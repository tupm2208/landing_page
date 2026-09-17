/**
 * @file THE TRAINING BOOKS (Đ7) — what the shop teaches the AI, and the queue a person approves.
 *
 * Sales Desk kept all of this in the browser's localStorage (`toprun.qaBank`, `toprun.reviewItems`,
 * `toprun.customerProfiles`, `toprun.productKnowledge`, `toprun.aiStyleExamples`): one machine's
 * training was invisible to the next, and a cleared browser lost it. Here it is the landing's data,
 * shared by every OMI of the shop, and read by the brain through `training.knowledge`.
 *
 * THE ONE RULE: NOTHING IS APPROVED AUTOMATICALLY. Analysis results, operator edits and style
 * corrections all enter the queue as `candidate`; only `approve` (a person's click) changes that,
 * and only approved items ever reach the model.
 *
 * Pure functions over the books; the module calls them inside `document.update()`.
 */

export const QA_DOCUMENT = "tro-ly-ai-hoi-dap";
export const REVIEW_DOCUMENT = "tro-ly-ai-hang-duyet";
export const KNOWLEDGE_DOCUMENT = "tro-ly-ai-kien-thuc";
export const OPS_DOCUMENT = "tro-ly-ai-van-hanh";
export const ANALYSIS_DOCUMENT = "tro-ly-ai-phan-tich";

export const QA_KEEP_MAX = 500;
export const REVIEW_KEEP_MAX = 2000;

/** How an approved item is applied (Desk `trainingApplicationLabel`). Wire values. */
export const APPLICATIONS = ["static_qa", "intent_rule", "dynamic_rule", "clarification_rule", "handoff_rule", "knowledge_rule"] as const;
export type Application = (typeof APPLICATIONS)[number];

export const REVIEW_KINDS = ["ai_analysis", "operator_style_correction", "facebook_ai_operator_edit", "zalo_operator_edit", "manual"] as const;

/** Why a person corrected the AI (Desk `trainingEditReasonLabel`). */
export const EDIT_REASONS = ["correct", "wrong_product", "wrong_context", "wrong_stock", "missing_question", "handoff"] as const;

const text = (v: unknown, n = 2000): string => String(v ?? "").trim().slice(0, n);
const norm = (v: unknown): string => text(v, 4000).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ");

// ------------------------------------------------------------------------ Q&A

export interface QaItem {
  id: string;
  intent: string;
  cauHoi: string;
  traLoi: string;
  trangThai: "approved" | "retired";
  nguon: "manual" | "review_approved";
  soLanDung: number;
  capNhatLuc: string;
}

export interface QaBook { version: 1; muc: QaItem[] }
export const defaultQaBook = (): QaBook => ({ version: 1, muc: [] });

export function addQa(book: QaBook | null, input: Record<string, unknown>, at: Date, source: QaItem["nguon"] = "manual"): { book: QaBook; item: QaItem } {
  const intent = text(input["intent"], 80);
  const cauHoi = text(input["cauHoi"], 1000);
  const traLoi = text(input["traLoi"], 3000);
  if (!intent || !cauHoi || !traLoi) throw new Error("Cần nhập intent, câu hỏi và câu trả lời.");
  const item: QaItem = { id: `qa_${at.getTime()}_${(book?.muc.length ?? 0) + 1}`, intent, cauHoi, traLoi, trangThai: "approved", nguon: source, soLanDung: 0, capNhatLuc: at.toISOString() };
  return { book: { version: 1, muc: [item, ...(book?.muc ?? [])].slice(0, QA_KEEP_MAX) }, item };
}

export function setQaStatus(book: QaBook | null, id: string, status: string, at: Date): { book: QaBook; item: QaItem | null } {
  if (status !== "approved" && status !== "retired") throw new Error('Trạng thái phải là "approved" hoặc "retired".');
  const muc = (book?.muc ?? []).map((q) => (q.id === id ? { ...q, trangThai: status as QaItem["trangThai"], capNhatLuc: at.toISOString() } : q));
  return { book: { version: 1, muc }, item: muc.find((q) => q.id === id) ?? null };
}

// ------------------------------------------------------------------------ the review queue

export interface ContextLine { vai: "khach" | "shop"; chu: string }

