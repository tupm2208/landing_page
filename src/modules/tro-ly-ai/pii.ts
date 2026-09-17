/**
 * @file Strips personal data from chat text BEFORE it leaves the landing (Đ7 training analysis).
 *
 * Decided with the roadmap: archived conversations go to Xeon for analysis, but the customer's
 * phone, e-mail, address, account number and name stay here. Xeon strips phones and e-mails once
 * more (defence in depth); what only the landing can know — the customer's DISPLAY NAME from the
 * thread — is removed here.
 *
 * Deliberately generous: a product code survives (letters + digits), a size or a price survives
 * (short numbers), but any long digit run is hidden — losing an EAN in a training sample costs
 * nothing, leaking an account number costs a lot.
 */

export const HIDDEN = "[đã ẩn]";

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
// 0912 345 678 · 0912.345.678 · +84 912345678 · 84912345678
const PHONE = /(?<![\w])(?:\+?84|0)(?:[\s.-]?\d){8,10}(?![\w])/g;
// Account numbers, card numbers, ids: 8+ digits with no letters around them.
const LONG_DIGITS = /(?<![\w])\d{8,}(?![\w])/g;
// "địa chỉ: 12 Đội Cấn, Ba Đình" / "đc 12 ngõ 5" / "giao về số 3 Lê Lợi" — the rest of the line.
const ADDRESS = /((?:địa chỉ|dia chi|đ\/c|đc|dc|giao về|giao ve|ship về|ship ve|nhà ở|nha o|nhận hàng ở|nhan hang o)\s*[:\-]?\s*)([^\n.;!?]{3,160})/giu;
// "số 12 ngõ 34 ..." / "12 đường Lê Lợi" without a keyword.
const STREET = /\b(?:số\s*)?\d{1,4}[a-z]?\s*(?:\/\s*\d{1,4}\s*)?(?:ngõ|ngách|hẻm|kiệt|đường|phố|ngo|hem|duong|pho)\s+[^\n,.;]{2,60}/giu;
// "tên Nguyễn Văn A" / "em là Trần Thị B" — up to four capitalised words.
const NAMED = /((?:tên(?: em| mình| tôi| anh| chị)?(?: là)?|tôi là|mình là|em là|anh là|chị là|người nhận(?: là)?)\s*[:\-]?\s*)((?:\p{Lu}[\p{Ll}\p{M}]*\s*){1,4})/gu;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Text with personal data replaced. `names` = names known for this conversation (display name, profile name). */
export function stripPII(text: string, names: readonly string[] = []): string {
  let out = String(text ?? "");
  for (const raw of names) {
    // Zalo lines are "Nhóm · Người gửi": each part is a name.
    for (const name of String(raw ?? "").split(" · ").map((n) => n.trim()).filter((n) => n.length >= 2)) {
      out = out.replace(new RegExp(escapeRegex(name), "giu"), "[tên]");
    }
  }
  return out
    .replace(EMAIL, HIDDEN)
    .replace(PHONE, HIDDEN)
    .replace(LONG_DIGITS, HIDDEN)
    .replace(ADDRESS, (_m, keyword: string) => `${keyword}[địa chỉ đã ẩn]`)
    .replace(STREET, "[địa chỉ đã ẩn]")
    .replace(NAMED, (_m, keyword: string) => `${keyword}[tên] `);
}
