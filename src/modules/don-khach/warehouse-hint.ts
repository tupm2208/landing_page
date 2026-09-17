/**
 * @file "GỢI Ý GOM 1 KHO" — huy hiệu dưới danh sách món của một đơn. Chép từ
 * `landingWarehouseSuggestion` của Sales Desk (`app.js:8917-8966`).
 *
 * Câu hỏi nó trả lời: **có kho nào một mình gánh được cả đơn không?** Gom một kho là một kiện, một
 * lần đóng, một phí ship. Tách kho là ngần ấy thứ nhân lên — nên người bán muốn biết ngay trên
 * dòng đơn, trước khi chọn kho cho từng món.
 *
 * Ba câu trả lời, đúng như Desk:
 *   `mot-kho`  — có kho gánh được tất cả, nói tên kho đó (xanh)
 *   `tach-kho` — không kho nào gánh hết, nhưng món nào cũng có chỗ; nói món nào về kho nào (hổ phách)
 *   `thieu`    — có món không kho nào đủ; nói mã món đó (đỏ)
 *
 * MỘT LỖI CỦA DESK KHÔNG CHÉP SANG: một nhánh hiển thị của Desk quên đi qua bảng đổi tên nên hiện
 * mã kho thô (`wh_yen`) trong khi chỗ khác cùng màn hiện "Yến". Ở đây tên kho luôn là tên người
 * đọc được; mã kho đi riêng trong `maKho` cho màn hình dùng.
 *
 * Hàm thuần: tồn kho do người gọi đưa vào (`hang-kho.stock`), file này không đọc CSDL, không gọi ai.
 */

const text = (v: unknown): string => String(v ?? "").trim();

/** Một dòng tồn của một mã hàng, như `hang-kho.stock` trả về. */
export interface StockLine {
  size: string;
  quantity: number;
  warehouseId: string;
  /** Thứ tự ưu tiên kho: nhỏ hơn thì giao trước. */
  rank?: number;
}

/** Một dòng món cần tìm kho. */
export interface WantedLine {
  maDong: string;
  ma: string;
  size: string;
  soLuong: number;
}

export type WarehouseHint =
  | { kieu: "mot-kho"; mau: "green"; nhan: string; maKho: string; tenKho: string }
  | { kieu: "tach-kho"; mau: "amber"; nhan: string; theoMon: { ma: string; size: string; maKho: string; tenKho: string }[] }
  | { kieu: "thieu"; mau: "red"; nhan: string; thieu: { ma: string; size: string }[] }
  | null;

/** Tồn của một kho cho đúng (mã, size). */
function stockAt(lines: readonly StockLine[], size: string, warehouseId: string): number {
  const wanted = text(size).toLowerCase();
  return lines
    .filter((l) => text(l.warehouseId) === warehouseId && (wanted === "" || text(l.size).toLowerCase() === wanted))
    .reduce((sum, l) => sum + Math.max(0, Number(l.quantity) || 0), 0);
}

/**
 * Gợi ý kho cho một đơn.
 *
 * @param lines  các dòng món của đơn
 * @param stock  tồn theo mã hàng: `mã -> các dòng tồn`
 * @param tenKho mã kho -> tên người đọc được
 */
export function suggestWarehouse(
  lines: readonly WantedLine[],
  stock: ReadonlyMap<string, readonly StockLine[]>,
  tenKho: ReadonlyMap<string, string> = new Map()
): WarehouseHint {
  const wanted = lines.filter((l) => text(l.ma) !== "");
  if (wanted.length === 0) return null;

  const name = (id: string) => tenKho.get(id) || id;

  // Ứng viên theo đúng thứ tự ưu tiên kho của danh mục (`rank`), như Desk.
  const ranked = new Map<string, number>();
  for (const line of wanted) {
    for (const s of stock.get(line.ma) ?? []) {
      const id = text(s.warehouseId);
      if (id === "") continue;
      const rank = Number(s.rank ?? Number.MAX_SAFE_INTEGER);
      if (!ranked.has(id) || rank < (ranked.get(id) ?? Number.MAX_SAFE_INTEGER)) ranked.set(id, rank);
    }
  }
  if (ranked.size === 0) return null;   // chưa có dữ liệu tồn thì không đoán bừa
  const candidates = [...ranked.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);

  // 1. Kho nào một mình đủ cho MỌI món?
  for (const id of candidates) {
    const enough = wanted.every((l) => stockAt(stock.get(l.ma) ?? [], l.size, id) >= Math.max(1, l.soLuong));
    if (enough) return { kieu: "mot-kho", mau: "green", maKho: id, tenKho: name(id), nhan: `Gợi ý gom 1 kho: ${name(id)}` };
  }

  // 2. Không thì mỗi món về kho đầu tiên đủ cho nó.
  const theoMon: { ma: string; size: string; maKho: string; tenKho: string }[] = [];
  const thieu: { ma: string; size: string }[] = [];
  for (const line of wanted) {
    const at = candidates.find((id) => stockAt(stock.get(line.ma) ?? [], line.size, id) >= Math.max(1, line.soLuong));
    if (at === undefined) thieu.push({ ma: line.ma, size: line.size });
    else theoMon.push({ ma: line.ma, size: line.size, maKho: at, tenKho: name(at) });
  }

  // 3. Còn món không kho nào đủ — nói ra, vì đó là việc phải xử lý chứ không phải gợi ý.
  if (thieu.length > 0) {
    return {
      kieu: "thieu", mau: "red", thieu,
      nhan: `Chưa đủ tồn theo kho: ${thieu.map((t) => `${t.ma}${t.size ? ` size ${t.size}` : ""}`).join(", ")}`
    };
  }
  return {
    kieu: "tach-kho", mau: "amber", theoMon,
    nhan: `Gợi ý tách kho: ${theoMon.map((t) => `${t.ma} → ${t.tenKho}`).join("; ")}`
  };
}
