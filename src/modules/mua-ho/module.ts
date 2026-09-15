/**
 * @file MODULE PURCHASING & AUTO-ORDERING ("mua-ho") — tier "van-hanh", runs on the merchant server.
 *
 * The portal for PURCHASING PARTNERS: they open their private link, see what needs buying,
 * report how much they bought, or report it out of stock.
 *
 * FOUR RULES THAT MUST NOT BREAK:
 *
 * 1. NOT LOGGED IN = ONLY THE LOGIN SCREEN. Not one piece of partner data — name, list to buy,
 *    cost price — leaks before a valid session. Dũng's rule in AGENTS.md; a test guards it.
 *
 * 2. OUT-OF-STOCK IS KEYED BY LINE ID, NOT LINE POSITION. Incident ORD-1788854262493
 *    (10/09/2026): the report was re-applied by position every 15 seconds, so removing one line
 *    let another slide into that position and be marked out of stock — the customer was told wrong.
 *
 * 3. THE SAME COMMAND TWICE IS NOT WRITTEN TWICE. Weak network, partner taps again — same result,
 *    not two purchase slips. The unique key (partner + command id) guarantees it.
 *
 * 4. THE COST PRICE IS THE SHOP'S, NOT THE PARTNER'S. Partners report the cost they bought at;
 *    the price sold to the customer they never see.
 */

import { ACCESS, ERROR_CODES, EVENTS, defineModule, type KernelRequest, type ModuleContext, type ReplyDraft } from "../../contract";
import type { OrderServices as OrderServicesOf } from "../don-khach/module";
import { toMysqlDateTime } from "../../shared/mysql-time";
import { PartnerSession, type PartnerSessionConfig } from "./partner-session";
import { PurchaseRepository, isDuplicateKeyError, type Partner, type StockOutReport } from "./purchase-repository";
import { SCHEMA } from "./schema";

/** `ctx.config` as `app.ts` builds it. */
export type Config = PartnerSessionConfig;

/**
 * The order slice this module reads (order wire format). Declared locally from the old JS: the
 * Orders module is being ported in parallel.
 */
export interface OrderForPurchasing {
  id?: string;
  items?: { variantId?: string | number; productCode?: string; productName?: string; size?: string; qty?: number | string }[];
}

/**
 * Minimal structural type of the Orders search — declared locally, not `import type`d, so this
 * module's build never pulls the Orders module's files in while both are ported in parallel.
 * Mirrors the current `OrderServices["don-khach"].search(filter)`.
 */
type OrderServices = OrderServicesOf["don-khach"];

interface Services {
  "don-khach": Pick<OrderServices, "search">;
}

type Ctx = ModuleContext<Config, Services>;

/** One order line a partner must buy. Wire: returned as `canMua[]` to the portal. */
export interface PurchaseTask {
  maDong: string;
  maDon: string;
  maMon: string;
  ten: string;
  size: string;
  soLuong: number;
}

export type ReportPurchaseResult =
  | { ok: true; trungLenh: true; maPhieu: string }
  | { ok: true; maPhieu: string; maDong: string; soLuong: number }
  | { ok: false; viSao: "thieu_ma_dong_hoac_so_luong" };

export type ReportStockOutResult =
  | { ok: true; maDong: string }
  | { ok: false; viSao: "thieu_ma_dong" };

/** Services this module PROVIDES (`mua-ho.*`). Consumers `import type` this. */
export interface PurchasingServices {
  /** The order lines a partner still has to buy. */
  needsPurchase(partnerId: string): Promise<PurchaseTask[]>;
  /** Which lines of an order are reported out of stock — other modules ask before promising a customer. */
  reportedOutOfStock(orderId: string): Promise<StockOutReport[]>;
}

const TEN_MINUTES = 10 * 60 * 1000;

const text = (v: unknown): string => String(v || "").trim();

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

const NOT_LOGGED_IN: ReplyDraft = {
  status: 401,
  body: { ok: false, error: ERROR_CODES.unauthenticated, message: "Mở lại link riêng của bạn để vào cổng." }
};

function session(ctx: Ctx): PartnerSession {
  return new PartnerSession(ctx.config, ctx.ports.clock);
}

function repository(ctx: Ctx): PurchaseRepository {
  return new PurchaseRepository(ctx.ports.store);
}

/**
 * The partner logged in, or `null`. Reads the session, then checks the TABLE again — a revoked
 * partner (switched off) must not keep using an old session.
 */
async function loggedInPartner(ctx: Ctx, request: KernelRequest): Promise<Partner | null> {
  const portalCode = session(ctx).portalCode(request.headers);
  if (!portalCode) return null;
  return repository(ctx).activePartnerByPortalCode(portalCode);
}

