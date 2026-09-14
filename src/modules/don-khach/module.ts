/**
 * @file ORDERS & CUSTOMERS module — tier "van-hanh", runs on the merchant's server.
 *
 * It OWNS three tables inherited from the running site: `orders`, `order_items`,
 * `order_status_logs`. They cannot be renamed (Sales Desk and Image Tool read them directly), so
 * they are declared as `inheritedTables` — still exactly one owner, just outside the prefix rule.
 *
 * THREE RULES THAT MUST NOT BREAK:
 *
 * 1. PLACING AN ORDER RESERVES STOCK FIRST. Writing an order without a reservation sells one pair
 *    of shoes to two people. Reservation goes through Inventory's service — this module NEVER
 *    touches stock itself.
 *
 * 2. WRITING AN ORDER IS ONE TRANSACTION. Head + lines + status log in one go; a failure in the
 *    middle leaves no half order. Before: three separate JSON files, and a power cut between them
 *    left an order with lines but no head.
 *
 * 3. EVERY MONEY NUMBER GOES THROUGH `order-money-kit`. That file is byte-identical in three
 *    repositories and a test compares every byte. The server annotates `paidAmount` /
 *    `remainingAmount` BEFORE an order leaves; nowhere derives them from `paymentStatus`.
 *
 * This file is only the manifest: routes, services, events, tables. The rules live in
 * `order-service.ts`, `customer-self-service.ts`, `public-orders.ts`, `reports.ts`.
 */

import { ACCESS, ERROR_CODES, EVENTS, defineModule, type ReplyDraft } from "../../contract";
import type { Config, OrderContext, Services } from "./context";
import { repositoryOf } from "./context";
import { cancelByCustomer, editCustomerProfile, lookupOrder, viewByLookupToken } from "./customer-self-service";
import type { Order, SearchFilter } from "./order-repository";
import {
  changeStatus, placeOrder, readByLookupToken, readOrder, recordPayment, searchOrders,
  type ChangeStatusInput, type PlaceResult, type RecordPaymentInput, type WriteOutcome
} from "./order-service";
import { ORDER_CAP, overview } from "./reports";
import { ORDER_TABLES, SCHEMA } from "./schema";

export type { Config, Services, ReserveInput, ReserveResult, ReleaseInput, ReleaseResult, OrderMoneySummary } from "./context";

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

export const manifest = defineModule<Config, Services>({
  id: "don-khach",
  name: "Đơn hàng & khách",
  tier: "van-hanh",
  runsOn: "server-khach",
  feature: "don-khach",
  version: "0.1.0",
  ports: ["store", "logger", "clock", "bus", "config"],
  requires: ["hang-kho.reserve", "hang-kho.release"],

  // Three tables from the running site — cannot be renamed because Desk reads them directly.
  inheritedTables: [ORDER_TABLES.orders, ORDER_TABLES.items, ORDER_TABLES.statusLogs],
  // This module CREATES them on a fresh machine, with exactly the running site's columns.
  schema: SCHEMA,

  // Money on an order is computed by the Money module (RULE 3: every number through the kit).
  // OPTIONAL because a merchant may not have bought Money — the lookup page still works, it
  // just does not show the paid amount.
  requiresOptional: ["tien-doi-soat.orderMoney"],

  events: {
    emits: [EVENTS.orderCreated, EVENTS.orderStatusChanged, EVENTS.orderCancelled],
    listens: {}
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
    {
      method: "POST", path: "/api/orders", access: ACCESS.public,
      whyPublic: "Khách đặt hàng từ web, không có mã nào. Tự bảo vệ bằng: phải có món thật trong kho, giữ chỗ tồn trước khi ghi, và không nhận giá từ client.",
      // Placing an order RESERVES real stock — a flooder could reserve the whole shop. Tight limit.
      rateLimit: { calls: 20, windowMs: TEN_MINUTES },
      handle: async (ctx, request): Promise<ReplyDraft> => {
        const result = await placeOrder(ctx, await request.json());
        if (!result.ok) return { status: 400, body: { ok: false, error: result.reason, mon: result.code, size: result.size } };
        return { status: 200, body: { ok: true, id: result.id, token: result.token, total: result.total } };
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
    }
  ],

  botTools: [
    { ten: "tra_don", moTa: "Tra trạng thái một đơn theo mã", hieuUng: "doc" },
    { ten: "tao_don", moTa: "Chốt đơn cho khách trong khung chat", hieuUng: "ghi" }
  ]
});
