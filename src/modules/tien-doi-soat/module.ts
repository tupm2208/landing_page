/**
 * @file MODULE MONEY & RECONCILIATION ("tien-doi-soat") — tier "van-hanh", runs on the merchant server.
 *
 * Its job: the customer chooses how much to pay, the shop records money received, and the seller
 * is told money came in. It does NOT own orders — it reads and changes them through the Orders
 * module's services, so there is ONE writer of the order book.
 *
 * THREE RULES THAT MUST NOT BREAK:
 *
 * 1. EVERY MONEY NUMBER GOES THROUGH `order-money-kit`. That file is identical in three
 *    repositories (Desk + two landings) and a test compares every byte. This module computes only
 *    the landing's OWN part (how much the customer chooses to pay, how it is rounded) — it never
 *    recomputes "paid / remaining / COD" itself.
 *
 * 2. RECORDING MONEY IS A REAL PERSON'S JOB. No tool exposed to the bot carries the "tien" effect
 *    — the contract refuses such a manifest at load time.
 *
 * 3. TELEGRAM IS EACH MERCHANT'S SETTING (Dũng, 12/09). Token and group live in `ctx.config`,
 *    never as constants. A shop that has not entered them gets NO alerts — not alerts to another
 *    shop's group.
 */

import { ACCESS, EVENTS, defineModule, type ModuleContext } from "../../contract";
import type { OrderServices as OrderServicesOf } from "../don-khach/module";
import type { PlatformServices } from "../khung-nen-tang/module";
import { annotateOrderMoneyFields, codAmountForOrder, type MoneyFields } from "../../shared/order-money";
import {
  PAYMENT_METHODS, PAYMENT_NOTES, amountDueNow, isValidChoice, shippingFee, transferCode, type PaymentChoice
} from "./money-rules";
import { TelegramAlerts, type TelegramConfig } from "./telegram";

/** `ctx.config` as `app.ts` builds it. The three amounts are FALLBACKS: page content wins when present. */
export interface Config {
  depositPercent?: number;
  defaultShippingFee?: number;
  transferPrefix?: string;
  telegram?: TelegramConfig;
}

/** The order slice this module reads. Field names are the order wire format (the money kit reads them). */
export interface OrderMoneyView extends MoneyFields {
  id?: string;
}

/**
 * Minimal structural types of the services consumed. Declared locally (not `import type`d) because
 * `don-khach` and `khung-nen-tang` are being ported in parallel and a type import would pull their
 * half-built files into this module's build. The shapes mirror their current exports
 * (`OrderServices["don-khach"]`, `PlatformServices.moneySettings`).
 */
type OrderServices = OrderServicesOf["don-khach"];

/** Money settings the owner edits in the admin screen (page content). `null` = not set: this module's fallback applies. */
interface PageMoneySettings {
  phanTramCoc?: number | null;
  phiShipMacDinh?: number | null;
  tienToChuyenKhoan?: string | null;
}


interface Services {
  "don-khach": Pick<OrderServices, "read" | "readByLookupToken" | "recordPayment">;
  "khung-nen-tang"?: Pick<PlatformServices, "moneySettings" | "settings">;
}

type Ctx = ModuleContext<Config, Services>;

/** The three money numbers of an order plus COD — ALWAYS read through the kit, never derived here. */
export interface OrderMoney {
  tong: number;
  daTra: number;
  conPhaiTra: number;
  cod: number;
}

export interface ChoosePaymentInput {
  maDon?: string;
  maTra?: string;
  luaChon?: string;
}

/** Result of a payment choice. Fields are wire: spread into the HTTP reply. */
export type ChoosePaymentResult =
  | { ok: true; maDon: string; luaChon: PaymentChoice; phuongThuc: string; soPhaiTra: number; phiShip: number; maChuyenKhoan: string }
  | { ok: false; viSao: "thieu_ma_don_hoac_ma_tra" | "lua_chon_khong_hop_le" | "khong_thay_don" };

export interface RecordPaidInput {
  maDon?: string;
  soTien?: number | string;
  /** Who recorded it (`"quan-tri"`, a Desk user...). Goes into the order log. */
  boi?: string;
  ghiChu?: string;
}

export type RecordPaidResult =
  | { ok: true; maDon: string; daTra: number; conPhaiTra: number; traDu: boolean }
  | { ok: false; viSao: "thieu_ma_don_hoac_so_tien" | "khong_thay_don" };

