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
import { toMysqlDateTime } from "../../shared/mysql-time";
import { deleteOrder, editOrder, listCustomers, purgeOrder, restoreOrder, reviewOrderCustomer, rotateLookupSecret, upsertManualOrder } from "./admin-orders";
import { PROFILE_SCHEMA, deleteProfileAddress, findProfileByPhone, listProfiles, readProfile, saveProfile, saveProfileAddress } from "./customer-profiles";
import { RETURNS_AND_CONTACTS_SCHEMA, listContacts, listReturns, returnLine, saveContact } from "./returns-and-contacts";
import { withPurchaseCounts, writeLineState } from "./line-procurement";
import { swapLine } from "./line-swap";
import { backfillCostPrices, linesMissingCost, writeCostPrices } from "./cost-price";
import { endOrder } from "./lifecycle";
import { availableActions, runQuickAction } from "./quick-actions";
import { parcelsOf } from "./parcels";
import { suggestWarehouse, type StockLine } from "./warehouse-hint";
import { WORKFLOW_TABS, countByTab, operationalStatuses } from "./workflow";
import type { Config, OrderContext, Services } from "./context";
import { repositoryOf } from "./context";
import {
  cancelMyOrder, forgotPassword, login, logout, me, myOrders, profile, register, requestChange, resetPassword, verifyChange
} from "./customer-accounts";
import { CUSTOMER_SCHEMA, CUSTOMER_TABLES } from "./customer-schema";
import { cancelByCustomer, editCustomerProfile, lookupOrder, viewByLookupToken } from "./customer-self-service";
import type { Order, SearchFilter } from "./order-repository";
import {
  changeStatus, placeOrder, readByLookupToken, readOrder, recordPayment, searchOrders,
  type ChangeStatusInput, type PlaceResult, type RecordPaymentInput, type WriteOutcome
} from "./order-service";
import type { Parcel } from "./parcels";
import { onDeliveryState, onShipmentCreated } from "./shipment-state";
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
    /** Đ3: the order's parcels (empty = ships as one). */
    parcels(id: string): Promise<Parcel[]>;
  };
}

const TEN_MINUTES = 10 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };
const text = (v: unknown): string => String(v ?? "").trim();
/**
 * Who did it, for the order history: the person or machine the kernel resolved (`nguoi:lan`,
 * `quan-tri`, `shop:may-ban-hang`). Before the web admin every change was written as "quan-tri".
 */
