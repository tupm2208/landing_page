/**
 * @file ORDERS & CUSTOMERS module — tier "van-hanh", runs on the merchant's server.
 *
 * It OWNS seven tables inherited from the running site: `orders`, `order_items`,
 * `order_status_logs` and the four customer-account tables. They cannot be renamed (Sales Desk and
 * Image Tool read them directly), so they are declared as `inheritedTables` — still exactly one
 * owner, just outside the prefix rule.
 *
 * THREE RULES THAT MUST NOT BREAK:
 *
 * 1. PLACING AN ORDER RESERVES STOCK FIRST, and the hold becomes a SALE once the order is written;
 *    cancelling or deleting gives the pairs back, once. Stock moves go through Inventory's
 *    services — this module NEVER touches stock tables itself.
 *
 * 2. WRITING AN ORDER IS ONE TRANSACTION. Head + lines + status log in one go; a failure in the
 *    middle leaves no half order. Before: three separate JSON files, and a power cut between them
 *    left an order with lines but no head.
 *
 * 3. EVERY MONEY NUMBER GOES THROUGH `order-money-kit`. That file is byte-identical in three
 *    repositories and a test compares every byte. The server annotates `paidAmount` /
 *    `remainingAmount` BEFORE an order leaves; nowhere derives them from `paymentStatus`.
 *
 * Four kinds of callers, four groups of doors:
 *   - the CUSTOMER on the web (public): place, look up, view/edit/cancel within 15 minutes;
 *   - the CUSTOMER with an ACCOUNT (public + session cookie): `/api/account/*`, 11 doors of the
 *     running site, and the two account pages served from `goc/`;
 *   - the OWNER in OMI (admin): list, open, change status, manual order, edit, delete, customers;
 *   - SALES DESK (admin): `POST /api/admin/manual-orders/sync`.
 *
 * This file is only the manifest. The rules live in `order-service.ts`, `customer-self-service.ts`,
 * `customer-accounts.ts`, `admin-orders.ts`, `public-orders.ts`, `reports.ts`.
 */

import { ACCESS, ERROR_CODES, EVENTS, defineModule, reply, type ReplyDraft } from "../../contract";
import { deleteOrder, editOrder, listCustomers, upsertManualOrder } from "./admin-orders";
import type { Config, OrderContext, Services } from "./context";
import { repositoryOf } from "./context";
import {
  cancelMyOrder, forgotPassword, login, logout, me, myOrders, profile, register, requestChange, resetPassword, verifyChange
} from "./customer-accounts";
import { CUSTOMER_SCHEMA, CUSTOMER_TABLES } from "./customer-schema";
import { cancelByCustomer, editCustomerProfile, lookupOrder, viewByLookupToken } from "./customer-self-service";
import type { Order, SearchFilter } from "./order-repository";
import {
  changeStatus, placeOrder, readByLookupToken, readOrder, recordPayment, recordShipment, searchOrders,
  type ChangeStatusInput, type PlaceResult, type RecordPaymentInput, type WriteOutcome
} from "./order-service";
import { placeOrderOnce, placeRefusal } from "./placement-guard";
import { ORDER_CAP, overview } from "./reports";
import { ORDER_TABLES, SCHEMA } from "./schema";

export type {
  Config, Services, ReserveInput, ReserveResult, ReleaseInput, ReleaseResult, CommitInput, CommitResult, RestockInput, RestockResult, OrderMoneySummary
} from "./context";

/** The services this module PROVIDES (`don-khach.read` ...). Consumers `import type` this. */
export interface OrderServices {
  "don-khach": {
    read(id: string): Promise<Order | null>;
    search(filter?: SearchFilter): Promise<Order[]>;
    place(body: unknown): Promise<PlaceResult>;
    changeStatus(input: ChangeStatusInput): Promise<WriteOutcome>;
    readByLookupToken(input: { id?: string; token?: string }): Promise<Order | null>;
    recordPayment(input: RecordPaymentInput): Promise<WriteOutcome>;
  };
}

