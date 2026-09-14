/**
 * @file The module manifest: what a module IS, and the validator that refuses a bad one.
 *
 * A manifest is data the kernel reads before loading a module: its routes and who may call them,
 * the ports it needs, the events it emits and listens to, the services it provides and requires,
 * the tables it owns. Everything that used to be an ad-hoc check scattered through the old
 * `server.js` is declared here once, and the kernel enforces it.
 *
 * The validator THROWS on the first defect: a module with a broken manifest is not loaded at all,
 * rather than running with half its doors unguarded. Its messages are for developers (English).
 */

import type { ModuleContext, RouteHandler, ServiceMap } from "./http";
import { ACCESS_LEVELS, PORT_NAMES, type Access, type PortName, type SchemaStep } from "./ports";

/** Where a module can run. This server loads only `server-khach` modules. */
export const RUN_TARGETS = ["server-khach", "bo-nao", "omi"] as const;
export type RunTarget = (typeof RUN_TARGETS)[number];

/**
 * The sales tiers (decided 09/09/2026) plus `khung`: the platform base that is not sold
 * separately and cannot be switched off (admin account, tickets, initial setup).
 */
export const TIERS = ["van-hanh", "content", "chatbot", "khung"] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Effects a bot tool may have. RULE: no tool exposed to the bot may carry the "tien" (money)
 * effect — spending money always waits for a human.
 */
export const TOOL_EFFECTS = ["doc", "ghi", "tien"] as const;
export type ToolEffect = (typeof TOOL_EFFECTS)[number];

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface RateLimitSpec {
  calls: number;
  windowMs: number;
}

/** One HTTP route. `access` is mandatory: forgetting it is a manifest error, not an open door. */
export interface RouteSpec<TConfig = Record<string, unknown>, TServices = ServiceMap> {
  method: HttpMethod;
  path: string;
  access: Access;
  /** Required on public routes: how the route protects itself without a token. */
  whyPublic?: string;
  /** Required on public routes: a door open to the Internet is never left unlimited. */
  rateLimit?: RateLimitSpec;
  /** Per-route body limit in bytes. The catalogue door needs 12 MB; an order needs 1 MB. */
  bodyLimit?: number;
  /** Feature this route belongs to; overrides the module's. `false` exempts the route. */
  feature?: string | false;
  handle: RouteHandler<TConfig, TServices>;
}

/** A tool the brain may call through this module (listed to Xeon by `cong-bo-nao`). Field names are wire. */
export interface BotToolSpec {
  ten: string;
  hieuUng: ToolEffect;
  [extra: string]: unknown;
}

export type ServiceFn<TConfig = Record<string, unknown>, TServices = ServiceMap> =
  (ctx: ModuleContext<TConfig, TServices>, ...args: never[]) => unknown;

export type EventListener<TConfig = Record<string, unknown>, TServices = ServiceMap> =
  (ctx: ModuleContext<TConfig, TServices>, payload: unknown) => unknown;

export interface ModuleManifest<TConfig = Record<string, unknown>, TServices = ServiceMap> {
  /** Lower-case, hyphenated; equals the module's directory name and prefixes its tables. */
  id: string;
  /** Vietnamese display name for the operator. */
  name: string;
  tier: Tier;
  runsOn: RunTarget;
  version: string;
  /**
   * The sellable feature this module belongs to. Machine tickets from Xeon list the features a
   * shop bought; the kernel refuses routes of features not on the ticket (403 with the feature id).
   */
  feature?: string;
  ports?: PortName[];
  routes?: RouteSpec<TConfig, TServices>[];
  events?: {
    emits?: string[];
    listens?: Record<string, EventListener<TConfig, TServices>>;
  };
  /**
   * Services this module PROVIDES, named `<own id>.<name>`. The only way another module reads
   * this module's data: the bus is one-way and cannot answer a question.
   */
  provides?: Record<string, ServiceFn<TConfig, TServices>>;
  /** Services this module needs; a missing one aborts loading with a clear message. */
  requires?: string[];
  /** Services used if present; absent ones switch that part off (logged at startup). */
  requiresOptional?: string[];
  /** Tables inherited from the old site (`orders`...) that do not follow the prefix rule. */
  inheritedTables?: string[];
  schema?: SchemaStep[];
  botTools?: BotToolSpec[];
}

/** A manifest with its generics erased — what the kernel and the registry hold. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyManifest = ModuleManifest<any, any>;

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const TABLE_PATTERN = /^[a-z][a-z0-9_]*$/;
const SERVICE_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-zA-Z0-9]*$/;

/** Prefix every NEW table of a module must carry: the id with hyphens turned into underscores. */
export function tablePrefixFor(moduleId: string): string {
  return `${moduleId.replace(/-/g, "_")}_`;
}

