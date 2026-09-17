/**
 * @file ĐỔI MẪU KHI HẾT HÀNG — đối tác báo không mua được, người bán đổi cho khách sang đôi khác.
 *
 * Desk làm việc này bằng **chatbot**: khách tự nhắn "đổi sang mã X size 42", bot đọc hiểu tiếng
 * Việt rồi sửa đơn. Anh Dũng chốt 16/09/2026 làm thành **một nút trên màn đơn**: người bán đang
 * nói chuyện với khách, họ gõ mã vào ô tìm hàng (đã có) và bấm đổi. Bỏ được cả tầng đọc hiểu
 * tiếng Việt — thứ mà ở Desk sinh ra `ambiguousSize`, `pendingSwap` hết hạn sau 24h, và cuối cùng
 * bị tắt bằng cờ môi trường vì lỗi chưa sửa xong.
 *
 * LỖI CỦA DESK ĐƯỢC VÁ Ở ĐÂY. Desk ghi thẳng dòng mới vào đơn nhưng **không đụng giữ chỗ tồn**,
 * và tự ghi trong Telegram nội bộ: *"Giu cho ton (stockReservation) van tro ma cu — nguoi truc
 * soat lai kho."* Nghĩa là đổi mẫu xong, đôi CŨ vẫn bị đơn này giữ (không ai bán được) còn đôi MỚI
 * thì không ai giữ (người khác mua mất). Ở đây tồn đi theo món: trả đôi cũ, lấy đôi mới, trong
 * cùng một lượt.
 *
 * BA LUẬT:
 *
 * 1. DÒNG ĐÃ MUA THÌ KHÔNG ĐỔI. Có phiếu mua nghĩa là đối tác đã trả tiền cho đôi đó — đổi mẫu
 *    lúc này là bỏ rơi một món hàng đã mua thật. Muốn đổi thì hoàn tác phiếu trước.
 * 2. GIÁ LÀ GIÁ MỚI, không giữ giá cũ. Đôi khác là hàng khác; giữ giá cũ là bán lỗ hoặc bán đắt
 *    mà không ai biết vì sao. Chênh lệch được trả về để màn hình nói cho người bán.
 * 3. MÃ DÒNG GIỮ NGUYÊN. Đổi mẫu không phải xoá dòng rồi thêm dòng: mọi thứ khoá theo mã dòng
 *    (phiếu mua, báo hết hàng) phải còn trỏ đúng chỗ.
 */

import type { ReplyDraft } from "../../contract";
import type { OrderContext } from "./context";
import { repositoryOf } from "./context";
import { withPurchaseCounts } from "./line-procurement";
import { readOrder } from "./order-service";

const text = (v: unknown): string => String(v ?? "").trim();
const refuse = (status: number, error: string, message: string): ReplyDraft => ({ status, body: { ok: false, error, message } });
const NO_STORE = { "Cache-Control": "no-store" };

export interface SwapLineInput {
  orderId: string;
  lineId: string;
  /** Đôi mới: mã và size. Giá do KHO quyết, không nhận từ màn hình. */
  ma: string;
  size: string;
  /** Vì sao đổi — đi vào nhật ký đơn. */
  lyDo?: string | undefined;
  /** Số đã mua của dòng này, đếm từ phiếu (luật 1). */
  daMua: number;
  actor: string;
}

/**
 * Đổi một dòng sang mẫu khác. Trả về đơn sau khi đổi, kèm phần tiền chênh để màn hình nói ra.
 */