export interface ReviewItem {
  id: string;
  loai: (typeof REVIEW_KINDS)[number];
  tieuDe: string;
  intent: string;
  cauKhach: string;
  traLoiDeXuat: string;
  traLoiAiGoc: string;
  lyDoSua: string;
  lyDo: string;
  cachApDung: Application;
  nguCanh: ContextLine[];
  duKienAi: Record<string, string>;
  duKienSua: Record<string, string>;
  nguonHoiThoai: string;
  trangThai: "candidate" | "approved" | "approved_rule" | "approved_knowledge" | "blocked";
  taoLuc: string;
  capNhatLuc: string;
  duyetLuc?: string;
}

export interface ReviewBook { version: 1; muc: ReviewItem[] }
export const defaultReviewBook = (): ReviewBook => ({ version: 1, muc: [] });

/** A price, a stock count or a size in an answer means it must be looked up live, not repeated. */
export function mentionsLiveData(answer: string): boolean {
  return /\d{2,}|giá|gia\b|còn hàng|con hang|hết hàng|het hang|tồn|size/i.test(answer);
}

/** The application an item gets: what the proposer said, but never a fixed answer that repeats live data. */
export function applicationFor(proposed: unknown, answer: string, editReason = ""): Application {
  let kind: Application = (APPLICATIONS as readonly string[]).includes(String(proposed)) ? (proposed as Application) : "static_qa";
  if (editReason === "handoff") kind = "handoff_rule";
  else if (editReason === "missing_question") kind = "clarification_rule";
  else if (editReason === "wrong_product" || editReason === "wrong_context") kind = "intent_rule";
  if (kind === "static_qa" && mentionsLiveData(answer)) kind = "dynamic_rule";
  return kind;
}

/** Dedupe key: intent + question + answer, accents and spacing ignored (Desk `trainingCandidateKey`). */
export function candidateKey(item: { intent: string; cauKhach: string; traLoiDeXuat: string }): string {
  return `${norm(item.intent)}|${norm(item.cauKhach)}|${norm(item.traLoiDeXuat)}`;
}

function contextLines(raw: unknown): ContextLine[] {
  return (Array.isArray(raw) ? raw : []).slice(-12).map((x) => {
    const o = x !== null && typeof x === "object" ? (x as Record<string, unknown>) : {};
    return { vai: o["vai"] === "khach" ? "khach" as const : "shop" as const, chu: text(o["chu"], 500) };
  }).filter((l) => l.chu !== "");
}

function stringMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
    const value = text(v, 200);
    if (value) out[k.slice(0, 40)] = value;
  }
  return out;
}

/** Builds a CANDIDATE from anything that proposes one. Never approved here. */
export function reviewCandidate(input: Record<string, unknown>, at: Date, seq: number): ReviewItem {
  const kind = (REVIEW_KINDS as readonly string[]).includes(String(input["loai"])) ? input["loai"] as ReviewItem["loai"] : "manual";
  const answer = text(input["traLoiDeXuat"], 3000);
  const cauKhach = text(input["cauKhach"], 1000);
  if (!cauKhach || !answer) throw new Error("Đề xuất cần câu khách hỏi và câu trả lời.");
  const reason = (EDIT_REASONS as readonly string[]).includes(String(input["lyDoSua"])) ? String(input["lyDoSua"]) : "";
  return {
    id: `rv_${at.getTime()}_${seq}`,
    loai: kind,
    tieuDe: text(input["tieuDe"], 200) || "Đề xuất huấn luyện",
    intent: text(input["intent"], 80) || "khac",
    cauKhach, traLoiDeXuat: answer,
    traLoiAiGoc: text(input["traLoiAiGoc"], 3000),
    lyDoSua: reason,
    lyDo: text(input["lyDo"], 1000),
    cachApDung: applicationFor(input["cachApDung"], answer, reason),
    nguCanh: contextLines(input["nguCanh"]),
    duKienAi: stringMap(input["duKienAi"]),
    duKienSua: stringMap(input["duKienSua"]),
    nguonHoiThoai: text(input["nguonHoiThoai"], 191),
    trangThai: "candidate",
    taoLuc: at.toISOString(),
    capNhatLuc: at.toISOString()
  };
}

