/**
 * @file The kernel: loads modules, hands each its ports, routes requests, guards every door.
 *
 * The kernel knows nothing about products, orders or carriers. It knows what a module looks like
 * (the manifest), which ports it asked for, and where its routes lead. On every request it runs
 * the same chain, in this order and in ONE place, so no module can forget a step:
 *
 *   route match -> rate limit -> access check -> feature check -> body limit -> handler
 *
 * Loading is a composition step: the constructor wires ports, services and listeners and throws
 * on any inconsistency (missing port, missing required service, two owners for one table...).
 * A kernel that constructed is a kernel whose modules are all consistent with each other.
 */

import {
  ACCESS, ERROR_CODES, ManifestValidator, type AnyManifest, type IncomingRequest, type KernelRequest, type Logger,
  type ModuleBus, type ModuleContext, type ModulePorts, type Reply, type ReplyDraft, type ServiceMap, BodyError,
  type RateLimitPort, type AuthPort
} from "../contract";
import { EventBus } from "./event-bus";
import { Router, type RouteRow } from "./router";
import { callerAddress } from "./ports/rate-limiter";

/** Everything the composition root may plug into a kernel. Missing ports are only an error if a module asks for them. */
export interface KernelPorts extends Partial<ModulePorts> {
  rateLimiter?: RateLimitPort;
}

export interface KernelOptions {
  ports: KernelPorts;
  modules: AnyManifest[];
  logger?: Logger;
  /** Per-module configuration, keyed by module id. Modules never read `process.env`. */
  config?: Record<string, unknown>;
  /** Trust proxy headers for the caller address (only behind a real proxy). */
  trustProxy?: boolean;
}

export interface ModuleSummary {
  id: string;
  name: string;
  tier: string;
  version: string;
  routeCount: number;
  botTools: string[];
}

interface LoadedModule {
  manifest: AnyManifest;
  ctx: ModuleContext<unknown, ServiceMap>;
}

interface ProvidedService {
  moduleId: string;
  call: (...args: unknown[]) => unknown;
}

const NO_LOGGER: Logger = { info: () => undefined, warn: () => undefined };

export class Kernel {
  readonly bus: EventBus;
  private readonly router = new Router();
  private readonly loaded: LoadedModule[] = [];
  private readonly services = new Map<string, ProvidedService>();
  private readonly tableOwners = new Map<string, string>();
  private readonly logger: Logger;
  private readonly ports: KernelPorts;
  private readonly trustProxy: boolean;

  constructor(options: KernelOptions) {
    if (!Array.isArray(options.modules)) throw new Error("Kernel needs `modules`: an array of manifests");
    this.ports = options.ports;
    this.logger = options.logger ?? options.ports.logger ?? NO_LOGGER;
    this.trustProxy = options.trustProxy === true;
    this.bus = new EventBus(this.logger);

    const pending: { manifest: AnyManifest; services: Record<string, Record<string, (...a: unknown[]) => unknown>> }[] = [];
    for (const raw of options.modules) {
      const manifest = ManifestValidator.validate(raw, String((raw as { id?: unknown })?.id ?? "unknown"));
      if (manifest.runsOn !== "server-khach") {
        throw new Error(`Module "${manifest.id}" runs on "${manifest.runsOn}" — the merchant server does not load it.`);
      }
      const services: Record<string, Record<string, (...a: unknown[]) => unknown>> = {};
      const ctx: ModuleContext<unknown, ServiceMap> = {
        id: manifest.id,
        ports: this.portsFor(manifest),
        bus: this.busFor(manifest),
        services,
        config: (options.config ?? {})[manifest.id] ?? {}
      };
      this.claimTables(manifest);
      this.registerServices(manifest, ctx);
      this.registerRoutes(manifest, ctx);
      this.registerListeners(manifest, ctx);
      pending.push({ manifest, services });
      this.loaded.push({ manifest, ctx });
      this.logger.info(`[khung] nạp module "${manifest.id}" (${manifest.name}) — ${(manifest.routes ?? []).length} đường`);
    }
    // Services are wired after every module is loaded: a provider may come later than a consumer.
    for (const { manifest, services } of pending) this.wireServices(manifest, services);
  }

