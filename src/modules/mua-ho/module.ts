/**
 * @file MODULE PURCHASING & AUTO-ORDERING ("mua-ho") — tier "van-hanh", runs on the merchant server.
 *
 * The portal for PURCHASING PARTNERS: they log in, see what needs buying, report how much they
 * bought (or that it is out of stock), ask for a waybill, and mark an order packed. This module
 * also SERVES that portal's pages: they live in its own `goc/`, and only it may hand them out.
 *
 * FIVE RULES THAT MUST NOT BREAK:
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
 *
 * 5. A PARTNER IS A PERSON, NOT A LINK (15/09/2026). They log in with a name and a password hashed
 *    like a collaborator's. The portal code stays as the ADDRESS of their page; it stopped being
 *    the proof of who they are, so a forwarded link is no longer an account.
 */

import { ACCESS, ERROR_CODES, EVENTS, defineModule, reply, type KernelRequest, type ModuleContext, type ReplyDraft } from "../../contract";
import type { OrderServices as OrderServicesOf } from "../don-khach/module";
import type { CreateFromOrderInput, CreateFromOrderOutcome } from "../van-chuyen/module";
import { toMysqlDateTime } from "../../shared/mysql-time";
import { LoginLockout } from "../../shared/login-lockout";
import { hashPassword, verifyPassword } from "../../shared/password";
import { PartnerSession, type PartnerSessionConfig } from "./partner-session";
import {
  LEDGER_EXTRA, LEDGER_PAID, PACKED, PurchaseRepository, isDuplicateKeyError,
  type Partner, type PurchaseSlip, type StockOutReport
} from "./purchase-repository";
import {
  buildNeeds, buildOrderLines, buildParcels, buildSessions, buildSummary, lineIdOf, normaliseFeeMode,
  openLines, unitCostOf, type OpenLine, type PortalOrder, type PortalOrderLine, type PortalView
} from "./portal-state";
import { matchReading, readLabel, type ScanAiConfig, type ScanCandidate } from "./scan-label";
import { POLICIES_DOCUMENT, SCHEMA } from "./schema";
import { dateWindow, inWindow } from "../../shared/date-range";

/** `ctx.config` as `app.ts` builds it. */
export interface Config extends PartnerSessionConfig {
  /** Key for reading a product label with the camera. The OPERATOR's key, not the shop's. */
  scanAi?: ScanAiConfig;
}

/**
 * The order slice this module reads (order wire format). Declared locally from the old JS: the
 * Orders module is being ported in parallel.
 */
export interface OrderForPurchasing extends PortalOrder {
  id?: string;
  items?: PortalOrderLine[];
}

/**
 * Minimal structural type of the Orders search — declared locally, not `import type`d, so this
 * module's build never pulls the Orders module's files in while both are ported in parallel.
 */
type OrderServices = OrderServicesOf["don-khach"];

interface Services {
  "don-khach": Pick<OrderServices, "search">;
  /** Optional (Đ4): the shop's own Telegram bot, to hand an order's products to a partner. */
  "tien-doi-soat"?: { sendTelegram(input: { chatId: string; text: string }): Promise<{ ok: boolean; loiNhan: string }> };
  /** Optional: a shop may not have bought Shipping. Then the portal shows no "create waybill" button. */
  "van-chuyen"?: { createFromOrder(input: CreateFromOrderInput): Promise<CreateFromOrderOutcome> };
}

type Ctx = ModuleContext<Config, Services>;

/** One order line a partner must buy. Wire: returned as `canMua[]` to the shop's screen. */
export interface PurchaseTask {
  maDong: string;
  maDon: string;
  maMon: string;
  ten: string;
  size: string;
  /** Pairs still missing on the line (what anybody bought is already taken off). */
  soLuong: number;
  /** The partner the line was given to. */
  maDoiTac: string;
}

export type ReportPurchaseResult =
  | { ok: true; trungLenh: true; maPhieu: string; maLenh: string }
  | { ok: true; maPhieu: string; maDong: string; soLuong: number; thua?: number; maLenh: string }
  | { ok: false; viSao: "thieu_ma_dong_hoac_so_luong" | "dong_khong_thuoc_doi_tac" | "khong_con_dong_can_mua" };

export type ReportStockOutResult =
  | { ok: true; maDong: string }
  | { ok: false; viSao: "thieu_ma_dong" | "dong_khong_thuoc_doi_tac" | "khong_con_dong_can_mua" };

/** What the page shows when a report is refused. */
const REFUSALS: Record<string, string> = {
  thieu_ma_dong_hoac_so_luong: "Thiếu mã sản phẩm hoặc số lượng mua được.",
  thieu_ma_dong: "Thiếu mã sản phẩm cần báo hết hàng.",
  dong_khong_thuoc_doi_tac: "Dòng hàng này không nằm trong danh sách cần mua của bạn.",
  khong_con_dong_can_mua: "Mã/size này không còn đơn nào đang chờ bạn mua — tải lại trang để xem danh sách mới."
};

const refused = (viSao: string): ReplyDraft => reply.json({ ok: false, error: viSao, message: REFUSALS[viSao] ?? "Không ghi nhận được." }, 400);

/** Services this module PROVIDES (`mua-ho.*`). Consumers `import type` this. */
export interface PurchasingServices {
  /** The order lines a partner still has to buy. */
  needsPurchase(partnerId: string): Promise<PurchaseTask[]>;
  /** Which lines of an order are reported out of stock — other modules ask before promising a customer. */
  reportedOutOfStock(orderId: string): Promise<StockOutReport[]>;
}

const TEN_MINUTES = 10 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };

const text = (v: unknown): string => String(v || "").trim();

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

