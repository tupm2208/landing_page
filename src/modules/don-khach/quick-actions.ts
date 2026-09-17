/**
 * @file THE BUTTONS IN THE STATUS CELL — Xác nhận, Sẵn sàng giao, Chờ ship bắt buộc, Hoàn tất,
 * Hoàn tác trạng thái. Copied from Sales Desk (`app.js:8826-8867` for which button shows when,
 * `app.js:26859-26933` for what each one does).
 *
 * WHY THE SERVER DECIDES WHICH BUTTONS SHOW. Desk worked it out in the browser, so the rule lived
 * next to the drawing code and drifted. Here `availableActions()` answers it once; the screen draws
 * what it is told, and the same answer guards the write — a button hidden on the screen is still
 * refused if someone calls the door directly.
 *
 * THREE RULES:
 *
 * 1. SẴN SÀNG GIAO NEEDS EVERY LINE BOUGHT. That is the gate: a parcel cannot be promised for
 *    shoes nobody has. The way past it is the next rule, taken deliberately.
 *
 * 2. CHỜ SHIP BẮT BUỘC IS THE WAY OUT, and it says so. The shoes are on the desk but the
 *    bookkeeping disagrees; the shop ships anyway. It clears the shipping fields so the order
 *    re-enters the shipping flow from the start, and remembers it was forced.
 *
 * 3. UNDO IS EXACTLY ONE STEP. Every quick change writes where it came from; undoing restores
 *    that and clears the slot. No stack — the button is for the click just made by mistake.
 *
 * `cancelled` and `returned_to_stock` are NOT here: ending an order touches stock, money and the
 * carrier, so it lives in its own file with its own confirmations.
 */

import type { ReplyDraft, Row } from "../../contract";
import { toMysqlDateTime } from "../../shared/mysql-time";
import type { OrderContext } from "./context";
import { repositoryOf } from "./context";
import { withPurchaseCounts } from "./line-procurement";
import type { Order } from "./order-repository";
import { readOrder } from "./order-service";
import { linesNotReady, type WorkflowOrder } from "./workflow";

const text = (v: unknown): string => String(v ?? "").trim();
const lower = (v: unknown): string => text(v).toLowerCase();
const refuse = (status: number, error: string, message: string): ReplyDraft => ({ status, body: { ok: false, error, message } });
const NO_STORE = { "Cache-Control": "no-store" };

/** The quick actions, by wire name. */
export const QUICK_ACTIONS = ["xac-nhan", "san-sang-giao", "cho-ship-bat-buoc", "hoan-tat", "hoan-tac"] as const;
export type QuickAction = (typeof QUICK_ACTIONS)[number];

/** Statuses that hide "Xác nhận" — the order is already past it (Desk, `app.js:8836`). */
const PAST_CONFIRM = [
  "confirmed_by_customer", "waiting_partner_confirm", "partner_assigned", "purchase_partial",
  "purchase_complete", "partner_confirmed", "ready_to_ship", "sent_to_sapo", "completed",
  "cancelled", "returned_to_stock"
];

/** An order that has ENDED takes no quick action at all. */
const ENDED = ["completed", "cancelled", "returned_to_stock"];

/**
 * Which buttons this order shows, in Desk's order. The screen draws exactly this list; the write
 * door checks against it too, so hiding a button and refusing the call cannot disagree.
 */
export function availableActions(order: WorkflowOrder & { statusTruocDoiNhanh?: string }): QuickAction[] {
  const status = lower(order.status);
  const out: QuickAction[] = [];

  // Shown only when there is something to undo. Desk: `app.js:8833`.
  if (text(order.statusTruocDoiNhanh) !== "") out.push("hoan-tac");
  if (!PAST_CONFIRM.includes(status)) out.push("xac-nhan");
  // RULE 1: the gate. Everything bought, and not already past shipping.
  if (linesNotReady(order).length === 0 && !["ready_to_ship", "sent_to_sapo", ...ENDED].includes(status)) out.push("san-sang-giao");
  // RULE 2: the way out. Shown even when the gate is shut — that is its whole purpose.
  if (!["sent_to_sapo", ...ENDED].includes(status)) out.push("cho-ship-bat-buoc");
  if (!ENDED.includes(status)) out.push("hoan-tat");
  return out;
}

export interface QuickActionInput {
  id: string;
  viec: string;
  ghiChu?: string | undefined;
  actor: string;
}

