/**
 * @file MODULE SIZE & LINE ADVICE ("tu-van-size") — Đ9, tier "van-hanh", on the merchant server.
 *
 * Sales Desk's Fit Finder and "Sản phẩm mẫu" screens, split along the line decided 17/09/2026:
 *
 *   HERE (the shop's own)          — Fit Finder settings (weights, customer questions, line fields),
 *                                    the arithmetic of size charts and foot measurements, the shop's
 *                                    PRODUCT LINES and which catalogue item belongs to which line;
 *   ON XEON (industry knowledge)   — sample profiles, the research queue, line DNA (what a line is for,
 *                                    what fits a pace × distance), reference classification. This module
 *                                    only relays, with the landing's private inbox token.
 *
 * "Áp vào Fit Finder/Catalog" is where the two meet: Xeon turns profiles into lines, this module keeps
 * them and assigns catalogue items by keyword. "Dùng sản phẩm này làm mẫu cho cả dòng" (left from Đ5)
 * goes the other way: one product's web fields become the line here and the profile on Xeon.
 *
 * Nothing here writes the catalogue tables: `hang-kho` owns them. A line assignment is this module's
 * own document, read next to the catalogue.
 */

import { ACCESS, defineModule, reply, type ModuleContext } from "../../contract";
import { callXeon as sharedCallXeon, relayXeon, type XeonAnswer } from "../../shared/xeon-call";
import type { PlatformServices } from "../khung-nen-tang/module";
import { chartRows, convertSizeBetweenBrands, sizeFromFootMeasure, sizeFromTem, sockBand } from "./size-chart";

export const CONFIG_DOCUMENT = "tu-van-size-cau-hinh";
export const LINES_DOCUMENT = "tu-van-size-dong";

const TEN_MINUTES = 10 * 60 * 1000;
const NO_STORE = { "Cache-Control": "no-store" };
const XEON_SLOW = 170_000;

export type Config = Record<string, never>;

/** The catalogue item as `hang-kho.search` returns it (only what this module reads). */
interface CatalogItem { code?: string; name?: string; brand?: string; category?: string; source?: string; status?: string; sizes?: { qty?: number }[] }

interface Services {
  "hang-kho"?: { search(input: { query?: string; limit?: number }): Promise<CatalogItem[]>; read(key: string): Promise<Record<string, unknown> | null> };
  "khung-nen-tang"?: Pick<PlatformServices, "xeon">;
}

type Ctx = ModuleContext<Config, Services>;

export interface FitFinderConfig {
  maModule: string;
  tenNoiBo: string;
  tenCongKhai: string;
  moTa: string;
  trangThai: "foundation" | "pilot" | "live";
  trongSo: { mucDich: number; banChan: number; tocDoCuLy: number; ruiRo: number; banDuoc: number };
  bienKhach: string[];
  truongDong: string[];
  capNhatLuc: string;
}

export interface ProductLine extends Record<string, unknown> {
  id: string;
  ten: string;
  hang: string;
  tuKhoa: string[];
  capNhatLuc: string;
}

interface LineBook { version: 1; dong: ProductLine[]; gan: Record<string, string>; capNhatLuc: string }

const text = (v: unknown, n = 2000): string => String(v ?? "").trim().slice(0, n);
const asObject = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const lines = (v: unknown, n = 50, len = 300): string[] => (Array.isArray(v) ? v : String(v ?? "").split(/\r?\n/)).map((x) => text(x, len)).filter(Boolean).slice(0, n);
const plain = (v: unknown): string => text(v, 4000).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/\s+/g, " ");
const lineId = (v: unknown): string => plain(v).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
const weight = (v: unknown): number => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

export function defaultFitFinder(inputs: { bienKhach?: string[]; truongDong?: string[] } = {}): FitFinderConfig {
  return {
    maModule: "FIT_FINDER", tenNoiBo: "Fit Finder", tenCongKhai: "Tìm sản phẩm phù hợp",
    moTa: "Module giúp khách nhập thông tin cơ thể, nhu cầu sử dụng và sản phẩm đang dùng để hệ thống chấm điểm sản phẩm phù hợp theo luật kiểm soát được.",
    trangThai: "foundation", trongSo: { mucDich: 25, banChan: 25, tocDoCuLy: 20, ruiRo: 15, banDuoc: 15 },
    bienKhach: inputs.bienKhach ?? [], truongDong: inputs.truongDong ?? [], capNhatLuc: ""
  };
}

