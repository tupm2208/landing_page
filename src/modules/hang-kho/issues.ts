/**
 * @file "CẦN XỬ LÝ" — what is wrong in the catalogue and the warehouses, found by rules, never stored
 * (OMI "Hàng hóa & Kho" v1, 18/09/2026; wire in `omi/docs/HOP-DONG-API-HANG-KHO-V1.md` §7).
 *
 * A pure function over rows the module reads: no table of "issues" exists, so an issue fixed on the
 * shelf disappears from the list on the next read — there is nothing to close by hand and nothing to
 * go stale. Each kind has ONE fixed severity (the mockup's), so the list sorts the same for everyone.
 */

/** Issue kinds. VALUES are wire. */
export const ISSUE_KINDS = {
  noImage: "thieu-anh",
  noInformation: "thieu-thong-tin",
  stockMismatch: "lech-ton",
  noPrice: "thieu-gia",
  importErrors: "import-loi",
  noPartner: "chua-co-partner",
  oddPrice: "gia-bat-thuong"
} as const;
export type IssueKind = (typeof ISSUE_KINDS)[keyof typeof ISSUE_KINDS];

/** Severity per kind — fixed, not per row. VALUES are wire. */
export const ISSUE_SEVERITY: Record<IssueKind, "cao" | "trung-binh" | "thap"> = {
  "thieu-anh": "cao",
  "thieu-thong-tin": "trung-binh",
  "lech-ton": "cao",
  "thieu-gia": "trung-binh",
  "import-loi": "trung-binh",
  "chua-co-partner": "trung-binh",
  "gia-bat-thuong": "thap"
};

const SEVERITY_ORDER = { cao: 0, "trung-binh": 1, thap: 2 } as const;
/** The most rows one answer carries; `dem` still counts everything. */
export const ISSUE_CAP = 500;

export interface IssueItem { code: string; name: string; brand: string; category: string; gender: string; description: string; image: string; updatedAt: string; attributes: Record<string, unknown>; webContent: Record<string, unknown> }
export interface IssueVariant { code: string; size: string; warehouseId: string; stock: number; reserved: number; price: number; cost: number; updatedAt: string }
export interface IssueWarehouse { name: string; type: "ready" | "order"; hasDefaultPartner: boolean }
/** The LATEST file import of a warehouse, with how many rows it dropped or could not read. */
export interface IssueImport { warehouseId: string; sessionId: string; at: string; problems: number }

/** One row of the list. Wire names. */
export interface Issue {
  mucDo: "cao" | "trung-binh" | "thap";
  loai: IssueKind;
  maKho: string;
  tenKho: string;
  ma: string;
  ten: string;
  size: string;
  moTa: string;
  tuLuc: string;
}

export interface IssueFilter { kind?: string; warehouseId?: string; severity?: string }

const text = (v: unknown): string => String(v ?? "").trim();