/**
 * Checks one manifest and throws on the first defect. Returns the manifest for chaining.
 *
 * Kept as a class so each rule is a small named method: the error message says which rule
 * failed, and adding a rule is adding a method plus a line in `validate()`.
 */
export class ManifestValidator {
  constructor(private readonly source: string) {}

  static validate(manifest: unknown, source: string): AnyManifest {
    return new ManifestValidator(source).validate(manifest);
  }

  private fail(reason: string): never {
    throw new Error(`Invalid module manifest (${this.source}): ${reason}`);
  }

  validate(input: unknown): AnyManifest {
    if (!input || typeof input !== "object") this.fail("not an object");
    const m = input as AnyManifest;
    this.checkIdentity(m);
    this.checkPorts(m);
    this.checkRoutes(m);
    this.checkEvents(m);
    this.checkServices(m);
    this.checkTables(m);
    this.checkBotTools(m);
    return m;
  }

  private checkIdentity(m: AnyManifest): void {
    if (typeof m.id !== "string" || !ID_PATTERN.test(m.id)) this.fail(`id must be lower-case-hyphenated, got ${JSON.stringify(m.id)}`);
    if (typeof m.name !== "string" || m.name.trim() === "") this.fail("missing `name` (Vietnamese display name)");
    if (!TIERS.includes(m.tier)) this.fail(`\`tier\` must be one of ${TIERS.join(", ")}`);
    if (!RUN_TARGETS.includes(m.runsOn)) this.fail(`\`runsOn\` must be one of ${RUN_TARGETS.join(", ")}`);
    if (typeof m.version !== "string") this.fail("missing `version`");
    if (m.feature !== undefined && (typeof m.feature !== "string" || !ID_PATTERN.test(m.feature))) {
      this.fail(`module \`feature\` must be a lower-case-hyphenated feature id, got ${JSON.stringify(m.feature)}`);
    }
  }

  private checkPorts(m: AnyManifest): void {
    const ports = m.ports ?? [];
    if (!Array.isArray(ports)) this.fail("`ports` must be an array");
    for (const p of ports) if (!PORT_NAMES.includes(p)) this.fail(`unknown port requested: ${String(p)}`);
  }

  private checkRoutes(m: AnyManifest): void {
    const routes = m.routes ?? [];
    if (!Array.isArray(routes)) this.fail("`routes` must be an array");
    for (const r of routes) {
      const where = `route ${String(r.method)} ${String(r.path)}`;
      if (!HTTP_METHODS.includes(r.method)) this.fail(`${where}: unsupported method`);
      if (typeof r.path !== "string" || !r.path.startsWith("/")) this.fail(`${where}: path must start with "/"`);
      if (typeof r.handle !== "function") this.fail(`${where}: missing handler (\`handle\`)`);
      if (r.feature !== undefined && r.feature !== false && (typeof r.feature !== "string" || !ID_PATTERN.test(r.feature))) {
        this.fail(`${where}: \`feature\` must be a feature id or false`);
      }
      // Fail closed: a route without an access level is a manifest error, never an open door.
      if (!ACCESS_LEVELS.includes(r.access)) {
        this.fail(`${where}: must declare \`access\` (${ACCESS_LEVELS.join(" | ")}), got ${JSON.stringify(r.access)}`);
      }
      // A door open to the whole world must say what protects it.
      if (r.access === "cong-khai" && (typeof r.whyPublic !== "string" || r.whyPublic.trim().length < 10)) {
        this.fail(`${where}: a public route must explain its own protection in \`whyPublic\``);
      }
      if (r.bodyLimit !== undefined && (!Number.isInteger(r.bodyLimit) || r.bodyLimit <= 0)) {
        this.fail(`${where}: \`bodyLimit\` must be a positive integer (bytes)`);
      }
      if (r.rateLimit !== undefined) {
        const h = r.rateLimit;
        if (!h || typeof h !== "object") this.fail(`${where}: \`rateLimit\` must be { calls, windowMs }`);
        if (!Number.isInteger(h.calls) || h.calls <= 0) this.fail(`${where}: rateLimit.calls must be a positive integer`);
        if (!Number.isInteger(h.windowMs) || h.windowMs <= 0) this.fail(`${where}: rateLimit.windowMs must be a positive integer`);
      } else if (r.access === "cong-khai") {
        // Nothing identifies a caller on a public route, so the rate limit is the only brake.
        this.fail(`${where}: a public route MUST declare \`rateLimit\` — a door to the Internet is never unlimited`);
      }
    }
  }

