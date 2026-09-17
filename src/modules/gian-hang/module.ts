/**
 * @file STOREFRONT module ("gian-hang") — the web face customers see. Tier "van-hanh", runs on the merchant server.
 *
 * This module has NO business logic: it knows no prices, no stock, writes no table. It does
 * exactly three things:
 *   1. Serves the storefront files (HTML, CSS, JS, images) — through the `staticFiles` port,
 *      never by opening `fs` itself.
 *   2. Maps a few friendly paths: "/" -> index.html, "/mobile" -> mobile.html,
 *      "/product/<slug>" -> product.html, "/ctv-login" and "/ctv-account" -> the collaborator pages.
 *   3. Injects Open Graph tags into the product page, because Facebook's crawler runs no JavaScript.
 *
 * THE UI HERE IS A VERBATIM COPY of the running site (directory `goc/`), as Dũng decided on
 * 12/09/2026: "put every feature in for the trial, improve module by module later". So `goc/`
 * is exempt from the split rules and nobody may call it split code.
 *
 * THIS IS THE PLACE MOST LIKELY TO LEAK A FILE in the whole system. That is why the
 * `staticFiles` port ALLOWS BY LIST (the extension must be declared) instead of blocking by a
 * deny list.
 */

import { ACCESS, ERROR_CODES, defineModule, reply, type KernelRequest, type ModuleContext, type ReplyDraft, type StaticZone } from "../../contract";
import type { InventoryServices } from "../hang-kho/module";
import { injectOpenGraph, productKeyFromRequest, type ProductLike } from "./open-graph";
import { decodeShareToken } from "./share-links";

/** `ctx.config` as built by `moduleConfigFromEnv()` in app.ts. */
export interface Config {
  /** The real site origin for OG tags and canonical links (Facebook's crawler reads them). */
  siteUrl: string;
  /** Origin of the real product images (`GOC_ANH_THAT`); empty = no redirect for missing images. */
  realImageOrigin: string;
}

/**
 * The slice of the inventory service this module uses. Declared locally because
 * `../hang-kho/module` does not export its service types yet; swap for
 * `import type { InventoryServices }` once it does.
 */
export interface Services {
  "hang-kho"?: Pick<InventoryServices, "read">;
  /** Collaborators: a `?ref=CODE` landing sets the 30-day referral cookie (running site's rule). */
  "ctv"?: { referralCookieFor(code: unknown): Promise<Record<string, string> | null> };
}

/** A storefront page, with the referral cookie added when the address carries a valid `?ref=`. */
async function withReferral(ctx: Ctx, request: KernelRequest, page: Promise<ReplyDraft>): Promise<ReplyDraft> {
  const reply = await page;
  const code = request.query["ref"];
  const set = code ? await ctx.services["ctv"]?.referralCookieFor(code).catch(() => null) : null;
  return set ? { ...reply, headers: { ...(reply.headers ?? {}), ...set } } : reply;
}

type Ctx = ModuleContext<Config, Services>;

const MINUTES_10 = 10 * 60 * 1000;

/** The storefront lives in this module's own `goc/`. */
function zoneOf(ctx: Ctx): StaticZone {
  return ctx.ports.staticFiles.open(`${ctx.id}/goc`);
}

function isPhone(request: KernelRequest): boolean {
  const ua = String(request.headers["user-agent"] || "").toLowerCase();
  return /iphone|ipod|android.*mobile|windows phone|blackberry|mobile safari/.test(ua);
}

function siteUrlOf(ctx: Ctx): string {
  return String(ctx.config.siteUrl || "https://toprun.site").trim().replace(/\/+$/, "");
}

function realImageOriginOf(ctx: Ctx): string {
  return String(ctx.config.realImageOrigin || "").trim().replace(/\/+$/, "");
}

