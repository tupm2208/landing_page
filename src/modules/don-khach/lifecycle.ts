/**
 * @file HAI ĐƯỜNG KẾT THÚC MỘT ĐƠN — "Hủy" và "Hàng hoàn". Chép luật từ Sales Desk
 * (`applyOrderLifecycleCancel`, `server.js:4928`), giữ nguyên chỗ hai đường khác nhau.
 *
 * Chúng trông giống nhau trên màn hình và KHÔNG giống nhau trong sổ sách:
 *
 *   HỦY (`cancel_all`) — lượt bán chưa từng xảy ra. Đảo lại: hàng về kho đúng như lúc chưa bán.
 *   HÀNG HOÀN (`return_to_stock`) — lượt bán ĐÃ xảy ra, khách trả hàng về. Hàng về là một lượt
 *   NHẬP MỚI. Không đảo bút toán bán, vì nó có thật; tiền vốn đã chi có thật.
 *
 * Desk nhập kho theo giá vốn thật. Landing chưa có sổ kho ghi giá vốn, nên bước này trả tồn qua
 * `hang-kho.restock` và GHI RÕ vào nhật ký đơn rằng đây là hàng hoàn kèm giá vốn — khi có module
 * sổ kho thì đổi sang bút toán nhập thật. Đây là chỗ làm ít hơn Desk **có chủ ý**, không phải sót.
 *
 * BA CHỖ KHÁC LÀM ÍT HƠN DESK, cùng lý do "nói ra còn hơn giả vờ đã làm":
 *
 *   1. KHÔNG HUỶ VẬN ĐƠN Ở HÃNG. `van-chuyen` mới khai đường `cancel_order` của SPX chứ chưa có
 *      hàm dùng. Đơn đang có mã vận đơn thì trả về `cangoihang` để màn hình nói rõ: phải gọi hãng
 *      bằng tay. Giả vờ đã huỷ là để một kiện hàng thật đi giao cho một đơn đã chết.
 *   2. KHÔNG GHI SỔ TIỀN. Landing chưa có `financeEntries`. Giữ cọc thì chỉ ghi nhật ký; hoàn tiền
 *      đi qua `POST /api/tien/hoan` (đã có, bắt buộc lý do, đã chặn hoàn quá số đã trả).
 *   3. KHÔNG VOID HOA HỒNG CTV. Đơn chưa mang mã giới thiệu.
 *
 * Cả hai đường đều xoá `status_before_quick_update`: đơn đã kết thúc thì không "hoàn tác" được nữa
 * bằng một nút — muốn mở lại là một quyết định khác, có người chịu trách nhiệm.
 */

import type { ReplyDraft } from "../../contract";
import { EVENTS } from "../../contract";
import type { OrderContext } from "./context";
import { repositoryOf } from "./context";
import { readOrder, returnStock } from "./order-service";

const text = (v: unknown): string => String(v ?? "").trim();
const refuse = (status: number, error: string, message: string): ReplyDraft => ({ status, body: { ok: false, error, message } });
const NO_STORE = { "Cache-Control": "no-store" };

/** Hai cách kết thúc. Giá trị là giao thức với màn hình. */
export const END_MODES = ["huy", "hang-hoan"] as const;
export type EndMode = (typeof END_MODES)[number];

/** Đơn đã kết thúc rồi thì không kết thúc lần nữa. */
const ENDED = ["cancelled", "canceled", "returned_to_stock"];

export interface EndOrderInput {
  id: string;
  mode: string;
  /** Lý do — bắt buộc với hàng hoàn: ba tháng sau không ai nhớ vì sao khách trả hàng. */
  lyDo?: string | undefined;
  /**
   * Tiền khách đã trả, người bán quyết ngay lúc huỷ (Desk `runOrderLifecycleCancel`, Đ2):
   * `giu` = giữ cọc (ghi vào nhật ký, không còn việc gì phải làm), `hoan` = sẽ hoàn (OMI gọi tiếp
   * `POST /api/tien/hoan` — module Tiền giữ sổ hoàn, đơn không tự chạm vào tiền), rỗng = chưa quyết.
   */
  giuCoc?: string | undefined;
  actor: string;
}