/** Adds candidates, skipping ones already in the queue (any status). Returns how many were new. */
export function enqueueCandidates(book: ReviewBook | null, items: ReviewItem[]): { book: ReviewBook; added: ReviewItem[] } {
  const seen = new Set((book?.muc ?? []).map(candidateKey));
  const added: ReviewItem[] = [];
  for (const item of items) {
    const key = candidateKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(item);
  }
  return { book: { version: 1, muc: [...added, ...(book?.muc ?? [])].slice(0, REVIEW_KEEP_MAX) }, added };
}

/** Replaces one candidate in place (a person re-saving the same style example), or adds it. */
export function upsertCandidate(book: ReviewBook | null, id: string, item: ReviewItem): ReviewBook {
  const list = book?.muc ?? [];
  if (id && list.some((r) => r.id === id)) {
    return { version: 1, muc: list.map((r) => (r.id === id ? { ...item, id, taoLuc: r.taoLuc, trangThai: r.trangThai === "blocked" ? "candidate" : r.trangThai } : r)) };
  }
  return { version: 1, muc: [item, ...list].slice(0, REVIEW_KEEP_MAX) };
}

/**
 * A PERSON approves one candidate. A fixed answer becomes a Q&A the bot may use; anything that
 * depends on live data becomes a rule the model reads (Desk `approve-review`).
 */
export function approveReview(review: ReviewBook | null, qa: QaBook | null, id: string, at: Date): { review: ReviewBook; qa: QaBook; item: ReviewItem } {
  const item = (review?.muc ?? []).find((r) => r.id === id);
  if (!item) throw Object.assign(new Error("Không thấy mục trong hàng đợi."), { status: 404 });
  if (item.trangThai !== "candidate") throw Object.assign(new Error("Mục này đã được xử lý."), { status: 409 });
  let nextQa = qa ?? defaultQaBook();
  const status: ReviewItem["trangThai"] = item.cachApDung === "static_qa" ? "approved" : item.cachApDung === "knowledge_rule" ? "approved_knowledge" : "approved_rule";
  if (status === "approved") nextQa = addQa(nextQa, { intent: item.intent, cauHoi: item.cauKhach, traLoi: item.traLoiDeXuat }, at, "review_approved").book;
  const updated: ReviewItem = { ...item, trangThai: status, capNhatLuc: at.toISOString(), duyetLuc: at.toISOString() };
  return { review: { version: 1, muc: (review?.muc ?? []).map((r) => (r.id === id ? updated : r)) }, qa: nextQa, item: updated };
}

export function blockReview(review: ReviewBook | null, id: string, at: Date): { review: ReviewBook; item: ReviewItem | null } {
  let found: ReviewItem | null = null;
  const muc = (review?.muc ?? []).map((r) => {
    if (r.id !== id) return r;
    found = { ...r, trangThai: "blocked", capNhatLuc: at.toISOString() };
    return found;
  });
  return { review: { version: 1, muc }, item: found };
}

// ------------------------------------------------------------------------ profiles, fit notes, libraries, style

export interface SampleProfile { id: string; ten: string; kenh: string; sizeQuen: string; formChan: string; monChoi: string; brandThich: string[]; daMua: string[]; tomTat: string; taoLuc: string }
export interface FitNote { id: string; maSp: string; tenSp: string; form: string; phuHop: string; tuVanSize: string; luuY: string; bangChung: string; taoLuc: string }
export interface Library { id: string; ten: string; duongDan: string; uuTien: number; dungKhi: string[]; moTa: string; noiDung: string; taoLuc: string; capNhatLuc: string }
export interface StyleExample { id: string; cauKhach: string; traLoiAi: string; traLoiDuyet: string; lyDo: string; tinhHuong: string; nguCanh: ContextLine[]; maDuyet: string; taoLuc: string; capNhatLuc: string }

export interface KnowledgeBook { version: 1; hoSoMau: SampleProfile[]; kienThuc: FitNote[]; thuVien: Library[]; cauMau: StyleExample[] }
export const defaultKnowledgeBook = (): KnowledgeBook => ({ version: 1, hoSoMau: [], kienThuc: [], thuVien: [], cauMau: [] });

const list = (raw: unknown, n: number): string[] =>
  (Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(",")).map((s) => s.trim().slice(0, 80)).filter(Boolean).slice(0, n);

