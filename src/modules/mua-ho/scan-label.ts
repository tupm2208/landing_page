/**
 * @file READING A PRODUCT LABEL WITH THE CAMERA — the partner points a phone at the label, a vision
 * model reads the article code and the size, and the answer is matched against what they still have
 * to buy.
 *
 * Ported from the running site (`scanLabelWithAI` + `scanPartnerLabel`, v73, 02/09/2026). Three
 * decisions of that version are kept because they were paid for in real mistakes:
 *
 * 1. OUT OF THE LIST = A WARNING, NEVER A PURCHASE. A code that is not on this partner's list, or a
 *    size that is not, comes back as `khong_trong_danh_sach` / `sai_size`. The scan NEVER writes a
 *    purchase by itself; the partner still confirms. Dũng decided this on 02/09 after a scan bought
 *    the wrong size.
 * 2. ONE CHARACTER OF SLACK ON THE CODE, NONE ON THE SIZE. A label reads `IM7681` as `IM768I` often
 *    enough to matter, and the list is short, so an edit distance of one still lands on the right
 *    row. Sizes are compared by VALUE (`43 1/3` = 43.333), never by slack: 42 and 43 are different
 *    shoes.
 * 3. THE MODEL SEES ONLY THE PHOTO. It is never told what the partner is supposed to be buying, so
 *    it cannot "helpfully" answer with a code from the list it never read.
 *
 * The key belongs to the OPERATOR (`SCAN_AI_API_KEY`), not to the shop — see `app.ts`. Unset = this
 * door answers "not configured" and the partner types as before.
 */

import type { HttpClient } from "../../contract";

/** Adidas prints UK on the label; the catalogue is EU. Table of the running site. */
const ADIDAS_UK_TO_EU: Readonly<Record<string, string>> = {
  "3.5": "36", "4": "36 2/3", "4.5": "37 1/3", "5": "38", "5.5": "38 2/3", "6": "39 1/3", "6.5": "40",
  "7": "40 2/3", "7.5": "41 1/3", "8": "42", "8.5": "42 2/3", "9": "43 1/3", "9.5": "44", "10": "44 2/3",
  "10.5": "45 1/3", "11": "46", "11.5": "46 2/3", "12": "47 1/3"
};

/** Nike prints US. Same source. */
const NIKE_US_TO_EU: Readonly<Record<string, string>> = {
  "5": "37.5", "5.5": "38", "6": "38.5", "6.5": "39", "7": "40", "7.5": "40.5", "8": "41", "8.5": "42",
  "9": "42.5", "9.5": "43", "10": "44", "10.5": "44.5", "11": "45", "11.5": "45.5", "12": "46", "13": "47.5"
};

export interface ScanAiConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/** What the model answered, once parsed. */
export interface LabelReading {
  code: string;
  kind: string;
  sizes: { eu?: string; uk?: string; us?: string; jp?: string; letter?: string };
  confidence: number;
}

export type ReadLabelOutcome =
  | { ok: true; reading: LabelReading }
  | { ok: false; viSao: "chua_cau_hinh" | "anh_khong_hop_le" | "ai_loi"; loiNhan: string };

/** One line the partner still has to buy, as the matcher needs it. */
export interface ScanCandidate {
  maDong: string;
  maMon: string;
  ten: string;
  size: string;
  soLuong: number;
}

export type ScanMatch =
  | { trangThai: "khop"; maMon: string; size: string; dong: ScanCandidate; sizeDaDoc: string[] }
  | { trangThai: "sai_size"; maMon: string; sizeDaDoc: string[]; sizeCanMua: { size: string; soLuong: number }[]; loiNhan: string }
  | { trangThai: "khong_trong_danh_sach"; maMon: string; sizeDaDoc: string[]; loiNhan: string }
  | { trangThai: "khong_doc_duoc"; loiNhan: string };

/** Letters and digits only, upper case — a label prints `IM-7681` and the catalogue holds `IM7681`. */
export function normaliseCode(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** `A/XL` -> `XL`, `XXL` -> `2XL` — the same rule Sales Desk used (v68). */
export function normaliseSize(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/^A\//, "")
    .replace(/^(X{2,5})([SL])$/, (_all, xs: string, letter: string) => `${xs.length}X${letter}`)
    .replace(/\s+/g, " ");
}

/** `43 1/3` -> 43.333…, `42,5` -> 42.5. `NaN` for a letter size. */
export function sizeToNumber(value: unknown): number {
  const text = String(value ?? "").trim();
  const fraction = text.match(/^(\d{1,2})\s+([12])\/3$/);
  if (fraction) return Number(fraction[1]) + Number(fraction[2]) / 3;
  const plain = Number(text.replace(",", "."));
  return Number.isFinite(plain) ? plain : NaN;
}

/** Two sizes are the same size: equal as text, or equal as numbers (`43 1/3` = `43.33`). */
export function sizesEqual(left: unknown, right: unknown): boolean {
  const a = normaliseSize(left);
  const b = normaliseSize(right);
  if (a !== "" && a === b) return true;
  const na = sizeToNumber(a);
  const nb = sizeToNumber(b);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) <= 0.05;
}

