/**
 * @file TÁCH KIỆN — một đơn có hàng ở hai kho là hai kiện, hai vận đơn, hai lần thu COD.
 * Chép luật từ `ensureShippingChildOrders` của Sales Desk (`server.js:25578`).
 *
 * KHÔNG CÓ NÚT "TÁCH KIỆN", và đó là điều đúng nhất của thiết kế này. Kiện **dẫn xuất** từ việc
 * mỗi dòng món thuộc kho nào: gom các dòng theo kho, ra mấy nhóm là mấy kiện. Người bán không bao
 * giờ phải nhớ bấm tách — họ chọn kho cho từng dòng (việc họ vẫn làm), và kiện tự đúng theo.
 *
 * Một kiện KHÔNG phải một đơn trong sổ. Nó là mã tham chiếu `<mã đơn>-01`, `-02` để nhập lên hãng
 * vận chuyển và để đối soát khi tiền COD về. Desk cũng vậy: `findOrderInStore` luôn hạ mã con về
 * mã cha trước khi tra.
 *
 * TIỀN CHIA THEO GIÁ TRỊ HÀNG, LÀM TRÒN BỘI 10.000đ. Khách trả trước 500k cho đơn hai kiện thì
 * mỗi kiện gánh một phần, và COD từng kiện là phần còn thiếu của kiện đó. Không chia thì kiện đầu
 * thu đủ tiền cả đơn — khách trả hai lần.
 *
 * Làm tròn bội 10.000: shipper đếm tiền mặt, không có tờ 3.700đ. Desk làm vậy và đây giữ nguyên.
 */

const text = (v: unknown): string => String(v ?? "").trim();

/** Một dòng món, đủ để chia kiện. */
export interface ParcelLine {
  maDong: string;
  productCode: string;
  productName: string;
  size: string;
  qty: number;
  price: number;
  warehouseId: string;
  warehouseName: string;
  partnerId: string;
}

/** Một kiện của một đơn. */
export interface Parcel {
  /** `<mã đơn>-01`. Mã nhập lên hãng vận chuyển, KHÔNG phải một đơn trong sổ. */
  maKien: string;
  maDon: string;
  thuTu: number;
  maKho: string;
  tenKho: string;
  maDoiTac: string;
  mon: ParcelLine[];
  /** Giá trị hàng của riêng kiện này. */
  giaTriHang: number;
  /** Phần tiền khách đã trả được gánh bởi kiện này. */
  daTra: number;
  /** COD của kiện = phần còn thiếu của chính nó. */
  cod: number;
}

/** `<mã đơn>-01` — đúng cách Desk sinh (`shippingSplitOrderId`, server.js:24481). */
export function parcelId(orderId: string, index: number): string {
  return `${text(orderId)}-${String(index + 1).padStart(2, "0")}`;
}

/**
 * Mã đơn cha của một mã kiện. Desk chỉ nhận dạng tiền tố `MAN-`; ở đây nhận mọi mã đơn, vì
 * landing sinh cả `ORD-` lẫn `MAN-` và một mã kiện `ORD-…-01` cũng phải tra về được cha.
 */
export function parentOrderId(maybeParcelId: string): string {
  const s = text(maybeParcelId);
  const m = /^(.+)-(\d{2})$/.exec(s);
  return m ? m[1]! : s;
}

/**
 * Chia một số tiền theo tỉ lệ các phần, làm tròn xuống bội `step`, rồi rải phần dư cho phần nào
 * bị cắt nhiều nhất. Chép `proportionalRoundedAmounts` (server.js:25671).
 *
 * Tổng các phần LUÔN bằng số ban đầu — nếu không, tiền tự sinh ra hoặc tự mất đi giữa hai kiện.
 */