/**
 * The real product images live on the real site: 33,809 files, 7.6 GB — not copied to the
 * split build.
 *
 * So when a file under `/assets/` is not here and `realImageOrigin` is set, we 302 to the real
 * site and the browser fetches it. The trial machine makes NO outbound call (nothing passes
 * through trial mode); it only points.
 *
 * The target is NOT taken from the request: the origin comes from the config and the path must
 * match the image pattern below. This can never become an open redirect.
 */
const IMAGE_PATTERN = /^\/assets\/[A-Za-z0-9_\-./]+\.(?:png|jpe?g|webp|gif|svg|ico|woff2?|ttf|mp4)$/i;

function realImageUrl(ctx: Ctx, path: string): string | null {
  const origin = realImageOriginOf(ctx);
  if (!origin) return null;
  const p = String(path || "");
  if (p.includes("..") || !IMAGE_PATTERN.test(p)) return null;
  return `${origin}${p}`;
}

async function serveFile(ctx: Ctx, path: string, extraHeaders: Record<string, string> = {}): Promise<ReplyDraft> {
  const file = await zoneOf(ctx).read(path);
  if (!file) {
    const elsewhere = realImageUrl(ctx, path);
    if (elsewhere) return { redirect: elsewhere, status: 302, headers: { "Cache-Control": "public, max-age=86400" } };
    // /api/... khong co tuyen roi vao day (tuyen GET /* cua gian hang): noi ro la thieu chuc nang, khong phai thieu tep.
    if (path.startsWith("/api/")) return reply.json({ ok: false, error: ERROR_CODES.notFound, khongCoDuong: true, message: `Landing chưa có chức năng này (GET ${path}) — landing đang chạy bản cũ hơn OMI, hoặc chưa bật mảnh chứa nó. Cập nhật mã landing, build lại và bật lại landing.` }, 404);
    return reply.json({ ok: false, error: ERROR_CODES.notFound, message: "Không có tệp này." }, 404);
  }
  return reply.file(file.data, file.type, 200, { "Cache-Control": file.cacheControl, ...extraHeaders });
}