/** One insertion, deletion or substitution apart — no more. */
export function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    if (edits) return false;
    edits = 1;
    if (a.length > b.length) i += 1;
    else if (a.length < b.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Every EU size the reading could mean: the printed EU first, then UK and US converted. */
export function candidateSizes(reading: LabelReading): string[] {
  const sizes = reading.sizes ?? {};
  const out: string[] = [];
  if (sizes.letter) out.push(String(sizes.letter));
  if (sizes.eu) out.push(String(sizes.eu));
  const uk = String(sizes.uk ?? "").trim();
  if (uk && ADIDAS_UK_TO_EU[uk]) out.push(ADIDAS_UK_TO_EU[uk]!);
  const us = String(sizes.us ?? "").trim();
  if (us && NIKE_US_TO_EU[us]) out.push(NIKE_US_TO_EU[us]!);
  return [...new Set(out.filter(Boolean))];
}

/** Only a real data URL of a real image goes to the model — never a URL the caller chose. */
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const SYSTEM_PROMPT =
  'Bạn đọc TEM sản phẩm thể thao (giày/quần áo adidas, Nike...) trong ảnh. Trả về DUY NHẤT một JSON, ' +
  'không giải thích: {"productCode":"mã article in trên tem, vd JP9252, IM7681, HQ2721-001","kind":"shoe hoặc apparel",' +
  '"sizes":{"eu":"size EU/F nếu có, giữ dạng phân số vd 43 1/3","uk":"","us":"","jp":"","letter":"size chữ nếu là quần áo, vd XL, A/XL, 2XL"},' +
  '"confidence":0.0-1.0}. Không thấy tem hoặc không đọc được mã thì productCode để chuỗi rỗng.';

/**
 * Asks the model to read the label. Never throws: a refusal is an outcome the partner can act on
 * ("hold the label flatter"), not a 500.
 */
export async function readLabel(http: HttpClient, config: ScanAiConfig, imageDataUrl: unknown): Promise<ReadLabelOutcome> {
  const apiKey = String(config.apiKey ?? "").trim();
  if (!apiKey) {
    return { ok: false, viSao: "chua_cau_hinh", loiNhan: "Chưa bật quét tem (thiếu SCAN_AI_API_KEY) — nhập tay giúp shop nhé." };
  }
  const image = String(imageDataUrl ?? "");
  if (!IMAGE_DATA_URL.test(image)) return { ok: false, viSao: "anh_khong_hop_le", loiNhan: "Ảnh gửi lên không hợp lệ." };

  const baseUrl = String(config.baseUrl ?? "").trim().replace(/\/+$/, "") || "https://ai.elevenvoice.site/v1";
  const model = String(config.model ?? "").trim() || "ag/gemini-3.7-flash-low";

  try {
    const response = await http.fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      timeoutMs: 25000,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        // The gateway refuses a streamed answer here, and the image must be a base64 data URL.
        stream: false,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: [{ type: "text", text: "Đọc tem trong ảnh này." }, { type: "image_url", image_url: { url: image } }] }
        ]
      })
    });
    const payload = (await response.json().catch(() => ({}))) as { choices?: { message?: { content?: unknown } }[] };
    if (!response.ok) return { ok: false, viSao: "ai_loi", loiNhan: `AI trả lời HTTP ${response.status}.` };

    const answer = String(payload?.choices?.[0]?.message?.content ?? "").trim();
    const jsonText = (answer.match(/\{[\s\S]*\}/) ?? [""])[0];
    const parsed = JSON.parse(jsonText || "{}") as Record<string, unknown>;
    const sizes = parsed["sizes"];
    return {
      ok: true,
      reading: {
        code: String(parsed["productCode"] ?? "").trim(),
        kind: String(parsed["kind"] ?? "").trim(),
        sizes: sizes !== null && typeof sizes === "object" ? (sizes as LabelReading["sizes"]) : {},
        confidence: Number(parsed["confidence"] ?? 0)
      }
    };
  } catch (e) {
    // Trial mode blocks this call (it is an outside destination): say so plainly.
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, viSao: "ai_loi", loiNhan: /timed out|abort/i.test(message) ? "AI đọc tem quá lâu, thử lại giúp shop." : message };
  }
}

/**
 * Matches a reading against what this partner still has to buy.
 *
 * RULE 1 of this file: a code or size outside the list is a WARNING. Nothing here writes anything.
 */
export function matchReading(reading: LabelReading, candidates: ScanCandidate[]): ScanMatch {
  const code = normaliseCode(reading.code);
  if (!code) {
    return { trangThai: "khong_doc_duoc", loiNhan: "Chưa đọc được mã trên tem — đưa camera gần hơn, giữ tem phẳng và đủ sáng giúp shop." };
  }

  const waiting = candidates.filter((row) => Number(row.soLuong || 0) > 0);
  const sameCode = waiting.filter((row) => {
    const wanted = normaliseCode(row.maMon);
    return wanted === code || editDistanceAtMostOne(wanted, code);
  });
  const sizes = candidateSizes(reading);

  const matched = sameCode.find((row) => sizes.some((size) => sizesEqual(row.size, size)));
  if (matched) return { trangThai: "khop", maMon: matched.maMon, size: matched.size, dong: matched, sizeDaDoc: sizes };

  if (sameCode.length > 0) {
    return {
      trangThai: "sai_size",
      maMon: sameCode[0]!.maMon,
      sizeDaDoc: sizes,
      sizeCanMua: sameCode.map((row) => ({ size: row.size, soLuong: row.soLuong })),
      loiNhan: `Đúng mã ${sameCode[0]!.maMon} nhưng size trên tem (${sizes.join("/") || "?"}) KHÔNG nằm trong danh sách cần mua.`
    };
  }
  return {
    trangThai: "khong_trong_danh_sach",
    maMon: reading.code,
    sizeDaDoc: sizes,
    loiNhan: `Mã ${reading.code} không thuộc danh sách cần mua — không mua sản phẩm này.`
  };
}