/** The order lines this partner must buy — not yet bought, not yet reported out. */
async function needsPurchase(ctx: Ctx, partnerId: string): Promise<PurchaseTask[]> {
  const settled = await repository(ctx).settledLineIds(partnerId);

  // Source of work: order lines waiting to be bought. Read through the Orders service — this
  // module never opens the order book itself.
  const orders = await ctx.services["don-khach"].search({ status: "pending", limit: 200 });
  const tasks: PurchaseTask[] = [];
  for (const order of orders) {
    (order.items ?? []).forEach((line, i) => {
      // STABLE LINE ID: order id + the line number given when the order was CREATED. Never the current position.
      const lineId = `${order.id}#${line.variantId || i + 1}`;
      if (settled.has(lineId)) return;
      tasks.push({
        maDong: lineId, maDon: String(order.id ?? ""), maMon: String(line.productCode ?? ""), ten: String(line.productName ?? ""),
        size: String(line.size ?? ""), soLuong: Number(line.qty || 1)
      });
    });
  }
  return tasks;
}

/** The partner reports a purchase. RULE 3: the same command id is not written twice. */
async function reportPurchase(ctx: Ctx, partner: Partner, body: Record<string, unknown> = {}): Promise<ReportPurchaseResult> {
  const lineId = text(body["maDong"]);
  const quantity = Math.max(0, Math.trunc(Number(body["soLuong"] ?? body["quantity"] ?? 0)));
  const commandId = text(body["maLenh"] || body["commandId"]);
  if (!lineId || quantity <= 0) return { ok: false, viSao: "thieu_ma_dong_hoac_so_luong" };

  const repo = repository(ctx);
  if (commandId) {
    const existing = await repo.purchaseByCommand(partner.id, commandId);
    if (existing) return { ok: true, trungLenh: true, maPhieu: existing.maPhieu };
  }

  const now = ctx.ports.clock.now();
  const slipId = `mua_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
  const orderId = lineId.split("#")[0] ?? "";
  const productCode = String(body["maMon"] || "");

  try {
    await repo.insertPurchase({
      ma_phieu: slipId, ma_doi_tac: partner.id, ma_don: orderId, ma_dong: lineId,
      ma_mon: productCode, size: String(body["size"] || ""),
      so_luong: quantity,
      // RULE 4: the partner reports the COST price they bought at.
      gia_von: Math.max(0, Number(body["giaVon"] ?? body["actualUnitCost"] ?? 0)),
      ma_lenh: commandId, ghi_chu: String(body["ghiChu"] || ""), tao_luc: toMysqlDateTime(now, { ms: true })
    });
  } catch (e) {
    // Two taps at once: the second hits the unique key — answer with the existing slip, never throw.
    if (isDuplicateKeyError(e)) {
      const existing = await repo.purchaseByCommand(partner.id, commandId);
      if (existing) return { ok: true, trungLenh: true, maPhieu: existing.maPhieu };
    }
    throw e;
  }

  ctx.bus.emit(EVENTS.stockBack, { maDon: orderId, maDong: lineId, maMon: productCode, soLuong: quantity, boi: partner.id });
  return { ok: true, maPhieu: slipId, maDong: lineId, soLuong: quantity };
}

/** The partner reports a line out of stock. RULE 2: keyed by LINE ID. */
async function reportStockOut(ctx: Ctx, partner: Partner, body: Record<string, unknown> = {}): Promise<ReportStockOutResult> {
  const lineId = text(body["maDong"]);
  if (!lineId) return { ok: false, viSao: "thieu_ma_dong" };
  const orderId = lineId.split("#")[0] ?? "";
  const productCode = String(body["maMon"] || "");
  const now = ctx.ports.clock.now();

  // Reporting the same line again UPDATES it, never creates a second row — partners may tap twice.
  await repository(ctx).upsertStockOut({
    ma_dong: lineId, ma_doi_tac: partner.id, ma_don: orderId,
    ma_mon: productCode, size: String(body["size"] || ""),
    ly_do: String(body["lyDo"] || body["reason"] || ""), bao_luc: toMysqlDateTime(now, { ms: true })
  });

  ctx.bus.emit(EVENTS.stockOut, { maDon: orderId, maDong: lineId, maMon: productCode, boi: partner.id });
  return { ok: true, maDong: lineId };
}

export const manifest = defineModule<Config, Services>({
  id: "mua-ho",
  name: "Mua hộ & đặt tự động",
  tier: "van-hanh",
  runsOn: "server-khach",
  feature: "mua-ho",
  version: "0.1.0",
  ports: ["store", "logger", "clock", "bus", "config"],
  requires: ["don-khach.search"],
  schema: SCHEMA,

  events: { emits: [EVENTS.stockOut, EVENTS.stockBack], listens: {} },

  provides: {
    "mua-ho.needsPurchase": (ctx, partnerId: string) => needsPurchase(ctx, String(partnerId || "")),
    "mua-ho.reportedOutOfStock": (ctx, orderId: string) => repository(ctx).stockOutsForOrder(String(orderId || ""))
  },

  routes: [
    {
      // The partner opens their private link -> a session is set. The ONLY door into the portal.
      method: "POST", path: "/api/partner-portal/login", access: ACCESS.public,
      whyPublic: "Đối tác mở link riêng của họ, không có tài khoản. Tự bảo vệ bằng: mã cổng phải khớp một đối tác đang bật; sai là 401 và không lộ gì.",
      rateLimit: { calls: 20, windowMs: 15 * 60 * 1000 },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const portalCode = text(body["token"] || body["maCong"]);
        if (!portalCode) return NOT_LOGGED_IN;
        const partner = await repository(ctx).activePartnerByPortalCode(portalCode);
        if (!partner) {
          ctx.ports.logger.warn("[mua-ho] ma cong khong dung hoac doi tac da tat");
          return NOT_LOGGED_IN;
        }
        return {
          status: 200,
          headers: { ...session(ctx).loginHeaders(portalCode), "Cache-Control": "no-store" },
          body: { ok: true, doiTac: { ma: partner.id, ten: partner.name } }
        };
      }
    },
    {
      method: "POST", path: "/api/partner-portal/logout", access: ACCESS.public,
      whyPublic: "Chỉ xoá cookie phiên của chính người gọi, không đọc gì và không sửa gì.",
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: (ctx) => ({ status: 200, headers: session(ctx).logoutHeaders(), body: { ok: true } })
    },
    {
      // RULE 1: not logged in = NOT one piece of information.
      method: "GET", path: "/api/partner-portal", access: ACCESS.public,
      whyPublic: "Cổng đối tác. Chưa có phiên hợp lệ thì chỉ trả về 'chưa đăng nhập' — không lộ tên, việc cần mua hay giá vốn.",
      rateLimit: { calls: 240, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const partner = await loggedInPartner(ctx, request);
        if (!partner) return NOT_LOGGED_IN;
        return {
          status: 200, headers: { "Cache-Control": "no-store" },
          body: { ok: true, doiTac: { ma: partner.id, ten: partner.name }, canMua: await needsPurchase(ctx, partner.id) }
        };
      }
    },
    {
      method: "POST", path: "/api/partner-portal/purchases", access: ACCESS.public,
      whyPublic: "Đối tác báo đã mua. Tự bảo vệ bằng phiên cookie ký HMAC; không có phiên là 401 trước khi đọc bất cứ gì.",
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const partner = await loggedInPartner(ctx, request);
        if (!partner) return NOT_LOGGED_IN;
        const result = await reportPurchase(ctx, partner, asRecord(await request.json()));
        return result.ok ? { status: 200, body: result } : { status: 400, body: { ok: false, error: result.viSao } };
      }
    },
    {
      method: "POST", path: "/api/partner-portal/out-of-stock", access: ACCESS.public,
      whyPublic: "Đối tác báo hết hàng. Cùng phiên cookie như đường báo đã mua; khoá theo mã dòng nên báo lại không đụng dòng khác.",
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const partner = await loggedInPartner(ctx, request);
        if (!partner) return NOT_LOGGED_IN;
        const result = await reportStockOut(ctx, partner, asRecord(await request.json()));
        return result.ok ? { status: 200, body: result } : { status: 400, body: { ok: false, error: result.viSao } };
      }
    },
    {
      // OMI's "Sản phẩm cần mua": what still has to be bought, what was bought, and what a partner
      // said it could not get. One door, three lists — they are always read together.
      method: "GET", path: "/api/admin/mua-ho", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const partnerId = text(request.query["doiTac"]);
        const limit = Number(request.query["limit"] || 0);
        const repo = repository(ctx);
        return {
          status: 200,
          headers: { "Cache-Control": "no-store" },
          body: {
            ok: true,
            doiTac: partnerId,
            canMua: await needsPurchase(ctx, partnerId),
            daMua: await repo.recentPurchases(partnerId, limit),
            baoHet: await repo.recentStockOuts(partnerId, limit)
          }
        };
      }
    },
    {
      // The shop manages its partners.
      method: "GET", path: "/api/admin/partners", access: ACCESS.admin,
      handle: async (ctx) => ({ status: 200, headers: { "Cache-Control": "no-store" }, body: await repository(ctx).listPartners() })
    },
    {
      method: "POST", path: "/api/admin/partners", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const id = text(body["ma"]);
        const portalCode = text(body["maCong"]);
        if (!id || !portalCode) return { status: 400, body: { ok: false, error: "thieu_ma_hoac_ma_cong" } };
        await repository(ctx).upsertPartner({
          ma: id, ten: String(body["ten"] || id), ma_cong: portalCode,
          trang_thai: String(body["trangThai"] || "active"),
          dien_thoai: String(body["dienThoai"] || ""),
          tinh: String(body["tinh"] || ""), huyen: String(body["huyen"] || ""), xa: String(body["xa"] || ""),
          dia_chi_chi_tiet: String(body["diaChiChiTiet"] || ""),
          sua_luc: toMysqlDateTime(ctx.ports.clock.now(), { ms: true })
        });
        return { status: 200, body: { ok: true, ma: id } };
      }
    }
  ],

  botTools: [
    { ten: "hang_order_bao_lau", moTa: "Hàng này phải order thì bao lâu về", hieuUng: "doc" }
  ]
});