const NOT_LOGGED_IN: ReplyDraft = {
  status: 401,
  body: { ok: false, error: ERROR_CODES.unauthenticated, message: "Phiên đăng nhập đã hết. Vui lòng đăng nhập lại." }
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
 *
 * A request that names a portal code (`?token=` / `token` in the body, as the page sends) must name
 * THE SAME partner as the cookie — the running site's rule. Otherwise partner A's cookie opened on
 * partner B's link quietly shows A's screen under B's address.
 */
async function loggedInPartner(ctx: Ctx, request: KernelRequest, body?: Record<string, unknown>): Promise<Partner | null> {
  const portalCode = session(ctx).portalCode(request.headers);
  if (!portalCode) return null;
  const named = text(request.query["token"] || body?.["token"]);
  if (named !== "" && named !== portalCode) return null;
  return repository(ctx).activePartnerByPortalCode(portalCode);
}

/** How many orders the portal reads: the newest, dead or alive — the builders decide what counts. */
const ORDERS_READ = 500;

/** Orders as the portal sees them. One read, reused by every list on the screen. */
async function recentOrders(ctx: Ctx): Promise<OrderForPurchasing[]> {
  return ctx.services["don-khach"].search({ limit: ORDERS_READ });
}

/** Who is looking, and what was already done — everything the builders need. `""` = the shop. */
async function viewFor(ctx: Ctx, partnerId: string): Promise<PortalView> {
  const repo = repository(ctx);
  const [purchasedByAnyone, purchasedByPartner, reportedOut, packing, shipmentRequests] = await Promise.all([
    repo.purchasedByLine(""),
    partnerId ? repo.purchasedByLine(partnerId) : repo.purchasedByLine(""),
    repo.stockOutLineIds(partnerId),
    partnerId ? repo.packingFor(partnerId) : Promise.resolve(new Map()),
    partnerId ? repo.shipmentRequestsFor(partnerId) : Promise.resolve(new Map())
  ]);
  return { partnerId, purchasedByAnyone, purchasedByPartner, reportedOut, packing, shipmentRequests, now: ctx.ports.clock.now() };
}

/** The order lines a partner still has to buy — the shop's screen and the bot read this shape. */
async function needsPurchase(ctx: Ctx, partnerId: string): Promise<PurchaseTask[]> {
  const [orders, view] = await Promise.all([recentOrders(ctx), viewFor(ctx, partnerId)]);
  return openLines(orders, view).map(({ order, line, lineId, remaining }) => ({
    maDong: lineId, maDon: text(order.id), maMon: text(line.productCode), ten: text(line.productName),
    size: text(line.size), soLuong: remaining, maDoiTac: text(line.partnerId)
  }));
}

/** Product names by code, for the sessions tab (a slip stores only the code). */
function namesFrom(orders: OrderForPurchasing[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const order of orders) {
    for (const line of order.items ?? []) {
      const code = text(line.productCode).toLowerCase();
      if (code && line.productName && !names.has(code)) names.set(code, text(line.productName));
    }
  }
  return names;
}

/**
 * THE WHOLE SCREEN in one reply: what to buy, which orders to pack, which parcels need a waybill,
 * the slips already reported, and the money. The page reads exactly these names — see `portal-state.ts`.
 */
async function portalState(ctx: Ctx, partner: Partner): Promise<Record<string, unknown>> {
  const repo = repository(ctx);
  const [orders, view, recent, allSlips, ledger] = await Promise.all([
    recentOrders(ctx),
    viewFor(ctx, partner.id),
    repo.recentPurchases(partner.id, 200),
    repo.allPurchases(partner.id),
    repo.ledgerFor(partner.id, 500)
  ]);

  const paid = ledger.filter((l) => l.loai === LEDGER_PAID);
  const extra = ledger.filter((l) => l.loai === LEDGER_EXTRA);
  const sum = (rows: typeof ledger) => rows.reduce((total, l) => total + l.soTien, 0);
  const asMoneyRow = (l: (typeof ledger)[number]) => ({ amount: l.soTien, createdAt: l.taoLuc, note: l.ghiChu });
  const parcels = buildParcels(orders, view);

  return {
    ok: true,
    // `partner.login` and the portal code are the partner's own — never another's.
    partner: { id: partner.id, name: partner.name, login: partner.login },
    token: partner.portalCode,
    needs: buildNeeds(orders, view),
    orders: buildOrderLines(orders, view),
    packingOrders: parcels,
    shipments: parcels,
    purchases: buildSessions(recent, partner, namesFrom(orders)).slice(0, 50),
    payments: paid.map(asMoneyRow),
    adjustments: extra.map(asMoneyRow),
    summary: buildSummary(allSlips, partner, sum(paid), sum(extra)),
    // The shop's screen and the tests still read this one.
    canMua: openLines(orders, view).map(({ order, line, lineId, remaining }) => ({
      maDong: lineId, maDon: text(order.id), maMon: text(line.productCode), ten: text(line.productName),
      size: text(line.size), soLuong: remaining, maDoiTac: text(line.partnerId)
    })),
    generatedAt: ctx.ports.clock.now().toISOString()
  };
}

/** The purchase session a reply should carry, so the page's "Đang mua" panel updates without a reload. */
async function sessionReply(ctx: Ctx, partner: Partner, sessionId: string, orders?: OrderForPurchasing[]): Promise<Record<string, unknown> | null> {
  if (!sessionId) return null;
  const slips = await repository(ctx).sessionSlips(partner.id, sessionId);
  if (slips.length === 0) return null;
  return buildSessions(slips, partner, orders ? namesFrom(orders) : undefined)[0] ?? null;
}

/** One share of a purchase: how many pairs go on which line. */
interface Allocation {
  lineId: string;
  orderId: string;
  take: number;
  unitCost: number;
}

/**
 * Turns "I bought 3 of DV1234 size 42" into the ORDER LINES it covers.
 *
 * The page's buttons are per product and size (that is how a person shops), but everything stored
 * is per line (rule 2). This is the only place the two meet.
 *
 * Order, as on the running site: first the lines this purchase FINISHES an order with — a whole
 * parcel can then leave — and among those, and then the rest, the oldest order first.
 */
async function allocate(ctx: Ctx, partnerId: string, productCode: string, size: string, quantity: number): Promise<Allocation[]> {
  const [orders, view] = await Promise.all([recentOrders(ctx), viewFor(ctx, partnerId)]);
  const open = openLines(orders, view);
  const wantedCode = productCode.trim().toLowerCase();
  const wantedSize = size.trim().toLowerCase();
  let left = Math.max(0, Math.trunc(quantity));

  // What is still missing per order for this partner, to know which purchase completes an order.
  const missingPerOrder = new Map<string, number>();
  for (const o of open) missingPerOrder.set(text(o.order.id), (missingPerOrder.get(text(o.order.id)) ?? 0) + o.remaining);

  const candidates = open
    .filter((o) => text(o.line.productCode).toLowerCase() === wantedCode && (wantedSize === "" || text(o.line.size).toLowerCase() === wantedSize))
    .map((o) => ({ ...o, completes: missingPerOrder.get(text(o.order.id)) === o.remaining && left >= o.remaining }))
    .sort((a, b) => (a.completes === b.completes ? text(a.order.createdAt).localeCompare(text(b.order.createdAt)) : a.completes ? -1 : 1));

  const out: Allocation[] = [];
  for (const c of candidates) {
    if (left <= 0) break;
    const take = Math.min(left, c.remaining);
    out.push({ lineId: c.lineId, orderId: text(c.order.id), take, unitCost: unitCostOf(c.line) });
    left -= take;
  }
  return out;
}

/** Writes ONE purchase slip. RULE 3: the same command id is not written twice. */
async function writeSlip(
  ctx: Ctx, partner: Partner,
  { lineId, orderId, productCode, size, quantity, paidCost, systemCost, commandId, note }:
  { lineId: string; orderId: string; productCode: string; size: string; quantity: number; paidCost: number; systemCost: number; commandId: string; note: string }
): Promise<{ maPhieu: string; trungLenh?: true }> {
  const repo = repository(ctx);
  if (commandId) {
    const existing = await repo.purchaseByCommand(partner.id, commandId);
    if (existing) return { maPhieu: existing.maPhieu, trungLenh: true };
  }
  const now = ctx.ports.clock.now();
  const slipId = `mua_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await repo.insertPurchase({
      ma_phieu: slipId, ma_doi_tac: partner.id, ma_don: orderId, ma_dong: lineId,
      ma_mon: productCode, size,
      so_luong: quantity,
      // RULE 4: the partner reports the COST price they bought at; the system's is kept beside it.
      gia_von: Math.max(0, paidCost || systemCost),
      gia_he_thong: Math.max(0, systemCost),
      ma_lenh: commandId, ghi_chu: note, tao_luc: toMysqlDateTime(now, { ms: true })
    });
  } catch (e) {
    // Two taps at once: the second hits the unique key — answer with the existing slip, never throw.
    if (isDuplicateKeyError(e)) {
      const existing = await repo.purchaseByCommand(partner.id, commandId);
      if (existing) return { maPhieu: existing.maPhieu, trungLenh: true };
    }
    throw e;
  }
  // A partner bought against this line: Orders locks its warehouse, because the slip now points at
  // it. One-way, over the bus — this module may not call Orders, and Orders may not ask back.
  ctx.bus.emit(EVENTS.purchaseReported, { maDon: orderId, maDong: lineId, maMon: productCode, soLuong: quantity, boi: partner.id });
  return { maPhieu: slipId };
}

/** The line behind a line id, among the lines this partner may touch. */
async function openLineById(ctx: Ctx, partnerId: string, lineId: string): Promise<OpenLine | null> {
  const [orders, view] = await Promise.all([recentOrders(ctx), viewFor(ctx, partnerId)]);
  return openLines(orders, view).find((o) => o.lineId === lineId) ?? null;
}

/**
 * The partner reports a purchase.
 *
 * Two shapes arrive here and both must work: the SHOP's screen (and the tests) send a line id, the
 * PORTAL page sends a product code and a size for the server to spread over the waiting lines.
 * Either way the line must be one the shop GAVE this partner — a line id from someone else's list
 * is refused, not written.
 */
async function reportPurchase(ctx: Ctx, partner: Partner, body: Record<string, unknown> = {}): Promise<ReportPurchaseResult> {
  const commandId = text(body["maLenh"] || body["commandId"]);
  const quantity = Math.max(0, Math.trunc(Number(body["soLuong"] ?? body["quantity"] ?? 0)));
  const paidCost = Math.max(0, Number(body["giaVon"] ?? body["actualUnitCost"] ?? 0));
  const note = String(body["ghiChu"] || body["note"] || "");
  const lineId = text(body["maDong"]);

  if (lineId) {
    if (quantity <= 0) return { ok: false, viSao: "thieu_ma_dong_hoac_so_luong" };
    // A repeated command is answered before the line check: the first write may have closed the line.
    if (commandId) {
      const existing = await repository(ctx).purchaseByCommand(partner.id, commandId);
      if (existing) return { ok: true, trungLenh: true, maPhieu: existing.maPhieu, maLenh: commandId };
    }
    const open = await openLineById(ctx, partner.id, lineId);
    if (!open) return { ok: false, viSao: "dong_khong_thuoc_doi_tac" };
    const written = await writeSlip(ctx, partner, {
      lineId, orderId: text(open.order.id), productCode: text(open.line.productCode), size: text(open.line.size),
      quantity: Math.min(quantity, open.remaining), paidCost, systemCost: unitCostOf(open.line), commandId, note
    });
    if (written.trungLenh) return { ok: true, trungLenh: true, maPhieu: written.maPhieu, maLenh: commandId };
    return { ok: true, maPhieu: written.maPhieu, maDong: lineId, soLuong: quantity, maLenh: commandId || written.maPhieu };
  }

  const productCode = text(body["maMon"] || body["productCode"]);
  const size = String(body["size"] || "");
  if (!productCode || quantity <= 0) return { ok: false, viSao: "thieu_ma_dong_hoac_so_luong" };

  if (commandId) {
    const existing = await repository(ctx).purchaseByCommand(partner.id, `${commandId}#0`);
    if (existing) return { ok: true, trungLenh: true, maPhieu: existing.maPhieu, maLenh: commandId };
  }
  const parts = await allocate(ctx, partner.id, productCode, size, quantity);
  if (parts.length === 0) return { ok: false, viSao: "khong_con_dong_can_mua" };

  let first: { maPhieu: string; trungLenh?: true } | null = null;
  let index = 0;
  for (const part of parts) {
    // One command id per LINE, or the second line would look like a duplicate of the first.
    const perLine = commandId ? `${commandId}#${index}` : "";
    const written = await writeSlip(ctx, partner, {
      lineId: part.lineId, orderId: part.orderId, productCode, size,
      quantity: part.take, paidCost, systemCost: part.unitCost, commandId: perLine, note
    });
    first ??= written;
    index += 1;
  }
  const allocated = parts.reduce((total, p) => total + p.take, 0);
  if (first?.trungLenh) return { ok: true, trungLenh: true, maPhieu: first.maPhieu, maLenh: commandId };
  return {
    ok: true, maPhieu: first?.maPhieu ?? "", maDong: parts[0]!.lineId, soLuong: allocated,
    // Bought more than anyone is waiting for: said out loud, not dropped in silence.
    ...(allocated < quantity ? { thua: quantity - allocated } : {}),
    maLenh: commandId || (first?.maPhieu ?? "")
  };
}

/**
 * The partner reports a line out of stock. RULE 2: keyed by LINE ID.
 *
 * The report is written, and ANNOUNCED: Orders listens and takes the line off this partner's hands
 * (status `partner_out_of_stock`, no longer pushed to buy), so the shop sees it must find another
 * source. Until 16/09 nobody listened, and the line simply vanished from every list.
 */
