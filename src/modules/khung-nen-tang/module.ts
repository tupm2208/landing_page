/**
 * @file The platform base ("khung-nen-tang") — shared infrastructure, NOT sold separately, cannot be switched off.
 *
 * The spec calls this "the platform base, 12 routes, belonging to no feature": admin account,
 * devices, initial setup, running version. Since 14/09/2026 (decided) the "devices" part is no
 * longer here: which machine may enter is Xeon's business (3-machine licence); the landing only
 * keeps Xeon's public key to verify tickets. What remains: registering with Xeon, page content,
 * the running version.
 */

import { ACCESS, defineModule, reply, type Caller, type ModuleContext } from "../../contract";
import { defaultPageContent, moneySettingsFrom, normalisePageContent, type MoneySettings, type PageContent } from "./page-content";
import {
  SHOP_SETTINGS_DOCUMENT, forScreen, mergeSettings, settingsOf, type ShopSettingsDocument
} from "./shop-settings";
import { readXeonRegistration, registerWithXeon, saveXeonRegistration, summariseXeonRegistration } from "./xeon-registration";

/** Document name — on-disk contract. */
export const PAGE_CONTENT_DOCUMENT = "khung-nen-tang-noi-dung";

const TEN_MINUTES = 10 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };

/** `ctx.config` as `app.ts` builds it (`moduleConfigFromEnv`). */
export interface Config {
  deployId: string;
  xeonAddress: string;
  landingAddress: string;
}

/** Where the inbox pushes messages and with which token. `null` until the landing registered. Field names are the service contract. */
export interface XeonInboxTarget {
  shop: string;
  diaChiXeon: string;
  maNhanTin: string;
}

/** Services this module provides (`khung-nen-tang.content` / `.moneySettings` / `.xeon` / `.settings`). */
export interface PlatformServices {
  content(): Promise<PageContent>;
  moneySettings(): Promise<MoneySettings>;
  xeon(): Promise<XeonInboxTarget | null>;
  /**
   * The shop's own keys and addresses — what used to be Sales Desk's `.env`. Secrets in the
   * clear: this is a module-to-module service, never an HTTP reply (see `shop-settings.ts`).
   */
  settings(): Promise<Record<string, string>>;
}

type Ctx = ModuleContext<Config>;

async function readPageContent(ctx: Ctx): Promise<PageContent> {
  const stored = await ctx.ports.store.document<Partial<PageContent>>(PAGE_CONTENT_DOCUMENT).read(null);
  return stored ? normalisePageContent(stored, stored.updatedAt || ctx.ports.clock.now()) : defaultPageContent();
}