/** Product page: read the product, inject the OG tags. Without the inventory module the bare page is served. */
async function productPage(ctx: Ctx, request: KernelRequest): Promise<ReplyDraft> {
  const template = await zoneOf(ctx).read("/product.html");
  if (!template) return reply.json({ ok: false, error: ERROR_CODES.notFound }, 404);

  const key = productKeyFromRequest({ path: request.path, query: request.query });
  let product: ProductLike | null = null;
  const read = ctx.services["hang-kho"]?.read;
  if (key && key.length <= 160 && read) {
    try {
      const found = await read(key);
      if (found && String(found["status"] || "").trim().toLowerCase() !== "hidden") product = found;
    } catch (e) {
      // A broken product read must still return the page to the customer — only the OG tags are lost.
      ctx.ports.logger.warn(`[gian-hang] khong doc duoc mon "${key}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const zone = zoneOf(ctx);
  const { html, found } = await injectOpenGraph({
    template: template.data.toString("utf8"),
    product, key,
    siteUrl: siteUrlOf(ctx),
    fileExists: (path) => zone.exists(path),
    realImageOrigin: realImageOriginOf(ctx)
  });

  return reply.file(Buffer.from(html, "utf8"), "text/html; charset=utf-8", 200, {
    "Cache-Control": "public, max-age=300",
    ...(found ? {} : { "X-Robots-Tag": "noindex, nofollow" })
  });
}

export const manifest = defineModule<Config, Services>({
  id: "gian-hang",
  name: "Gian hàng (mặt web)",
  tier: "van-hanh",
  runsOn: "server-khach",
  feature: "gian-hang",
  version: "0.1.0",
  ports: ["staticFiles", "logger", "config"],

  // With the inventory module the product page carries OG tags; without it the page still works.
  requiresOptional: ["hang-kho.read", "ctv.referralCookieFor"],

  routes: [
    {
      method: "GET", path: "/", access: ACCESS.public,
      whyPublic: "Trang chu cua web ban hang. Chi tra tep tinh, khong doc du lieu khach.",
      rateLimit: { calls: 600, windowMs: MINUTES_10 },
      handle: async (ctx, request) => {
        // A phone landing on "/" goes to the mobile build — same as the running site.
        if (isPhone(request)) {
          const query = new URLSearchParams(request.query).toString();
          return { redirect: `/mobile${query ? `?${query}` : ""}`, status: 302 };
        }
        return withReferral(ctx, request, serveFile(ctx, "/index.html"));
      }
    },
    {
      method: "GET", path: "/mobile", access: ACCESS.public,
      whyPublic: "Ban web cho dien thoai. Chi tra tep tinh, khong doc du lieu khach.",
      rateLimit: { calls: 600, windowMs: MINUTES_10 },
      handle: async (ctx, request) => withReferral(ctx, request, serveFile(ctx, "/mobile.html"))
    },
    {
      // The collaborator pages navigate to these friendly paths (ctv-login.js, ctv-account.js); the
      // catch-all cannot serve them because it only serves declared extensions.
      method: "GET", path: "/ctv-login", access: ACCESS.public,
      whyPublic: "Trang dang nhap cong tac vien. Chi tra tep tinh, khong doc du lieu.",
      rateLimit: { calls: 600, windowMs: MINUTES_10 },
      handle: async (ctx) => serveFile(ctx, "/ctv-login.html")
    },
    {
      method: "GET", path: "/ctv-account", access: ACCESS.public,
      whyPublic: "Trang tai khoan cong tac vien. Chi tra tep tinh; du lieu lay qua /api/ctv/me, can phien dang nhap.",
      rateLimit: { calls: 600, windowMs: MINUTES_10 },
      handle: async (ctx) => serveFile(ctx, "/ctv-account.html")
    },
    {
      method: "GET", path: "/product.html", access: ACCESS.public,
      whyPublic: "Trang san pham cong khai, kem the OG de share ra Facebook.",
      rateLimit: { calls: 600, windowMs: MINUTES_10 },
      handle: (ctx, request) => withReferral(ctx, request, productPage(ctx, request))
    },
    {
      method: "GET", path: "/product/:khoa", access: ACCESS.public,
      whyPublic: "Trang san pham cong khai theo duong dan dep, kem the OG.",
      rateLimit: { calls: 600, windowMs: MINUTES_10 },
      handle: (ctx, request) => withReferral(ctx, request, productPage(ctx, request))
    },
    {
      method: "GET", path: "/l/:token", access: ACCESS.public,
      whyPublic: "Link chia se bo loc. Chi 302 ve chinh site, khoa loc phai co trong danh sach khai.",
      rateLimit: { calls: 300, windowMs: MINUTES_10 },
      handle: async (_ctx, request) => ({
        redirect: decodeShareToken(request.params["token"]), status: 302,
        headers: { "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" }
      })
    },
    {
      // CATCHES EVERYTHING ELSE. Matched LAST (the router sorts "*" routes to the end), so it
      // never swallows another module's API route.
      method: "GET", path: "/*", access: ACCESS.public,
      whyPublic: "Tep cua mat web (CSS, JS, anh). Cong tepTinh chi tra duoi tep da khai, trong dung thu muc goc/ cua module.",
      rateLimit: { calls: 6000, windowMs: MINUTES_10 },
      handle: async (ctx, request) => {
        // The running site's partner links were `/partner-<code>`; the router matches whole path
        // segments, so the portal moved to `/partner/<code>`. Links already sent to partners (and
        // bookmarked on their phones) must still arrive — this is the only route that sees them.
        const oldPartnerLink = /^\/partner-([A-Za-z0-9_-]{8,})$/.exec(request.path);
        if (oldPartnerLink) return { redirect: `/partner/${oldPartnerLink[1]}`, status: 301, headers: { "Cache-Control": "no-store" } };
        return serveFile(ctx, request.path);
      }
    }
  ]
});