export function normaliseFitFinder(body: Record<string, unknown>, now: string): FitFinderConfig {
  const w = asObject(body["trongSo"]);
  const status = text(body["trangThai"], 20);
  return {
    maModule: text(body["maModule"], 60).replace(/[^A-Za-z0-9_]/g, "_") || "FIT_FINDER",
    tenNoiBo: text(body["tenNoiBo"], 120) || "Fit Finder",
    tenCongKhai: text(body["tenCongKhai"], 120) || "Tìm sản phẩm phù hợp",
    moTa: text(body["moTa"], 2000),
    trangThai: status === "pilot" || status === "live" ? status : "foundation",
    trongSo: { mucDich: weight(w["mucDich"]), banChan: weight(w["banChan"]), tocDoCuLy: weight(w["tocDoCuLy"]), ruiRo: weight(w["ruiRo"]), banDuoc: weight(w["banDuoc"]) },
    bienKhach: lines(body["bienKhach"], 60, 300), truongDong: lines(body["truongDong"], 60, 300), capNhatLuc: now
  };
}

/** A line as Xeon or the product editor sends it, with only the fields the shop keeps. */
export function normaliseLine(raw: Record<string, unknown>, now: string): ProductLine | null {
  const ten = text(raw["ten"], 200);
  const id = lineId(text(raw["id"], 160) || ten);
  if (!id || !ten) return null;
  const danhGia = asObject(raw["danhGia"]);
  return {
    id, ten, hang: text(raw["hang"], 80), loai: text(raw["loai"], 80), tuKhoa: lines(raw["tuKhoa"], 30, 160).length ? lines(raw["tuKhoa"], 30, 160) : [ten],
    gioiThieu: text(raw["gioiThieu"], 4000), baiViet: text(raw["baiViet"], 12000), moTaNgan: text(raw["moTaNgan"], 2000),
    tinhNang: lines(raw["tinhNang"], 30), congNghe: lines(raw["congNghe"], 30), phuHop: lines(raw["phuHop"], 30), khongHop: lines(raw["khongHop"], 30),
    huongDanFit: text(raw["huongDanFit"], 2000), ghiChuSize: text(raw["ghiChuSize"], 2000), maMau: text(raw["maMau"], 80),
    nguon: text(raw["nguon"], 40) || "tay", maHoSo: text(raw["maHoSo"], 120),
    danhGia: Object.keys(danhGia).length ? danhGia : null,
    capNhatLuc: now
  };
}

/** Longest keyword of a line found in the item text; 0 = no match. */
export function lineMatchLength(line: ProductLine, item: CatalogItem): number {
  const t = plain(`${item.name ?? ""} ${item.code ?? ""} ${item.brand ?? ""}`);
  let best = 0;
  for (const k of [...line.tuKhoa, line.ten]) { const n = plain(k).trim(); if (n.length >= 3 && n.length > best && t.includes(n)) best = n.length; }
  return best;
}

const configDocument = (ctx: Ctx) => ctx.ports.store.document<FitFinderConfig>(CONFIG_DOCUMENT);
const linesDocument = (ctx: Ctx) => ctx.ports.store.document<LineBook>(LINES_DOCUMENT);
const emptyBook = (): LineBook => ({ version: 1, dong: [], gan: {}, capNhatLuc: "" });

/** One call to the shop's Xeon with the private inbox token. Never throws. */
async function callXeon(ctx: Ctx, route: string, body: unknown, timeoutMs = 60_000): Promise<XeonAnswer> {
  return sharedCallXeon(ctx, "POST", route, body ?? {}, { timeoutMs, unregistered: "Landing chưa đăng ký với Xeon — kiến thức ngành nằm trên Xeon nên chưa dùng được." });
}

const relay = relayXeon;

async function catalogue(ctx: Ctx): Promise<CatalogItem[]> {
  const search = ctx.services["hang-kho"]?.search;
  return search ? await search({ query: "", limit: 0 }) : [];
}

