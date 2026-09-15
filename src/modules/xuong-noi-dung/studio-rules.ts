/**
 * @file THE RULES OF A POST — what makes a Facebook post publishable, as pure functions.
 *
 * Ported from Sales Desk's `content_studio_kit.js`, which is the most incident-scarred file in
 * that project: almost every rule below exists because a real post went out wrong, or because a
 * rule that looked obvious blocked a perfectly good post. The comments say which, because that is
 * the only way the next person knows not to "simplify" one back into a bug.
 *
 * NOTHING HERE READS A FILE, OPENS A SOCKET OR TOUCHES A CLOCK. Everything is data in, verdict
 * out, so the rules can be tested by themselves and a screen can run the same check as the server.
 *
 * WHAT IS DELIBERATELY NOT HARD-CODED, unlike in Desk: the shop's own site. Desk was one shop, so
 * `toprun.site` sat in a regex. OMI serves many, so the link check takes the shop's origin.
 */

/** A verdict line. `id` is for code to branch on, `message` is for the person to read. */
export interface RuleNote {
  id: string;
  message: string;
}

export interface RuleResult {
  errors: RuleNote[];
  warnings: RuleNote[];
}

/** One shape of post. `minCodes`/`maxCodes` follow the album limit: 1 cover + 5 cards. */
export interface PostFormat {
  label: string;
  minCodes: number;
  maxCodes: number;
  requiresGallery?: boolean;
  guide: string;
}

/** Five posts a day per page, at least two hours apart — decided 06/09/2026 on the running shop. */
export const DEFAULT_SLOTS: readonly string[] = ["06:30", "10:00", "12:00", "17:00", "20:30"];
export const MIN_GAP_MINUTES = 120;
/** An album is 6 images: one cover plus five cards. Everything about code counts follows from this. */
export const ALBUM_MAX_CODES = 6;
export const HOOK_CAPS_MIN = 4;
export const HOOK_CAPS_MAX = 10;
export const CAPTION_MIN_LENGTH = 900;
export const CAPTION_MAX_LENGTH = 2200;
/** Meta refuses a schedule under 12 minutes out; building the images needs a few more. */
export const SCHEDULE_LEAD_MINUTES = 20;

export const POST_FORMATS: Readonly<Record<string, PostFormat>> = {
  gom_nhu_cau: { label: "Gom nhiều mã theo một nhu cầu", minCodes: 5, maxCodes: 6, guide: "Nêu nhu cầu và tiêu chí, mỗi mã một dòng nhận xét hợp với ai, chốt hai nhánh chọn." },
  so_sanh: { label: "So sánh các dòng cùng hãng", minCodes: 4, maxCodes: 6, guide: "Điểm chung, khác nhau từng chỗ, ai nên chọn dòng nào." },
  so_sanh_hang: { label: "So sánh giữa các hãng", minCodes: 4, maxCodes: 6, guide: "Tiêu chí so, từng hãng mạnh yếu ở đâu, ai hợp đôi nào. Công bằng, không dìm hãng khác." },
  gioi_thieu_hang: { label: "Giới thiệu một hãng", minCodes: 4, maxCodes: 6, guide: "Hãng ở đâu, nổi tiếng vì gì, công nghệ đặc trưng, giá nằm ở đâu, ai nên thử." },
  kien_thuc: { label: "Kiến thức một chủ đề", minCodes: 4, maxCodes: 6, guide: "Giải thích cơ chế bằng lời thường ngày, ví dụ bằng chính các mã trong bài." },
  hoi_dap: { label: "Hỏi đáp một câu khách hay hỏi", minCodes: 4, maxCodes: 6, guide: "Hook là câu hỏi, trả lời thẳng ở đoạn hai, rồi dẫn sang các mã." },
  mot_dong: { label: "Một dòng sản phẩm nhiều màu", minCodes: 4, maxCodes: 6, guide: "Ai hợp ai không, khác nhau giữa các bản, size." },
  mot_san_pham: { label: "Một sản phẩm, album nhiều góc chụp", minCodes: 1, maxCodes: 2, requiresGallery: true, guide: "Nói kỹ một món: dáng, chất liệu, đế, cảm giác đi, hợp ai, KHÔNG hợp ai, size." },
  su_kien: { label: "Theo sự kiện hoặc mùa", minCodes: 4, maxCodes: 6, guide: "Bối cảnh thật, việc cần chuẩn bị, mã theo từng việc." }
};