export function splitMoney(total: number, weights: readonly number[], step = 10000): number[] {
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  const whole = Math.max(0, Math.round(total));
  if (sum <= 0 || whole <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (Math.max(0, w) / sum) * whole);
  const parts = exact.map((x) => Math.floor(x / step) * step);
  let left = whole - parts.reduce((s, p) => s + p, 0);

  // Phần dư về tay ai: ai bị cắt nhiều nhất khi làm tròn xuống.
  const order = exact
    .map((x, i) => ({ i, lost: x - parts[i]! }))
    .sort((a, b) => b.lost - a.lost);
  for (const { i } of order) {
    if (left <= 0) break;
    const give = Math.min(step, left, Math.max(0, Math.round(weights[i] ?? 0)) - parts[i]!);
    if (give <= 0) continue;
    parts[i] = parts[i]! + give;
    left -= give;
  }
  // Còn dư sau khi mọi phần đã chạm trần giá trị hàng của nó: dồn cho phần lớn nhất.
  //
  // Ở đây hai luật đánh nhau, và TỔNG ĐÚNG thắng: phần cuối có thể lẻ (3.333đ) thay vì tròn bội
  // 10.000. Làm tròn cho đẹp mà tổng lệch thì tiền tự mất hoặc tự sinh giữa hai kiện — sai sổ.
  // Một số lẻ trên phiếu chỉ là xấu; một đồng chênh là một lần đối soát không khớp.
  if (left > 0) {
    const biggest = weights.reduce((best, w, i) => (w > (weights[best] ?? -1) ? i : best), 0);
    parts[biggest] = parts[biggest]! + left;
  }
  return parts;
}

/** Một đơn, đủ để chia kiện. Hình dạng cấu trúc nên cả `Order` lẫn bản đã gắn số đều hợp. */
export interface ParcelSource {
  id: string;
  paidAmount?: number;
  items: readonly {
    maDong: string; productCode: string; productName: string; size: string;
    qty: number; price: number; warehouseId: string; warehouseName: string; partnerId: string;
  }[];
}

/** Các kiện của một đơn, từ chính đơn đó. Rỗng = đơn đi một kiện như bình thường. */
export function parcelsOf(order: ParcelSource): Parcel[] {
  return splitIntoParcels({
    maDon: order.id,
    daTra: Number(order.paidAmount ?? 0),
    mon: order.items.map((m) => ({
      maDong: m.maDong, productCode: m.productCode, productName: m.productName, size: m.size,
      qty: m.qty, price: m.price, warehouseId: m.warehouseId, warehouseName: m.warehouseName, partnerId: m.partnerId
    }))
  });
}

/** Kho chịu trách nhiệm một dòng. Chưa gán gì thì gom chung vào một nhóm "chưa chọn kho". */
function groupKeyOf(line: ParcelLine): string {
  return text(line.partnerId) || text(line.warehouseId) || "";
}

export interface SplitInput {
  maDon: string;
  mon: readonly ParcelLine[];
  /** Khách đã trả bao nhiêu cho CẢ đơn. */
  daTra: number;
  /** Ép cả đơn về một kho: người bán gom tay khi hai kho ở cạnh nhau. */
  epMotKho?: boolean;
}

/**
 * Các kiện của một đơn. **Một nhóm thì không phải tách** — trả mảng rỗng, và đơn đi một kiện như
 * bình thường (Desk: `if (groups.size <= 1) return []`).
 */
export function splitIntoParcels(input: SplitInput): Parcel[] {
  const lines = input.mon.filter((l) => text(l.productCode) !== "");
  if (lines.length === 0) return [];

  const groups = new Map<string, ParcelLine[]>();
  for (const line of lines) {
    const key = input.epMotKho === true ? "" : groupKeyOf(line);
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }
  if (groups.size <= 1) return [];

  // Thứ tự kiện theo thứ tự dòng đầu tiên của nhóm — để `-01` luôn là kiện của dòng đầu đơn,
  // không nhảy lung tung giữa hai lần đọc.
  const keys = [...groups.keys()];
  const values = keys.map((k) => (groups.get(k) ?? []).reduce((s, l) => s + Math.max(0, l.price) * Math.max(1, l.qty), 0));
  const paidParts = splitMoney(Math.min(Math.max(0, input.daTra), values.reduce((s, v) => s + v, 0)), values);

  return keys.map((key, i) => {
    const mon = groups.get(key) ?? [];
    const first = mon[0]!;
    const giaTriHang = values[i]!;
    const daTra = Math.min(giaTriHang, paidParts[i] ?? 0);
    return {
      maKien: parcelId(input.maDon, i),
      maDon: text(input.maDon),
      thuTu: i + 1,
      maKho: text(first.warehouseId),
      tenKho: text(first.warehouseName),
      maDoiTac: text(first.partnerId),
      mon,
      giaTriHang,
      daTra,
      // COD của kiện là phần CÒN THIẾU của chính nó, không phải tổng đơn.
      cod: Math.max(0, giaTriHang - daTra)
    };
  });
}
