/**
 * @file Size signals found in a chat (Desk `extractFitSignalsFromConversation`, 14/08/2026).
 *
 * Desk measured 3.987 real conversations: 61% mention a size, 24% a foot measurement. The shop does
 * not want them typed twice — but a regex is not a fact, so a signal is only ever PROPOSED: a person
 * presses ✓ (it goes into the customer's profile) or ✗ (it stops showing for this conversation).
 * Only CUSTOMER messages are read; of the same kind the LAST one wins, because a customer who
 * hesitates between sizes settles at the end.
 */

export interface FitSignal {
  type: "footLength" | "footWidth" | "wearing" | "sizeEU" | "fitNote";
  label: string;
  value: string;
  unit?: string;
  brand?: string;
  quote: string;
  at: string;
  /** Stable key for ✓ / ✗ (Desk `fitSignalKey`). */
  khoa: string;
}

const BRAND_WORDS: [string, string][] = [
  ["new balance", "New Balance"], ["newbalance", "New Balance"], ["li-ning", "Li-Ning"], ["lining", "Li-Ning"],
  ["nike", "Nike"], ["adidas", "adidas"], ["asics", "Asics"], ["puma", "Puma"], ["mizuno", "Mizuno"],
  ["hoka", "Hoka"], ["saucony", "Saucony"], ["brooks", "Brooks"], ["anta", "Anta"], ["kailas", "Kailas"],
  ["salomon", "Salomon"], ["altra", "Altra"]
];
const MODEL_BRANDS: Record<string, string> = {
  pegasus: "Nike", vaporfly: "Nike", alphafly: "Nike", vomero: "Nike", invincible: "Nike", structure: "Nike", zoomfly: "Nike", "zoom fly": "Nike", infinity: "Nike", windflo: "Nike",
  adizero: "adidas", adios: "adidas", boston: "adidas", ultraboost: "adidas", supernova: "adidas", "evo sl": "adidas", takumi: "adidas",
  novablast: "Asics", nimbus: "Asics", kayano: "Asics", cumulus: "Asics", metaspeed: "Asics", superblast: "Asics", "magic speed": "Asics", magicspeed: "Asics", trabuco: "Asics",
  "1080": "New Balance", fuelcell: "New Balance", rebel: "New Balance", "sc elite": "New Balance",
  cloudmonster: "On", cloudsurfer: "On", cloudeclipse: "On",
  endorphin: "Saucony", kinvara: "Saucony", triumph: "Saucony", ghost: "Brooks", glycerin: "Brooks", hyperion: "Brooks",
  clifton: "Hoka", bondi: "Hoka", rincon: "Hoka", speedgoat: "Hoka"
};
const MODEL_WORDS = "nike|adidas|asics|new ?balance|puma|mizuno|hoka|saucony|brooks|li-?ning|anta|kailas|salomon|altra"
  + "|pegasus|vaporfly|alphafly|vomero|invincible|structure|zoom ?fly|infinity|windflo"
  + "|adizero|adios|boston|ultraboost|supernova|evo ?sl|takumi"
  + "|novablast|nimbus|kayano|cumulus|metaspeed|superblast|magic ?speed|trabuco"
  + "|1080|fuelcell|rebel|sc ?elite|cloudmonster|cloudsurfer|cloudeclipse"
  + "|endorphin|kinvara|triumph|ghost|glycerin|hyperion|clifton|bondi|rincon|speedgoat";

export function brandFromText(value: string): string {
  const lower = ` ${String(value ?? "").toLowerCase()} `;
  for (const [word, brand] of BRAND_WORDS) if (lower.includes(word)) return brand;
  for (const [model, brand] of Object.entries(MODEL_BRANDS)) if (lower.includes(model)) return brand;
  return "";
}

const decimal = (raw: string | undefined) => String(raw ?? "").replace(",", ".").trim();

export function signalKey(signal: { type: string; brand?: string; value: string }): string {
  return [signal.type, signal.brand || "", signal.value].join("|").toLowerCase();
}

/** Signals in the customer's messages, minus the ones a person dismissed. */
export function extractFitSignals(messages: { chieu: string; chu: string; luc: string }[], dismissed: readonly string[] = []): FitSignal[] {
  const found = new Map<string, FitSignal>();
  const remember = (signal: Omit<FitSignal, "quote" | "at" | "khoa">, quote: string, at: string) => {
    if (!signal.value) return;
    found.set(`${signal.type}|${signal.brand || ""}`, { ...signal, quote: quote.replace(/\s+/g, " ").trim().slice(0, 140), at, khoa: signalKey(signal) });
  };
  for (const message of messages) {
    if (message.chieu !== "den" || !message.chu) continue;
    const text = String(message.chu);
    const at = message.luc || "";
    const length = /(?:ch[âa]n|d[àa]i|đo|\bdo\b)[^\d\n]{0,25}(\d{2}(?:[.,]\d)?)\s*(?:cm|ph[âa]n)\b/i.exec(text) || /\b(2[0-9](?:[.,]\d)?)\s*(?:cm|ph[âa]n)\b/i.exec(text);
    if (length) remember({ type: "footLength", label: "Chân dài", value: decimal(length[1]), unit: "cm" }, text, at);
    const width = /(?:ngang|r[ộo]ng(?:\s+nh[ấa]t)?|b[ềe] r[ộo]ng)[^\d\n]{0,15}(\d(?:[.,]\d)?|1[01](?:[.,]\d)?)\s*(?:cm|ph[âa]n)\b/i.exec(text);
    if (width) remember({ type: "footWidth", label: "Bề ngang", value: decimal(width[1]), unit: "cm" }, text, at);
    const wearing = new RegExp(`(?:đang|dang|hay|th[ưu][ờo]ng|v[ẫâa]n)\\s+(?:đi|di|ch[ạa]y|d[ùu]ng|mang)\\s+(?:gi[àa]y\\s+)?(?:đ[ôo]i\\s+)?(${MODEL_WORDS})((?:\\s+[a-z0-9.]{1,12}){0,3})`, "i").exec(text);
    if (wearing) {
      const shoe = `${wearing[1]}${wearing[2] || ""}`.replace(/\s+/g, " ").trim().slice(0, 40);
      remember({ type: "wearing", label: "Đang đi", value: shoe, brand: brandFromText(shoe) }, text, at);
    }
    const size = /\b(?:size|sz|c[ỡơo])\s*[:=]?\s*(3[5-9]|4[0-8])((?:[.,]5)|\s?[12]\/3)?\b/i.exec(text);
    if (size) remember({ type: "sizeEU", label: "Size", value: `${size[1]}${decimal(size[2]).replace(/\s+/, " ")}`, brand: brandFromText(text) }, text, at);
    const feedback = /\b(3[5-9]|4[0-8])(?:[.,]5)?\s*(?:th[ìi]\s+|h[ơo]i\s+)?(ch[ậa]t|r[ộo]ng|v[ừư]a)/i.exec(text);
    if (feedback) remember({ type: "fitNote", label: "Fit", value: `${feedback[1]} ${feedback[2]}`.toLowerCase() }, text, at);
  }
  const hidden = new Set(dismissed.map((k) => k.toLowerCase()));
  return [...found.values()].filter((s) => !hidden.has(s.khoa));
}
