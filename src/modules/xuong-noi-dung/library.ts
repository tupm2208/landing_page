/**
 * @file "KHO CONTENT" and "PHONG CÁCH & PROMPT MẪU" — posts kept for reuse, and the shop's writing
 * styles (Desk `contentLibraryPanel`, `contentPromptStyleTemplate`).
 *
 * Desk kept both in the browser's state and synced them to its store. Here they are landing
 * documents, so a second machine sees the same library, and the CHOSEN style travels with every
 * writing / critique / optimise request to Xeon — the voice is the shop's setting, not Xeon's.
 */

export const LIBRARY_DOCUMENT = "xuong-noi-dung-kho-bai";
export const STYLE_DOCUMENT = "xuong-noi-dung-phong-cach";
const LIBRARY_KEEP = 1000;

export const LIBRARY_CHANNELS = ["facebook", "seo", "review"] as const;
export const LIBRARY_STATUSES = ["draft", "ready", "published"] as const;

export interface LibraryItem {
  id: string;
  tieuDe: string;
  kenh: string;
  trangThai: string;
  dongSanPham: string;
  maSanPham: string[];
  quote: string;
  noiDung: string;
  tag: string[];
  ghiChu: string;
  /** The batch post it came from, if any. */
  nguonBai: string;
  taoLuc: string;
  suaLuc: string;
}

export interface LibraryBook { version: 1; muc: LibraryItem[]; updatedAt: string }

export interface WritingStyle { id: string; ten: string; moTa: string; luatViet: string; cauTruc: string; baiMau: string }
export interface StyleBook { version: 1; chon: string; danhSach: WritingStyle[]; updatedAt: string }

const text = (v: unknown, n = 2000): string => String(v ?? "").trim().slice(0, n);
const list = (v: unknown, n: number): string[] => (Array.isArray(v) ? v.map((x) => text(x, 80)) : String(v ?? "").split(",").map((x) => text(x, 80))).filter(Boolean).slice(0, n);

export const defaultLibraryBook = (): LibraryBook => ({ version: 1, muc: [], updatedAt: "" });

/** Desk's two starting styles, without the shop's name in them. */
export function defaultStyleBook(): StyleBook {
  return {
    version: 1, chon: "viral_review", updatedAt: "",
    danhSach: [
      {
        id: "viral_review", ten: "Viral review có quote", moTa: "Mở bài có insight mạnh, quote rõ, nội dung giống bài review bán hàng nhưng không lố.",
        luatViet: "Viết như một người đã tư vấn rất nhiều khách chọn hàng.\nƯu tiên câu ngắn, có nhịp, có nhận định rõ.\nKhông viết kiểu quảng cáo chung chung. Luôn nói ai nên mua, ai không nên mua.",
        cauTruc: "- Mở bài bằng một insight hoặc câu gây chú ý.\n- Giải thích cảm giác / đối tượng phù hợp.\n- Nêu điểm cần cân nhắc.\n- Kết thúc bằng gợi ý chọn size / inbox.",
        baiMau: ""
      },
      {
        id: "seo_guide", ten: "SEO guide rõ cấu trúc", moTa: "Dùng cho bài website, tập trung ý định tìm kiếm và đoạn đọc nhanh.",
        luatViet: "Viết rõ, có cấu trúc, tránh văn hoa. Ưu tiên giúp khách ra quyết định.",
        cauTruc: "1. Tổng quan nhanh\n2. Ai nên chọn\n3. Ai nên cân nhắc mẫu khác\n4. Fit-size và lưu ý mua",
        baiMau: ""
      }
    ]
  };
}

export function saveLibraryItem(book: Partial<LibraryBook> | null, body: Record<string, unknown>, id: string, at: string): { book: LibraryBook; item: LibraryItem } | { error: string } {
  const title = text(body["tieuDe"], 180);
  const content = text(body["noiDung"], 30000);
  if (title === "" && content === "") return { error: "Cần tiêu đề hoặc nội dung bài." };
  const current = Array.isArray(book?.muc) ? book.muc : [];
  const wanted = text(body["id"], 80);
  const existing = current.find((m) => m.id === wanted);
  const channel = text(body["kenh"]);
  const status = text(body["trangThai"]);
  const item: LibraryItem = {
    id: existing?.id ?? id,
    tieuDe: title || content.split("\n")[0]!.slice(0, 120),
    kenh: (LIBRARY_CHANNELS as readonly string[]).includes(channel) ? channel : "facebook",
    trangThai: (LIBRARY_STATUSES as readonly string[]).includes(status) ? status : "draft",
    dongSanPham: text(body["dongSanPham"], 160), maSanPham: list(body["maSanPham"], 30), quote: text(body["quote"], 400),
    noiDung: content, tag: list(body["tag"], 12), ghiChu: text(body["ghiChu"], 500), nguonBai: text(body["nguonBai"], 120) || existing?.nguonBai || "",
    taoLuc: existing?.taoLuc ?? at, suaLuc: at
  };
  const muc = existing ? current.map((m) => (m.id === item.id ? item : m)) : [item, ...current];
  return { book: { version: 1, muc: muc.slice(0, LIBRARY_KEEP), updatedAt: at }, item };
}

export function filterLibrary(book: Partial<LibraryBook> | null, filter: { q?: string | undefined; kenh?: string | undefined }): LibraryItem[] {
  const q = String(filter.q ?? "").toLowerCase().trim();
  return (Array.isArray(book?.muc) ? book.muc : []).filter((m) =>
    (!filter.kenh || filter.kenh === "all" || m.kenh === filter.kenh)
    && (q === "" || `${m.tieuDe} ${m.quote} ${m.noiDung} ${m.maSanPham.join(" ")} ${m.tag.join(" ")}`.toLowerCase().includes(q)));
}

export function saveStyle(book: Partial<StyleBook> | null, body: Record<string, unknown>, at: string): StyleBook | { error: string } {
  const base = Array.isArray(book?.danhSach) && book.danhSach.length > 0 ? book : defaultStyleBook();
  const id = text(body["id"], 60).replace(/[^a-zA-Z0-9_-]/g, "_");
  if (id === "") return { error: "Cần ID style." };
  const style: WritingStyle = {
    id, ten: text(body["ten"], 120) || id, moTa: text(body["moTa"], 600), luatViet: text(body["luatViet"], 3000), cauTruc: text(body["cauTruc"], 2000), baiMau: text(body["baiMau"], 4000)
  };
  const others = (base.danhSach ?? []).filter((s) => s.id !== id);
  return { version: 1, chon: id, danhSach: [style, ...others].slice(0, 30), updatedAt: at };
}

export function chosenStyle(book: Partial<StyleBook> | null): WritingStyle | null {
  const all = Array.isArray(book?.danhSach) && book.danhSach.length > 0 ? book : defaultStyleBook();
  return (all.danhSach ?? []).find((s) => s.id === all.chon) ?? all.danhSach?.[0] ?? null;
}
