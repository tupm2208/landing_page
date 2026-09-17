/**
 * @file WHAT THE SHOP DECIDES ABOUT ONE LINE — pick a warehouse, push it to the buying list, say
 * what kind of thing it is. Sales Desk's per-line controls inside the order row.
 *
 * Three rules, each one a real incident behind it:
 *
 * 1. A LINE THAT HAS BEEN BOUGHT DOES NOT CHANGE WAREHOUSE. Once a partner has written a purchase
 *    slip against this line they are out buying, or have already paid. Swapping the warehouse then
 *    leaves their slip pointing at an order line that no longer belongs to them, and the money is
 *    owed to nobody. The screen shows this as the picker turning into "Đã mua · khóa kho".
 *
 * 2. THE COST PRICE IS PINNED WHEN THE LINE IS PUSHED, not when it is bought. What the shop
 *    expected to pay is part of the decision to buy; reading it later from the catalogue would
 *    quietly rewrite history every time a supplier changed a price.
 *
 * 3. HOW MUCH WAS BOUGHT IS NEVER STORED HERE. It is counted from the purchase slips, which
 *    Purchasing owns. A copy goes stale the moment a slip is undone — and then the order screen
 *    and the partner's portal disagree about whether the shoes exist.
 *
 * The count therefore arrives as an argument (`purchasedQty`), read at the route from
 * `mua-ho.purchasedByLine`. This file, and `don-khach.search`/`read`, never call Purchasing —
 * Purchasing already calls `don-khach.search`, so asking back would close a loop that the kernel
 * cannot see (services are wired after every module loads) and that only shows up under load.
 */

import type { ReplyDraft, Row } from "../../contract";
import type { OrderContext } from "./context";
import { repositoryOf } from "./context";
import { readOrder } from "./order-service";

const text = (v: unknown): string => String(v ?? "").trim();
const refuse = (status: number, error: string, message: string): ReplyDraft => ({ status, body: { ok: false, error, message } });
const NO_STORE = { "Cache-Control": "no-store" };

/** What a line can be, as the picker offers it. Wire values — Sales Desk's own list. */
export const PRODUCT_KINDS = ["shoe", "apparel", "accessory", "bag", "hat", "sock", "other"] as const;

/**
 * Warehouses that need nobody to buy for them: the shop's own shelf (`wh_toprun*`) and a pair
 * bought outside the system (`wh_external`). A line in one of these is complete the moment it is
 * assigned — there is nothing to wait for.
 */
export function needsNoPurchase(warehouseId: unknown): boolean {
  const key = text(warehouseId).toLowerCase();
  return key === "wh_external" || key.startsWith("wh_toprun");
}

/** A line is bought when its warehouse needs no buying, or the slips cover the quantity ordered. */
export function lineIsComplete(line: { warehouseId?: unknown; quantity?: unknown }, purchasedQty: number): boolean {
  if (needsNoPurchase(line.warehouseId)) return true;
  return purchasedQty >= Math.max(1, Math.trunc(Number(line.quantity ?? 1)));
}

/** A line is locked once real buying has happened against it (rule 1). */
export function lineIsLocked(row: Row, purchasedQty: number): boolean {
  return purchasedQty > 0 || (row["purchase_locked_at"] !== null && row["purchase_locked_at"] !== undefined);
}

/**
 * Adds to every line of an order what only Purchasing knows: how much was bought, whether that
 * finishes the line, and whether the warehouse is now locked.
 *
 * The screen must not work these out for itself — Sales Desk did, in three places, and the three
 * drifted apart. Here the server answers once and every caller draws the same buttons.
 */
export function withPurchaseCounts<T extends { items: OrderLineView[] }>(order: T, bought: ReadonlyMap<string, number>): T {
  return {
    ...order,
    items: order.items.map((line) => {
      const daMua = bought.get(line.maDong) ?? 0;
      return {
        ...line,
        daMua,
        canMua: Math.max(0, Math.max(1, Math.trunc(Number(line.quantity ?? 1))) - daMua),
        daMuaDu: lineIsComplete(line, daMua),
        khoaKho: lineIsLocked({ purchase_locked_at: line.purchaseLockedAt || null }, daMua)
      };
    })
  };
}

/** The slice of an order line this file reads. Kept structural so it fits both the row and the view. */
export interface OrderLineView {
  maDong: string;
  quantity?: unknown;
  warehouseId?: unknown;
  purchaseLockedAt?: string;
  [extra: string]: unknown;
}

export interface WriteLineInput {
  orderId: string;
  lineId: string;
  /** Pick a warehouse/partner. `""` clears it. */
  maDoiTac?: string | undefined;
  maKho?: string | undefined;
  tenKho?: string | undefined;
  /** Push to (or pull from) the buying list. */
  dayMua?: boolean | undefined;
  /** What kind of thing this is. */
  loaiSanPham?: string | undefined;
  /** How many the partners have bought against this line — counted by the caller, never stored. */
  daMua: number;
  actor: string;
}