/**
 * Kết thúc một đơn. Trả về đơn sau khi kết thúc, kèm những việc NGƯỜI phải tự làm tiếp
 * (`canNguoiLam`) — thay vì im lặng bỏ qua chúng.
 */
export async function endOrder(ctx: OrderContext, input: EndOrderInput): Promise<ReplyDraft> {
  const id = text(input.id);
  const mode = text(input.mode) as EndMode;
  if (!(END_MODES as readonly string[]).includes(mode)) {
    return refuse(422, "cach_ket_thuc_la", `Cách "${mode}" không có. Đang mở: ${END_MODES.join(", ")}.`);
  }

  const repository = repositoryOf(ctx);
  const order = await repository.read(id);
  if (!order) return refuse(404, "khong_thay", "Không có đơn này.");
  if (order.daXoa) return refuse(409, "don_o_thung_rac", "Đơn này đang ở thùng rác, không kết thúc được. Khôi phục nó trước đã.");
  if (ENDED.includes(text(order.status).toLowerCase())) {
    return refuse(409, "don_da_ket_thuc", `Đơn này đã ở trạng thái "${order.status}".`);
  }
  // Hàng hoàn mà không nói vì sao thì ba tháng sau không phân biệt được với một cú bấm nhầm.
  if (mode === "hang-hoan" && text(input.lyDo) === "") {
    return refuse(422, "thieu_ly_do", "Hàng hoàn phải ghi lý do — khách trả vì sao.");
  }

  const now = ctx.ports.clock.now();
  const status = mode === "huy" ? "cancelled" : "returned_to_stock";
  const canNguoiLam: string[] = [];

  // CHỖ KHÁC NHAU DUY NHẤT VỀ TỒN: cả hai đều trả hàng về kho, nhưng vì hai lý do khác nhau, nên
  // nhật ký phải nói rõ lý do nào — người đọc sổ sáu tháng sau chỉ còn dòng nhật ký này.
  const takenBack = await returnStock(ctx, id);
  const deposit = order.paidAmount > 0 ? text(input.giuCoc) : "";
  const depositNote = deposit === "giu" ? `. Giữ cọc ${order.paidAmount}đ` : deposit === "hoan" ? `. Hoàn ${order.paidAmount}đ cho khách` : "";
  const note = mode === "huy"
    ? `Huỷ đơn — trả lại ${takenBack} dòng vào kho${text(input.lyDo) ? `. Lý do: ${text(input.lyDo)}` : ""}${depositNote}`
    : `Hàng hoàn — nhập lại ${takenBack} dòng vào kho. Lý do: ${text(input.lyDo)}${depositNote}`;

  await repository.updateHead({ id, patch: { status }, actor: input.actor, note, at: now });
  // Đơn đã kết thúc: không còn chỗ để "hoàn tác một bước".
  await repository.updateQuickFields({ id, patch: { status_before_quick_update: "" } });

  // Việc của NGƯỜI, nói ra chứ không giả vờ đã làm hộ.
  if (text(order.trackingCode) !== "") {
    canNguoiLam.push(`Đơn đang có vận đơn ${order.trackingCode}${order.shippingProvider ? ` (${order.shippingProvider})` : ""} — phải gọi hãng huỷ bằng tay, OMI chưa huỷ hộ được.`);
  }
  if (order.paidAmount > 0 && deposit === "") {
    canNguoiLam.push(`Khách đã trả ${order.paidAmount}đ — quyết định giữ hay hoàn ở màn Tài chính (Hoàn tiền).`);
  }

  ctx.bus.emit(EVENTS.orderCancelled, { maDon: id, boi: input.actor, cach: mode });
  ctx.ports.logger.info(`[don-khach] ${input.actor} ${mode === "huy" ? "huỷ" : "nhận hàng hoàn"} đơn ${id}`);

  return {
    status: 200, headers: NO_STORE,
    body: { ok: true, cach: mode, trangThai: status, daTraTon: takenBack, canNguoiLam, order: await readOrder(ctx, id) }
  };
}