/** Phrases the shop decided never to publish. Each one was written by a bot and had to be deleted. */
const BANNED_RULES: readonly { id: string; label: string; pattern: RegExp }[] = [
  { id: "ben_em", label: 'cụm "bên em" kiểu rao', pattern: /(ở )?bên em/i },
  { id: "noi_that", label: '"nói thật" / "thành thật"', pattern: /nói thật|thành thật/i },
  { id: "tra_loi_thang", label: '"trả lời thẳng"', pattern: /trả lời thẳng/i },
  { id: "co_san", label: "nhắc hàng có sẵn", pattern: /có sẵn|đang sẵn|sẵn hàng|hàng vừa về/i },
  { id: "hua_giao", label: "hứa mốc giao", pattern: /kịp (trước )?(lễ|khai giảng|tết)|hỏa tốc|đặt hôm nay/i },
  { id: "xach_tay", label: '"xách tay" / "hàng Nhật"', pattern: /xách tay|hàng nhật/i },
  // `\b` is ASCII-only in JavaScript, so it never sits next to a Vietnamese letter: Desk's
  // version of this rule (`\b(mình|bạn)\s+(nhé|nha|ạ)\b`) could not fire on "Mình nhé," or "mình ạ." —
  // the boundary after "nhé" / "ạ" can never exist. Unicode lookarounds instead.
  { id: "xung_ho_sai", label: 'xưng "mình" hoặc "bạn" với khách', pattern: /(?<!\p{L})(mình|bạn)\s+(nhé|nha|ạ)(?!\p{L})/iu }
];

/** Size and stock claims. Separate because they slip through the eye most easily. */
const STOCK_RULES: readonly { id: string; label: string; pattern: RegExp }[] = [
  { id: "du_size", label: "nhắc đủ size", pattern: /đủ size|nhiều size|dải size|đầy lại size|còn nhiều cỡ|size từ \d|từ \d\d đến \d\d/i }
];

/**
 * The rules a WRITER needs told, in sentences rather than regexes.
 *
 * The judge works on patterns; a model works on instructions. Deriving the instructions from the
 * same array keeps one source of truth — adding a banned phrase teaches the writer about it in the
 * same commit that starts rejecting it.
 */
export function writerRules(): { captionToiThieu: number; captionToiDa: number; hookChuHoaToiThieu: number; hookChuHoaToiDa: number; cam: string[] } {
  return {
    captionToiThieu: CAPTION_MIN_LENGTH,
    captionToiDa: CAPTION_MAX_LENGTH,
    hookChuHoaToiThieu: HOOK_CAPS_MIN,
    hookChuHoaToiDa: HOOK_CAPS_MAX,
    cam: [
      ...[...BANNED_RULES, ...STOCK_RULES].map((rule) => `Không ${rule.label}.`),
      "Không nhắc giá tiền, không nhắc phần trăm giảm giá.",
      "Chữ trên ảnh phải lấy chữ từ hook, nhưng ngắn hơn hook."
    ]
  };
}

/** Too much salesmanship. A warning only — a person decides whether it reads badly. */
const HYPE_WORDS: readonly string[] = ["cực kỳ", "tuyệt vời", "không có đối thủ", "đỉnh cao", "số một", "hoàn hảo", "ăn tiền", "chuẩn bài", "vượt trội", "cực chất"];
const ENGLISH_WORDS: readonly string[] = ["recommend", "review", "feedback", "style", "fit", "outfit", "combo"];

const text = (v: unknown): string => (typeof v === "string" ? v : "");

function firstLine(value: string): string {
  return value.split("\n")[0] ?? "";
}