async function readShopSettings(ctx: Ctx): Promise<Record<string, string>> {
  return settingsOf(await ctx.ports.store.document<Partial<ShopSettingsDocument>>(SHOP_SETTINGS_DOCUMENT).read(null));
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const text = (value: unknown): string => String(value ?? "").trim();

/** The caller as the admin screen expects it: the auth port speaks English, the wire speaks Vietnamese. */
function callerOnTheWire(caller: Caller): Record<string, unknown> {
  return {
    vai: caller.role, ten: caller.name, bang: caller.via, shop: caller.shop ?? null, maMay: caller.machineId ?? null,
    manh: caller.features ?? null, truc: caller.onDuty ?? null, hetLuc: caller.expiresAt ?? null
  };
}

export const manifest = defineModule<Config>({
  id: "khung-nen-tang",
  name: "Khung nền tảng",
  tier: "khung",
  runsOn: "server-khach",
  version: "0.3.0",
  ports: ["auth", "logger", "config", "store", "clock", "http"],

  provides: {
    // The money module reads deposit percent / shipping fee / transfer prefix from here, so the
    // owner edits ONE place in the admin screen and the whole system follows.
    "khung-nen-tang.content": (ctx): Promise<PageContent> => readPageContent(ctx),
    "khung-nen-tang.moneySettings": async (ctx): Promise<MoneySettings> => moneySettingsFrom(await readPageContent(ctx)),
    // The inbox reads this to know WHICH Xeon to push messages to, with which token. Not registered = null.
    "khung-nen-tang.xeon": async (ctx): Promise<XeonInboxTarget | null> => {
      const doc = await readXeonRegistration(ctx.ports.store);
      return doc ? { shop: doc.shop, diaChiXeon: doc.diaChiXeon, maNhanTin: doc.maNhanTin } : null;
    },
    // Shipping reads its carrier keys here, Money its Telegram bot: one place the owner edits in
    // OMI, no `.env` on the shop's server to hand-edit and no redeploy to pick a key up.
    "khung-nen-tang.settings": (ctx): Promise<Record<string, string>> => readShopSettings(ctx)
  },

  routes: [
    {
      // The admin screen sees: which shop on Xeon this landing is, registered when. Never the inbox token.
      method: "GET", path: "/api/admin/xeon", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const doc = await readXeonRegistration(ctx.ports.store);
        const me = ctx.ports.auth.identify(request);
        return reply.json({ ok: true, xeon: summariseXeonRegistration(doc), toi: callerOnTheWire(me) }, 200, NO_STORE);
      }
    },
    {
      // Register (again) with Xeon while running — on a key change, a Xeon change, or a reinstall.
      // Only a long-lived key (Desk) or a machine that entered with a ticket may call: admin.
      method: "POST", path: "/api/admin/xeon/dang-ky", access: ACCESS.admin,
      rateLimit: { calls: 10, windowMs: 15 * 60 * 1000 },
      bodyLimit: 4 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json()) ?? {};
        const previous = await readXeonRegistration(ctx.ports.store);
        try {
          const fresh = await registerWithXeon({
            http: ctx.ports.http,
            xeonAddress: text(body["diaChiXeon"]) || previous?.diaChiXeon || ctx.config.xeonAddress,
            key: text(body["key"]) || previous?.key || "",
            landingAddress: text(body["diaChiLanding"]) || previous?.diaChiLanding || ctx.config.landingAddress
          });
          const now = ctx.ports.clock.now();
          await saveXeonRegistration(ctx.ports.store, fresh, now);
          ctx.ports.auth.setXeon({ keyId: fresh.keyId, publicKeyPem: fresh.khoaCongPem, shop: fresh.shop });
          ctx.ports.logger.info(`[khung-nen-tang] dang ky voi Xeon ${fresh.diaChiXeon}: shop "${fresh.shop}"`);
          return reply.json({ ok: true, xeon: summariseXeonRegistration({ ...fresh, dangKyLuc: now.toISOString() }) }, 200, NO_STORE);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          ctx.ports.logger.warn(`[khung-nen-tang] dang ky Xeon that bai: ${message}`);
          return reply.json({ ok: false, error: "dang_ky_that_bai", message }, 502);
        }
      }
    },
    {
      // The storefront reads the home-page text, shipping fee and bank details from here.
      //
      // PUBLIC on purpose: the customer must be able to read the account number to transfer
      // money. That is why this reply holds only the fields declared in `page-content.ts` —
      // never a Telegram token or a key.
      method: "GET", path: "/api/content", access: ACCESS.public,
      whyPublic: "Chữ trên trang và thông tin chuyển khoản — thứ khách phải đọc được. Chỉ trả các trường đã khai, không có khoá nào.",
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json(await readPageContent(ctx), 200, { "Cache-Control": "public, max-age=60" })
    },
    {
      // The owner edits the page content.
      method: "POST", path: "/api/content", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      bodyLimit: 256 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        if (!body) return reply.json({ ok: false, error: "can_mot_doi_tuong" }, 400);
        const current = await readPageContent(ctx);
        const next = normalisePageContent({ ...current, ...body }, ctx.ports.clock.now());
        await ctx.ports.store.document<PageContent>(PAGE_CONTENT_DOCUMENT).write(next);
        ctx.ports.logger.info("[khung-nen-tang] noi dung trang da doi");
        return reply.json({ ok: true, noiDung: next }, 200, NO_STORE);
      }
    },
    {
      // THE SHOP'S CONFIGURATION, as OMI's "Kết nối" screen draws it: groups of fields, each
      // saying whether it is set. Secrets come back masked — see rule 1 of `shop-settings.ts`.
      method: "GET", path: "/api/admin/cau-hinh", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx) => reply.json({ ok: true, nhom: forScreen(await readShopSettings(ctx)) }, 200, NO_STORE)
    },
    {
      // Save. An empty secret means "unchanged" and `__xoa__` means "erase" (rule 3); an unknown
      // key is dropped (rule 2). The log names the keys that changed, never their values.
      method: "POST", path: "/api/admin/cau-hinh", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      bodyLimit: 64 * 1024,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        if (!body) return reply.json({ ok: false, error: "can_mot_doi_tuong" }, 400);
        const incoming = asObject(body["giaTri"]) ?? body;
        const current = await readShopSettings(ctx);
        const { next, changed } = mergeSettings(current, incoming);
        if (changed.length > 0) {
          await ctx.ports.store.document<ShopSettingsDocument>(SHOP_SETTINGS_DOCUMENT).write({ giaTri: next, updatedAt: ctx.ports.clock.now().toISOString() });
          ctx.ports.logger.info(`[khung-nen-tang] cấu hình shop đã đổi: ${changed.join(", ")}`);
        }
        return reply.json({ ok: true, daDoi: changed, nhom: forScreen(next) }, 200, NO_STORE);
      }
    },
    {
      // The running site has this route and Image Tool reads it after every deploy.
      method: "GET", path: "/api/runtime-version", access: ACCESS.public,
      whyPublic: "Chỉ trả phiên bản đang chạy — không đọc dữ liệu của shop. Image Tool gọi sau mỗi lần deploy.",
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: (ctx) => reply.json({ ok: true, deployId: String(ctx.config.deployId || "chua-dat"), runtimeRoot: "toprunvn-modules" }, 200, NO_STORE)
    }
  ],

  botTools: []
});