const actorOf = (request: { caller?: { name?: string } }): string => text(request.caller?.name) || "quan-tri";
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
  schema: [...SCHEMA, ...CUSTOMER_SCHEMA, ...RETURNS_AND_CONTACTS_SCHEMA, ...PROFILE_SCHEMA],

  // Money on an order is computed by the Money module (RULE 3: every number through the kit).
  // OPTIONAL because a merchant may not have bought Money — the lookup page still works, it
  // just does not show the paid amount.
  // The transfer prefix comes from page content when the platform module is there (the owner edits it).
  // `mua-ho.purchasedByLine`: how much of each line the partners have bought. Optional — a shop
  // without Purchasing simply has nothing bought yet, and the per-line buttons all stay open.
  // `hang-kho.stock`: tồn từng kho, để trả lời "có kho nào gánh được cả đơn không". Tuỳ chọn vì
  // bài kiểm tra cắm kho giả chỉ có bốn cửa giữ/trả/chốt/hoàn — thiếu nó thì màn hình đơn giản là
  // không có gợi ý, chứ không gãy.
  requiresOptional: [
    "tien-doi-soat.orderMoney", "khung-nen-tang.moneySettings", "ctv.attributionFor",
    "mua-ho.purchasedByLine", "mua-ho.costByLine", "hang-kho.stock", "hang-kho.restockInto", "khung-nen-tang.settings"
  ],

  events: {
    emits: [EVENTS.orderCreated, EVENTS.orderStatusChanged, EVENTS.orderCancelled],
    listens: {
      /**
       * A partner reported buying a line: stamp it, so its warehouse can no longer be swapped.
       *
       * The stamp is a convenience, not the rule — the rule is "a line with slips against it is
       * locked", counted fresh every time (`lineIsLocked`). If this listener never ran, the line
       * would still lock; the column only saves a round trip and survives a slip being undone
       * without the shop losing the fact that buying already started.
       */
      [EVENTS.purchaseReported]: async (ctx: OrderContext, payload: unknown) => {
        const p = (payload ?? {}) as Record<string, unknown>;
        const maDong = text(p["maDong"]);
        const maDon = text(p["maDon"]);
        if (maDon === "" || maDong === "") return;
        await repositoryOf(ctx).updateLine({
          orderId: maDon, lineId: maDong,
          patch: { purchase_locked_at: toMysqlDateTime(ctx.ports.clock.now()), procurement_status: "purchased" },
          at: ctx.ports.clock.now()
        });
      },
      /**
       * A partner said they cannot get this line. The line leaves their list (no longer pushed to
       * buy) and is marked `partner_out_of_stock` — which puts the order on the "có vấn đề" tab, so
       * the shop picks another warehouse. Before 16/09 nobody listened and the line just vanished.
       */
      [EVENTS.partnerStockOut]: async (ctx: OrderContext, payload: unknown) => {
        const p = (payload ?? {}) as Record<string, unknown>;
        const maDong = text(p["maDong"]);
        const maDon = text(p["maDon"]);
        if (maDon === "" || maDong === "") return;
        await repositoryOf(ctx).updateLine({
          orderId: maDon, lineId: maDong,
          patch: { procurement_status: "partner_out_of_stock", purchase_authorized: 0 },
          at: ctx.ports.clock.now()
        });
        ctx.ports.logger.info(`[don-khach] doi tac ${text(p["boi"])} bao het dong ${maDong} cua don ${maDon}`);
      },
      // A waybill was created (from OMI's Vận đơn screen, or by Purchasing): write the tracking
      // number onto the order. Shipping does not know what an order is and only this module writes
      // the orders table, so the two meet here. The order is NOT marked shipped — see `recordShipment`.
      [EVENTS.shipmentCreated]: async (ctx: OrderContext, payload: unknown) => {
        const p = (payload ?? {}) as Record<string, unknown>;
        // Đ3: the slip may be a PARCEL of an order (`ORD-1-02`) — see shipment-state.ts.
        const r = await onShipmentCreated(ctx, { maPhieu: text(p["maPhieu"]), maVanDon: text(p["maVanDon"]), hang: text(p["hang"]) });
        if (!r.ok && r.reason !== "khong_co_don") {
          ctx.ports.logger.warn(`[don-khach] khong ghi duoc ma van don cho ${text(p["maPhieu"]) || "(khong ro don)"}: ${r.reason}`);
        }
      },
      // Đ3: the tracking sync learned a new delivery state.
      [EVENTS.shipmentStatusChanged]: async (ctx: OrderContext, payload: unknown) => {
        const p = (payload ?? {}) as Record<string, unknown>;
        await onDeliveryState(ctx, { maPhieu: text(p["maPhieu"]), trangThaiGiao: text(p["trangThaiGiao"]), trangThai: text(p["trangThai"]) });
      }
    }
  },

  provides: {
    "don-khach.read": (ctx: OrderContext, id: string) => readOrder(ctx, id),
    "don-khach.search": (ctx: OrderContext, filter?: SearchFilter) => searchOrders(ctx, filter),
    "don-khach.place": (ctx: OrderContext, body: unknown) => placeOrder(ctx, body),
    "don-khach.changeStatus": (ctx: OrderContext, input: ChangeStatusInput) => changeStatus(ctx, input),
    "don-khach.readByLookupToken": (ctx: OrderContext, input: { id?: string; token?: string }) => readByLookupToken(ctx, input),
    "don-khach.recordPayment": (ctx: OrderContext, input: RecordPaymentInput) => recordPayment(ctx, input),
    // Đ3: the parcels of an order, so Shipping can create one waybill per parcel without knowing the order shape.
    "don-khach.parcels": async (ctx: OrderContext, id: string) => {
      const order = await readOrder(ctx, id);
      return order ? parcelsOf(order) : [];
    }
  },

  routes: [
    // ---------------- the customer on the web ----------------
    {
      method: "POST", path: "/api/orders", access: ACCESS.public,
      whyPublic: "Khách đặt hàng từ web, không có mã nào. Tự bảo vệ bằng: phải có món thật trong kho, giữ chỗ tồn trước khi ghi, và không nhận giá từ client.",
      // Placing an order RESERVES real stock — a flooder could reserve the whole shop. Tight limit.
      rateLimit: { calls: 20, windowMs: TEN_MINUTES },
      handle: async (ctx, request): Promise<ReplyDraft> => {
        const result = await placeOrderOnce(ctx, await request.json(), request.headers);
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
      handle: async (ctx, request) => {
        const tab = text(request.query["nhom"]);
        const q = text(request.query["q"]).toLowerCase();
        // The tab and the search box filter AFTER reading. Reading only `limit` orders first cut the
        // list to the newest 50, so "Đơn mới" showed 0 while its tab counted 10 (17/09/2026). With a
        // filter, read the same 500 the tab counts read, filter, then keep `limit`.
        const wanted = Math.min(Math.max(1, Number(request.query["limit"]) || 50), 500);
        const orders = await searchOrders(ctx, {
          status: request.query["status"] || null,
          phone: request.query["phone"] || null,
          since: request.query["since"] || null,
          limit: tab === "" && q === "" ? (request.query["limit"] ?? null) : 500,
          // An unknown value reads as "live orders only" — a typo in a query string must not
          // quietly hand back the bin.
          deleted: request.query["daXoa"] === "chi" ? "chi" : request.query["daXoa"] === "tat-ca" ? "tat-ca" : "khong",
          // Đ10 twin site: `site=chinh` = the main site only, `site=<slug>` = that site. Absent = every site.
          ...(request.query["site"] ? { site: request.query["site"] === "chinh" ? "" : String(request.query["site"]) } : {})
        });
        // ONE call for the whole page, not one per order.
        const bought = (await ctx.services["mua-ho"]?.purchasedByLine()) ?? new Map<string, number>();
        const withCounts = orders.map((o) => withPurchaseCounts(o, bought));
        const drawn = withCounts
          // Which tab it sits in, which buttons it shows, and whether it travels as more than one
          // parcel — all decided here, once, so no screen works any of it out for itself.
          .map((o) => ({ ...o, trangThaiQuyTrinh: operationalStatuses(o), viecLamDuoc: availableActions(o), kien: parcelsOf(o) }))
          // Two filters from Desk's status dropdown (`landingOrderStatusOptions`) that are not tabs:
          // a line nobody was given to yet, and orders sitting with a partner.
          .filter((o) => tab === "" || (tab === "chua-gan-kho"
            ? o.items.some((m) => m.warehouseId === "" && m.partnerId === "")
            : tab === "o-doi-tac" ? o.items.some((m) => m.partnerId !== "") : o.trangThaiQuyTrinh.includes(tab)))
          // The search box reads what the seller can SEE on the row — id, customer, phone, product.
          .filter((o) => q === "" || [o.id, o.customerName, o.phone, o.trackingCode, ...o.items.map((m) => `${m.productCode} ${m.productName}`)]
            .join(" ").toLowerCase().includes(q))
          .slice(0, wanted);
        return { status: 200, headers: NO_STORE, body: drawn };
      }
    },
    {
      /**
       * How many orders sit in each tab — a door of its own, on purpose.
       *
       * The number on a tab counts EVERY live order, and must not move when the seller types in
       * the search box or pages through the list. Folding it into the list door would make the
       * counts follow the filter, which is exactly the thing they are there to escape.
       *
       * Under `/api/admin/orders/…` so it can never be mistaken for an order id by the router.
       */
      method: "GET", path: "/api/admin/orders/dem-quy-trinh", access: ACCESS.admin,
      rateLimit: { calls: 240, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const site = request.query["site"] ? { site: request.query["site"] === "chinh" ? "" : String(request.query["site"]) } : {};
        const [live, binned] = await Promise.all([
          searchOrders(ctx, { limit: 500, ...site }),
          searchOrders(ctx, { limit: 500, deleted: "chi", ...site })
        ]);
        const bought = (await ctx.services["mua-ho"]?.purchasedByLine()) ?? new Map<string, number>();
        const counts = countByTab(live.map((o) => withPurchaseCounts(o, bought)));
        // Desk shows deleted orders inside "Đã hủy" as well (`app.js:8472`).
        counts["cancelled"] = (counts["cancelled"] ?? 0) + binned.length;
        return {
          status: 200, headers: NO_STORE,
          body: { ok: true, nhom: WORKFLOW_TABS, dem: counts, tongDangHoatDong: live.length, soDaXoa: binned.length }
        };
      }
    },
    {
      // A manual order typed by the owner (OMI). Same wire as Sales Desk's sync below.
      method: "POST", path: "/api/orders/thu-cong", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => upsertManualOrder(ctx, { body: await bodyOf(request.json), actor: actorOf(request) })
    },
    {
      method: "GET", path: "/api/orders/:maDon", access: ACCESS.admin,
      handle: async (ctx, request) => {
        const order = await readOrder(ctx, request.params["maDon"] ?? "");
        if (!order) return { status: 404, body: { ok: false, error: ERROR_CODES.notFound, message: "Không có đơn này." } };
        const bought = (await ctx.services["mua-ho"]?.purchasedByLine()) ?? new Map<string, number>();
        const full = withPurchaseCounts(order, bought);
        return {
          status: 200, headers: NO_STORE,
          body: { ...full, viecLamDuoc: availableActions(full), kien: parcelsOf(full) }
        };
      }
    },
    {
      /**
       * One door for the buttons in the status cell — Desk's shape: the name of the job travels in
       * the body, not in the path. Six near-identical doors would drift apart; this one cannot.
       */
      /**
       * "Có kho nào một mình gánh được cả đơn không?" — cửa RIÊNG, hỏi khi mở một đơn.
       *
       * Mỗi đơn là N lần hỏi tồn. Nhét vào cửa danh sách là 100 đơn thành 100×N lần hỏi cho một
       * lần tải trang, và máy chủ của khách nằm trên hosting chung.
       */
      method: "GET", path: "/api/orders/:maDon/goi-y-kho", access: ACCESS.admin,
      rateLimit: { calls: 240, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const order = await readOrder(ctx, request.params["maDon"] ?? "");
        if (!order) return { status: 404, body: { ok: false, error: ERROR_CODES.notFound, message: "Không có đơn này." } };
        const stockOf = ctx.services["hang-kho"].stock;
        if (!stockOf) return { status: 200, headers: NO_STORE, body: { ok: true, goiY: null } };

        const stock = new Map<string, StockLine[]>();
        const names = new Map<string, string>();
        // Một lần hỏi cho mỗi MÃ HÀNG, không phải mỗi dòng: một đơn hai đôi cùng mã chỉ hỏi một lần.
        for (const code of new Set(order.items.map((m) => m.productCode).filter((c) => c !== ""))) {
          const answer = await stockOf({ code });
          if (!answer.found) continue;
          stock.set(code, answer.lines);
          for (const l of answer.lines) if (!names.has(l.warehouseId)) names.set(l.warehouseId, l.warehouseId);
        }
        // Tên kho người đọc được: lấy từ chính dòng đơn nếu đã gán, không hiện mã thô như Desk.
        for (const m of order.items) if (m.warehouseId !== "" && m.warehouseName !== "") names.set(m.warehouseId, m.warehouseName);

        const hint = suggestWarehouse(
          order.items.map((m) => ({ maDong: m.maDong, ma: m.productCode, size: m.size, soLuong: m.qty })),
          stock, names
        );
        return { status: 200, headers: NO_STORE, body: { ok: true, goiY: hint } };
      }
    },
    {
      /**
       * ĐỔI MẪU một dòng — đối tác báo hết hàng, người bán đổi cho khách sang đôi khác.
       *
       * Desk làm bằng chatbot đọc hiểu tiếng Việt và đang tắt vì lỗi chưa sửa. Đây là một nút:
       * người bán gõ mã mới vào ô tìm hàng rồi bấm. Tồn đi theo món trong cùng một lượt — đó
       * chính là chỗ Desk bỏ dở ("giữ chỗ tồn vẫn trỏ mã cũ").
       */
      method: "POST", path: "/api/orders/:maDon/dong/:maDong/doi-mau", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request.json);
        const maDong = decodeURIComponent(request.params["maDong"] ?? "");
        const bought = (await ctx.services["mua-ho"]?.purchasedByLine())?.get(maDong) ?? 0;
        return swapLine(ctx, {
          orderId: request.params["maDon"] ?? "",
          lineId: maDong,
          ma: text(body["ma"]),
          size: text(body["size"]),
          lyDo: text(body["lyDo"]),
          daMua: bought,
          actor: actorOf(request)
        });
      }
    },
    {
      // Hai đường KẾT THÚC một đơn — tách khỏi `viec` vì chúng đụng tồn kho, tiền và hãng vận
      // chuyển, và vì "Hàng hoàn" bắt buộc có lý do.
      method: "POST", path: "/api/orders/:maDon/ket-thuc", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request.json);
        return endOrder(ctx, {
          id: request.params["maDon"] ?? "",
          mode: text(body["cach"]),
          lyDo: text(body["lyDo"]),
          giuCoc: text(body["giuCoc"]),
          actor: actorOf(request)
        });
      }
    },
    {
      method: "POST", path: "/api/orders/:maDon/viec", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request.json);
        return runQuickAction(ctx, {
          id: request.params["maDon"] ?? "",
          viec: text(body["viec"]),
          ghiChu: text(body["ghiChu"]),
          actor: actorOf(request)
        });
      }
    },
    {
      method: "PATCH", path: "/api/orders/:maDon", access: ACCESS.admin,
      handle: async (ctx, request) => {
        const body = await bodyOf(request.json);
        const outcome = await changeStatus(ctx, {
          id: request.params["maDon"] ?? "", status: text(body["status"]), note: text(body["note"]), actor: actorOf(request)
        });
        return { status: outcome.ok ? 200 : 404, body: outcome.ok ? { ok: true } : { ok: false, viSao: outcome.reason } };
      }
    },
    {
      // The owner edits recipient, money, shipping and lines. Lines move stock (old back, new taken).
      method: "PUT", path: "/api/orders/:maDon", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => editOrder(ctx, request.params["maDon"] ?? "", await bodyOf(request.json), actorOf(request))
    },
    {
      // Xoá = move to the bin AND give the stock back. Permanent removal is the door below.
      method: "DELETE", path: "/api/orders/:maDon", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => deleteOrder(ctx, request.params["maDon"] ?? "", actorOf(request))
    },
    {
      // The shop's decisions about ONE line: which warehouse buys it, whether it is pushed to the
      // buying list, what kind of thing it is. How much has already been bought is counted from
      // Purchasing's slips HERE, at the route — never inside `search`/`read`, which Purchasing calls.
      method: "PATCH", path: "/api/orders/:maDon/dong/:maDong", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request.json);
        const maDong = decodeURIComponent(request.params["maDong"] ?? "");
        const bought = (await ctx.services["mua-ho"]?.purchasedByLine())?.get(maDong) ?? 0;
        return writeLineState(ctx, {
          orderId: request.params["maDon"] ?? "",
          lineId: maDong,
          ...(body["maDoiTac"] === undefined ? {} : { maDoiTac: text(body["maDoiTac"]) }),
          ...(body["maKho"] === undefined ? {} : { maKho: text(body["maKho"]) }),
          ...(body["tenKho"] === undefined ? {} : { tenKho: text(body["tenKho"]) }),
          ...(body["dayMua"] === undefined ? {} : { dayMua: body["dayMua"] === true }),
          ...(body["loaiSanPham"] === undefined ? {} : { loaiSanPham: text(body["loaiSanPham"]) }),
          daMua: bought,
          actor: actorOf(request)
        });
      }
    },
    {
      method: "POST", path: "/api/orders/:maDon/khoi-phuc", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => restoreOrder(ctx, request.params["maDon"] ?? "", actorOf(request))
    },
    {
      // Emptying the bin. Refuses an order that is not in it — see `purgeOrder`.
      method: "DELETE", path: "/api/orders/:maDon/vinh-vien", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => purgeOrder(ctx, request.params["maDon"] ?? "", actorOf(request))
    },
    {
      /**
       * GIÁ VỐN — ba cửa cho màn Tài chính.
       *
       * Ở đây chứ không ở màn Đơn hàng: giá vốn là việc của người làm sổ, và nó là con số nhạy
       * cảm nhất trên một dòng đơn — ai đứng sau lưng người bán hàng cũng đọc được nếu nó nằm
       * trên bảng đơn.
       */
      method: "GET", path: "/api/tien/gia-von/thieu", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => linesMissingCost(ctx, Number(request.query["gioiHan"] ?? 200))
    },
    {
      method: "POST", path: "/api/tien/gia-von", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request.json);
        const rows = Array.isArray(body["dong"]) ? body["dong"] : [];
        return writeCostPrices(ctx, rows.map((x) => {
          const r = (x ?? {}) as Record<string, unknown>;
          return { maDon: text(r["maDon"]), maDong: text(r["maDong"]), giaVon: Number(r["giaVon"] ?? 0) };
        }), actorOf(request));
      }
    },
    {
      // Bù tự động từ phiếu mua của đối tác. Chạy lại bao nhiêu lần cũng được — chỉ điền chỗ trống.
      method: "POST", path: "/api/tien/gia-von/bu-tu-phieu", access: ACCESS.admin,
      rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request.json);
        return backfillCostPrices(ctx, { maDon: text(body["maDon"]), actor: actorOf(request) });
      }
    },
    {
      // Customers as the owner sees them: accounts, and everyone known from orders.
      method: "GET", path: "/api/admin/khach", access: ACCESS.admin,
      handle: async (ctx, request) => listCustomers(ctx, text(request.query["q"]), Number(request.query["limit"] || 200))
    },
    // ----- Đ2 (17/09/2026): the owner's customer book, Sales Desk's `customerProfiles` -----
    {
      method: "GET", path: "/api/admin/ho-so-khach", access: ACCESS.admin,
      handle: async (ctx, request) => listProfiles(ctx, text(request.query["q"]), Number(request.query["limit"] || 300))
    },
    {
      // Exact phone — the order editor's "Tìm khách". Its own path so no router can read the word as a profile id.
      method: "GET", path: "/api/admin/ho-so-khach-theo-so", access: ACCESS.admin,
      handle: async (ctx, request) => {
        const row = await findProfileByPhone(ctx, text(request.query["dienThoai"]));
        return row ? readProfile(ctx, text(row["ma"])) : reply.json({ ok: true, khach: null }, 200, NO_STORE);
      }
    },
    {
      method: "GET", path: "/api/admin/ho-so-khach/:ma", access: ACCESS.admin,
      handle: async (ctx, request) => readProfile(ctx, request.params["ma"] ?? "")
    },
    {
      method: "POST", path: "/api/admin/ho-so-khach", access: ACCESS.admin,
      rateLimit: { calls: 240, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => saveProfile(ctx, await bodyOf(request.json))
    },
    {
      method: "POST", path: "/api/admin/ho-so-khach/:ma/dia-chi", access: ACCESS.admin,
      rateLimit: { calls: 240, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => saveProfileAddress(ctx, request.params["ma"] ?? "", await bodyOf(request.json))
    },
    {
      method: "DELETE", path: "/api/admin/ho-so-khach/:ma/dia-chi/:maDiaChi", access: ACCESS.admin,
      rateLimit: { calls: 240, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => deleteProfileAddress(ctx, request.params["ma"] ?? "", request.params["maDiaChi"] ?? "")
    },
    {
      // A web order whose buyer is not in the book yet ("Chờ duyệt khách"): link it to a profile,
      // or make a new profile from what the order says (Desk `confirm-remote-*-customer`).
      method: "POST", path: "/api/orders/:maDon/duyet-khach", access: ACCESS.admin,
      rateLimit: { calls: 240, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => reviewOrderCustomer(ctx, request.params["maDon"] ?? "", await bodyOf(request.json), actorOf(request))
    },
    {
      // A NEW lookup secret for an order (the old one cannot be shown again: only its hash is kept).
      method: "POST", path: "/api/orders/:maDon/ma-tra-cuu", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => rotateLookupSecret(ctx, request.params["maDon"] ?? "", actorOf(request))
    },
    {
      // The contact book of the warehouse page: a customer typed in by hand (see returns-and-contacts.ts).
      method: "GET", path: "/api/admin/so-khach", access: ACCESS.admin,
      handle: async (ctx, request) => reply.json({ ok: true, khach: await listContacts(ctx, Number(request.query["limit"] || 500)) }, 200, NO_STORE)
    },
    {
      method: "POST", path: "/api/admin/so-khach", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => saveContact(ctx, await bodyOf(request.json))
    },
    {
      // A partial return of one line into a chosen warehouse (the warehouse page's "Hoàn").
      method: "POST", path: "/api/orders/:maDon/dong/:maDong/tra-hang", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = await bodyOf(request.json);
        return returnLine(ctx, {
          orderId: request.params["maDon"] ?? "", lineId: request.params["maDong"] ?? "",
          quantity: body["soLuong"], warehouseId: body["maKho"], note: body["ghiChu"], actor: actorOf(request)
        });
      }
    },
    {
      method: "GET", path: "/api/admin/hoan-hang", access: ACCESS.admin,
      handle: async (ctx, request) => reply.json({ ok: true, hoanHang: await listReturns(ctx, Number(request.query["limit"] || 500)) }, 200, NO_STORE)
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