export function addSampleProfile(book: KnowledgeBook | null, input: Record<string, unknown>, at: Date): { book: KnowledgeBook; item: SampleProfile } {
  const ten = text(input["ten"], 120);
  if (!ten) throw new Error("Cần nhập tên khách.");
  const b = { ...defaultKnowledgeBook(), ...(book ?? {}) };
  const item: SampleProfile = {
    id: `hs_${at.getTime()}_${b.hoSoMau.length + 1}`, ten, kenh: text(input["kenh"], 40) || "Manual",
    sizeQuen: text(input["sizeQuen"], 40), formChan: text(input["formChan"], 120), monChoi: text(input["monChoi"], 120),
    brandThich: list(input["brandThich"], 10), daMua: list(input["daMua"], 20), tomTat: text(input["tomTat"], 1000), taoLuc: at.toISOString()
  };
  return { book: { ...b, hoSoMau: [item, ...b.hoSoMau].slice(0, 300) }, item };
}

export function addFitNote(book: KnowledgeBook | null, input: Record<string, unknown>, at: Date): { book: KnowledgeBook; item: FitNote } {
  const maSp = text(input["maSp"], 64);
  const tenSp = text(input["tenSp"], 200);
  if (!maSp || !tenSp) throw new Error("Cần nhập mã và tên sản phẩm.");
  const b = { ...defaultKnowledgeBook(), ...(book ?? {}) };
  const item: FitNote = {
    id: `fit_${at.getTime()}_${b.kienThuc.length + 1}`, maSp, tenSp,
    form: text(input["form"], 200) || "chưa rõ", phuHop: text(input["phuHop"], 200) || "chưa rõ", tuVanSize: text(input["tuVanSize"], 200) || "chưa rõ",
    luuY: text(input["luuY"], 200) || "cần tiếp tục thu thập phản hồi", bangChung: text(input["bangChung"], 2000) || "chưa có feedback", taoLuc: at.toISOString()
  };
  return { book: { ...b, kienThuc: [item, ...b.kienThuc].slice(0, 500) }, item };
}

export function saveLibrary(book: KnowledgeBook | null, input: Record<string, unknown>, at: Date): { book: KnowledgeBook; item: Library } {
  const id = text(input["id"], 80).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  const ten = text(input["ten"], 160);
  const duongDan = text(input["duongDan"], 200);
  const noiDung = text(input["noiDung"], 20000);
  if (!id || !ten || !duongDan || !noiDung) throw new Error("Cần đủ ID, tên, đường dẫn và nội dung knowledge.");
  const b = { ...defaultKnowledgeBook(), ...(book ?? {}) };
  const was = b.thuVien.find((l) => l.id === id);
  const item: Library = {
    id, ten, duongDan, uuTien: Math.min(100, Math.max(1, Math.round(Number(input["uuTien"]) || 80))), dungKhi: list(input["dungKhi"], 12),
    moTa: text(input["moTa"], 1000), noiDung, taoLuc: was?.taoLuc ?? at.toISOString(), capNhatLuc: at.toISOString()
  };
  return { book: { ...b, thuVien: [item, ...b.thuVien.filter((l) => l.id !== id)].slice(0, 200) }, item };
}

/** Desk `buildKnowledgeMarkdown`: a library file skeleton from its description. */
export function knowledgeMarkdown(input: { ten: string; moTa: string; dungKhi: string[] }): string {
  return [
    `# ${input.ten || "Kho kiến thức mới"}`, "",
    "## Mục tiêu", input.moTa || "(mô tả để hệ thống hiểu khi nào đọc kho này)", "",
    "## Dùng khi", ...(input.dungKhi.length ? input.dungKhi.map((w) => `- ${w}`) : ["- (tình huống)"]), "",
    "## Quy tắc tư vấn", "- ", "",
    "## Câu cần hỏi lại khách", "- ", "",
    "## Không làm", "- Không báo giá / tồn kho khi chưa tra dữ liệu hiện tại.", "- Không chẩn đoán bệnh."
  ].join("\n");
}