/** Runs one quick action. Returns the order as it now stands, so the screen redraws from truth. */
export async function runQuickAction(ctx: OrderContext, input: QuickActionInput): Promise<ReplyDraft> {
  const id = text(input.id);
  const viec = text(input.viec) as QuickAction;
  if (!(QUICK_ACTIONS as readonly string[]).includes(viec)) {
    return refuse(422, "viec_la", `Việc "${viec}" không có. Đang mở: ${QUICK_ACTIONS.join(", ")}.`);
  }

  const repository = repositoryOf(ctx);
  const raw = await repository.read(id);
  if (!raw) return refuse(404, "khong_thay", "Không có đơn này.");
  if (raw.daXoa) return refuse(409, "don_o_thung_rac", "Đơn này đang ở thùng rác. Khôi phục nó trước đã.");

  // The gate reads how much was BOUGHT, which only Purchasing knows. Reading the raw order here
  // would judge every line unbought and shut the gate on orders that are ready to go.
  const bought = (await ctx.services["mua-ho"]?.purchasedByLine()) ?? new Map<string, number>();
  const order = withPurchaseCounts(raw, bought);
  const before = text(raw.statusTruocDoiNhanh);
  const allowed = availableActions({ ...order, statusTruocDoiNhanh: before });
  if (!allowed.includes(viec)) {
    // The same rule that hid the button on the screen. Says WHY, not just "no".
    if (viec === "san-sang-giao") {
      const missing = linesNotReady(order).map((l) => text((l as Row)["productCode"]) || "?").join(", ");
      return refuse(409, "chua_mua_du", `Còn dòng chưa mua đủ: ${missing}. Muốn giao ngay thì dùng "Chờ ship bắt buộc".`);
    }
    return refuse(409, "viec_khong_hop_trang_thai", `Đơn đang ở "${order.status}" nên không làm được việc này.`);
  }

  const now = ctx.ports.clock.now();
  const at = toMysqlDateTime(now);

  if (viec === "hoan-tac") {
    // RULE 3: one step back, then the slot is empty again.
    await repository.updateHead({
      id, patch: { status: before || "confirmed_by_customer" }, actor: input.actor,
      note: `Hoàn tác về "${before}"`, at: now
    });
    await repository.updateQuickFields({ id, patch: { status_before_quick_update: "", force_ready_to_ship: 0, force_ready_to_ship_at: null } });
    return { status: 200, headers: NO_STORE, body: { ok: true, viec, trangThai: before, order: await readOrder(ctx, id) } };
  }

  // Everything else remembers where it came from, so `hoan-tac` has somewhere to go.
  const quick: Row = { status_before_quick_update: order.status };
  const patch: Record<string, unknown> = {};
  let note = "";

  if (viec === "xac-nhan") {
    patch["status"] = "confirmed_by_customer";
    note = "Xác nhận đơn";
  } else if (viec === "san-sang-giao") {
    patch["status"] = "ready_to_ship";
    patch["fulfillmentStatus"] = "ready_to_ship";
    note = "Sẵn sàng giao";
  } else if (viec === "cho-ship-bat-buoc") {
    patch["status"] = "ready_to_ship";
    patch["fulfillmentStatus"] = "ready_to_ship";
    // RULE 2: back to the start of the shipping flow, and remembered as forced.
    patch["trackingCode"] = "";
    quick["force_ready_to_ship"] = 1;
    quick["force_ready_to_ship_at"] = at;
    const missing = linesNotReady(order).length;
    note = missing > 0 ? `Chờ ship bắt buộc (${missing} dòng chưa mua đủ)` : "Chờ ship bắt buộc";
  } else {
    patch["status"] = "completed";
    patch["fulfillmentStatus"] = "completed";
    note = order.remainingAmount > 0 ? `Hoàn tất — CÒN THIẾU ${order.remainingAmount}đ, cần soát tiền` : "Hoàn tất";
  }

  await repository.updateHead({ id, patch, actor: input.actor, note: text(input.ghiChu) || note, at: now });
  await repository.updateQuickFields({ id, patch: quick });

  // Completing an order closes its lines too (Desk's cascade, `app.js:13732`): nobody is still
  // expected to buy anything for an order that is done.
  if (viec === "hoan-tat") {
    await repository.completeLines({ id, at: now });
    if (order.remainingAmount > 0) {
      ctx.ports.logger.warn(`[don-khach] don ${id} hoan tat nhung con thieu ${order.remainingAmount}d — can soat tien`);
    }
  }

  ctx.ports.logger.info(`[don-khach] ${input.actor} ${viec} don ${id}`);
  const after = await readOrder(ctx, id) as Order;
  return { status: 200, headers: NO_STORE, body: { ok: true, viec, trangThai: after.status, order: after } };
}