/** Services this module PROVIDES (`tien-doi-soat.*`). Consumers `import type` this. */
export interface MoneyServices {
  orderMoney(orderId: string): Promise<(OrderMoney & { maDon: string | undefined }) | null>;
  choosePaymentMethod(input: ChoosePaymentInput): Promise<ChoosePaymentResult>;
  recordPaid(input: RecordPaidInput): Promise<RecordPaidResult>;
  refund(input: RefundInput): Promise<RefundResult>;
}

/** Giving money BACK to a customer: which order, how much, and why. */
export interface RefundInput {
  maDon?: string;
  soTien?: number | string;
  lyDo?: string;
  boi?: string;
}

export type RefundResult =
  | { ok: true; maDon: string; daHoan: number; daTra: number; conPhaiTra: number }
  | { ok: false; viSao: "thieu_ma_don_hoac_so_tien" | "khong_thay_don" | "hoan_qua_so_da_tra" | "thieu_ly_do"; daTra?: number };

const TEN_MINUTES = 10 * 60 * 1000;

const vnd = (n: number): string => n.toLocaleString("vi-VN");

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

interface MoneySettings {
  depositPercent: number;
  defaultShippingFee: number;
  transferPrefix: string;
}

/**
 * Money settings. PAGE CONTENT first (the owner edits it in the admin screen), then the
 * environment — same as the running site, where deposit % / shipping fee / transfer prefix come
 * from landing-content. Without the platform feature (or before any edit) the environment is used.
 */