/** Saves (or updates by id) a style example; returns it. */
export function saveStyleExample(book: KnowledgeBook | null, input: Record<string, unknown>, at: Date): { book: KnowledgeBook; item: StyleExample } {
  const cauKhach = text(input["cauKhach"], 1000);
  const traLoiDuyet = text(input["traLoiDuyet"], 3000);
  if (!cauKhach || !traLoiDuyet) throw new Error("Cần có tin nhắn khách và câu trả lời đã sửa trước khi ghi nhận.");
  const b = { ...defaultKnowledgeBook(), ...(book ?? {}) };
  const id = text(input["ma"], 64);
  const was = id ? b.cauMau.find((s) => s.id === id) : undefined;
  const item: StyleExample = {
    id: was?.id ?? `style_${at.getTime()}`, cauKhach, traLoiAi: text(input["traLoiAi"], 3000), traLoiDuyet, lyDo: text(input["lyDo"], 1000),
    tinhHuong: text(input["tinhHuong"], 500), nguCanh: contextLines(input["nguCanh"]), maDuyet: was?.maDuyet ?? "",
    taoLuc: was?.taoLuc ?? at.toISOString(), capNhatLuc: at.toISOString()
  };
  return { book: { ...b, cauMau: [item, ...b.cauMau.filter((s) => s.id !== item.id)].slice(0, 50) }, item };
}

// ------------------------------------------------------------------------ operations settings

export const REPLY_MODES = ["auto", "suggest", "off"] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];

export interface OpsSettings {
  /** Shop-wide default for conversations without their own setting. */
  cheDoTraLoi: ReplyMode;
  /** "Người trực" — a person is on duty: the AI drafts, never sends. */
  nguoiTruc: boolean;
  /** Draft automatically when a customer message arrives in a suggest-mode conversation. */
  tuPhanTich: boolean;
  nguongTinCay: number;
  /** "Ép takeover toàn bộ ca rủi ro" — nothing is sent by the bot anywhere. */
  epNguoi: boolean;
  /** "Tạm dừng hàng đối tác" — the AI answers from the shop's own stock only. */
  tatHangDoiTac: boolean;
  /** Pages whose bot is switched off (Desk page control). */
  trangTatBot: string[];
  capNhatLuc: string;
}

export function defaultOps(): OpsSettings {
  return { cheDoTraLoi: "auto", nguoiTruc: false, tuPhanTich: true, nguongTinCay: 85, epNguoi: false, tatHangDoiTac: false, trangTatBot: [], capNhatLuc: "" };
}

export function readOps(stored: Partial<OpsSettings> | null): OpsSettings {
  const d = defaultOps();
  const s = stored ?? {};
  return {
    cheDoTraLoi: (REPLY_MODES as readonly string[]).includes(String(s.cheDoTraLoi)) ? s.cheDoTraLoi as ReplyMode : d.cheDoTraLoi,
    nguoiTruc: s.nguoiTruc === true, tuPhanTich: s.tuPhanTich !== false,
    nguongTinCay: Number.isFinite(Number(s.nguongTinCay)) && Number(s.nguongTinCay) > 0 ? Number(s.nguongTinCay) : d.nguongTinCay,
    epNguoi: s.epNguoi === true, tatHangDoiTac: s.tatHangDoiTac === true,
    trangTatBot: Array.isArray(s.trangTatBot) ? s.trangTatBot.map(String) : [], capNhatLuc: String(s.capNhatLuc ?? "")
  };
}

/** Applies a partial change from the screen; throws on a bad value. */
export function patchOps(current: OpsSettings, body: Record<string, unknown>, at: Date): OpsSettings {
  const next = { ...current, trangTatBot: [...current.trangTatBot] };
  if (body["cheDoTraLoi"] !== undefined) {
    if (!(REPLY_MODES as readonly string[]).includes(String(body["cheDoTraLoi"]))) throw new Error('Chế độ trả lời phải là "auto", "suggest" hoặc "off".');
    next.cheDoTraLoi = body["cheDoTraLoi"] as ReplyMode;
  }
  for (const key of ["nguoiTruc", "tuPhanTich", "epNguoi", "tatHangDoiTac"] as const) {
    if (body[key] !== undefined) next[key] = body[key] === true;
  }
  if (body["nguongTinCay"] !== undefined) {
    const n = Number(body["nguongTinCay"]);
    if (!Number.isFinite(n) || n < 50 || n > 100) throw new Error("Ngưỡng tự trả lời phải từ 50 đến 100%.");
    next.nguongTinCay = Math.round(n);
  }
  const page = text(body["trang"], 64);
  if (page && body["trangTatBot"] !== undefined) {
    next.trangTatBot = body["trangTatBot"] === true ? [...new Set([...next.trangTatBot, page])] : next.trangTatBot.filter((p) => p !== page);
  }
  next.capNhatLuc = at.toISOString();
  return next;
}