  // ---- loading -------------------------------------------------------------------------------

  /**
   * Only the declared ports are installed. An undeclared port is a getter that throws at the
   * line using it — never a silent fallback to another module's port.
   */
  private portsFor(manifest: AnyManifest): ModulePorts {
    const wanted = new Set(manifest.ports ?? []);
    const ports = {} as ModulePorts;
    for (const name of ["store", "logger", "clock", "http", "auth", "staticFiles", "mail", "uploads"] as const) {
      if (wanted.has(name)) {
        const port = this.ports[name];
        if (port === undefined) throw new Error(`Module "${manifest.id}" asks for port "${name}" but the kernel has no such port.`);
        Object.defineProperty(ports, name, { value: port, enumerable: true });
      } else {
        Object.defineProperty(ports, name, {
          enumerable: false,
          get: () => { throw new Error(`Module "${manifest.id}" uses port "${name}" without declaring it in \`ports\`.`); }
        });
      }
    }
    return ports;
  }

  private busFor(manifest: AnyManifest): ModuleBus {
    const allowed = new Set(manifest.events?.emits ?? []);
    return {
      emit: (event, payload) => {
        if (!allowed.has(event)) throw new Error(`Module "${manifest.id}" emits "${event}" without declaring it in \`events.emits\`.`);
        return this.bus.emit(event, payload);
      },
      listenerMap: () => this.bus.listenerMap()
    };
  }

  /** Every table has exactly ONE owner — inherited tables included. */
  private claimTables(manifest: AnyManifest): void {
    const tables = [...(manifest.inheritedTables ?? []), ...(manifest.schema ?? []).flatMap((s) => s.tables)];
    for (const table of tables) {
      const owner = this.tableOwners.get(table);
      if (owner && owner !== manifest.id) throw new Error(`Table "${table}" is claimed by two modules: "${owner}" and "${manifest.id}".`);
      this.tableOwners.set(table, manifest.id);
    }
  }

  /** The provider's own ctx is bound in; a consumer passes business arguments only. */
  private registerServices(manifest: AnyManifest, ctx: ModuleContext<unknown, ServiceMap>): void {
    for (const [name, fn] of Object.entries(manifest.provides ?? {})) {
      const existing = this.services.get(name);
      if (existing) throw new Error(`Service "${name}" is provided twice: by "${existing.moduleId}" and "${manifest.id}".`);
      const call = fn as (c: ModuleContext<unknown, ServiceMap>, ...args: unknown[]) => unknown;
      this.services.set(name, { moduleId: manifest.id, call: (...args) => call(ctx, ...args) });
    }
  }

  private registerRoutes(manifest: AnyManifest, ctx: ModuleContext<unknown, ServiceMap>): void {
    for (const r of manifest.routes ?? []) {
      // Route feature > module feature > none. `feature: false` exempts the route.
      const feature = r.feature === false ? null : (r.feature ?? manifest.feature ?? null);
      const handle = r.handle as (c: ModuleContext<unknown, ServiceMap>, req: KernelRequest) => Promise<ReplyDraft> | ReplyDraft;
      this.router.add({
        method: r.method, path: r.path, moduleId: manifest.id, access: r.access, feature,
        ...(r.rateLimit ? { rateLimit: r.rateLimit } : {}),
        ...(r.bodyLimit ? { bodyLimit: r.bodyLimit } : {}),
        handle: (request) => handle(ctx, request)
      });
    }
  }

  private registerListeners(manifest: AnyManifest, ctx: ModuleContext<unknown, ServiceMap>): void {
    for (const [event, listener] of Object.entries(manifest.events?.listens ?? {})) {
      const fn = listener as (c: ModuleContext<unknown, ServiceMap>, payload: unknown) => unknown;
      this.bus.on(event, manifest.id, (payload) => fn(ctx, payload));
    }
  }