async function reportStockOut(ctx: Ctx, partner: Partner, body: Record<string, unknown> = {}): Promise<ReportStockOutResult> {
  const reason = String(body["lyDo"] || body["reason"] || body["note"] || "");
  const now = ctx.ports.clock.now();
  const repo = repository(ctx);

  const write = async (open: OpenLine): Promise<void> => {
    const orderId = text(open.order.id);
    const productCode = text(open.line.productCode);
    const size = text(open.line.size);
    // Reporting the same line again UPDATES it, never creates a second row — partners may tap twice.
    await repo.upsertStockOut({
      ma_dong: open.lineId, ma_doi_tac: partner.id, ma_don: orderId,
      ma_mon: productCode, size, ly_do: reason, bao_luc: toMysqlDateTime(now, { ms: true })
    });
    ctx.bus.emit(EVENTS.partnerStockOut, { maDon: orderId, maDong: open.lineId, maMon: productCode, size, lyDo: reason, boi: partner.id });
  };

  const [orders, view] = await Promise.all([recentOrders(ctx), viewFor(ctx, partner.id)]);
  // A line already reported stays reportable (the reason may change), so the filter is widened here.
  const open = openLines(orders, { ...view, reportedOut: new Set() });

  const lineId = text(body["maDong"]);
  if (lineId) {
    const line = open.find((o) => o.lineId === lineId);
    if (!line) return { ok: false, viSao: "dong_khong_thuoc_doi_tac" };
    await write(line);
    return { ok: true, maDong: lineId };
  }

  // The page reports "this shop has none" per product and size: every waiting line of it is out.
  const productCode = text(body["maMon"] || body["productCode"]).toLowerCase();
  if (!productCode) return { ok: false, viSao: "thieu_ma_dong" };
  const size = text(body["size"]).toLowerCase();
  const lines = open.filter((o) => text(o.line.productCode).toLowerCase() === productCode && (size === "" || text(o.line.size).toLowerCase() === size));
  if (lines.length === 0) return { ok: false, viSao: "khong_con_dong_can_mua" };
  for (const line of lines) await write(line);
  return { ok: true, maDong: lines[0]!.lineId };
}

// =============================================================================================
// Đ4 (17/09/2026) — the SHOP's side of partner work: the ledger by period, correcting a transfer,
// buying / reporting out of stock ON BEHALF of a partner, moving bought goods between orders,
// handing an order's products to a partner's Telegram, and the partner policies the bot reads.
// =============================================================================================

const nowStamp = (ctx: Ctx): string => toMysqlDateTime(ctx.ports.clock.now(), { ms: true });
const newCommand = (ctx: Ctx, prefix: string): string => `${prefix}_${ctx.ports.clock.now().getTime()}_${Math.random().toString(36).slice(2, 8)}`;
const lower = (v: unknown): string => text(v).toLowerCase();
const escapeHtml = (v: unknown): string => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Orders whose goods may no longer move: delivered, finished, cancelled. */
const FINAL_ORDER_STATUSES = new Set(["delivered", "completed", "cancelled", "canceled", "returned_to_stock", "soft_deleted"]);

/**
 * THE LEDGER BY PERIOD — Desk's `partnerFeesTemplate`: per partner the purchase sessions, pairs,
 * orders, fee, extra costs, what was transferred and what is still owed, inside the window.
 * Voided transfers are listed (struck through on screen) but never counted.
 */