/**
 * How ONE conversation is answered. Strongest first: internal group / page switched off → off;
 * then the conversation's own setting, else the shop default; a person on duty or "force human"
 * turns any `auto` into `suggest`.
 */
export function effectiveMode(ops: OpsSettings, thread: { bot?: string | undefined; noiBo?: boolean | undefined; trang?: string | undefined } | null, page = ""): ReplyMode {
  if (thread?.noiBo === true) return "off";
  const pageId = String(thread?.trang || page || "");
  if (pageId && ops.trangTatBot.includes(pageId)) return "off";
  const own = (REPLY_MODES as readonly string[]).includes(String(thread?.bot)) ? thread!.bot as ReplyMode : ops.cheDoTraLoi;
  if (own === "auto" && (ops.nguoiTruc || ops.epNguoi)) return "suggest";
  return own;
}

// ------------------------------------------------------------------------ analysis job

export interface AnalysisState {
  version: 1;
  trangThai: "chua-chay" | "dang-chay" | "xong" | "loi";
  sau: string;
  soLo: number;
  soHoiThoai: number;
  trongKhoLucChay: number;
  tomTat: string[];
  nguyenTac: { tieuDe: string; chiTiet: string; loai: string }[];
  cauHoi: { intent: string; cauHoi: string; traLoi: string; loai: string; lyDo: string }[];
  daNhapLuc: string;
  loiCuoi: string;
  batDauLuc: string;
  capNhatLuc: string;
}

export function defaultAnalysis(): AnalysisState {
  return { version: 1, trangThai: "chua-chay", sau: "", soLo: 0, soHoiThoai: 0, trongKhoLucChay: 0, tomTat: [], nguyenTac: [], cauHoi: [], daNhapLuc: "", loiCuoi: "", batDauLuc: "", capNhatLuc: "" };
}

/** Folds one batch result into the job (dedupe questions by text, cap the lists). */
export function foldAnalysis(state: AnalysisState, result: Record<string, unknown>, cursor: string, done: boolean, conversations: number, at: string): AnalysisState {
  const next: AnalysisState = { ...state, nguyenTac: [...state.nguyenTac], cauHoi: [...state.cauHoi], tomTat: [...state.tomTat] };
  const summary = text(result["tomTat"], 1000);
  if (summary) next.tomTat = [...next.tomTat, summary].slice(-20);
  const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x !== null && typeof x === "object") as Record<string, unknown>[] : []);
  const principles = new Set(next.nguyenTac.map((p) => norm(p.tieuDe)));
  for (const p of rows(result["nguyenTac"])) {
    const item = { tieuDe: text(p["tieuDe"], 160), chiTiet: text(p["chiTiet"], 800), loai: text(p["loai"], 40) };
    if (!item.tieuDe || principles.has(norm(item.tieuDe))) continue;
    principles.add(norm(item.tieuDe));
    next.nguyenTac.push(item);
  }
  const questions = new Set(next.cauHoi.map((q) => `${norm(q.intent)}|${norm(q.cauHoi)}`));
  for (const q of rows(result["cauHoi"])) {
    const item = { intent: text(q["intent"], 60), cauHoi: text(q["cauHoi"], 500), traLoi: text(q["traLoi"], 1500), loai: text(q["loai"], 40), lyDo: text(q["lyDo"], 300) };
    const key = `${norm(item.intent)}|${norm(item.cauHoi)}`;
    if (!item.cauHoi || !item.traLoi || questions.has(key)) continue;
    questions.add(key);
    next.cauHoi.push(item);
  }
  next.nguyenTac = next.nguyenTac.slice(0, 60);
  next.cauHoi = next.cauHoi.slice(0, 300);
  next.sau = cursor;
  next.soLo += 1;
  next.soHoiThoai += conversations;
  next.trangThai = done ? "xong" : "dang-chay";
  next.loiCuoi = "";
  next.capNhatLuc = at;
  return next;
}