/**
 * How many WORDS IN CAPITALS the hook opens with (the 06/09 rule: 4–10).
 *
 * Counts a run at the START of the line only: a shop name in capitals halfway down is not a hook.
 */
export function hookCapsRun(line: string): number {
  let count = 0;
  for (const word of text(line).trim().split(/\s+/)) {
    const letters = word.replace(/[^\p{L}]/gu, "");
    if (letters === "" || letters !== letters.toUpperCase()) break;
    count += 1;
  }
  return count;
}

/**
 * `5K`, `10K`, `21K`, `42K` are RUNNING DISTANCES, not money.
 *
 * Before 12/09/2026 the price rule read them as "5 nghìn" and blocked shoe posts that scored 8/8/8,
 * and the reviewers kept "finding a rule violation" in a perfectly ordinary sentence about distance.
 */
function isRunningDistance(hit: string): boolean {
  return /^\s*(5|10|21|42)\s*k\s*$/i.test(hit);
}

export interface CaptionContext {
  /** The words printed on the cover image — checked against the hook, not against the whole caption. */
  main?: string;
}

/** Checks the caption a post will publish with. */
export function checkCaption(caption: unknown, { main = "" }: CaptionContext = {}): RuleResult {
  const errors: RuleNote[] = [];
  const warnings: RuleNote[] = [];
  const body = text(caption);
  if (body.trim() === "") return { errors: [{ id: "caption_rong", message: "Caption đang rỗng." }], warnings };

  for (const rule of [...BANNED_RULES, ...STOCK_RULES]) {
    const hit = body.match(rule.pattern);
    if (hit) errors.push({ id: rule.id, message: `Vi phạm ${rule.label}: "${hit[0]}"` });
  }

  // Money. Three false catches had to be designed out, all seen for real:
  //   "Y2K"        — a letter before the digits
  //   "3 đến 5 km" — a letter after the unit
  //   "5 km"       — the "k" is glued to "m", so the rule above already drops it
  const money = [...body.matchAll(/(?<![\p{L}\d])\d[\d.,]*\s*(k|đ|vnđ|nghìn|triệu)(?![\p{L}\d])/giu)]
    .map((m) => m[0])
    .filter((hit) => !isRunningDistance(hit));
  if (money.length > 0) {
    errors.push({ id: "gia_tien", message: `Caption nhắc giá tiền: ${[...new Set(money.map((m) => m.trim()))].join(", ")}` });
  }

  // Percentages: the ban is on DISCOUNT percentages. "80% chị hỏi em đều hợp Supernova" and
  // "90% trọng lượng dồn lên gân" are ordinary ratios. Catching every "%" locked a post that had
  // scored 8/8/8 (12/09/2026) — the same trap as "5K = 5 nghìn".
  const percent = [...body.matchAll(/[^.!?\n]{0,40}\d+\s*%[^.!?\n]{0,40}/g)]
    .map((m) => m[0])
    .filter((piece) => /gi[ảa]m|sale|khuy[ếe]n m[ãa]i|off|b[ớo]t|r[ẻe] h[ơo]n|gi[áa]|deal/i.test(piece));
  if (percent.length > 0) {
    const numbers = percent.map((piece) => (piece.match(/\d+\s*%/) ?? [""])[0].trim()).filter((x) => x !== "");
    errors.push({ id: "phan_tram", message: `Caption nhắc phần trăm giảm giá: ${[...new Set(numbers)].join(", ")}` });
  }

  const hook = firstLine(body);
  const caps = hookCapsRun(hook);
  if (hook.trim() !== "" && hook === hook.toUpperCase()) {
    errors.push({ id: "hook_hoa_ca_cau", message: "Hook viết hoa cả câu." });
  } else if (caps < HOOK_CAPS_MIN || caps > HOOK_CAPS_MAX) {
    errors.push({ id: "hook_caps", message: `Cụm viết hoa đầu hook ${caps} chữ, cần ${HOOK_CAPS_MIN}–${HOOK_CAPS_MAX}.` });
  }

  // 13/09/2026: the words on the cover must be TAKEN FROM the hook, not avoid it. The old rule had
  // it backwards and flagged exactly what the shop wanted. Both survivors are warnings, because a
  // person can fix an image by hand.
  if (main.trim() !== "" && hook.trim() !== "") {
    // TWO ratios, not one. Measuring a single overlap makes a SHORTENED hook — "BA ĐÔI ĐÁNG CÂN
    // NHẮC" under a longer hook — score a perfect match and get flagged as swallowing it, which is
    // the exact false alarm Desk had to remove (13/09/2026). So: how much of the COVER comes from
    // the hook, and separately how much of the HOOK the cover gives away.
    const shared = sharedWords(main, hook);
    const fromHook = shared / Math.max(1, wordsOf(main).size);
    const givesAway = shared / Math.max(1, wordsOf(hook).size);
    if (fromHook < 0.3) warnings.push({ id: "anh_khong_theo_hook", message: "Chữ trên ảnh không lấy từ hook — câu mạnh nhất của bài không lên ảnh." });
    else if (givesAway > 0.9) warnings.push({ id: "anh_nuot_hook", message: "Chữ trên ảnh gần như nuốt cả hook — nhìn ảnh là biết hết, không còn gì để tò mò." });
  }

  const length = body.trim().length;
  if (length < CAPTION_MIN_LENGTH) errors.push({ id: "caption_ngan", message: `Caption ${length} ký tự, cần ít nhất ${CAPTION_MIN_LENGTH}.` });
  if (length > CAPTION_MAX_LENGTH) errors.push({ id: "caption_dai", message: `Caption ${length} ký tự, tối đa ${CAPTION_MAX_LENGTH}.` });

  const hype = HYPE_WORDS.filter((w) => body.toLowerCase().includes(w));
  if (hype.length > 0) warnings.push({ id: "tu_qua_da", message: `Từ quảng cáo quá đà: ${hype.join(", ")}` });
  const english = ENGLISH_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(body));
  if (english.length > 0) warnings.push({ id: "tu_tieng_anh", message: `Từ tiếng Anh lọt vào: ${english.join(", ")}` });

  return { errors, warnings };
}

