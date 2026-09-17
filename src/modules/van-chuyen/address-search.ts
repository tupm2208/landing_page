/**
 * @file TÌM ĐỊA CHỈ TRONG DANH MỤC HÀNH CHÍNH — để người bán gõ vài chữ rồi bấm chọn, thay vì
 * gõ tay cả tên tỉnh.
 *
 * Vì sao đáng làm: hãng vận chuyển **từ chối** đơn có tên tỉnh/xã không khớp danh mục của họ —
 * "Hà nội", "TP Hà Nội", "Hà Nội " là ba chuỗi khác nhau với máy. Mỗi đơn bị từ chối là một lần
 * người bán mở lại đơn, sửa tay, tạo lại vận đơn.
 *
 * Chép luật khớp từ `address-kit.js` của Sales Desk (bản này landing cũng đang có ở
 * `modules/gian-hang/goc/`), giữ nguyên thang điểm và nguyên tắc **"gõ để lọc, bấm để chọn,
 * không nhận chuỗi tự viết"**:
 *
 *   4 điểm — trùng khít     3 — bắt đầu bằng     2 — trùng đầu một từ     1 — chứa
 *
 * HAI HỆ CÙNG TỒN TẠI, và đó là chuyện của năm 2025. Việt Nam bỏ cấp huyện: 63 tỉnh ba cấp thành
 * 34 tỉnh hai cấp. SPX nhận cả hai nhưng phải nói rõ đang dùng hệ nào (`address_version` 0 hoặc
 * 2 — giá trị 1 bị từ chối). Nên người bán CHỌN hệ, hệ thống không đoán: một xã cũ có thể đã tách
 * làm hai xã mới, và đoán sai là gửi hàng tới nhầm nơi.
 */

import twoTier from "./du-lieu/don-vi-hanh-chinh-2-cap.json";
import threeTier from "./du-lieu/don-vi-hanh-chinh-3-cap.json";
import { normaliseText, stripPrefix } from "./address";

/** Hệ hành chính: `ba-cap` là 63 tỉnh cũ (có huyện), `hai-cap` là 34 tỉnh mới (không huyện). */
export type AddressScheme = "ba-cap" | "hai-cap";

/** Một mục trong danh mục: tên người đọc + mã của danh mục. */
export interface AddressUnit {
  ten: string;
  ma: string;
}

interface RawWard { name?: string; code?: string | number }
interface RawDistrict { name?: string; code?: string | number; wards?: RawWard[] }
interface RawProvince { name?: string; code?: string | number; districts?: RawDistrict[]; wards?: RawWard[] }

const unit = (raw: { name?: string; code?: string | number } | undefined): AddressUnit =>
  ({ ten: String(raw?.name ?? "").trim(), ma: String(raw?.code ?? "") });

const provincesOf = (scheme: AddressScheme): RawProvince[] =>
  (scheme === "hai-cap" ? twoTier : threeTier) as RawProvince[];

/** Điểm khớp, chép từ `scoreOption` của `address-kit.js`. 0 = không khớp. */
export function scoreOf(name: string, query: string): number {
  const n = stripPrefix(normaliseText(name));
  const q = stripPrefix(normaliseText(query));
  if (q === "") return 1;               // chưa gõ gì: mọi mục đều hợp lệ, cắt bớt ở tầng trên
  if (n === q) return 4;
  if (n.startsWith(q)) return 3;
  if (n.split(" ").some((word) => word.startsWith(q))) return 2;
  return n.includes(q) ? 1 : 0;
}

function search(names: readonly AddressUnit[], query: string, limit: number): AddressUnit[] {
  return names
    .map((u) => ({ u, diem: scoreOf(u.ten, query) }))
    .filter((x) => x.diem > 0)
    .sort((a, b) => b.diem - a.diem || a.u.ten.localeCompare(b.u.ten, "vi"))
    .slice(0, Math.max(1, limit))
    .map((x) => x.u);
}

export interface AddressQuery {
  scheme: AddressScheme;
  /** Cấp cần tìm. `huyen` không có trong hệ hai cấp. */
  cap: "tinh" | "huyen" | "xa";
  /** Chữ người bán đang gõ. Rỗng = trả về đầu danh sách. */
  q?: string;
  /** Tỉnh đã chọn — bắt buộc khi tìm huyện hoặc xã. */
  tinh?: string;
  /** Huyện đã chọn — bắt buộc khi tìm xã ở hệ ba cấp. */
  huyen?: string;
  limit?: number;
}

/** Tìm đúng tên trong một danh sách (không phải tìm gần đúng). */
function exact(list: readonly RawProvince[] | readonly RawDistrict[], name: string): RawProvince | RawDistrict | undefined {
  const want = stripPrefix(normaliseText(name));
  if (want === "") return undefined;
  return (list as readonly RawProvince[]).find((x) => stripPrefix(normaliseText(String(x.name ?? ""))) === want);
}

/**
 * Các mục hợp với chữ đang gõ. Tìm huyện/xã thì phải nói cấp trên đã chọn gì — không có nó thì
 * trả rỗng, chứ không trả cả 11.000 xã của cả nước.
 */
export function searchAddress(input: AddressQuery): AddressUnit[] {
  const limit = Math.min(Math.max(1, Number(input.limit) || 12), 50);
  const q = String(input.q ?? "");
  const provinces = provincesOf(input.scheme);

  if (input.cap === "tinh") return search(provinces.map(unit), q, limit);

  const province = exact(provinces, String(input.tinh ?? "")) as RawProvince | undefined;
  if (!province) return [];

  if (input.cap === "huyen") {
    // Hệ hai cấp không có huyện — trả rỗng thay vì bịa ra một cấp đã bị bỏ.
    if (input.scheme === "hai-cap") return [];
    return search((province.districts ?? []).map(unit), q, limit);
  }

  if (input.scheme === "hai-cap") return search((province.wards ?? []).map(unit), q, limit);
  const district = exact(province.districts ?? [], String(input.huyen ?? "")) as RawDistrict | undefined;
  if (!district) return [];
  return search((district.wards ?? []).map(unit), q, limit);
}

/** Tên này có trong danh mục không — dùng để báo đỏ ô nhập, như `address-kit.js` làm. */
export function isKnown(input: Omit<AddressQuery, "q" | "limit"> & { ten: string }): boolean {
  const want = stripPrefix(normaliseText(input.ten));
  if (want === "") return true;   // để trống không phải là sai
  return searchAddress({ ...input, q: input.ten, limit: 50 })
    .some((u) => stripPrefix(normaliseText(u.ten)) === want);
}