const forXeon = (items: CatalogItem[]) => items.map((i) => ({ ma: text(i.code, 80), ten: text(i.name, 300), hang: text(i.brand, 80), loai: text(i.category, 80), nguon: text(i.source, 40) }));
const inStockNames = (items: CatalogItem[]) => items.filter((i) => i.status !== "hidden" && (i.sizes ?? []).some((s) => Number(s.qty) > 0)).map((i) => text(i.name, 300)).filter(Boolean);

/** Upserts lines and assigns catalogue items by longest keyword. Returns how many items got a line. */
async function storeLines(ctx: Ctx, incoming: ProductLine[], explicit: { ma: string; dong: string }[], items: CatalogItem[]): Promise<{ soDong: number; soGan: number }> {
  const now = ctx.ports.clock.now().toISOString();
  let assigned = 0;
  await linesDocument(ctx).update((current) => {
    const book = { ...emptyBook(), ...(current ?? {}) };
    const byId = new Map(book.dong.map((l) => [l.id, l]));
    for (const line of incoming) byId.set(line.id, { ...(byId.get(line.id) ?? {}), ...line });
    const all = [...byId.values()];
    const gan = { ...book.gan };
    for (const { ma, dong } of explicit) if (ma && byId.has(dong)) { gan[ma] = dong; assigned += 1; }
    for (const item of items) {
      const code = text(item.code, 80);
      if (!code || explicit.some((e) => e.ma === code)) continue;
      let best: { id: string; length: number } | null = null;
      for (const line of incoming) { const length = lineMatchLength(line, item); if (length > (best?.length ?? 0)) best = { id: line.id, length }; }
      if (best && gan[code] !== best.id) { gan[code] = best.id; assigned += 1; }
    }
    return { version: 1, dong: all.slice(0, 3000), gan, capNhatLuc: now };
  }, emptyBook());
  return { soDong: incoming.length, soGan: assigned };
}