  /** A missing required service aborts loading: the operator just switched off a module another one relies on. */
  private wireServices(manifest: AnyManifest, into: Record<string, Record<string, (...a: unknown[]) => unknown>>): void {
    const attach = (name: string, provider: ProvidedService) => {
      const [group, method] = name.split(".") as [string, string];
      (into[group] ??= {})[method] = provider.call;
    };
    for (const name of manifest.requires ?? []) {
      const provider = this.services.get(name);
      if (!provider) {
        throw new Error(
          `Module "${manifest.id}" requires service "${name}" but no loaded module provides it ` +
          `(module "${name.split(".")[0]}" is not loaded or is switched off).`
        );
      }
      attach(name, provider);
    }
    for (const name of manifest.requiresOptional ?? []) {
      const provider = this.services.get(name);
      if (!provider) {
        this.logger.info(`[khung] module "${manifest.id}": dịch vụ "${name}" không có — phần dùng nó đang TẮT.`);
        continue;
      }
      attach(name, provider);
    }
    for (const group of Object.values(into)) Object.freeze(group);
    Object.freeze(into);
  }

  // ---- handling ------------------------------------------------------------------------------

  /** Handles one request without Node's http objects — tests call this directly. */
  async handle(incoming: IncomingRequest): Promise<Reply> {
    const match = this.router.match(incoming.method, incoming.path);
    // An unknown route is almost always an OMI newer than this landing: say so, and name the route.
    if (match.kind === "none") {
      return { status: 404, body: { ok: false, error: ERROR_CODES.notFound, khongCoDuong: true, message: `Landing chưa có chức năng này (${incoming.method} ${incoming.path}) — landing đang chạy bản cũ hơn OMI, hoặc chưa bật mảnh chứa nó. Cập nhật mã landing, build lại và bật lại landing.` } };
    }
    if (match.kind === "wrong-method") {
      return { status: 405, body: { ok: false, error: ERROR_CODES.badRequest, message: "Phương thức không đúng cho đường này." } };
    }
    const { route, params } = match;
    const request = this.normalise(incoming, params);

    // Rate limit BEFORE any work: a flooder must not make the server do anything, not even auth.
    if (route.rateLimit && this.ports.rateLimiter) {
      const who = callerAddress(request, { trustProxy: this.trustProxy });
      const verdict = this.ports.rateLimiter.hit(`${request.method} ${route.path}|${who}`, route.rateLimit.calls, route.rateLimit.windowMs);
      if (!verdict.allowed) {
        this.logger.warn(`[khung] chặn gọi dồn: ${request.method} ${route.path} từ ${who}`);
        return {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(verdict.retryAfterMs / 1000)) },
          body: { ok: false, error: ERROR_CODES.tooManyRequests, message: "Hệ thống đang nhận quá nhiều yêu cầu. Vui lòng thử lại sau ít phút." }
        };
      }
    }

    // Access is checked HERE, once. Modules never check it themselves, so nobody can forget.
    if (route.access !== ACCESS.public) {
      const refused = await this.checkAccess(route.access, route.feature, request, route.path);
      if (refused) return refused;
    }

    try {
      if (route.bodyLimit) incoming.setBodyLimit?.(route.bodyLimit);
      const draft = await route.handle(request);
      if (!draft || typeof draft !== "object") throw new Error(`Module "${route.moduleId}" returned nothing for ${request.method} ${request.path}`);
      return withDefaultStatus(draft);
    } catch (e) {
      // An oversized or non-JSON body is the CALLER's mistake. It surfaces from `request.json()`,
      // i.e. inside the handler, so it must be caught here or it would become a 500 plus an alarm.
      if (e instanceof BodyError) {
        return e.kind === "too-large"
          ? { status: 413, body: { ok: false, error: ERROR_CODES.badRequest, message: "Yêu cầu quá lớn." } }
          : { status: 400, body: { ok: false, error: ERROR_CODES.badRequest, message: "Thân yêu cầu không phải JSON." } };
      }
      this.logger.warn(`[khung] module "${route.moduleId}" lỗi ở ${request.method} ${request.path}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      return { status: 500, body: { ok: false, error: ERROR_CODES.internal } };
    }
  }

  private async checkAccess(access: string, feature: string | null, request: KernelRequest, routePath: string): Promise<Reply | null> {
    const auth: AuthPort | undefined = this.ports.auth;
    if (!auth) {
      this.logger.warn(`[khung] đường ${request.method} ${request.path} khai quyền "${access}" nhưng khung không có cổng quyền`);
      return { status: 500, body: { ok: false, error: ERROR_CODES.internal } };
    }
    // Resolved ONCE: a token or ticket, else a person's session cookie (which needs a table lookup).
    const caller = await auth.resolve(request);
    if (!auth.callerAllows(caller, access as never)) {
      // Log WHO was refused, not just that someone was — it is what gets traced when something happens.
      this.logger.warn(`[khung] từ chối ${request.method} ${routePath}: cần "${access}", người gọi là "${caller.name || "không rõ"}" (${caller.via})`);
      return { status: 401, body: { ok: false, error: ERROR_CODES.unauthenticated, message: "Thiếu mã hoặc mã không đủ quyền cho đường này." } };
    }
    // Feature gate: the ticket lists what the shop bought; a route of an unbought feature is 403
    // and names the feature, so OMI shows "chưa mua mảnh X" instead of a mystery error.
    if (feature && auth.callerLacksFeature(caller, feature)) {
      this.logger.warn(`[khung] từ chối ${request.method} ${routePath}: "${caller.name}" chưa mua mảnh "${feature}"`);
      return { status: 403, body: { ok: false, error: ERROR_CODES.featureNotBought, manh: feature, message: `Shop chưa mua mảnh "${feature}".` } };
    }
    request.caller = caller;
    // A person changing something is written down: the web admin has no machine name to trace.
    if (caller.via === "phien-nguoi" && request.method !== "GET") {
      this.logger.info(`[khung] ${caller.name} ${request.method} ${routePath}`);
    }
    return null;
  }

  private normalise(incoming: IncomingRequest, params: Record<string, string>): KernelRequest {
    return {
      method: incoming.method,
      path: incoming.path,
      params,
      query: incoming.query ?? {},
      headers: incoming.headers ?? {},
      ip: incoming.ip ?? "",
      json: incoming.json ?? (async () => ({})),
      raw: incoming.raw ?? (async () => Buffer.alloc(0))
    };
  }

  // ---- introspection -------------------------------------------------------------------------

  routes(): RouteRow[] { return this.router.list(); }

  serviceTable(): { name: string; moduleId: string }[] {
    return [...this.services.entries()].map(([name, s]) => ({ name, moduleId: s.moduleId }));
  }

  tableOwnerTable(): { table: string; moduleId: string }[] {
    return [...this.tableOwners.entries()].map(([table, moduleId]) => ({ table, moduleId }));
  }

  modules(): ModuleSummary[] {
    return this.loaded.map(({ manifest }) => ({
      id: manifest.id, name: manifest.name, tier: manifest.tier, version: manifest.version,
      routeCount: (manifest.routes ?? []).length,
      botTools: (manifest.botTools ?? []).map((t) => t.ten)
    }));
  }

  /** Every bot tool of every module, tagged with its module — the brain reads this list over HTTP. */
  botTools(): Record<string, unknown>[] {
    return this.loaded.flatMap(({ manifest }) => (manifest.botTools ?? []).map((t) => ({ ...t, module: manifest.id })));
  }
}

function withDefaultStatus(draft: ReplyDraft): Reply {
  if (draft.status !== undefined) return draft as Reply;
  return { ...draft, status: draft.redirect ? 302 : 200 };
}

/** Function form for call sites that read better without `new`. */
export function createKernel(options: KernelOptions): Kernel {
  return new Kernel(options);
}