async function moneySettings(ctx: Ctx): Promise<MoneySettings> {
  const c = ctx.config ?? {};
  let fromPage: PageMoneySettings | null = null;
  const read = ctx.services["khung-nen-tang"]?.moneySettings;
  if (read) {
    try { fromPage = (await read()) ?? null; } catch (e) {
      ctx.ports.logger.warn(`[tien-doi-soat] khong doc duoc noi dung trang: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return {
    depositPercent: fromPage?.phanTramCoc ?? Math.max(1, Math.min(100, Number(c.depositPercent || 100))),
    defaultShippingFee: fromPage?.phiShipMacDinh
      ?? (Number.isFinite(Number(c.defaultShippingFee)) ? Number(c.defaultShippingFee) : 30000),
    transferPrefix: fromPage?.tienToChuyenKhoan ?? String(c.transferPrefix || "TR")
  };
}

/**
 * The seller's alert channel. The token comes from the SHOP'S OWN SETTINGS (what the owner typed
 * in OMI's Kết nối screen, kept on this server) and falls back to the machine's environment —
 * never from page content, which is public and would hand the bot token to the world.
 */
async function alerts(ctx: Ctx): Promise<TelegramAlerts> {
  const deps = { http: ctx.ports.http, logger: ctx.ports.logger };
  const read = ctx.services["khung-nen-tang"]?.settings;
  const fallback = ctx.config?.telegram ?? {};
  if (read === undefined) return new TelegramAlerts(deps, fallback);
  try {
    const shop = await read();
    return new TelegramAlerts(deps, {
      token: String(shop["telegram_bot_token"] ?? "").trim() || String(fallback.token ?? ""),
      chatId: String(shop["telegram_chat_bao_dong"] ?? "").trim() || String(fallback.chatId ?? "")
    });
  } catch {
    return new TelegramAlerts(deps, fallback);            // an alert must never block the money path
  }
}

/** The money numbers of an order — through the kit, never derived. */
export function moneyOf(order: OrderMoneyView): OrderMoney {
  const annotated = annotateOrderMoneyFields(order);
  return {
    tong: Number(annotated.total || 0),
    daTra: Number(annotated.paidAmount || 0),
    conPhaiTra: Number(annotated.remainingAmount || 0),
    cod: codAmountForOrder(annotated)
  };
}

// ---------- services ----------

/** The customer picks how to pay. Changing the choice REWRITES the amount — quirk of 04/09. */
async function choosePaymentMethod(ctx: Ctx, { maDon = "", maTra = "", luaChon = "" }: ChoosePaymentInput = {}): Promise<ChoosePaymentResult> {
  if (!maDon || !maTra) return { ok: false, viSao: "thieu_ma_don_hoac_ma_tra" };
  if (!isValidChoice(luaChon)) return { ok: false, viSao: "lua_chon_khong_hop_le" };

  const order = await ctx.services["don-khach"].readByLookupToken({ id: maDon, token: maTra });
  if (!order) return { ok: false, viSao: "khong_thay_don" };

  const settings = await moneySettings(ctx);
  const amountDue = amountDueNow(luaChon, Number(order.total || 0), settings.depositPercent);
  const fee = shippingFee(luaChon, settings.defaultShippingFee);
  const reference = transferCode(maDon, settings.transferPrefix);

  await ctx.services["don-khach"].recordPayment({
    id: maDon,
    paymentMethod: PAYMENT_METHODS[luaChon],
    paymentAmount: amountDue,
    paymentReference: reference,
    note: PAYMENT_NOTES[luaChon]
  });

  (await alerts(ctx)).notify(`💰 Đơn <b>${maDon}</b>: khách chọn <b>${luaChon}</b> — cần thu <b>${vnd(amountDue)}đ</b>`);
  return { ok: true, maDon, luaChon, phuongThuc: PAYMENT_METHODS[luaChon], soPhaiTra: amountDue, phiShip: fee, maChuyenKhoan: reference };
}

/** A real person records money received. RULE 2: never opened to the bot. */
async function recordPaid(ctx: Ctx, { maDon = "", soTien = 0, boi = "nguoi-that", ghiChu = "" }: RecordPaidInput = {}): Promise<RecordPaidResult> {
  const amount = Math.max(0, Math.round(Number(soTien) || 0));
  if (!maDon || amount <= 0) return { ok: false, viSao: "thieu_ma_don_hoac_so_tien" };

  const order = await ctx.services["don-khach"].read(maDon);
  if (!order) return { ok: false, viSao: "khong_thay_don" };

  const before = moneyOf(order);
  const paidNow = before.daTra + amount;
  const paidInFull = paidNow >= before.tong;

  await ctx.services["don-khach"].recordPayment({
    id: maDon,
    paymentStatus: paidInFull ? "paid" : "partially_paid",
    paymentAmount: paidNow,
    note: ghiChu || `Ghi nhận đã trả ${vnd(amount)}đ (${boi}).`
  });

  ctx.bus.emit(EVENTS.paymentReceived, { maDon, soTien: amount, daTra: paidNow, traDu: paidInFull });
  (await alerts(ctx)).notify(`✅ Đơn <b>${maDon}</b>: đã nhận <b>${vnd(amount)}đ</b>` +
    (paidInFull ? " — <b>đủ tiền</b>" : ` — còn <b>${vnd(Math.max(0, before.tong - paidNow))}đ</b>`));

  return { ok: true, maDon, daTra: paidNow, conPhaiTra: Math.max(0, before.tong - paidNow), traDu: paidInFull };
}

/**
 * REFUND — money going back to the customer.
 *
 * A refund is not "a payment with a minus in front": it is the one money move a shop makes that
 * nobody can undo by talking to the bank. So it is admin-only (never a bot tool, RULE 2), it
 * REQUIRES a written reason — a refund with no reason is indistinguishable from a mistake three
 * months later — and it can never exceed what the customer actually paid. Refunding more than was
 * received would leave the order's "đã trả" negative and every later number wrong.
 *
 * It does NOT cancel the order and does NOT return stock: those are separate decisions a person
 * makes on the order screen (a refunded deposit on an order that still ships is a real case).
 */
async function refund(ctx: Ctx, { maDon = "", soTien = 0, lyDo = "", boi = "quan-tri" }: RefundInput = {}): Promise<RefundResult> {
  const amount = Math.max(0, Math.round(Number(soTien) || 0));
  if (!maDon || amount <= 0) return { ok: false, viSao: "thieu_ma_don_hoac_so_tien" };
  if (String(lyDo || "").trim() === "") return { ok: false, viSao: "thieu_ly_do" };

  const order = await ctx.services["don-khach"].read(maDon);
  if (!order) return { ok: false, viSao: "khong_thay_don" };

  const before = moneyOf(order);
  if (amount > before.daTra) return { ok: false, viSao: "hoan_qua_so_da_tra", daTra: before.daTra };

  const paidNow = before.daTra - amount;
  await ctx.services["don-khach"].recordPayment({
    id: maDon,
    paymentStatus: paidNow <= 0 ? "refunded" : paidNow >= before.tong ? "paid" : "partially_paid",
    paymentAmount: paidNow,
    note: `Hoàn ${vnd(amount)}đ cho khách (${boi}): ${String(lyDo).trim()}`
  });

  ctx.bus.emit(EVENTS.paymentRefunded, { maDon, soTien: amount, daTra: paidNow, lyDo: String(lyDo).trim(), boi });
  (await alerts(ctx)).notify(`↩️ Đơn <b>${maDon}</b>: đã hoàn <b>${vnd(amount)}đ</b> — ${String(lyDo).trim()}`);

  return { ok: true, maDon, daHoan: amount, daTra: paidNow, conPhaiTra: Math.max(0, before.tong - paidNow) };
}

async function orderMoney(ctx: Ctx, orderId: string): Promise<(OrderMoney & { maDon: string | undefined }) | null> {
  const order = await ctx.services["don-khach"].read(String(orderId || ""));
  if (!order) return null;
  return { maDon: order.id, ...moneyOf(order) };
}

export const manifest = defineModule<Config, Services>({
  id: "tien-doi-soat",
  name: "Tiền & đối soát",
  tier: "van-hanh",
  runsOn: "server-khach",
  feature: "tien",
  version: "0.1.0",
  ports: ["logger", "clock", "http", "bus", "config"],
  requires: ["don-khach.read", "don-khach.readByLookupToken", "don-khach.recordPayment"],
  // Deposit % / shipping fee / transfer prefix: read from page content when the platform is present.
  requiresOptional: ["khung-nen-tang.moneySettings", "khung-nen-tang.settings"],

  events: { emits: [EVENTS.paymentReceived, EVENTS.paymentRefunded], listens: {} },

  provides: {
    "tien-doi-soat.orderMoney": (ctx, orderId: string) => orderMoney(ctx, orderId),
    "tien-doi-soat.choosePaymentMethod": (ctx, input: ChoosePaymentInput) => choosePaymentMethod(ctx, input),
    "tien-doi-soat.recordPaid": (ctx, input: RecordPaidInput) => recordPaid(ctx, input),
    "tien-doi-soat.refund": (ctx, input: RefundInput) => refund(ctx, input)
  },

  routes: [
    {
      method: "POST", path: "/api/orders/public/payment-choice", access: ACCESS.public,
      whyPublic: "Khách tự chọn cách trả cho đơn của chính mình. Tự bảo vệ bằng: phải có ĐÚNG mã đơn kèm mã tra cứu, và số tiền do server tính chứ không nhận từ khách.",
      rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const result = await choosePaymentMethod(ctx, {
          maDon: String(body["orderId"] || body["id"] || ""),
          maTra: String(body["token"] || body["orderToken"] || ""),
          luaChon: String(body["choice"] || body["luaChon"] || "")
        });
        return result.ok ? { status: 200, body: { ...result, ok: true } } : { status: 400, body: { ok: false, error: result.viSao } };
      }
    },
    {
      // A real person records money received. Admin only — RULE 2.
      method: "POST", path: "/api/tien/da-tra", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const result = await recordPaid(ctx, {
          maDon: String(body["maDon"] || body["orderId"] || ""),
          soTien: Number(body["soTien"] ?? body["amount"] ?? 0),
          boi: String(body["boi"] || "quan-tri"),
          ghiChu: String(body["ghiChu"] || "")
        });
        return result.ok ? { status: 200, body: result } : { status: 400, body: { ok: false, error: result.viSao } };
      }
    },
    {
      // Giving money back. Admin only, a reason is required, never more than the customer paid.
      method: "POST", path: "/api/tien/hoan", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const result = await refund(ctx, {
          maDon: String(body["maDon"] || body["orderId"] || ""),
          soTien: Number(body["soTien"] ?? body["amount"] ?? 0),
          lyDo: String(body["lyDo"] || body["reason"] || ""),
          boi: String(body["boi"] || "quan-tri")
        });
        return result.ok ? { status: 200, body: result } : { status: 400, body: { ok: false, error: result.viSao, daTra: result.daTra } };
      }
    },
    {
      // The brain answers "I have transferred" — READ only, never writes.
      method: "GET", path: "/api/tien/don/:maDon", access: ACCESS.service,
      handle: async (ctx, request) => {
        const result = await orderMoney(ctx, request.params["maDon"] ?? "");
        if (!result) return { status: 404, body: { ok: false, error: "khong_thay_don" } };
        return { status: 200, headers: { "Cache-Control": "no-store" }, body: { ok: true, ...result } };
      }
    }
  ],

  // RULE 2: the bot may read the money status, never write it. The contract refuses the "tien" effect.
  botTools: [
    { ten: "tinh_trang_tien", moTa: "Đơn này đã trả bao nhiêu, còn phải trả bao nhiêu", hieuUng: "doc" }
  ]
});