export async function swapLine(ctx: OrderContext, input: SwapLineInput): Promise<ReplyDraft> {
  const orderId = text(input.orderId);
  const lineId = text(input.lineId);
  const newCode = text(input.ma);
  const newSize = text(input.size);
  if (newCode === "") return refuse(422, "thieu_ma_hang", "Chọn mã hàng mới trước đã.");

  const repository = repositoryOf(ctx);
  const order = await repository.read(orderId);
  if (!order) return refuse(404, "khong_thay", "Không có đơn này.");
  if (order.daXoa) return refuse(409, "don_o_thung_rac", "Đơn này đang ở thùng rác. Khôi phục nó trước đã.");
  if (["cancelled", "returned_to_stock", "completed"].includes(text(order.status).toLowerCase())) {
    return refuse(409, "don_da_ket_thuc", `Đơn đang ở "${order.status}" nên không đổi mẫu được.`);
  }
  if (text(order.trackingCode) !== "") {
    return refuse(409, "don_da_co_van_don", `Đơn đã có vận đơn ${order.trackingCode} — hàng đang trên đường, không đổi mẫu được nữa.`);
  }

  const line = order.items.find((m) => m.maDong === lineId);
  if (!line) return refuse(404, "khong_thay_dong", `Đơn ${orderId} không có dòng "${lineId}".`);

  // LUẬT 1: có phiếu mua rồi thì đối tác đã trả tiền cho đôi đó.
  if (input.daMua > 0) {
    return refuse(409, "dong_da_mua", `Dòng này đã mua ${input.daMua} đôi — hoàn tác phiếu mua trước rồi mới đổi mẫu được.`);
  }
  if (text(line.productCode).toLowerCase() === newCode.toLowerCase() && text(line.size).toLowerCase() === newSize.toLowerCase()) {
    return refuse(422, "khong_doi_gi", "Mẫu mới trùng đúng mẫu đang có.");
  }

  const quantity = Math.max(1, Math.trunc(Number(line.qty) || 1));
  const inventory = ctx.services["hang-kho"];

  // LẤY ĐÔI MỚI TRƯỚC KHI TRẢ ĐÔI CŨ. Ngược lại thì giữa hai bước có một khoảnh khắc cả hai đôi
  // đều rảnh — người khác mua mất đôi mới, và đơn này mất cả hai.
  const held = await inventory.reserve({ code: newCode, size: newSize, quantity, heldBy: "doi-mau" });
  if (!held.ok) {
    return refuse(409, "het_hang_mau_moi", `Mẫu ${newCode}${newSize ? ` size ${newSize}` : ""} cũng không còn đủ ${quantity} đôi.`);
  }

  // Đôi cũ về kho: chỉ những đôi CỦA DÒNG NÀY, không đụng dòng khác của đơn.
  const returned = await repository.releaseLineStock({ id: orderId, variantId: text(line.variantId), quantity });
  if (returned > 0) {
    const back = await inventory.restock({ variantId: text(line.variantId), quantity: returned });
    if (!back.ok) ctx.ports.logger.warn(`[don-khach] doi mau ${orderId}/${lineId}: khong tra lai duoc ton cu (${back.reason})`);
  }

  const committed = await inventory.commit({ ticket: held.ticket });
  const now = ctx.ports.clock.now();
  // LUẬT 2: giá là giá của kho, không phải giá cũ và cũng không nhận từ màn hình.
  const newPrice = Math.max(0, Number(held.price) || 0);
  const oldPrice = Math.max(0, Number(line.price) || 0);
  const chenh = (newPrice - oldPrice) * quantity;

  // TÊN HÀNG phải đi cùng: người bán đọc bảng đơn bằng tên, không bằng mã. Để rỗng thì hai dòng
  // khác nhau trông y hệt nhau trên màn hình, và người đóng gói lấy nhầm đôi.
  const catalogue = await ctx.services["hang-kho"].stock?.({ code: newCode });
  const newName = catalogue?.found === true ? text(catalogue.name) : "";

  await repository.swapLine({
    orderId, lineId,
    line: {
      product_code: newCode,
      variant_id: committed.ok ? committed.variantId : text(held.variantId),
      product_name: newName,
      size: newSize || text(held.size),
      price: newPrice,
      warehouse_id: text(held.warehouseId),
      // Kho ĐỔI THEO món, nên tên kho cũ không còn đúng. Hàng hoá chỉ cấp mã kho (`StockLine`
      // không mang tên), nên để trống và màn hình hiện mã — thà hiện mã còn hơn hiện tên SAI.
      warehouse_name: "",
      // Đổi mẫu là đổi việc: đôi mới chưa ai xác nhận, chưa ai mua.
      procurement_status: "waiting_partner_confirm",
      purchase_authorized: 0,
      cost_price: 0
    },
    at: now
  });
  // Tổng đơn đi theo dòng, nếu không thì COD sai ngay lần giao tới.
  await repository.recountTotal({ id: orderId, at: now });

  const note = `Đổi mẫu dòng ${lineId}: ${text(line.productCode)}${line.size ? ` size ${line.size}` : ""} → ${newCode}${newSize ? ` size ${newSize}` : ""}` +
    `${chenh === 0 ? "" : `, chênh ${chenh > 0 ? "+" : ""}${chenh}đ`}${text(input.lyDo) ? `. Lý do: ${text(input.lyDo)}` : ""}`;
  await repository.updateHead({ id: orderId, patch: {}, actor: input.actor, note, at: now });

  ctx.ports.logger.info(`[don-khach] ${input.actor} doi mau ${orderId}/${lineId}: ${text(line.productCode)} -> ${newCode}`);

  const after = await readOrder(ctx, orderId);
  const bought = (await ctx.services["mua-ho"]?.purchasedByLine()) ?? new Map<string, number>();
  return {
    status: 200, headers: NO_STORE,
    body: {
      ok: true, maDong: lineId,
      cu: { ma: text(line.productCode), size: text(line.size), gia: oldPrice },
      moi: { ma: newCode, size: newSize || text(held.size), gia: newPrice },
      chenh,
      // Câu cho người bán đọc cho khách nghe — họ đang cầm điện thoại.
      loiNhan: chenh === 0
        ? "Giá y như cũ, không phải thu thêm hay trả lại gì."
        : chenh > 0
          ? `Mẫu mới đắt hơn ${chenh}đ — báo khách phần chênh này.`
          : `Mẫu mới rẻ hơn ${-chenh}đ — cần trả lại khách phần chênh.`,
      order: after ? withPurchaseCounts(after, bought) : null
    }
  };
}