/** The words of a phrase worth comparing — short ones ("ba", "cho") say nothing about overlap. */
function wordsOf(phrase: string): Set<string> {
  return new Set(phrase.toLowerCase().split(/[^\p{L}\d]+/u).filter((w) => w.length > 2));
}

/** How many meaningful words the two phrases have in common. */
function sharedWords(a: string, b: string): number {
  const right = wordsOf(b);
  let hit = 0;
  for (const w of wordsOf(a)) if (right.has(w)) hit += 1;
  return hit;
}

export interface CommentContext {
  /** The shop's own site — links must point there. Desk had `toprun.site` in the regex; OMI has many shops. */
  siteOrigin?: string;
}

/** Checks the first comment, which is where the shop puts its links. */
export function checkComment(comment: unknown, { siteOrigin = "" }: CommentContext = {}): RuleResult {
  const errors: RuleNote[] = [];
  const warnings: RuleNote[] = [];
  const body = text(comment);
  if (body.trim() === "") return { errors: [{ id: "comment_rong", message: "Chưa có nội dung bình luận kèm bài." }], warnings };

  if (/tinyurl/i.test(body)) errors.push({ id: "tinyurl", message: "Comment còn dùng tinyurl." });
  const links = body.match(/https?:\/\/\S+/g) ?? [];
  if (links.length === 0) errors.push({ id: "comment_thieu_link", message: "Comment không có link nào." });
  if (links.length > 3) warnings.push({ id: "comment_nhieu_link", message: `Comment có ${links.length} link, nên giữ 1–2.` });

  const origin = String(siteOrigin || "").trim().replace(/\/+$/, "");
  if (origin !== "") {
    const stray = links.filter((l) => !l.toLowerCase().startsWith(`${origin.toLowerCase()}/`) && l.toLowerCase() !== origin.toLowerCase());
    if (stray.length > 0) errors.push({ id: "comment_link_la", message: `Link không thuộc ${origin}: ${stray[0]}` });
  }
  if (!/inbox|em/i.test(body)) warnings.push({ id: "comment_thieu_moi", message: "Comment thiếu câu mời inbox." });
  return { errors, warnings };
}