async function ledgerByPeriod(ctx: Ctx, partnerId: string, tuNgay: string, denNgay: string): Promise<Record<string, unknown>> {
  const repo = repository(ctx);
  const window = dateWindow(tuNgay, denNgay);
  const all = await repo.listPartners();
  const partners = all.filter((r) => partnerId === "" || String(r["ma"]) === partnerId);
  const rows: Record<string, unknown>[] = [];
  const payments: Record<string, unknown>[] = [];
  const extras: Record<string, unknown>[] = [];
  for (const row of partners) {
    const partner = await repo.partnerById(String(row["ma"]));
    if (!partner) continue;
    const [slips, ledger] = await Promise.all([repo.allPurchases(partner.id), repo.ledgerFor(partner.id, 2000, { withVoided: true })]);
    const inSlips = slips.filter((s) => inWindow(s.taoLuc, window));
    const inLedger = ledger.filter((l) => inWindow(l.taoLuc, window));
    const live = inLedger.filter((l) => !l.huyLuc);
    const paid = live.filter((l) => l.loai === LEDGER_PAID).reduce((t, l) => t + l.soTien, 0);
    const extra = live.filter((l) => l.loai === LEDGER_EXTRA).reduce((t, l) => t + l.soTien, 0);
    const summary = buildSummary(inSlips, partner, paid, extra);
    const sessions = new Set(inSlips.map((s) => s.maLenh ? s.maLenh.replace(/#\d+$/, "") : s.maPhieu)).size;
    const owed = summary.feeAmount + extra;
    if (partnerId !== "" || sessions > 0 || paid > 0 || extra !== 0) {
      rows.push({
        maDoiTac: partner.id, tenDoiTac: partner.name, phienMua: sessions, soMon: summary.purchasedQty, soDon: summary.orderCount,
        tienCong: summary.feeAmount, chiPhiThem: extra, daChuyen: paid, conNo: Math.max(0, owed - paid), traDu: Math.max(0, paid - owed)
      });
    }
    for (const l of inLedger) {
      const out = { ...l, maDoiTac: partner.id, tenDoiTac: partner.name };
      if (l.loai === LEDGER_EXTRA) extras.push(out); else payments.push(out);
    }
  }
  const newest = (a: Record<string, unknown>, b: Record<string, unknown>) => String(b["taoLuc"]).localeCompare(String(a["taoLuc"]));
  return { ok: true, tuNgay, denNgay, doiTac: rows, thanhToan: payments.sort(newest), chiPhi: extras.sort(newest) };
}

/** Correct or void one transfer / extra cost. The partner's page and every sum follow at once. */
async function changeLedger(ctx: Ctx, request: KernelRequest, kind: "sua" | "huy"): Promise<ReplyDraft> {
  const body = asRecord(await request.json());
  const id = text(body["ma"]);
  const repo = repository(ctx);
  const line = id ? await repo.ledgerLine(id) : null;
  if (!line) return reply.json({ ok: false, error: "khong_thay_khoan", message: "Không tìm thấy giao dịch cần sửa." }, 404);
  if (line.huyLuc) return reply.json({ ok: false, error: "da_huy", message: "Giao dịch này đã hoàn tác, không sửa được nữa." }, 409);
  const who = String(request.caller?.name || "quan-tri");
  if (kind === "sua") {
    const amount = Math.round(Number(body["soTien"] ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) return reply.json({ ok: false, error: "so_tien_sai", message: "Số tiền phải lớn hơn 0." }, 400);
    await repo.correctLedger(id, { soTien: amount, ghiChu: String(body["ghiChu"] ?? line.ghiChu), boi: who, at: nowStamp(ctx) });
    ctx.ports.logger.info(`[mua-ho] sua khoan ${id} cua doi tac ${line.maDoiTac}`);
  } else {
    await repo.voidLedger(id, { lyDo: text(body["lyDo"]) || "Hoàn tác", boi: who, at: nowStamp(ctx) });
    ctx.ports.logger.info(`[mua-ho] hoan tac khoan ${id} cua doi tac ${line.maDoiTac}`);
  }
  return { status: 200, headers: NO_STORE, body: { ok: true, ma: id, so: await repo.ledgerFor(line.maDoiTac, 200, { withVoided: true }) } };
}

/**
 * The shop presses "Đối tác xác nhận" / "Báo hết hàng" FOR a partner (Desk `partner-confirmed`,
 * `partner-out-of-stock`): every line of the order still waiting on a partner is bought at the
 * system cost, or reported out of stock — each under the partner the line was given to.
 */
async function actForPartners(ctx: Ctx, orderId: string, job: string, reason: string): Promise<ReplyDraft> {
  if (!orderId) return reply.json({ ok: false, error: "thieu_ma_don", message: "Thiếu mã đơn." }, 400);
  if (job !== "xac-nhan" && job !== "het-hang") return reply.json({ ok: false, error: "viec_sai", message: 'Việc phải là "xac-nhan" hoặc "het-hang".' }, 400);
  const [orders, view] = await Promise.all([recentOrders(ctx), viewFor(ctx, "")]);
  const widened = job === "het-hang" ? { ...view, reportedOut: new Set<string>() } : view;
  const lines = openLines(orders, widened).filter((o) => text(o.order.id) === orderId);
  if (lines.length === 0) {
    return reply.json({ ok: false, error: "khong_co_dong_cho", message: `Đơn ${orderId} không có dòng nào đang chờ đối tác (chưa chọn kho, chưa đẩy mua, hoặc đã mua đủ).` }, 409);
  }
  const repo = repository(ctx);
  const done: Record<string, unknown>[] = [];
  const command = newCommand(ctx, "thay");
  let index = 0;
  for (const open of lines) {
    const partner = await repo.partnerById(text(open.line.partnerId));
    if (!partner) { done.push({ maDong: open.lineId, ok: false, loiNhan: "Không thấy đối tác của dòng này." }); continue; }
    if (job === "xac-nhan") {
      const written = await writeSlip(ctx, partner, {
        lineId: open.lineId, orderId, productCode: text(open.line.productCode), size: text(open.line.size),
        quantity: open.remaining, paidCost: 0, systemCost: unitCostOf(open.line), commandId: `${command}#${index}`,
        note: reason || "Shop bấm thay đối tác: đối tác xác nhận"
      });
      done.push({ maDong: open.lineId, maDoiTac: partner.id, ok: true, maPhieu: written.maPhieu, soLuong: open.remaining });
    } else {
      const out = await reportStockOut(ctx, partner, { maDong: open.lineId, lyDo: reason || "Shop bấm thay đối tác: hết hàng" });
      done.push({ maDong: open.lineId, maDoiTac: partner.id, ok: out.ok });
    }
    index += 1;
  }
  ctx.ports.logger.info(`[mua-ho] shop bam thay doi tac (${job}) cho don ${orderId}: ${done.length} dong`);
  const count = done.filter((d) => d["ok"] === true).length;
  return {
    status: 200, headers: NO_STORE,
    body: { ok: true, maDon: orderId, viec: job, dong: done, message: job === "xac-nhan" ? `Đã ghi đối tác mua ${count} dòng của ${orderId}.` : `Đã báo hết hàng ${count} dòng của ${orderId}.` }
  };
}

/** Orders holding bought goods of the same product + size, that could give them to this line. */
async function reassignSources(ctx: Ctx, orderId: string, lineId: string): Promise<ReplyDraft> {
  const orders = await recentOrders(ctx);
  const target = orders.find((o) => text(o.id) === orderId);
  const index = (target?.items ?? []).findIndex((l, i) => lineIdOf(target!, l, i) === lineId);
  const line = index >= 0 ? target!.items![index]! : null;
  if (!target || !line) return reply.json({ ok: false, error: "khong_thay_dong", message: "Không tìm thấy dòng sản phẩm trên đơn." }, 404);
  const code = lower(line.productCode);
  const size = lower(line.size);
  const slips = (await repository(ctx).recentPurchases("", 1000)).filter((s) => lower(s.maMon) === code && lower(s.size) === size && s.maDon !== orderId);
  const byOrder = new Map<string, { maDon: string; khach: string; soLuong: number; coVanDon: boolean }>();
  for (const slip of slips) {
    const source = orders.find((o) => text(o.id) === slip.maDon) as (OrderForPurchasing & { trackingCode?: string; vanDonKien?: { maVanDon?: string }[] }) | undefined;
    if (!source || source.daXoa || FINAL_ORDER_STATUSES.has(lower(source.status))) continue;
    const entry = byOrder.get(slip.maDon) ?? {
      maDon: slip.maDon, khach: text(source.customerName), soLuong: 0,
      coVanDon: text(source.trackingCode) !== "" || (source.vanDonKien ?? []).some((k) => text(k.maVanDon) !== "")
    };
    entry.soLuong += slip.soLuong;
    byOrder.set(slip.maDon, entry);
  }
  return { status: 200, headers: NO_STORE, body: { ok: true, maDon: orderId, maDong: lineId, maMon: text(line.productCode), size: text(line.size), nguon: [...byOrder.values()] } };
}

/**
 * "Lấy hàng từ đơn khác" (Desk `confirm-reassign-purchase`): bought pairs of the same product + size
 * move from a source order to a line of this order that still misses them. A slip moved whole
 * keeps its id; a slip split leaves the rest on the source and a new slip on the target.
 *
 * A source with a live waybill is REFUSED: Desk cancelled the carrier's waybill first; here the
 * seller does that on the Vận đơn screen, so no parcel leaves with goods that were given away.
 *
 * `{ maPhieu, doiTacMoi }` instead moves one slip to ANOTHER PARTNER (a purchase typed under the
 * wrong partner) — the fee follows the slip.
 */
async function reassignPurchase(ctx: Ctx, body: Record<string, unknown>): Promise<ReplyDraft> {
  const repo = repository(ctx);
  const slipId = text(body["maPhieu"]);
  if (slipId) {
    const newPartner = text(body["doiTacMoi"]);
    const slip = await repo.slipById(slipId);
    if (!slip) return reply.json({ ok: false, error: "khong_thay_phieu", message: "Không tìm thấy phiếu mua." }, 404);
    const partner = newPartner ? await repo.partnerById(newPartner) : null;
    if (!partner) return reply.json({ ok: false, error: "khong_thay_doi_tac", message: "Chọn đối tác nhận phiếu." }, 400);
    if (partner.id === slip.maDoiTac) return reply.json({ ok: false, error: "cung_doi_tac", message: "Phiếu đã thuộc đối tác này." }, 400);
    await repo.moveSlip(slipId, { maDon: slip.maDon, maDong: slip.maDong, maDoiTac: partner.id });
    ctx.ports.logger.info(`[mua-ho] chuyen phieu ${slipId}: ${slip.maDoiTac} -> ${partner.id}`);
    return { status: 200, headers: NO_STORE, body: { ok: true, maPhieu: slipId, maDoiTac: partner.id, message: `Đã chuyển phiếu sang ${partner.name || partner.id}.` } };
  }

  const targetId = text(body["maDonDich"]);
  const targetLine = text(body["maDongDich"]);
  const sourceId = text(body["maDonNguon"]);
  if (!targetId || !targetLine || !sourceId) return reply.json({ ok: false, error: "thieu_thong_tin", message: "Thiếu đơn đích, dòng đích hoặc đơn nguồn." }, 400);
  if (targetId === sourceId) return reply.json({ ok: false, error: "cung_don", message: "Đơn nguồn và đơn đích trùng nhau." }, 400);

  const orders = await recentOrders(ctx);
  type Shipped = OrderForPurchasing & { trackingCode?: string; vanDonKien?: { maVanDon?: string }[] };
  const target = orders.find((o) => text(o.id) === targetId) as Shipped | undefined;
  const source = orders.find((o) => text(o.id) === sourceId) as Shipped | undefined;
  if (!target) return reply.json({ ok: false, error: "khong_thay_don", message: `Không tìm thấy đơn đích ${targetId}.` }, 404);
  if (!source) return reply.json({ ok: false, error: "khong_thay_don", message: `Không tìm thấy đơn nguồn ${sourceId}.` }, 404);
  for (const [label, order] of [["đích", target], ["nguồn", source]] as const) {
    if (order.daXoa || FINAL_ORDER_STATUSES.has(lower(order.status))) {
      return reply.json({ ok: false, error: "don_da_ket_thuc", message: `Đơn ${label} ${text(order.id)} đã giao/kết thúc — không thể chuyển hàng.` }, 409);
    }
  }
  if (text(source.trackingCode) !== "" || (source.vanDonKien ?? []).some((k) => text(k.maVanDon) !== "")) {
    return reply.json({ ok: false, error: "nguon_co_van_don", message: `Đơn ${sourceId} đang có vận đơn. Huỷ vận đơn ở màn Vận đơn trước rồi chuyển hàng.` }, 409);
  }
  const index = (target.items ?? []).findIndex((l, i) => lineIdOf(target, l, i) === targetLine);
  const line = index >= 0 ? target.items![index]! : null;
  if (!line) return reply.json({ ok: false, error: "khong_thay_dong", message: "Không tìm thấy dòng sản phẩm trên đơn đích." }, 404);

  const needed = Math.max(1, Math.trunc(Number(line.qty ?? line.quantity ?? 1)));
  const bought = (await repo.purchasedByLine("")).get(targetLine) ?? 0;
  const missing = Math.max(0, needed - bought);
  if (missing <= 0) return reply.json({ ok: false, error: "dich_da_du", message: `Dòng này đã mua đủ ${needed} sản phẩm.` }, 409);
  let left = Math.min(missing, Math.max(1, Math.trunc(Number(body["soLuong"] ?? missing)) || missing));

  const code = lower(line.productCode);
  const size = lower(line.size);
  const slips = (await repo.slipsOfOrder(sourceId)).filter((s) => lower(s.maMon) === code && lower(s.size) === size && s.soLuong > 0);
  if (slips.length === 0) {
    return reply.json({ ok: false, error: "nguon_khong_giu_hang", message: `Đơn ${sourceId} không còn giữ hàng ${text(line.productCode)} size ${text(line.size)} để chuyển.` }, 409);
  }
  let moved = 0;
  const now = ctx.ports.clock.now();
  for (const slip of slips) {
    if (left <= 0) break;
    const take = Math.min(left, slip.soLuong);
    if (take === slip.soLuong) {
      await repo.moveSlip(slip.maPhieu, { maDon: targetId, maDong: targetLine });
    } else {
      await repo.moveSlip(slip.maPhieu, { maDon: slip.maDon, maDong: slip.maDong, soLuong: slip.soLuong - take });
      await repo.insertPurchase({
        ma_phieu: `mua_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`, ma_doi_tac: slip.maDoiTac,
        ma_don: targetId, ma_dong: targetLine, ma_mon: slip.maMon, size: slip.size, so_luong: take,
        gia_von: slip.giaVon, gia_he_thong: slip.giaHeThong, ma_lenh: newCommand(ctx, "chuyen"),
        ghi_chu: `Lấy từ đơn ${sourceId}`, tao_luc: toMysqlDateTime(now, { ms: true })
      });
    }
    ctx.bus.emit(EVENTS.purchaseReported, { maDon: targetId, maDong: targetLine, maMon: slip.maMon, soLuong: take, boi: slip.maDoiTac });
    moved += take;
    left -= take;
  }
  ctx.ports.logger.info(`[mua-ho] chuyen ${moved} doi ${text(line.productCode)} tu ${sourceId} sang ${targetId}`);
  return {
    status: 200, headers: NO_STORE,
    body: { ok: true, maDonNguon: sourceId, maDonDich: targetId, maDongDich: targetLine, soLuong: moved, message: `Đã chuyển ${moved} sản phẩm từ đơn ${sourceId} sang ${targetId}.` }
  };
}

/** Desk's `partnerPurchaseTelegramText`, in HTML for the shop's bot. */
function handoffText(partnerName: string, order: OrderForPurchasing & { phone?: string; address?: string; note?: string }, lines: PortalOrderLine[]): string {
  const items = lines.map((l, i) => [
    `${i + 1}. ${escapeHtml(l.productName || l.productCode)}`,
    `Mã: ${escapeHtml(l.productCode || "-")}`,
    `Size: ${escapeHtml(l.size || "-")}`,
    `SL: ${Math.max(1, Math.trunc(Number(l.qty ?? l.quantity ?? 1)))}`
  ].join("\n")).join("\n\n");
  return [
    "<b>[Shop] Sản phẩm cần mua</b>",
    `Đối tác: ${escapeHtml(partnerName || "-")}`,
    `Đơn: ${escapeHtml(order.id || "-")}`,
    `Khách: ${escapeHtml(order.customerName || "-")}`,
    order.note ? `Ghi chú đơn: ${escapeHtml(order.note)}` : "",
    "",
    items,
    "",
    "Vui lòng vào trang đối tác riêng để xác nhận số lượng thực tế mua được."
  ].filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== "")).join("\n");
}

/** "Gửi đối tác" (Desk `handoff-order-products`): each partner on the order gets ITS lines on Telegram. */
async function handOff(ctx: Ctx, orderId: string): Promise<ReplyDraft> {
  if (!orderId) return reply.json({ ok: false, error: "thieu_ma_don", message: "Thiếu mã đơn." }, 400);
  const order = (await recentOrders(ctx)).find((o) => text(o.id) === orderId);
  if (!order) return reply.json({ ok: false, error: "khong_thay_don", message: `Không tìm thấy đơn ${orderId}.` }, 404);
  const groups = new Map<string, PortalOrderLine[]>();
  for (const line of order.items ?? []) {
    const partnerId = text(line.partnerId);
    if (!partnerId) continue;
    groups.set(partnerId, [...(groups.get(partnerId) ?? []), line]);
  }
  if (groups.size === 0) {
    return reply.json({ ok: false, error: "chua_chon_doi_tac", message: "Chưa chọn đối tác mua cho sản phẩm trong đơn. Chọn kho/đối tác ở từng dòng rồi gửi lại." }, 409);
  }
  const send = ctx.services["tien-doi-soat"]?.sendTelegram;
  const repo = repository(ctx);
  const results: { maDoiTac: string; tenDoiTac: string; ok: boolean; loiNhan: string; soDong: number }[] = [];
  for (const [partnerId, lines] of groups) {
    const partner = await repo.partnerById(partnerId);
    const name = partner?.name || partnerId;
    if (!partner) { results.push({ maDoiTac: partnerId, tenDoiTac: name, ok: false, loiNhan: "Không thấy đối tác.", soDong: lines.length }); continue; }
    if (!send) { results.push({ maDoiTac: partnerId, tenDoiTac: name, ok: false, loiNhan: "Shop chưa bật mảnh Tiền (bot Telegram).", soDong: lines.length }); continue; }
    const answer = await send({ chatId: partner.telegramChatId, text: handoffText(name, order, lines) });
    results.push({ maDoiTac: partnerId, tenDoiTac: name, ok: answer.ok, loiNhan: answer.loiNhan, soDong: lines.length });
  }
  const sent = results.filter((r) => r.ok).length;
  ctx.ports.logger.info(`[mua-ho] gui doi tac don ${orderId}: ${sent}/${results.length}`);
  return {
    status: 200, headers: NO_STORE,
    body: {
      ok: true, maDon: orderId, daGui: sent, ketQua: results,
      message: sent > 0 ? `Đã gửi Telegram cho ${sent}/${results.length} đối tác.` : `Chưa gửi được Telegram: ${results.map((r) => `${r.tenDoiTac} — ${r.loiNhan}`).join("; ")}`
    }
  };
}

/** One partner policy (Desk `partnerPolicies`): what the bot tells a customer about goods from this partner. */
interface PartnerPolicy { ma: string; ten: string; tenHienThi: string; macDinh: boolean; noiDung: string; ghiChu: string; suaLuc: string }

const DEFAULT_POLICY: PartnerPolicy = {
  ma: "mac-dinh", ten: "mac-dinh", tenHienThi: "Chính sách mặc định của shop", macDinh: true,
  noiDung: "Hàng order qua đối tác: shop xác nhận còn hàng trước khi báo khách, thời gian giao theo từng đối tác.",
  ghiChu: "Dùng chính sách mặc định nếu đối tác không có ghi chú riêng.", suaLuc: ""
};

async function readPolicies(ctx: Ctx): Promise<PartnerPolicy[]> {
  const book = await ctx.ports.store.document<{ chinhSach?: PartnerPolicy[] }>(POLICIES_DOCUMENT).read({ chinhSach: [] });
  const list = Array.isArray(book?.chinhSach) ? book!.chinhSach : [];
  return list.some((p) => p.macDinh) ? list : [DEFAULT_POLICY, ...list];
}

/** Desk `save-partner-policy`: name required, the default keeps its name, no two policies share one. */
async function savePolicy(ctx: Ctx, body: Record<string, unknown>): Promise<ReplyDraft> {
  const editing = text(body["ma"]);
  const name = lower(body["ten"]).replace(/\s+/g, "_").slice(0, 120);
  if (!name) return reply.json({ ok: false, error: "thieu_ten", message: "Cần nhập tên đối tác hoặc tên file." }, 400);
  let refusal: ReplyDraft | null = null;
  let saved: PartnerPolicy | null = null;
  await ctx.ports.store.document<{ chinhSach?: PartnerPolicy[] }>(POLICIES_DOCUMENT).update((current) => {
    // Never read the document again in here: on MySQL its row is locked for this update.
    const stored = Array.isArray(current?.chinhSach) ? [...current!.chinhSach] : [];
    const list = stored.some((p) => p.macDinh) ? stored : [DEFAULT_POLICY, ...stored];
    const old = editing ? list.find((p) => p.ma === editing) : undefined;
    if (editing && !old) { refusal = reply.json({ ok: false, error: "khong_thay", message: "Không tìm thấy chính sách cần sửa." }, 404); return undefined; }
    if (old?.macDinh && name !== old.ten) { refusal = reply.json({ ok: false, error: "doi_ten_mac_dinh", message: "Chính sách mặc định không được đổi tên. Chỉ sửa nội dung và ghi chú." }, 400); return undefined; }
    const clash = list.find((p) => p.ten === name && p.ma !== old?.ma);
    if (clash && old) { refusal = reply.json({ ok: false, error: "trung_ten", message: `Đã có chính sách cho ${name}. Hãy sửa chính sách đó hoặc dùng tên khác.` }, 409); return undefined; }
    const target = old ?? clash;
    const next: PartnerPolicy = {
      ma: target?.ma ?? name, ten: name, tenHienThi: target?.macDinh ? DEFAULT_POLICY.tenHienThi : `Đối tác ${name}`, macDinh: target?.macDinh ?? false,
      noiDung: String(body["noiDung"] ?? "").trim().slice(0, 4000) || DEFAULT_POLICY.noiDung,
      ghiChu: String(body["ghiChu"] ?? "").trim().slice(0, 2000) || DEFAULT_POLICY.ghiChu,
      suaLuc: ctx.ports.clock.now().toISOString()
    };
    saved = next;
    return { chinhSach: target ? list.map((p) => (p.ma === target.ma ? next : p)) : [next, ...list] };
  }, { chinhSach: [] });
  if (refusal) return refusal;
  return { status: 200, headers: NO_STORE, body: { ok: true, chinhSach: await readPolicies(ctx), daLuu: saved } };
}

/** Serves one file of the portal out of this module's own `goc/`. */
async function servePage(ctx: Ctx, path: string): Promise<ReplyDraft> {
  const file = await ctx.ports.staticFiles.open(`${ctx.id}/goc`).read(path);
  if (!file) return reply.json({ ok: false, error: ERROR_CODES.notFound }, 404);
  // The portal is nobody's business but the partner's: never cached by a shared proxy, never indexed.
  return reply.file(file.data, file.type, 200, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" });
}

/** The scripts and stylesheet the two portal pages pull in. */
const PORTAL_ASSETS = ["/partner-login.js", "/partner-portal.js", "/partner-portal.css", "/partner-scan.js"];

export const manifest = defineModule<Config, Services>({
  id: "mua-ho",
  name: "Mua hộ & đặt tự động",
  tier: "van-hanh",
  runsOn: "server-khach",
  feature: "mua-ho",
  version: "0.2.0",
  ports: ["store", "logger", "clock", "bus", "config", "staticFiles", "http"],
  requires: ["don-khach.search"],
  // Asking for a waybill goes through Shipping's service. OPTIONAL: without it the portal still
  // runs and the button simply says the feature is off — it never calls a carrier itself.
  requiresOptional: ["van-chuyen.createFromOrder", "tien-doi-soat.sendTelegram"],
  schema: SCHEMA,

  // `da-mua` thay cho `hang-kho.ve-lai` (16/09/2026): một phiếu mua của đối tác không phải là
  // "hàng về lại kho" — nó là một dòng đơn vừa được mua, và Đơn hàng cần biết để khoá kho dòng đó.
  events: { emits: [EVENTS.partnerStockOut, EVENTS.purchaseReported], listens: {} },

  provides: {
    "mua-ho.needsPurchase": (ctx, partnerId: string) => needsPurchase(ctx, String(partnerId || "")),
    "mua-ho.reportedOutOfStock": (ctx, orderId: string) => repository(ctx).stockOutsForOrder(String(orderId || "")),
    /**
     * How much has been bought, per order line. Orders asks for this to draw its per-line buttons
     * and to refuse a warehouse swap on a line that is already being bought.
     *
     * It reads the slips and nothing else — no order is fetched — so Orders may call it without
     * closing the loop back through `don-khach.search`, which this module uses.
     */
    "mua-ho.purchasedByLine": (ctx, partnerId?: string) => repository(ctx).purchasedByLine(String(partnerId || "")),
    /**
     * Giá vốn thật của từng dòng, bình quân theo số đôi đã mua. Đơn hàng dùng để bù giá vốn cho
     * đơn cũ — nó chỉ đọc bảng phiếu mua, không đọc đơn nào, nên gọi được từ Đơn hàng mà không
     * đóng vòng phụ thuộc.
     */
    "mua-ho.costByLine": (ctx, partnerId?: string) => repository(ctx).costByLine(String(partnerId || "")),
    /** Partner ids and names — the finance screen labels its partner rows with them (Đ4). */
    "mua-ho.partnerNames": async (ctx) => new Map((await repository(ctx).listPartners()).map((r) => [String(r["ma"] ?? ""), String(r["ten"] ?? "")]))
  },

  routes: [
    // ---------------- the portal's own pages ----------------
    {
      method: "GET", path: "/partner-login", access: ACCESS.public,
      whyPublic: "Màn đăng nhập của đối tác. Chỉ trả tệp tĩnh trong goc/ của module, không đọc dữ liệu nào.",
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: (ctx) => servePage(ctx, "/partner-login.html")
    },
    {
      // The address of a partner's page. The token in it is only the ADDRESS: what the server
      // trusts is the session cookie, checked by every `/api/partner-portal/*` door below.
      method: "GET", path: "/partner/:token", access: ACCESS.public,
      whyPublic: "Khung trang cổng đối tác. Chỉ trả HTML tĩnh; mọi dữ liệu phải xin qua /api/partner-portal, nơi kiểm phiên trước khi đọc gì.",
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: (ctx) => servePage(ctx, "/partner-portal.html")
    },
    {
      // The running site's short address for the login screen.
      method: "GET", path: "/partner", access: ACCESS.public,
      whyPublic: "Địa chỉ ngắn của màn đăng nhập đối tác; chỉ chuyển hướng, không đọc gì.",
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: () => reply.redirect("/partner-login")
    },
    {
      method: "GET", path: "/partner-portal.html", access: ACCESS.public,
      whyPublic: "Địa chỉ cũ của trang cổng; chỉ chuyển hướng về màn đăng nhập, không đọc gì.",
      rateLimit: { calls: 300, windowMs: TEN_MINUTES },
      handle: () => reply.redirect("/partner-login")
    },
    ...PORTAL_ASSETS.map((asset) => ({
      method: "GET" as const, path: asset, access: ACCESS.public,
      whyPublic: "Tệp giao diện của cổng đối tác (bản chép nguyên từ web cũ). Cổng tệp tĩnh chỉ trả đuôi đã khai, trong đúng goc/ của module.",
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: (ctx: Ctx) => servePage(ctx, asset)
    })),

    // ---------------- the session ----------------
    {
      // RULE 5: a name and a password. The portal code is still accepted for the shop's own tools
      // and for a partner whose password has not been set yet.
      method: "POST", path: "/api/partner-portal/login", access: ACCESS.public,
      whyPublic: "Đối tác tự đăng nhập, không có mã máy. Tự bảo vệ bằng: mật khẩu PBKDF2, hạn 20 lần/15 phút, và sai thì chỉ trả 'sai tên hoặc mật khẩu' — không nói tên nào có thật.",
      rateLimit: { calls: 20, windowMs: FIFTEEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const repo = repository(ctx);
        const now = ctx.ports.clock.now();

        const login = text(body["login"] || body["username"]).toLowerCase();
        // Trimmed, as the running site did: a phone keyboard adds a space after an autocompleted word.
        const password = String(body["password"] || body["matKhau"] || "").trim();
        if (login && password) {
          const lockKey = `${request.ip}|${login}`;
          const lockout = repo.loginLockout();
          const lockedUntil = await lockout.lockedUntil(lockKey, now);
          if (lockedUntil) {
            const minutes = LoginLockout.minutesLeft(lockedUntil, now);
            return reply.json({ ok: false, error: "tam_khoa", message: `Sai mật khẩu quá nhiều lần. Thử lại sau ${minutes} phút.` }, 429);
          }
          const account = await repo.activePartnerForLogin(login);
          // The SAME refusal whatever went wrong, or partner names could be enumerated.
          if (!account || !account.passwordHash || !(await verifyPassword(password, account.passwordHash))) {
            await lockout.recordFailure(lockKey, now);
            ctx.ports.logger.warn("[mua-ho] dang nhap doi tac that bai");
            return reply.json({ ok: false, error: "dang_nhap_sai", message: "Tên đăng nhập hoặc mật khẩu không đúng." }, 401);
          }
          await lockout.clear(lockKey);
          return {
            status: 200,
            headers: { ...session(ctx).loginHeaders(account.portalCode), ...NO_STORE },
            body: await portalState(ctx, account)
          };
        }

        // RULE 5: the portal code alone opens only a partner who has NO password yet. Once the shop
        // gave them one, a forwarded link must not be a way around it.
        const portalCode = text(body["token"] || body["maCong"]);
        if (!portalCode) return reply.json({ ok: false, error: "thieu_dang_nhap", message: "Nhập tên đăng nhập và mật khẩu." }, 400);
        const partner = await repo.activePartnerByPortalCode(portalCode);
        const record = partner ? await repo.partnerById(partner.id) : null;
        if (!partner || record?.hasPassword) {
          ctx.ports.logger.warn("[mua-ho] dang nhap bang ma cong bi tu choi");
          return reply.json({ ok: false, error: ERROR_CODES.unauthenticated, message: "Vui lòng đăng nhập bằng tên đăng nhập và mật khẩu." }, 401);
        }
        return {
          status: 200,
          headers: { ...session(ctx).loginHeaders(portalCode), ...NO_STORE },
          body: { ok: true, doiTac: { ma: partner.id, ten: partner.name }, token: partner.portalCode }
        };
      }
    },
    {
      method: "POST", path: "/api/partner-portal/logout", access: ACCESS.public,
      whyPublic: "Chỉ xoá cookie phiên của chính người gọi, không đọc gì và không sửa gì.",
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: (ctx) => ({ status: 200, headers: session(ctx).logoutHeaders(), body: { ok: true } })
    },

    // ---------------- what the partner sees and reports ----------------
    {
      // RULE 1: not logged in = NOT one piece of information.
      method: "GET", path: "/api/partner-portal", access: ACCESS.public,
      whyPublic: "Cổng đối tác. Chưa có phiên hợp lệ thì chỉ trả về 'chưa đăng nhập' — không lộ tên, việc cần mua hay giá vốn.",
      rateLimit: { calls: 240, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const partner = await loggedInPartner(ctx, request);
        if (!partner) return NOT_LOGGED_IN;
        return {
          status: 200, headers: NO_STORE,
          body: { ...(await portalState(ctx, partner)), doiTac: { ma: partner.id, ten: partner.name } }
        };
      }
    },
    {
      method: "POST", path: "/api/partner-portal/purchases", access: ACCESS.public,
      whyPublic: "Đối tác báo đã mua. Tự bảo vệ bằng phiên cookie ký HMAC; không có phiên là 401 trước khi đọc bất cứ gì.",
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const partner = await loggedInPartner(ctx, request, body);
        if (!partner) return NOT_LOGGED_IN;
        // The page sends quantity 0 to mean "this shop has none" — that is an out-of-stock report,
        // not a purchase of nothing.
        const quantity = Number(body["soLuong"] ?? body["quantity"] ?? -1);
        if (quantity === 0) {
          const out = await reportStockOut(ctx, partner, body);
          if (!out.ok) return refused(out.viSao);
          return { status: 200, headers: NO_STORE, body: { ...(await portalState(ctx, partner)), maDong: out.maDong, message: "Đã ghi nhận kho này hết hàng. Shop sẽ tìm nguồn khác." } };
        }
        const result = await reportPurchase(ctx, partner, body);
        if (!result.ok) return refused(result.viSao);
        const state = await portalState(ctx, partner);
        const extra = "thua" in result && result.thua ? ` ${result.thua} đôi mua dư không có đơn nào chờ — báo shop để xử lý.` : "";
        return {
          status: 200, headers: NO_STORE,
          body: {
            ...state, ...result,
            // The page's "Đang mua" panel merges this one session instead of reloading everything.
            session: await sessionReply(ctx, partner, result.maLenh),
            message: "trungLenh" in result ? "Lần bấm này đã được ghi nhận trước đó." : `Đã ghi nhận số lượng mua được.${extra}`
          }
        };
      }
    },
    {
      method: "POST", path: "/api/partner-portal/out-of-stock", access: ACCESS.public,
      whyPublic: "Đối tác báo hết hàng. Cùng phiên cookie như đường báo đã mua; khoá theo mã dòng nên báo lại không đụng dòng khác.",
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const partner = await loggedInPartner(ctx, request, body);
        if (!partner) return NOT_LOGGED_IN;
        const result = await reportStockOut(ctx, partner, body);
        return result.ok ? { status: 200, body: result } : refused(result.viSao);
      }
    },
    {
      // UNDO: the partner tapped the wrong row. The slip goes, the line is waiting to be bought
      // again, and the fee is recounted from what is left — which is why no total is ever stored.
      method: "POST", path: "/api/partner-portal/purchases/undo", access: ACCESS.public,
      whyPublic: "Đối tác hoàn tác dòng mua của CHÍNH MÌNH. Phiên cookie như các đường kia; xoá có khoá theo mã đối tác nên không đụng được phiếu của người khác.",
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const partner = await loggedInPartner(ctx, request, body);
        if (!partner) return NOT_LOGGED_IN;
        const sessionId = text(body["sessionId"] || body["maPhieu"]);
        const orderId = text(body["orderId"] || body["maDon"]);
        if (!sessionId) return reply.json({ ok: false, error: "thieu_ma_phieu", message: "Thiếu phiên mua cần hoàn tác." }, 400);

        // A session is one tap, which may have spread over several orders; the row the partner
        // tapped names ONE order, and only that order's slips go.
        const repo = repository(ctx);
        const slips = await repo.sessionSlips(partner.id, sessionId, orderId);
        let removed = 0;
        for (const slip of slips) removed += await repo.deletePurchase(partner.id, slip.maPhieu);
        if (removed === 0) return reply.json({ ok: false, error: "khong_thay_phieu", message: "Dòng mua này đã hoàn tác hoặc không còn tồn tại." }, 400);
        ctx.ports.logger.info(`[mua-ho] ${partner.id} hoan tac ${removed} phieu cua phien ${sessionId}${orderId ? ` (don ${orderId})` : ""}`);

        // What is left of the session, or — when nothing is — the undone rows, so the page redraws them as undone.
        const now = ctx.ports.clock.now().toISOString();
        const left = await sessionReply(ctx, partner, sessionId);
        const undone = left ?? {
          ...buildSessions(slips, partner)[0],
          quantity: 0,
          allocations: slips.map((slip) => ({ orderId: slip.maDon, lineIndex: 0, maDong: slip.maDong, productCode: slip.maMon, size: slip.size, quantity: 0, undoneAt: now, respondedAt: slip.taoLuc }))
        };
        return {
          status: 200, headers: NO_STORE,
          body: { ...(await portalState(ctx, partner)), session: undone, message: "Đã hoàn tác dòng mua. Sản phẩm quay lại trạng thái chưa mua." }
        };
      }
    },
    {
      // PACKED / NOT PACKED, per order per partner. A row each, so two partners on one order never
      // overwrite each other — which is exactly what the old shape did.
      method: "POST", path: "/api/partner-portal/order-packing", access: ACCESS.public,
      whyPublic: "Đối tác đánh dấu đơn đã đóng hàng. Phiên cookie như các đường kia; chỉ ghi trạng thái của chính đối tác đó trên đơn đó.",
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const partner = await loggedInPartner(ctx, request, body);
        if (!partner) return NOT_LOGGED_IN;
        const orderId = text(body["orderId"] || body["maDon"]);
        if (!orderId) return reply.json({ ok: false, error: "thieu_ma_don", message: "Thiếu mã đơn." }, 400);
        const wantPacked = text(body["status"] || body["trangThai"]) === PACKED;

        // Only a parcel on THIS partner's list — an order id typed by hand writes nothing.
        const repo = repository(ctx);
        const [orders, view] = await Promise.all([recentOrders(ctx), viewFor(ctx, partner.id)]);
        const parcel = buildParcels(orders, view).find((p) => p.orderId === orderId);
        if (!parcel) return reply.json({ ok: false, error: "khong_thay_don", message: "Đơn này không nằm trong danh sách đóng hàng của bạn." }, 404);
        // SEVEN STEPS: nothing is sealed before the courier has a label for it.
        if (wantPacked && !parcel.canPack) {
          return reply.json({
            ok: false, error: "cho_van_don",
            message: `Đơn ${orderId} chưa có vận đơn. Tạo vận đơn (hoặc chuyển ship ngoài) rồi mới xác nhận đóng hàng.`
          }, 400);
        }

        await repo.setPacking({
          ma_don: orderId, ma_doi_tac: partner.id,
          trang_thai: wantPacked ? PACKED : "pending",
          boi: partner.name || partner.id,
          sua_luc: toMysqlDateTime(ctx.ports.clock.now(), { ms: true })
        });
        return {
          status: 200, headers: NO_STORE,
          body: { ...(await portalState(ctx, partner)), message: wantPacked ? "Đã cập nhật đơn đã đóng hàng." : "Đã chuyển về chưa đóng hàng." }
        };
      }
    },
    {
      // ASK FOR A WAYBILL. The portal knows nothing about carriers, the warehouse address or COD:
      // it hands the order id to Shipping's service and shows what comes back.
      method: "POST", path: "/api/partner-portal/shipment-request", access: ACCESS.public,
      whyPublic: "Đối tác xin tạo vận đơn cho đơn đã mua đủ. Phiên cookie như các đường kia; chỉ nhận MÃ ĐƠN, mọi thông tin gửi/nhận do máy chủ tự dựng nên không đặt hộ đơn của ai khác được.",
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const partner = await loggedInPartner(ctx, request, body);
        if (!partner) return NOT_LOGGED_IN;
        const orderId = text(body["orderId"] || body["maDon"]);
        if (!orderId) return reply.json({ ok: false, error: "thieu_ma_don", message: "Thiếu mã đơn." }, 400);

        const create = ctx.services["van-chuyen"]?.createFromOrder;
        if (!create) {
          return reply.json({ ok: false, error: "chua_bat_manh_van_chuyen", message: "Shop chưa bật mảnh Vận chuyển nên chưa tạo được vận đơn ở đây." }, 503);
        }

        // Only an order on THIS partner's list, whose lines are all bought, may be sent to a carrier.
        const repo = repository(ctx);
        const [orders, view] = await Promise.all([recentOrders(ctx), viewFor(ctx, partner.id)]);
        const parcel = buildParcels(orders, view).find((p) => p.orderId === orderId);
        if (!parcel) return reply.json({ ok: false, error: "khong_thay_don", message: "Đơn này không nằm trong danh sách vận đơn của bạn (hoặc chưa mua đủ hàng)." }, 404);
        if (parcel.trackingCode) {
          await repo.clearShipmentRequest(orderId);
          return { status: 200, headers: NO_STORE, body: { ok: true, daCo: true, trackingCode: parcel.trackingCode, message: `Đơn ${orderId} đã có mã vận đơn ${parcel.trackingCode}.` } };
        }
        if (parcel.externalShip) {
          return reply.json({ ok: false, error: "ship_ngoai", message: `Đơn ${orderId} đi ship ngoài — không tạo vận đơn ở đây, bấm "Đã đóng hàng" khi xong.` }, 400);
        }
        // A request still creating: a second tap must not ask the carrier for a second waybill.
        if (parcel.requestPending) {
          return reply.json({ ok: false, error: "dang_tao", message: `Đơn ${orderId} đang được tạo vận đơn. Đợi vài phút rồi tải lại.` }, 409);
        }

        const now = ctx.ports.clock.now();
        await repo.setShipmentRequest({ maDon: orderId, maDoiTac: partner.id, dangTao: true, loi: "", at: now });
        const fail = async (status: number, error: string, message: string, extra: Record<string, unknown> = {}): Promise<ReplyDraft> => {
          await repo.setShipmentRequest({ maDon: orderId, maDoiTac: partner.id, dangTao: false, loi: message, at: ctx.ports.clock.now() });
          ctx.ports.logger.warn(`[mua-ho] xin van don ${orderId} that bai: ${error}`);
          return reply.json({ ok: false, error, message, ...extra }, status);
        };

        let result: CreateFromOrderOutcome;
        try {
          result = await create({ maDon: orderId });
        } catch (e) {
          return fail(502, "loi_goi_hang", `Chưa tạo được vận đơn: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (!("daGoi" in result)) {
          const missing = result.viSao === "thieu_thong_tin" ? (result.thieu ?? []) : [];
          return fail(400, result.viSao, result.viSao === "thieu_thong_tin" ? `Chưa tạo được vận đơn: thiếu ${missing.join(", ")}.` : "Chưa tạo được vận đơn cho đơn này.", { thieu: missing });
        }
        if (!result.daGoi) return fail(400, result.viSao, "Chưa tạo được vận đơn.", { thieu: result.thieu ?? [] });
        if (!result.ok) return fail(502, "hang_tu_choi", result.loiNhan || "Hãng vận chuyển từ chối tạo vận đơn.");
        await repo.clearShipmentRequest(orderId);
        return {
          status: 200, headers: NO_STORE,
          body: { ok: true, trackingCode: result.maVanDon, trackingUrl: result.duongTra, message: `Đã tạo vận đơn ${result.maVanDon}.` }
        };
      }
    },
    {
      // READING THE LABEL WITH THE CAMERA. It only ever ANSWERS — a match, a wrong size, or "not on
      // your list". Nothing is bought here; the partner still confirms (Dũng, 02/09/2026).
      method: "POST", path: "/api/partner-portal/scan-label", access: ACCESS.public,
      whyPublic: "Đối tác chụp tem để máy đọc hộ. Phiên cookie như các đường kia; chỉ TRẢ LỜI đọc được gì, không ghi phiếu mua nào.",
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      // A photo of a label, cropped by the page to ~640px: 1.6 MB is the running site's limit.
      bodyLimit: 2 * 1024 * 1024,
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const partner = await loggedInPartner(ctx, request, body);
        if (!partner) return NOT_LOGGED_IN;

        const outcome = await readLabel(ctx.ports.http, ctx.config.scanAi ?? {}, body["image"]);
        if (!outcome.ok) {
          ctx.ports.logger.warn(`[mua-ho] doc tem that bai: ${outcome.viSao}`);
          // NEVER SILENT, but never an alarm either: the partner reads this and types instead.
          return { status: 200, headers: NO_STORE, body: { ok: true, status: "unreadable", error: outcome.viSao, message: outcome.loiNhan } };
        }

        // The SAME rows the "cần mua" tab shows — per product and size, with what is missing on all
        // waiting orders together — so the scan never offers more (or less) than the list does.
        const [orders, view] = await Promise.all([recentOrders(ctx), viewFor(ctx, partner.id)]);
        const needs = buildNeeds(orders, view);
        const candidates: ScanCandidate[] = needs.map((n) => ({ maDong: `${n.productCode}|${n.size}`, maMon: n.productCode, ten: n.productName, size: n.size, soLuong: n.missingQty }));
        const match = matchReading(outcome.reading, candidates);
        ctx.ports.logger.info(`[mua-ho] ${partner.id} quet tem: ${match.trangThai}${"maMon" in match ? ` ${match.maMon}` : ""}`);

        // The wire names are the page's (`partner-scan.js` reads `status`, `need`, `sizesNeeded`).
        if (match.trangThai === "khop") {
          return {
            status: 200, headers: NO_STORE,
            body: {
              ok: true, status: "matched", productCode: match.maMon, size: match.size, readSizes: match.sizeDaDoc,
              need: {
                productCode: match.dong.maMon, productName: match.dong.ten, size: match.dong.size, missingQty: match.dong.soLuong,
                unitCost: needs.find((n) => `${n.productCode}|${n.size}` === match.dong.maDong)?.unitCost ?? 0
              }
            }
          };
        }
        if (match.trangThai === "sai_size") {
          return {
            status: 200, headers: NO_STORE,
            body: { ok: true, status: "wrong_size", productCode: match.maMon, readSizes: match.sizeDaDoc, sizesNeeded: match.sizeCanMua.map((s) => ({ size: s.size, missingQty: s.soLuong })), message: match.loiNhan }
          };
        }
        if (match.trangThai === "khong_trong_danh_sach") {
          return { status: 200, headers: NO_STORE, body: { ok: true, status: "not_in_list", productCode: match.maMon, readSizes: match.sizeDaDoc, message: match.loiNhan } };
        }
        return { status: 200, headers: NO_STORE, body: { ok: true, status: "unreadable", message: match.loiNhan } };
      }
    },

    // ---------------- the shop's own screens (OMI) ----------------
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
          headers: NO_STORE,
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
      // The shop looks at a partner's portal exactly as the partner sees it (running site: admin-preview).
      method: "GET", path: "/api/admin/mua-ho/portal", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const id = text(request.query["doiTac"] || request.query["partnerId"]);
        const partner = id ? await repository(ctx).partnerById(id) : null;
        if (!partner) return reply.json({ ok: false, error: ERROR_CODES.notFound, message: "Không thấy đối tác này." }, 404);
        return { status: 200, headers: NO_STORE, body: await portalState(ctx, partner) };
      }
    },
    {
      // The shop manages its partners.
      method: "GET", path: "/api/admin/partners", access: ACCESS.admin,
      handle: async (ctx) => ({ status: 200, headers: NO_STORE, body: await repository(ctx).listPartners() })
    },
    {
      method: "POST", path: "/api/admin/partners", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const id = text(body["ma"]);
        const portalCode = text(body["maCong"]);
        if (!id || !portalCode) return reply.json({ ok: false, error: "thieu_ma_hoac_ma_cong", message: "Đối tác cần có mã và mã cổng." }, 400);

        const password = String(body["matKhau"] || body["password"] || "");
        if (password !== "" && password.length < 8) {
          return reply.json({ ok: false, error: "mat_khau_ngan", message: "Mật khẩu đối tác phải dài ít nhất 8 ký tự." }, 400);
        }
        const now = ctx.ports.clock.now();
        const repo = repository(ctx);
        // An empty password means "leave it as it is": the upsert only writes the columns it is
        // given, so saving the address never touches the hash (nor logs the partner out).

        await repo.upsertPartner({
          ma: id, ten: String(body["ten"] || id), ma_cong: portalCode,
          trang_thai: String(body["trangThai"] || "active"),
          dien_thoai: String(body["dienThoai"] || ""),
          tinh: String(body["tinh"] || ""), huyen: String(body["huyen"] || ""), xa: String(body["xa"] || ""),
          dia_chi_chi_tiet: String(body["diaChiChiTiet"] || ""),
          // NULL, not "": the column is unique, and MySQL refuses a second empty string. Every
          // partner without an account yet has to fit in this table at the same time.
          dang_nhap: text(body["dangNhap"]).toLowerCase() || null,
          ...(password !== ""
            ? { bam_mat_khau: await hashPassword(password), bam_cap_luc: toMysqlDateTime(now) }
            : {}),
          cong_moi_mon: Math.max(0, Number(body["congMoiMon"] || 0)),
          cong_moi_don: Math.max(0, Number(body["congMoiDon"] || 0)),
          cach_tinh: normaliseFeeMode(body["cachTinh"]),
          // Left out = unchanged: an older screen that does not know these fields must not wipe them.
          ...(body["telegramChatId"] === undefined ? {} : { telegram_chat_id: text(body["telegramChatId"]).slice(0, 64) }),
          ...(body["email"] === undefined ? {} : { email: text(body["email"]).slice(0, 190) }),
          sua_luc: toMysqlDateTime(now, { ms: true })
        });
        if (password !== "") ctx.ports.logger.info(`[mua-ho] dat mat khau moi cho doi tac ${id}`);
        return { status: 200, body: { ok: true, ma: id } };
      }
    },
    {
      // The shop records a transfer to the partner, or an extra cost agreed with them.
      method: "POST", path: "/api/admin/mua-ho/tien", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const partnerId = text(body["doiTac"] || body["maDoiTac"]);
        const amount = Math.max(0, Number(body["soTien"] || 0));
        if (!partnerId || amount <= 0) return reply.json({ ok: false, error: "thieu_doi_tac_hoac_so_tien" }, 400);
        const kind = text(body["loai"]) === LEDGER_EXTRA ? LEDGER_EXTRA : LEDGER_PAID;
        const now = ctx.ports.clock.now();
        await repository(ctx).insertLedger({
          ma: `tien_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
          ma_doi_tac: partnerId, loai: kind, so_tien: amount,
          ghi_chu: String(body["ghiChu"] || ""), boi: "quan-tri", tao_luc: toMysqlDateTime(now, { ms: true })
        });
        ctx.ports.logger.info(`[mua-ho] ghi so tien ${kind} cho doi tac ${partnerId}`);
        return { status: 200, headers: NO_STORE, body: { ok: true, so: await repository(ctx).ledgerFor(partnerId, 50) } };
      }
    },

    // ---------------- Đ4: the shop does partner work ----------------
    {
      method: "GET", path: "/api/admin/mua-ho/so-cong-no", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => ({
        status: 200, headers: NO_STORE,
        body: await ledgerByPeriod(ctx, text(request.query["doiTac"]), text(request.query["tuNgay"]), text(request.query["denNgay"]))
      })
    },
    {
      method: "POST", path: "/api/admin/mua-ho/tien/sua", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: (ctx, request) => changeLedger(ctx, request, "sua")
    },
    {
      method: "POST", path: "/api/admin/mua-ho/tien/huy", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: (ctx, request) => changeLedger(ctx, request, "huy")
    },
    {
      // The shop records a purchase session ON BEHALF of a partner (Desk `confirm-partner-purchase`).
      // The same allocation as the portal: lines that finish an order first, then the oldest.
      method: "POST", path: "/api/admin/mua-ho/mua-thay", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const partner = await repository(ctx).partnerById(text(body["doiTac"]));
        if (!partner) return reply.json({ ok: false, error: "khong_thay_doi_tac", message: "Chọn đối tác xác nhận." }, 400);
        const cost = Number(body["giaVon"] ?? 0);
        if (!(cost > 0)) return reply.json({ ok: false, error: "thieu_gia_von", message: "Cần nhập giá mua thực tế lớn hơn 0." }, 400);
        const result = await reportPurchase(ctx, partner, { ...body, maLenh: text(body["maLenh"]) || newCommand(ctx, "omi"), ghiChu: String(body["ghiChu"] || "Shop ghi thay đối tác") });
        if (!result.ok) return refused(result.viSao);
        return { status: 200, headers: NO_STORE, body: { ...result, message: "thua" in result && result.thua ? `Đã ghi. ${result.thua} sản phẩm dư không có đơn nào chờ.` : "Đã xác nhận phiên mua." } };
      }
    },
    {
      method: "POST", path: "/api/admin/mua-ho/thay-doi-tac", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        return actForPartners(ctx, text(body["maDon"]), text(body["viec"]), String(body["lyDo"] || "").trim());
      }
    },
    {
      method: "GET", path: "/api/admin/mua-ho/nguon-chuyen", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: (ctx, request) => reassignSources(ctx, text(request.query["maDon"]), text(request.query["maDong"]))
    },
    {
      method: "POST", path: "/api/admin/mua-ho/chuyen-phieu", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => reassignPurchase(ctx, asRecord(await request.json()))
    },
    {
      method: "POST", path: "/api/admin/mua-ho/gui-doi-tac", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => handOff(ctx, text(asRecord(await request.json())["maDon"]))
    },
    {
      method: "GET", path: "/api/admin/mua-ho/chinh-sach", access: ACCESS.admin,
      handle: async (ctx) => ({ status: 200, headers: NO_STORE, body: { ok: true, chinhSach: await readPolicies(ctx) } })
    },
    {
      method: "POST", path: "/api/admin/mua-ho/chinh-sach", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => savePolicy(ctx, asRecord(await request.json()))
    }
  ],

  botTools: [
    { ten: "hang_order_bao_lau", moTa: "Hàng này phải order thì bao lâu về", hieuUng: "doc" }
  ]
});

export type { PurchaseSlip };