export const manifest = defineModule<Config, Services>({
  id: "tu-van-size",
  name: "Tư vấn size & dòng sản phẩm",
  tier: "van-hanh",
  runsOn: "server-khach",
  feature: "hang-kho",
  version: "0.1.0",
  ports: ["store", "logger", "clock", "http"],
  requiresOptional: ["hang-kho.search", "hang-kho.read", "khung-nen-tang.xeon"],

  routes: [
    // ------------------------------------------------------------ Fit Finder (the shop's settings)
    {
      method: "GET", path: "/api/tu-van-size/cau-hinh", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const [stored, book] = await Promise.all([configDocument(ctx).read(null), linesDocument(ctx).read(null)]);
        let config = stored;
        let goi: unknown = null;
        if (!config) {
          // First visit: the industry's questions come from Xeon's pack (a shoe shop's are not a pharmacy's).
          const pack = await callXeon(ctx, "/kien-thuc/goi", {}, 15_000);
          const ff = asObject(pack.body["fitFinder"]);
          config = defaultFitFinder({ bienKhach: lines(ff["customerInputs"]), truongDong: lines(ff["lineProfileFields"]) });
          goi = pack.ok ? pack.body["goi"] ?? null : null;
        }
        const b = { ...emptyBook(), ...(book ?? {}) };
        const counts: Record<string, number> = {};
        for (const id of Object.values(b.gan)) counts[id] = (counts[id] ?? 0) + 1;
        const t = config.trongSo;
        return reply.json({
          ok: true, cauHinh: config, daLuu: stored !== null, goi, tongTrongSo: t.mucDich + t.banChan + t.tocDoCuLy + t.ruiRo + t.banDuoc,
          dong: b.dong.map((l) => ({ id: l.id, ten: l.ten, hang: l.hang, loai: l["loai"] ?? "", maMau: l["maMau"] ?? "", nguon: l["nguon"] ?? "", coDanhGia: l["danhGia"] !== null && l["danhGia"] !== undefined, danhGia: l["danhGia"] ?? null, soMa: counts[l.id] ?? 0 }))
        }, 200, NO_STORE);
      }
    },
    {
      method: "POST", path: "/api/tu-van-size/cau-hinh", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES }, bodyLimit: 64 * 1024,
      handle: async (ctx, request) => {
        const config = normaliseFitFinder(asObject(await request.json()), ctx.ports.clock.now().toISOString());
        await configDocument(ctx).write(config);
        const t = config.trongSo;
        const total = t.mucDich + t.banChan + t.tocDoCuLy + t.ruiRo + t.banDuoc;
        return reply.json({ ok: true, cauHinh: config, tongTrongSo: total, message: total === 100 ? "Đã lưu module Fit Finder." : `Đã lưu Fit Finder. Lưu ý tổng trọng số hiện là ${total}, nên chỉnh về 100 khi dùng live.` }, 200, NO_STORE);
      }
    },
    {
      // The arithmetic: foot measurement / tag cm / brand-to-brand / sock band. Pure, no knowledge needed.
      method: "POST", path: "/api/tu-van-size/tinh", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES }, bodyLimit: 8 * 1024,
      handle: async (_ctx, request) => {
        const b = asObject(await request.json());
        const hang = text(b["hang"], 40);
        if (text(b["tem"])) {
          const r = sizeFromTem(b["tem"], hang);
          return r ? reply.json({ ok: true, cach: "tem", ketQua: r }, 200, NO_STORE) : reply.json({ ok: false, error: "tem_khong_hop_le", message: "Số trên tem phải từ 21 đến 32 cm (hoặc 210–320 mm)." }, 400);
        }
        if (text(b["size"]) && text(b["sangHang"])) {
          const r = convertSizeBetweenBrands(b["size"], hang, b["sangHang"]);
          return r ? reply.json({ ok: true, cach: "doi-hang", ketQua: r }, 200, NO_STORE) : reply.json({ ok: false, error: "khong_doi_duoc", message: "Không tra được size này trong bảng của hãng." }, 400);
        }
        if (text(b["tat"])) {
          const r = sockBand(b["tat"]);
          return r ? reply.json({ ok: true, cach: "tat", ketQua: r }, 200, NO_STORE) : reply.json({ ok: false, error: "khong_doi_duoc", message: "Size tất không có trong bảng (size trẻ em ghi K…)." }, 400);
        }
        const loai = text(b["loaiGiay"], 20);
        const r = sizeFromFootMeasure({ footLength: b["dai"], footWidth: b["rong"], footGirth: b["chuVi"], shoeType: loai === "lifestyle" || loai === "court" ? loai : "running", longRun: b["chayDai"] === true, brand: hang });
        return r ? reply.json({ ok: true, cach: "do-chan", ketQua: r }, 200, NO_STORE) : reply.json({ ok: false, error: "so_do_khong_hop_le", message: "Chiều dài chân phải từ 15 đến 35 cm." }, 400);
      }
    },
    {
      method: "GET", path: "/api/tu-van-size/bang-size", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (_ctx, request) => reply.json({ ok: true, ...chartRows(request.query["hang"]) }, 200, NO_STORE)
    },
    {
      // What fits a stated pace × distance, among lines that have stock HERE. Knowledge on Xeon, stock from this shop.
      method: "POST", path: "/api/tu-van-size/goi-y-dong", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES }, bodyLimit: 8 * 1024,
      handle: async (ctx, request) => {
        const b = asObject(await request.json());
        const items = await catalogue(ctx);
        return relay(await callXeon(ctx, "/kien-thuc/dong/goi-y", {
          nhuCau: { pace: text(b["pace"], 200), cuLy: text(b["cuLy"], 200), trinhDo: text(b["trinhDo"], 20), tamGia: Number(b["tamGia"]) || 0 },
          conHang: inStockNames(items), soDong: Number(b["soDong"]) || 3
        }));
      }
    },
    {
      method: "POST", path: "/api/tu-van-size/tim-dong", access: ACCESS.admin,
      rateLimit: { calls: 300, windowMs: TEN_MINUTES }, bodyLimit: 8 * 1024,
      handle: async (ctx, request) => {
        const b = asObject(await request.json());
        return relay(await callXeon(ctx, "/kien-thuc/dong/tim", { chu: text(b["chu"], 500), conHang: inStockNames(await catalogue(ctx)) }));
      }
    },
    {
      method: "GET", path: "/api/tu-van-size/dong", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const book = { ...emptyBook(), ...((await linesDocument(ctx).read(null)) ?? {}) };
        const code = text(request.query["ma"], 80);
        if (code) {
          const id = book.gan[code] ?? "";
          return reply.json({ ok: true, ma: code, dong: book.dong.find((l) => l.id === id) ?? null }, 200, NO_STORE);
        }
        return reply.json({ ok: true, dong: book.dong, gan: book.gan }, 200, NO_STORE);
      }
    },
    {
      // "Dùng sản phẩm này làm mẫu cho cả dòng" (Desk `useAsLineTemplate`): the product's web fields become
      // the shared line; every item whose name carries a keyword joins it; Xeon keeps the profile.
      method: "POST", path: "/api/tu-van-size/dong/tu-san-pham", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES }, bodyLimit: 128 * 1024,
      handle: async (ctx, request) => {
        const b = asObject(await request.json());
        const code = text(b["ma"], 80);
        if (!code) return reply.json({ ok: false, error: "thieu_ma", message: "Chưa chọn sản phẩm." }, 400);
        const product = ctx.services["hang-kho"]?.read ? await ctx.services["hang-kho"].read(code) : null;
        if (!product) return reply.json({ ok: false, error: "khong_thay", message: `Không thấy sản phẩm ${code}.` }, 404);
        const now = ctx.ports.clock.now().toISOString();
        const tenDong = text(b["tenDong"], 200) || text(product["name"], 200);
        const line = normaliseLine({ ...b, id: lineId(tenDong), ten: tenDong, hang: text(b["hang"], 80) || text(product["brand"], 80), loai: text(product["category"], 80), maMau: code, nguon: "san-pham-mau", tuKhoa: lines(b["tuKhoa"]).length ? lines(b["tuKhoa"]) : [tenDong] }, now);
        if (!line) return reply.json({ ok: false, error: "thieu_ten_dong", message: "Cần tên dòng sản phẩm." }, 400);
        const xeon = await callXeon(ctx, "/kien-thuc/mau/tu-san-pham", { sanPham: { ...b, ma: code, tenDong, hang: line.hang, loai: line["loai"] } });
        const fromXeon = xeon.ok ? normaliseLine(asObject(xeon.body["dong"]), now) : null;
        const merged = fromXeon ? { ...fromXeon, ...line, danhGia: fromXeon["danhGia"] } : line;
        const r = await storeLines(ctx, [merged], [{ ma: code, dong: merged.id }], await catalogue(ctx));
        return reply.json({
          ok: true, dong: merged, soGan: r.soGan, xeon: xeon.ok ? "da-luu-ho-so" : xeon.viSao,
          message: `Đã lưu mẫu dòng "${merged.ten}" và gán cho ${r.soGan} sản phẩm cùng dòng.${xeon.ok ? "" : ` (Chưa gửi được hồ sơ lên Xeon: ${xeon.viSao})`}`
        }, 200, NO_STORE);
      }
    },

    // ------------------------------------------------------------ sample profiles + research (relayed to Xeon)
    ...(([
      ["/api/kien-thuc/mau", "/kien-thuc/mau", (b: Record<string, unknown>) => ({ q: text(b["q"], 120), doDay: text(b["doDay"], 20) })],
      ["/api/kien-thuc/mau/doc", "/kien-thuc/mau/doc", (b: Record<string, unknown>) => ({ id: text(b["id"], 120) })],
      ["/api/kien-thuc/mau/ghi", "/kien-thuc/mau/ghi", (b: Record<string, unknown>) => ({ mau: asObject(b["mau"]) })],
      ["/api/kien-thuc/mau/xoa", "/kien-thuc/mau/xoa", (b: Record<string, unknown>) => ({ ids: lines(b["ids"], 2000, 120) })],
      ["/api/kien-thuc/mau/gop", "/kien-thuc/mau/gop", (b: Record<string, unknown>) => ({ ids: lines(b["ids"], 200, 120), giu: text(b["giu"], 120) })],
      ["/api/kien-thuc/mau/gop-trung", "/kien-thuc/mau/gop-trung", () => ({})],
      ["/api/kien-thuc/mau/mac-dinh", "/kien-thuc/mau/mac-dinh", () => ({})],
      ["/api/kien-thuc/mau/phan-tich", "/kien-thuc/mau/phan-tich", (b: Record<string, unknown>) => ({ id: text(b["id"], 120), noiDung: text(b["noiDung"], 200_000), mau: asObject(b["mau"]) })],
      ["/api/kien-thuc/nghien-cuu/tao", "/kien-thuc/nghien-cuu/tao", (b: Record<string, unknown>) => ({ ids: lines(b["ids"], 200, 120), prompt: text(b["prompt"], 20000) })]
    ] as const).map(([path, route, pick]) => ({
      method: "POST" as const, path, access: ACCESS.admin,
      rateLimit: { calls: 240, windowMs: TEN_MINUTES }, bodyLimit: 512 * 1024,
      handle: async (ctx: Ctx, request: { json(): Promise<unknown> }) => relay(await callXeon(ctx, route, pick(asObject(await request.json()))))
    }))),
    {
      method: "POST", path: "/api/kien-thuc/nghien-cuu/chay", access: ACCESS.admin,
      rateLimit: { calls: 30, windowMs: TEN_MINUTES }, bodyLimit: 4 * 1024,
      handle: async (ctx, request) => {
        const b = asObject(await request.json());
        return relay(await callXeon(ctx, "/kien-thuc/nghien-cuu/chay", { toiDa: Math.max(1, Math.min(10, Number(b["toiDa"]) || 3)) }, XEON_SLOW));
      }
    },
    {
      // "Gộp dòng kho thành mẫu": the catalogue goes up (codes, names, brands only — no prices, no stock).
      method: "POST", path: "/api/kien-thuc/mau/gop-kho", access: ACCESS.admin,
      rateLimit: { calls: 30, windowMs: TEN_MINUTES }, bodyLimit: 4 * 1024,
      handle: async (ctx) => relay(await callXeon(ctx, "/kien-thuc/mau/gop-kho", { sanPham: forXeon(await catalogue(ctx)) }, XEON_SLOW))
    },
    {
      // "Áp vào Fit Finder/Catalog": Xeon turns every profile into a line; the lines and assignments are kept here.
      method: "POST", path: "/api/kien-thuc/mau/xuat-ban", access: ACCESS.admin,
      rateLimit: { calls: 30, windowMs: TEN_MINUTES }, bodyLimit: 4 * 1024,
      handle: async (ctx) => {
        const items = await catalogue(ctx);
        const r = await callXeon(ctx, "/kien-thuc/mau/xuat-ban", { sanPham: forXeon(items) }, XEON_SLOW);
        if (!r.ok) return relay(r);
        const now = ctx.ports.clock.now().toISOString();
        const incoming = (Array.isArray(r.body["dong"]) ? r.body["dong"] : []).map((l) => normaliseLine(asObject(l), now)).filter((l): l is ProductLine => l !== null);
        const explicit = (Array.isArray(r.body["gan"]) ? r.body["gan"] : []).map((g) => ({ ma: text(asObject(g)["ma"], 80), dong: text(asObject(g)["dong"], 160) }));
        const stored = await storeLines(ctx, incoming, explicit, []);
        ctx.ports.logger.info(`[tu-van-size] ap ${stored.soDong} dong mau, gan ${stored.soGan} san pham`);
        return reply.json({ ok: true, soDong: stored.soDong, soGan: stored.soGan, message: `Đã áp ${stored.soDong} dòng mẫu và gán profile cho ${stored.soGan} sản phẩm match keyword.` }, 200, NO_STORE);
      }
    },
    {
      // "Chấm tham khảo" on the partner stock screen (Desk: RunRepeat taxonomy) — classification rules are on Xeon.
      method: "POST", path: "/api/kien-thuc/cham-dong", access: ACCESS.admin,
      rateLimit: { calls: 30, windowMs: TEN_MINUTES }, bodyLimit: 4 * 1024,
      handle: async (ctx, request) => {
        const b = asObject(await request.json());
        const source = text(b["nguon"], 20);
        const items = (await catalogue(ctx)).filter((i) => !source || text(i.source) === source);
        return relay(await callXeon(ctx, "/kien-thuc/cham-dong", { sanPham: forXeon(items).slice(0, 5000) }, XEON_SLOW));
      }
    }
  ],

  botTools: []
});