/** What the rules need to know about one product to judge a post that uses it. */
export interface ProductForPost {
  code: string;
  name?: string;
  sizes?: { size?: string; qty?: number }[];
  images?: number;
}

export interface Post {
  id?: string;
  page?: string;
  date?: string;
  time?: string;
  format?: string;
  codes?: string[];
  caption?: string;
  /** The words printed on the cover image. */
  main?: string;
  comment?: string;
  gallery?: unknown[];
}

export interface PostContext extends CommentContext {
  productsByCode?: Map<string, ProductForPost> | Record<string, ProductForPost>;
  /** Codes whose picture was already the cover of a recent post — reusing one looks like a repeat. */
  mainImageCodes?: Iterable<string>;
  /** Shared across a batch so the same code is not used twice in one day. */
  seenCodes?: Map<string, string>;
  nowMs?: number;
}

function productOf(ctx: PostContext, code: string): ProductForPost | null {
  const src = ctx.productsByCode;
  if (src === undefined) return null;
  if (src instanceof Map) return src.get(code) ?? null;
  return (src as Record<string, ProductForPost>)[code] ?? null;
}

/** Checks the product codes of a post: enough of them, all real, all sellable. */
export function checkCodes(post: Post, ctx: PostContext = {}): RuleResult {
  const errors: RuleNote[] = [];
  const warnings: RuleNote[] = [];
  const codes = post.codes ?? [];
  const format = post.format === undefined ? null : POST_FORMATS[post.format] ?? null;
  const usedAsMain = new Set(ctx.mainImageCodes ?? []);

  if (codes.length === 0) return { errors: [{ id: "khong_co_ma", message: "Bài chưa chọn mã sản phẩm nào." }], warnings };

  if (format !== null) {
    if (codes.length < format.minCodes) errors.push({ id: "thieu_ma", message: `Dạng bài "${format.label}" cần ít nhất ${format.minCodes} mã, đang có ${codes.length}.` });
    if (codes.length > format.maxCodes) errors.push({ id: "thua_ma", message: `Dạng bài "${format.label}" tối đa ${format.maxCodes} mã, đang có ${codes.length}.` });
    if (format.requiresGallery === true && (post.gallery ?? []).length === 0) {
      errors.push({ id: "thieu_gallery", message: `Dạng bài "${format.label}" phải có gallery để lấy nhiều góc chụp.` });
    }
  } else if (codes.length > ALBUM_MAX_CODES) {
    errors.push({ id: "qua_6_ma", message: `Album tối đa ${ALBUM_MAX_CODES} ảnh nên không quá ${ALBUM_MAX_CODES} mã.` });
  }

  for (const code of codes) {
    const product = productOf(ctx, code);
    if (product === null) { errors.push({ id: "ma_khong_ton_tai", message: `Mã ${code} không có trong danh mục.` }); continue; }
    if ((product.sizes ?? []).filter((s) => Number(s.qty ?? 0) > 0).length === 0) errors.push({ id: "het_size", message: `Mã ${code} hết size.` });
    if (Number(product.images ?? 0) === 0) errors.push({ id: "khong_co_anh", message: `Mã ${code} không có ảnh.` });
    if (String(product.name ?? "").trim() === "") errors.push({ id: "khong_co_ten", message: `Mã ${code} chưa có tên.` });
    if (usedAsMain.has(code)) warnings.push({ id: "anh_chinh_trung", message: `Mã ${code} vừa làm ảnh chủ một bài gần đây.` });

    // One code twice in a day reads as the shop having nothing else to sell.
    const seen = ctx.seenCodes;
    if (seen !== undefined) {
      const where = seen.get(code);
      const here = `${post.page ?? ""} ${post.time ?? ""}`.trim();
      if (where !== undefined && where !== here) warnings.push({ id: "ma_trung_lo", message: `Mã ${code} đã dùng ở bài ${where}.` });
      else seen.set(code, here);
    }
  }
  return { errors, warnings };
}

