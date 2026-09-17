/**
 * @file BÙ GIÁ VỐN CHO ĐƠN CŨ — những dòng đơn không ai ghi giá mua vào.
 *
 * Vấn đề: báo cáo tài chính và công nợ đối tác đọc giá vốn từng dòng. Dòng nào trống thì cả hai
 * ra số sai — và sai theo hướng nguy hiểm nhất: **lãi trông có vẻ cao hơn thật**.
 *
 * Ba nguồn giá vốn, theo đúng thứ tự tin cậy (chép từ Desk):
 *
 *   1. PHIẾU MUA CỦA ĐỐI TÁC — họ mua thật, họ trả tiền thật. Đây là số duy nhất không phải ước.
 *   2. NGƯỜI LÀM SỔ GÕ TAY — khi không có phiếu (hàng nhà, hàng mua ngoài hệ thống).
 *   3. GIÁ NHẬP TRONG DANH MỤC (`sale_file_price`) — chỉ là ước lượng, và chỉ dùng khi hai cái
 *      trên đều không có.
 *
 * MỘT LUẬT KHÔNG ĐƯỢC PHÁ: **bù tự động không bao giờ đè lên số đã có.** Người làm sổ gõ một con
 * số nghĩa là họ biết gì đó mà máy không biết — một lần chạy lại vòng đồng bộ mà xoá nó đi là mất
 * thông tin không lấy lại được. Chỉ chính người đó gõ đè mới được đè.
 */

import type { ReplyDraft, Row } from "../../contract";
import type { OrderContext } from "./context";
import { repositoryOf } from "./context";

const text = (v: unknown): string => String(v ?? "").trim();
const refuse = (status: number, error: string, message: string): ReplyDraft => ({ status, body: { ok: false, error, message } });
const NO_STORE = { "Cache-Control": "no-store" };

/** Giá vốn đến từ đâu — để sau này nhìn một con số là biết tin nó đến mức nào. */
export const COST_SOURCE = {
  partner: "phieu-mua",
  manual: "nguoi-lam-so",
  catalog: "danh-muc"
} as const;

export interface CostFix {
  maDon: string;
  maDong: string;
  /** Giá vốn một đôi. 0 = xoá số đã gõ, để nó quay về trống. */
  giaVon: number;
}

/**
 * Người làm sổ gõ giá vốn cho một hoặc nhiều dòng.
 *
 * Đây là cửa DUY NHẤT được đè lên số đã có — và đè có chủ đích, vì người gõ biết gì đó máy không
 * biết. Mọi đường tự động khác đều chỉ điền vào chỗ trống.
 */
export async function writeCostPrices(ctx: OrderContext, fixes: readonly CostFix[], actor: string): Promise<ReplyDraft> {
  if (fixes.length === 0) return refuse(422, "khong_co_gi_de_ghi", "Chưa nhập giá vốn cho dòng nào.");
  if (fixes.length > 200) return refuse(413, "qua_nhieu_dong", `Một lần lưu tối đa 200 dòng (đang gửi ${fixes.length}).`);

  const repository = repositoryOf(ctx);
  const now = ctx.ports.clock.now();
  const done: string[] = [];
  const missing: string[] = [];

  for (const fix of fixes) {
    const maDon = text(fix.maDon);
    const maDong = text(fix.maDong);
    const gia = Math.max(0, Math.round(Number(fix.giaVon) || 0));
    const changed = await repository.updateLine({
      orderId: maDon, lineId: maDong,
      patch: { cost_price: gia, cost_source: gia > 0 ? COST_SOURCE.manual : "" },
      at: now
    });
    if (changed > 0) done.push(maDong); else missing.push(maDong);
  }

  ctx.ports.logger.info(`[don-khach] ${actor} ghi giá vốn ${done.length} dòng${missing.length ? `, ${missing.length} dòng không thấy` : ""}`);
  return { status: 200, headers: NO_STORE, body: { ok: true, daGhi: done, khongThay: missing } };
}

/**
 * Bù giá vốn cho những dòng CÒN TRỐNG, từ phiếu mua của đối tác.
 *
 * Chạy lại được bao nhiêu lần cũng được: dòng đã có giá thì bỏ qua, nên không có lần chạy nào
 * xoá mất việc người khác đã làm.
 */
export async function backfillCostPrices(ctx: OrderContext, input: { maDon?: string; actor: string }): Promise<ReplyDraft> {
  const repository = repositoryOf(ctx);
  // Giá vốn thật, theo từng dòng, do Purchasing giữ. Không có mảnh mua hộ thì không có gì để bù.
  const paid = await ctx.services["mua-ho"]?.costByLine?.();
  if (!paid || paid.size === 0) {
    return { status: 200, headers: NO_STORE, body: { ok: true, daBu: [], viSao: "Chưa có phiếu mua nào để lấy giá vốn." } };
  }

  const orders = text(input.maDon) !== ""
    ? [await repository.read(text(input.maDon))].filter((o): o is NonNullable<typeof o> => o !== null)
    : await repository.search({ limit: 500 });

  const now = ctx.ports.clock.now();
  const filled: { maDon: string; maDong: string; giaVon: number }[] = [];
  for (const order of orders) {
    for (const line of order.items) {
      // LUẬT: chỉ điền vào chỗ trống.
      if (Number(line.costPrice) > 0) continue;
      const gia = paid.get(line.maDong);
      if (!gia || gia <= 0) continue;
      await repository.updateLine({
        orderId: order.id, lineId: line.maDong,
        patch: { cost_price: Math.round(gia), cost_source: COST_SOURCE.partner },
        at: now
      });
      filled.push({ maDon: order.id, maDong: line.maDong, giaVon: Math.round(gia) });
    }
  }

  if (filled.length > 0) ctx.ports.logger.info(`[don-khach] bù giá vốn từ phiếu mua cho ${filled.length} dòng (${input.actor})`);
  return { status: 200, headers: NO_STORE, body: { ok: true, daBu: filled } };
}

/** Những dòng chưa có giá vốn — việc còn phải làm của người làm sổ. */
export async function linesMissingCost(ctx: OrderContext, limit: number): Promise<ReplyDraft> {
  const orders = await repositoryOf(ctx).search({ limit: Math.min(Math.max(1, limit), 500) });
  const rows: Row[] = [];
  for (const order of orders) {
    for (const line of order.items) {
      if (Number(line.costPrice) > 0) continue;
      rows.push({
        maDon: order.id, maDong: line.maDong, khach: order.customerName, taoLuc: order.createdAt,
        ma: line.productCode, ten: line.productName, size: line.size, soLuong: line.qty,
        giaBan: line.price,
        // Gợi ý sẵn giá nhập trong danh mục để người làm sổ không phải tra tay — nhưng nó CHỈ là
        // gợi ý, chưa được ghi vào đâu cả.
        goiY: Number(line.saleFilePrice) || 0
      });
    }
  }
  return { status: 200, headers: NO_STORE, body: { ok: true, dong: rows } };
}