  private checkEvents(m: AnyManifest): void {
    const events = m.events ?? {};
    const emits = events.emits ?? [];
    if (!Array.isArray(emits)) this.fail("`events.emits` must be an array of event names");
    const listens = events.listens ?? {};
    if (typeof listens !== "object" || listens === null) this.fail("`events.listens` must be an object { name: listener }");
    for (const [name, fn] of Object.entries(listens)) {
      if (typeof fn !== "function") this.fail(`listener for "${name}" is not a function`);
    }
  }

  private checkServices(m: AnyManifest): void {
    const provides = m.provides ?? {};
    if (typeof provides !== "object" || provides === null) this.fail("`provides` must be an object { name: fn }");
    for (const [name, fn] of Object.entries(provides)) {
      if (!SERVICE_PATTERN.test(name)) this.fail(`service name must look like "<module>.<name>": ${name}`);
      if (!name.startsWith(`${m.id}.`)) this.fail(`service "${name}" must start with the module's own id ("${m.id}.")`);
      if (typeof fn !== "function") this.fail(`service "${name}" is not a function`);
    }
    const requires = m.requires ?? [];
    const optional = m.requiresOptional ?? [];
    if (!Array.isArray(requires)) this.fail("`requires` must be an array of service names");
    if (!Array.isArray(optional)) this.fail("`requiresOptional` must be an array of service names");
    const seen = new Set<string>();
    for (const name of [...requires, ...optional]) {
      if (typeof name !== "string") this.fail("service names must be strings");
      if (name.startsWith(`${m.id}.`)) this.fail(`module requires its own service: ${name}`);
      if (seen.has(name)) this.fail(`service "${name}" is both required and optional — pick one`);
      seen.add(name);
    }
  }

  private checkTables(m: AnyManifest): void {
    const inherited = m.inheritedTables ?? [];
    if (!Array.isArray(inherited)) this.fail("`inheritedTables` must be an array of table names");
    const inheritedSet = new Set<string>();
    for (const t of inherited) {
      if (typeof t !== "string" || !TABLE_PATTERN.test(t)) this.fail(`invalid inherited table name: ${JSON.stringify(t)}`);
      if (inheritedSet.has(t)) this.fail(`inherited table "${t}" declared twice`);
      inheritedSet.add(t);
    }
    const schema = m.schema ?? [];
    if (!Array.isArray(schema)) this.fail("`schema` must be an array of steps { name, sql, tables }");
    const prefix = tablePrefixFor(m.id);
    const stepNames = new Set<string>();
    for (const step of schema) {
      if (typeof step?.name !== "string" || step.name.trim() === "") this.fail("every schema step needs a `name`");
      if (stepNames.has(step.name)) this.fail(`two schema steps share the name "${step.name}" — the history would collide`);
      stepNames.add(step.name);
      if (typeof step.sql !== "string" || step.sql.trim() === "") this.fail(`schema step "${step.name}" has no \`sql\``);
      if (!Array.isArray(step.tables) || step.tables.length === 0) this.fail(`schema step "${step.name}" must list the \`tables\` it touches`);
      for (const t of step.tables) {
        // New tables carry the module prefix; inherited ones must be declared as such. Either way
        // every table has exactly one owner and the manifest says which module created it.
        const ok = typeof t === "string" && (t.startsWith(prefix) || inheritedSet.has(t));
        if (!ok) this.fail(`step "${step.name}" touches table "${String(t)}" — names must start with "${prefix}" or be listed in \`inheritedTables\``);
      }
    }
  }

  private checkBotTools(m: AnyManifest): void {
    const tools = m.botTools ?? [];
    if (!Array.isArray(tools)) this.fail("`botTools` must be an array");
    for (const tool of tools) {
      if (typeof tool.ten !== "string") this.fail("bot tool is missing `ten`");
      if (!TOOL_EFFECTS.includes(tool.hieuUng)) this.fail(`bot tool "${tool.ten}" must declare hieuUng: ${TOOL_EFFECTS.join("|")}`);
      if (tool.hieuUng === "tien") this.fail(`bot tool "${tool.ten}" carries the "tien" effect — the bot must never spend money`);
    }
  }
}

/** Function form of the validator for call sites that read better without a class. */
export function validateManifest(manifest: unknown, source: string): AnyManifest {
  return ManifestValidator.validate(manifest, source);
}

/**
 * Identity helper that keeps a module's generics: `export const manifest = defineModule<Config, Services>({...})`.
 * Validation happens when the kernel loads the module, not here — a manifest file must stay
 * side-effect free so tests can import it.
 */
export function defineModule<TConfig = Record<string, unknown>, TServices = ServiceMap>(
  manifest: ModuleManifest<TConfig, TServices>
): ModuleManifest<TConfig, TServices> {
  return manifest;
}