export interface PostVerdict extends RuleResult {
  tag: string;
  ok: boolean;
}

/** The whole verdict on one post. */
export function validatePost(post: Post, ctx: PostContext = {}): PostVerdict {
  const tag = `${post.date ? `${post.date} ` : ""}${post.time ?? ""} ${post.page ?? ""}`.trim();
  const errors: RuleNote[] = [];
  const warnings: RuleNote[] = [];

  if (!post.page) errors.push({ id: "thieu_page", message: "Bài chưa chọn fanpage." });
  if (!post.time) errors.push({ id: "thieu_gio", message: "Bài chưa có khung giờ." });
  if (post.format !== undefined && POST_FORMATS[post.format] === undefined) {
    errors.push({ id: "dang_bai_la", message: `Dạng bài "${post.format}" không có trong danh sách.` });
  }
  if (text(post.main).trim() === "") errors.push({ id: "thieu_chu_anh", message: "Chưa có chữ in trên ảnh chính." });

  if (post.date && post.time) {
    const scheduled = Date.parse(`${post.date}T${post.time}:00+07:00`);
    const now = Number.isFinite(ctx.nowMs) ? Number(ctx.nowMs) : Date.now();
    if (Number.isFinite(scheduled) && scheduled < now + SCHEDULE_LEAD_MINUTES * 60 * 1000) {
      errors.push({ id: "qua_gio", message: `Khung giờ đã qua hoặc còn dưới ${SCHEDULE_LEAD_MINUTES} phút — Meta sẽ từ chối.` });
    }
  }

  for (const part of [checkCaption(post.caption, { main: text(post.main) }), checkComment(post.comment, ctx), checkCodes(post, ctx)]) {
    errors.push(...part.errors);
    warnings.push(...part.warnings);
  }
  return { tag, ok: errors.length === 0, errors, warnings };
}

export interface BatchVerdict {
  ok: boolean;
  theoBai: PostVerdict[];
  errors: RuleNote[];
  warnings: RuleNote[];
}

const minutesOfSlot = (time: unknown): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
  return m === null ? null : Number(m[1]) * 60 + Number(m[2]);
};

/** The verdict on a whole day's batch: every post, plus what only shows up across posts. */
export function validateBatch(posts: Post[], ctx: PostContext = {}): BatchVerdict {
  const seenCodes = ctx.seenCodes ?? new Map<string, string>();
  const theoBai = posts.map((post) => validatePost(post, { ...ctx, seenCodes }));
  const errors: RuleNote[] = [];
  const warnings: RuleNote[] = [];

  // Two hours between posts on the same page, same day. Closer than that and the second post is
  // shown to the people who have just seen the first one.
  const byPageDay = new Map<string, Post[]>();
  for (const post of posts) {
    if (!post.page || !post.time) continue;
    const key = `${post.page}|${post.date ?? ""}`;
    byPageDay.set(key, [...(byPageDay.get(key) ?? []), post]);
  }
  for (const [key, group] of byPageDay) {
    const sorted = group
      .map((p) => ({ post: p, minutes: minutesOfSlot(p.time) }))
      .filter((x): x is { post: Post; minutes: number } => x.minutes !== null)
      .sort((a, b) => a.minutes - b.minutes);
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = (sorted[i] as { minutes: number }).minutes - (sorted[i - 1] as { minutes: number }).minutes;
      if (gap < MIN_GAP_MINUTES) {
        errors.push({
          id: "gian_cach",
          message: `${key.split("|")[0]}: ${sorted[i - 1]?.post.time} và ${sorted[i]?.post.time} cách nhau ${gap} phút, cần ít nhất ${MIN_GAP_MINUTES}.`
        });
      }
    }
  }

  return { ok: errors.length === 0 && theoBai.every((v) => v.ok), theoBai, errors, warnings };
}