/** Every issue the rules find, then filtered; `dem` counts BEFORE the filter (the screen's tabs). */
export function findIssues(
  input: { items: IssueItem[]; variants: IssueVariant[]; warehouses: ReadonlyMap<string, IssueWarehouse>; imports: IssueImport[] },
  filter: IssueFilter = {}
): { dem: Record<"thieuGia" | "thieuAnh" | "thieuThongTin" | "lechTon" | "importLoi" | "chuaCoPartner" | "giaBatThuong", number>; vanDe: Issue[] } {
  const items = new Map(input.items.map((i) => [i.code, i]));
  const warehouseName = (id: string) => input.warehouses.get(id)?.name || id;
  const all: Issue[] = [];
  const push = (kind: IssueKind, warehouseId: string, code: string, size: string, description: string, since: string) => {
    all.push({ mucDo: ISSUE_SEVERITY[kind], loai: kind, maKho: warehouseId, tenKho: warehouseId ? warehouseName(warehouseId) : "", ma: code, ten: items.get(code)?.name ?? "", size, moTa: description, tuLuc: since });
  };

  const imageSeen = new Set<string>();
  const informationSeen = new Set<string>();
  const partnerSeen = new Set<string>();
  for (const v of input.variants) {
    const item = items.get(v.code);
    const pair = `${v.code}\u0000${v.warehouseId}`;
    // One row per item per warehouse: a shoe with ten sizes in stock is ONE missing photo, not ten.
    if (v.stock > 0 && item && !text(item.image) && !imageSeen.has(pair)) {
      imageSeen.add(pair);
      push(ISSUE_KINDS.noImage, v.warehouseId, v.code, "", "Chưa có ảnh đại diện nhưng đang có tồn", item.updatedAt || v.updatedAt);
    }
    if (v.stock > 0 && item && !informationSeen.has(pair)) {
      const missing = [
        ["thương hiệu", item.brand], ["môn thể thao", item.category], ["giới tính", item.gender],
        ["loại sản phẩm", item.webContent["dongSanPham"]], ["màu sắc", item.attributes["mau"]], ["mô tả", item.description]
      ].filter(([, value]) => !text(value)).map(([label]) => label);
      if (missing.length > 0) {
        informationSeen.add(pair);
        push(ISSUE_KINDS.noInformation, v.warehouseId, v.code, "", `Thiếu thông tin: ${missing.join(", ")}`, item.updatedAt || v.updatedAt);
      }
    }
    if (v.reserved > v.stock || v.stock < 0) {
      push(ISSUE_KINDS.stockMismatch, v.warehouseId, v.code, v.size, "Lệch tồn (thực tế ≠ hệ thống)", v.updatedAt);
    }
    if (v.stock > 0 && v.price <= 0) {
      push(ISSUE_KINDS.noPrice, v.warehouseId, v.code, v.size, "Đang có tồn nhưng chưa có giá bán", v.updatedAt);
    }
    const warehouse = input.warehouses.get(v.warehouseId);
    if (warehouse?.type === "order" && !warehouse.hasDefaultPartner && !text(item?.attributes["doiTacCungCap"]) && !partnerSeen.has(pair)) {
      partnerSeen.add(pair);
      push(ISSUE_KINDS.noPartner, v.warehouseId, v.code, "", "Kho order chưa có partner mặc định và sản phẩm chưa gắn đối tác cung cấp", item?.updatedAt || v.updatedAt);
    }
    if (v.cost > 0 && (v.price < v.cost || v.price > 3 * v.cost)) {
      push(ISSUE_KINDS.oddPrice, v.warehouseId, v.code, v.size, v.price < v.cost ? "Giá bán thấp hơn giá vốn" : "Giá bán cao hơn 3 lần giá vốn", v.updatedAt);
    }
  }
  for (const session of input.imports) {
    if (session.problems > 0) {
      push(ISSUE_KINDS.importErrors, session.warehouseId, "", "", `Phiên nhập file ${session.sessionId} có ${session.problems} dòng lỗi hoặc bị bỏ`, session.at);
    }
  }

  const count = (kind: IssueKind) => all.filter((i) => i.loai === kind).length;
  const dem = {
    thieuGia: count(ISSUE_KINDS.noPrice), thieuAnh: count(ISSUE_KINDS.noImage), thieuThongTin: count(ISSUE_KINDS.noInformation), lechTon: count(ISSUE_KINDS.stockMismatch),
    importLoi: count(ISSUE_KINDS.importErrors), chuaCoPartner: count(ISSUE_KINDS.noPartner), giaBatThuong: count(ISSUE_KINDS.oddPrice)
  };
  const kind = text(filter.kind);
  const warehouseId = text(filter.warehouseId);
  const severity = text(filter.severity);
  const vanDe = all
    .filter((i) => (!kind || i.loai === kind) && (!warehouseId || i.maKho === warehouseId) && (!severity || i.mucDo === severity))
    .sort((a, b) => SEVERITY_ORDER[a.mucDo] - SEVERITY_ORDER[b.mucDo] || b.tuLuc.localeCompare(a.tuLuc) || a.ma.localeCompare(b.ma) || a.size.localeCompare(b.size))
    .slice(0, ISSUE_CAP);
  return { dem, vanDe };
}