const TEN_MINUTES = 10 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };
const text = (v: unknown): string => String(v ?? "").trim();
const bodyOf = async (json: () => Promise<unknown>): Promise<Record<string, unknown>> => {
  const b = await json();
  return (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
};

/** The two account pages (and their scripts) live in this module's `goc/`; everything else of the storefront is Gian hàng's. */
async function servePage(ctx: OrderContext, path: string): Promise<ReplyDraft> {
  const file = await ctx.ports.staticFiles.open(`${ctx.id}/goc`).read(path);
  if (!file) return reply.json({ ok: false, error: ERROR_CODES.notFound }, 404);
  return reply.file(file.data, file.type, 200, { "Cache-Control": file.cacheControl });
}

const ACCOUNT_PAGES = ["/account.html", "/account.js", "/account-manage.html", "/account-manage.js"];

export const manifest = defineModule<Config, Services>({
  id: "don-khach",
  name: "Đơn hàng & khách",
  tier: "van-hanh",
  runsOn: "server-khach",
  feature: "don-khach",
  version: "0.2.0",
  ports: ["store", "logger", "clock", "bus", "config", "staticFiles", "mail"],
  // reserve/release while placing; commit turns the hold into a sale once the order is written;
  // restock gives the pairs back when the order is cancelled (hole "Lỗ 1", closed 14/09/2026).
  requires: ["hang-kho.reserve", "hang-kho.release", "hang-kho.commit", "hang-kho.restock"],

  // Seven tables from the running site — cannot be renamed because Desk reads them directly.
  inheritedTables: [
    ORDER_TABLES.orders, ORDER_TABLES.items, ORDER_TABLES.statusLogs,
    CUSTOMER_TABLES.customers, CUSTOMER_TABLES.sessions, CUSTOMER_TABLES.changeRequests, CUSTOMER_TABLES.addresses
  ],
  // This module CREATES them on a fresh machine, with exactly the running site's columns.
  schema: [...SCHEMA, ...CUSTOMER_SCHEMA],

  // Money on an order is computed by the Money module (RULE 3: every number through the kit).
  // OPTIONAL because a merchant may not have bought Money — the lookup page still works, it
  // just does not show the paid amount.
  // The transfer prefix comes from page content when the platform module is there (the owner edits it).
  requiresOptional: ["tien-doi-soat.orderMoney", "khung-nen-tang.moneySettings"],

  events: {
    emits: [EVENTS.orderCreated, EVENTS.orderStatusChanged, EVENTS.orderCancelled],
    listens: {
      // A waybill was created (from OMI's Vận đơn screen, or by Purchasing): write the tracking
      // number onto the order. Shipping does not know what an order is and only this module writes
      // the orders table, so the two meet here. The order is NOT marked shipped — see `recordShipment`.
      [EVENTS.shipmentCreated]: async (ctx: OrderContext, payload: unknown) => {
        const p = (payload ?? {}) as Record<string, unknown>;
        const r = await recordShipment(ctx, { id: text(p["maPhieu"]), trackingCode: text(p["maVanDon"]), carrier: text(p["hang"]) });
        if (!r.ok && r.reason !== "khong_co_don") {
          ctx.ports.logger.warn(`[don-khach] khong ghi duoc ma van don cho ${text(p["maPhieu"]) || "(khong ro don)"}: ${r.reason}`);
        }
      }
    }
  },

  provides: {
    "don-khach.read": (ctx: OrderContext, id: string) => readOrder(ctx, id),
    "don-khach.search": (ctx: OrderContext, filter?: SearchFilter) => searchOrders(ctx, filter),
    "don-khach.place": (ctx: OrderContext, body: unknown) => placeOrder(ctx, body),
    "don-khach.changeStatus": (ctx: OrderContext, input: ChangeStatusInput) => changeStatus(ctx, input),
    "don-khach.readByLookupToken": (ctx: OrderContext, input: { id?: string; token?: string }) => readByLookupToken(ctx, input),
    "don-khach.recordPayment": (ctx: OrderContext, input: RecordPaymentInput) => recordPayment(ctx, input)
  },

  routes: [
    // ---------------- the customer on the web ----------------
    {
      method: "POST", path: "/api/orders", access: ACCESS.public,
      whyPublic: "Khách đặt hàng từ web, không có mã nào. Tự bảo vệ bằng: phải có món thật trong kho, giữ chỗ tồn trước khi ghi, và không nhận giá từ client.",
      // Placing an order RESERVES real stock — a flooder could reserve the whole shop. Tight limit.
      rateLimit: { calls: 20, windowMs: TEN_MINUTES },
      handle: async (ctx, request): Promise<ReplyDraft> => {
        const result = await placeOrderOnce(ctx, await request.json());
        if (!result.ok) return placeRefusal(result);
        // `paymentReference`: the checkout popup puts it in the QR and "Nội dung CK". Without it the
        // customer paid with the order id while the shop reconciled by TR-... (15/09/2026).
        return {
          status: 200,
          body: { ok: true, id: result.id, token: result.token, total: result.total, paymentReference: result.paymentReference, ...(result.duplicate ? { duplicate: true } : {}) }
        };
      }
    },
    {
      method: "POST", path: "/api/orders/lookup", access: ACCESS.public,
      whyPublic: "Khách tra đơn của chính mình. Tự bảo vệ bằng: phải có ĐÚNG mã đơn kèm mã tra cứu (hoặc mã bí mật, hoặc số điện thoại của chính đơn); sai một trong hai là không thấy gì.",
      // 30 per 10 minutes like the running site: enough for a real customer, not enough to guess a token.
      rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => lookupOrder(ctx, await request.json())
    },
    {
      // The customer opens the link in the email / in the popup right after ordering.
      method: "GET", path: "/api/orders/public", access: ACCESS.public,
      whyPublic: "Khách xem đơn của chính mình qua link có mã tra cứu. Tự bảo vệ bằng: phải có ĐÚNG mã đơn kèm mã tra cứu.",
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: (ctx, request) => viewByLookupToken(ctx, {
        id: text(request.query["order"] || request.query["orderId"]),
        token: text(request.query["token"])
      })
    },
    {
      // The customer edits the recipient profile within the first 15 minutes.
      method: "PATCH", path: "/api/orders/public", access: ACCESS.public,
      whyPublic: "Khách sửa thông tin người nhận trên đơn của chính mình. Tự bảo vệ bằng: đúng mã đơn kèm mã tra cứu, chỉ trong 15 phút đầu, và chỉ sửa hồ sơ chứ không sửa món hay giá.",
      rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request.json);
        return editCustomerProfile(ctx, {
          id: text(body["orderId"] || body["id"]),
          token: text(body["token"] || body["orderToken"]),
          body
        });
      }
    },
    {
      // The customer cancels within the first 15 minutes.
      method: "POST", path: "/api/orders/public/cancel", access: ACCESS.public,
      whyPublic: "Khách tự hủy đơn của chính mình. Tự bảo vệ bằng: đúng mã đơn kèm mã tra cứu, và chỉ trong 15 phút đầu.",
      rateLimit: { calls: 20, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request.json);
        return cancelByCustomer(ctx, {
          id: text(body["orderId"] || body["id"]),
          token: text(body["token"] || body["orderToken"])
        });
      }
    },

    // ---------------- the customer with an account (session cookie, running site's 11 doors) ----------------
    ...ACCOUNT_PAGES.map((page) => ({
      method: "GET" as const, path: page, access: ACCESS.public,
      whyPublic: "Trang tài khoản khách (HTML/JS tĩnh chép từ bản cũ). Cổng tệp tĩnh chỉ trả tệp đã khai trong goc/ của module.",
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: (ctx: OrderContext) => servePage(ctx, page)
    })),
    {
      method: "GET", path: "/api/account/me", access: ACCESS.public,
      whyPublic: "Trang hỏi 'tôi là ai' bằng cookie phiên; không có phiên thì trả null, không lộ gì.",
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: (ctx, request) => me(ctx, request.headers)
    },
    {
      method: "GET", path: "/api/account/profile", access: ACCESS.public,
      whyPublic: "Hồ sơ của chính khách, chỉ khi cookie phiên hợp lệ (401 trước khi đọc gì).",
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: (ctx, request) => profile(ctx, request.headers)
    },
    {
      method: "POST", path: "/api/account/register", access: ACCESS.public,
      whyPublic: "Khách tự đăng ký. Tự bảo vệ bằng: kiểm định dạng, mật khẩu băm PBKDF2, hạn gọi chặt để không tạo tài khoản hàng loạt.",
      rateLimit: { calls: 20, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => register(ctx, await bodyOf(request.json))
    },
    {
      method: "POST", path: "/api/account/login", access: ACCESS.public,
      whyPublic: "Khách đăng nhập. Tự bảo vệ bằng: so mật khẩu bằng timingSafeEqual và hạn 20 lần / 10 phút một địa chỉ để không dò mật khẩu.",
      rateLimit: { calls: 20, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => login(ctx, await bodyOf(request.json))
    },
    {
      method: "POST", path: "/api/account/logout", access: ACCESS.public,
      whyPublic: "Xoá phiên của chính mình; không có phiên thì không làm gì.",
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: (ctx, request) => logout(ctx, request.headers)
    },
    {
      method: "POST", path: "/api/account/forgot-password", access: ACCESS.public,
      whyPublic: "Xin link đặt lại mật khẩu qua e-mail. Câu trả lời giống nhau dù e-mail có hay không; hạn gọi chặt.",
      rateLimit: { calls: 10, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => forgotPassword(ctx, await bodyOf(request.json))
    },
    {
      method: "POST", path: "/api/account/reset-password", access: ACCESS.public,
      whyPublic: "Đặt lại mật khẩu bằng mã trong e-mail (sống 30 phút, băm trong bảng); sai mã là 400.",
      rateLimit: { calls: 10, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => resetPassword(ctx, await bodyOf(request.json))
    },
    {
      method: "GET", path: "/api/account/orders", access: ACCESS.public,
      whyPublic: "Đơn của chính khách đang đăng nhập (cookie phiên); không phiên là 401.",
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: (ctx, request) => myOrders(ctx, request.headers)
    },
    {
      method: "POST", path: "/api/account/orders/cancel", access: ACCESS.public,
      whyPublic: "Khách huỷ đơn của chính mình trong 15 phút; đơn phải thuộc tài khoản trong phiên.",
      rateLimit: { calls: 20, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => cancelMyOrder(ctx, request.headers, await bodyOf(request.json))
    },
    {
      method: "POST", path: "/api/account/request-change", access: ACCESS.public,
      whyPublic: "Khách xin đổi hồ sơ; thay đổi chỉ áp dụng sau khi bấm link trong e-mail của chính khách.",
      rateLimit: { calls: 20, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => requestChange(ctx, request.headers, await bodyOf(request.json))
    },
    {
      method: "POST", path: "/api/account/verify-change", access: ACCESS.public,
      whyPublic: "Xác nhận thay đổi bằng mã trong e-mail (sống 30 phút, dùng một lần).",
      rateLimit: { calls: 20, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => verifyChange(ctx, await bodyOf(request.json))
    },

    // ---------------- the owner (OMI) ----------------
    {
      // The shop owner opens OMI and sees: how many orders today, how much collected, what sells.
      method: "GET", path: "/api/bao-cao/tong-quan", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => ({
        status: 200, headers: NO_STORE,
        body: await overview({
          readOrders: (since) => repositoryOf(ctx).rowsForReport(since, ORDER_CAP),
          now: ctx.ports.clock.now(),
          days: request.query["ngay"],
          timezoneOffsetMinutes: Number(ctx.config.timezoneOffsetMinutes ?? 7 * 60)
        })
      })
    },
    {
      method: "GET", path: "/api/orders", access: ACCESS.admin,
      handle: async (ctx, request) => ({
        status: 200, headers: NO_STORE,
        body: await searchOrders(ctx, {
          status: request.query["status"] || null,
          phone: request.query["phone"] || null,
          since: request.query["since"] || null,
          limit: request.query["limit"] ?? null
        })
      })
    },
    {
      // A manual order typed by the owner (OMI). Same wire as Sales Desk's sync below.
      method: "POST", path: "/api/orders/thu-cong", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => upsertManualOrder(ctx, { body: await bodyOf(request.json), actor: "quan-tri" })
    },
    {
      method: "GET", path: "/api/orders/:maDon", access: ACCESS.admin,
      handle: async (ctx, request) => {
        const order = await readOrder(ctx, request.params["maDon"] ?? "");
        if (!order) return { status: 404, body: { ok: false, error: ERROR_CODES.notFound } };
        return { status: 200, headers: NO_STORE, body: order };
      }
    },
    {
      method: "PATCH", path: "/api/orders/:maDon", access: ACCESS.admin,
      handle: async (ctx, request) => {
        const body = await bodyOf(request.json);
        const outcome = await changeStatus(ctx, {
          id: request.params["maDon"] ?? "", status: text(body["status"]), note: text(body["note"]), actor: "quan-tri"
        });
        return { status: outcome.ok ? 200 : 404, body: outcome.ok ? { ok: true } : { ok: false, viSao: outcome.reason } };
      }
    },
    {
      // The owner edits recipient, money, shipping and lines. Lines move stock (old back, new taken).
      method: "PUT", path: "/api/orders/:maDon", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => editOrder(ctx, request.params["maDon"] ?? "", await bodyOf(request.json), "quan-tri")
    },
    {
      method: "DELETE", path: "/api/orders/:maDon", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => deleteOrder(ctx, request.params["maDon"] ?? "", "quan-tri")
    },
    {
      // Customers as the owner sees them: accounts, and everyone known from orders.
      method: "GET", path: "/api/admin/khach", access: ACCESS.admin,
      handle: async (ctx, request) => listCustomers(ctx, text(request.query["q"]), Number(request.query["limit"] || 200))
    },

    // ---------------- Sales Desk of TopRun (kept as on the running site) ----------------
    {
      method: "POST", path: "/api/admin/manual-orders/sync", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => upsertManualOrder(ctx, { body: await bodyOf(request.json), actor: "sales-desk" })
    }
  ],

  botTools: [
    { ten: "tra_don", moTa: "Tra trạng thái một đơn theo mã", hieuUng: "doc" },
    { ten: "tao_don", moTa: "Chốt đơn cho khách trong khung chat", hieuUng: "ghi" }
  ]
});