/**
 * Writes one line's decisions. Returns the whole order, because the screen redraws the row and
 * the shop's next decision depends on what the rest of the order now looks like.
 */
export async function writeLineState(ctx: OrderContext, input: WriteLineInput): Promise<ReplyDraft> {
  const repository = repositoryOf(ctx);
  const orderId = text(input.orderId);
  const lineId = text(input.lineId);
  const row = await repository.readLine(orderId, lineId);
  if (!row) return refuse(404, "khong_thay_dong", `Đơn ${orderId} không có dòng "${lineId}".`);

  const locked = lineIsLocked(row, input.daMua);
  const patch: Row = {};
  const now = ctx.ports.clock.now();

  if (input.loaiSanPham !== undefined) {
    const kind = text(input.loaiSanPham);
    if (kind !== "" && !(PRODUCT_KINDS as readonly string[]).includes(kind)) {
      return refuse(422, "loai_san_pham_la", `Loại "${kind}" không có. Đang mở: ${PRODUCT_KINDS.join(", ")}.`);
    }
    patch["product_kind"] = kind;
  }

  if (input.maDoiTac !== undefined || input.maKho !== undefined) {
    // RULE 1. Refused on the server, not only greyed out on the screen: the screen is one caller.
    if (locked) {
      return refuse(409, "khoa_kho", "Dòng này đã phát sinh mua hàng nên không chọn lại kho được. Muốn đổi thì hoàn tác phiếu mua trước.");
    }
    patch["partner_id"] = text(input.maDoiTac);
    patch["warehouse_id"] = text(input.maKho);
    patch["warehouse_name"] = text(input.tenKho);
    // Assigning a warehouse is the shop saying "this pair comes from here" — the line is waiting
    // on that partner from now on. A house or external warehouse waits on nobody.
    patch["procurement_status"] = text(input.maDoiTac) === "" && text(input.maKho) === ""
      ? ""
      : needsNoPurchase(input.maKho) ? "purchase_complete" : "waiting_partner_confirm";
  }

  if (input.dayMua !== undefined) {
    if (locked) {
      return refuse(409, "khoa_kho", "Dòng này đã mua rồi — không đẩy mua lại được.");
    }
    const warehouse = patch["warehouse_id"] ?? row["warehouse_id"];
    const partner = patch["partner_id"] ?? row["partner_id"];
    // Desk's rule, kept: pushing needs A PARTNER, not merely a warehouse. A line may already carry
    // the warehouse it was reserved from without anyone having been asked to go and buy it —
    // pushing that to the buying list would put work on a list nobody reads.
    if (input.dayMua && text(partner) === "" && !needsNoPurchase(warehouse)) {
      return refuse(409, "chua_chon_kho", "Chọn đối tác mua cho dòng này trước khi đẩy mua.");
    }
    patch["purchase_authorized"] = input.dayMua ? 1 : 0;
    patch["procurement_status"] = input.dayMua ? "purchase_ready" : "stock_confirmed";
    // RULE 2: pin what the shop expects to pay, once, at the moment of the decision.
    if (input.dayMua && !(Number(row["cost_price"] || 0) > 0)) {
      patch["cost_price"] = Number(row["sale_file_price"] || 0);
    }
  }

  const changed = await repository.updateLine({ orderId, lineId, patch, at: now });
  if (changed === 0) return refuse(422, "khong_co_gi_de_sua", "Không có gì để sửa trên dòng này.");

  // The order as a whole follows its lines: every line assigned means the order is waiting on
  // partners. Nothing here ever marks an order ready to ship — that is a person's decision.
  if (patch["partner_id"] !== undefined || patch["procurement_status"] !== undefined) {
    const after = await repository.read(orderId);
    const lines = after?.items ?? [];
    const allAssigned = lines.length > 0 && lines.every((l) => l.partnerId !== "" || l.warehouseId !== "");
    if (allAssigned && ["pending", "confirmed", "confirmed_by_customer", ""].includes(text(after?.status).toLowerCase())) {
      await repository.updateHead({
        id: orderId, patch: { status: "waiting_partner_confirm" }, actor: input.actor,
        note: "Mọi dòng đã chọn kho — chờ đối tác xác nhận", at: now
      });
    }
  }

  ctx.ports.logger.info(`[don-khach] ${input.actor} sửa dòng ${lineId}: ${Object.keys(patch).join(", ")}`);
  return { status: 200, headers: NO_STORE, body: { ok: true, maDong: lineId, order: await readOrder(ctx, orderId) } };
}
