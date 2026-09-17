/**
 * Đ9 — the landing's half of "Kiến thức ngành + kênh": Fit Finder arithmetic and settings (`tu-van-size`),
 * product lines kept here while sample profiles live on Xeon (relayed with the inbox token), Website
 * Channels (pixels + SEO readiness, `thong-ke`), SMTP per shop with a test button (`khung-nen-tang`).
 * Fake Xeon, fake catalogue, memory mailers: no network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLE, defineModule, type HttpRequestInit, type IncomingRequest, type Mailer, type MailMessage } from "../dist/contract/index.js";
import {
  FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, MemoryMailer, ShopSettingsMailer, TokenAuth, TrialModeMailer, jsonResponse
} from "../dist/kernel/index.js";
import { manifest as sizeAdvice } from "../dist/modules/tu-van-size/module.js";
import { manifest as analytics } from "../dist/modules/thong-ke/module.js";
import { manifest as platform } from "../dist/modules/khung-nen-tang/module.js";
import { convertSizeBetweenBrands, sizeFromFootMeasure, sizeFromTem, sockBand } from "../dist/modules/tu-van-size/size-chart.js";
import { seoReadiness, channelFrom } from "../dist/modules/thong-ke/website-channels.js";

const ADMIN = "ma-quan-tri-d9";
const T0 = new Date("2026-09-17T08:00:00.000Z");
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

const CATALOGUE = [
  { code: "JP1", name: "adidas Adizero Boston 13", brand: "adidas", category: "Running", source: "own", status: "orderable", price: 3200000, thumbnailImage: "/a.jpg", seoTitle: "Boston 13", seoDescription: "Giày tempo", sizes: [{ size: "42", qty: 2 }] },
  { code: "JP2", name: "adidas Adizero Boston 13 đen", brand: "adidas", category: "Running", source: "own", status: "orderable", price: 3200000, thumbnailImage: "", sizes: [{ size: "42", qty: 0 }] },
  { code: "NK1", name: "Nike Pegasus 41", brand: "", category: "Running", source: "partner", status: "orderable", price: 0, thumbnailImage: "/n.jpg", sizes: [{ size: "43", qty: 1 }] },
  { code: "AN1", name: "Mẫu ẩn Boston 13", brand: "adidas", category: "Running", source: "own", status: "hidden", price: 1, thumbnailImage: "/x.jpg", sizes: [{ size: "40", qty: 5 }] }
];

type XeonAnswer = (route: string, body: Body) => { status?: number; body: Body } | undefined;

function build({ xeon = (() => undefined) as XeonAnswer, registered = true, mail = new MemoryMailer() as Mailer } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "d9-"));
  const logger = new MemoryLogger();
  const clock = new ManualClock(T0);
  const calls: { route: string; body: Body; auth: string }[] = [];
  const http = new FakeHttpClient((url: string, init: HttpRequestInit) => {
    const route = url.replace("https://xeon.test", "");
    const body = JSON.parse(String(init.body ?? "{}")) as Body;
    calls.push({ route, body, auth: String((init.headers as Record<string, string>)?.["Authorization"] ?? "") });
    const custom = xeon(route, body);
    if (custom) return jsonResponse(custom.body, custom.status ?? 200);
    if (route === "/kien-thuc/goi") return jsonResponse({ ok: true, goi: { id: "giay-chay", ten: "Giày chạy" }, fitFinder: { customerInputs: ["Chiều dài chân", "Cự ly thường chạy"], lineProfileFields: ["Độ êm"] } });
    return jsonResponse({ ok: true, echo: route });
  });
  const fakePlatform = defineModule({
    id: "khung-nen-tang", name: "Nền giả", tier: "khung", runsOn: "server-khach", version: "0.0.1",
    provides: { "khung-nen-tang.xeon": async () => (registered ? { shop: "toprun", diaChiXeon: "https://xeon.test", maNhanTin: "ma-nhan-tin" } : null) }
  });
  const catalogue = defineModule({
    id: "hang-kho", name: "Kho giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
    provides: {
      "hang-kho.search": async () => CATALOGUE,
      "hang-kho.read": async (_ctx: unknown, key: string) => CATALOGUE.find((i) => i.code === key) ?? null
    }
  });
  const kernel = new Kernel({
    ports: {
      store: new JsonFileStore(directory, logger), logger, clock, http, mail, rateLimiter: new FixedWindowRateLimiter(clock),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock })
    },
    logger,
    modules: [sizeAdvice, analytics, fakePlatform, catalogue],
    config: { "thong-ke": { attributionSecret: "" } }
  });
  const call = async (method: string, p: string, body?: unknown, token: string | null = ADMIN) => {
    const [pathname, search = ""] = p.split("?");
    const r = await kernel.handle({ method, path: pathname!, query: Object.fromEntries(new URLSearchParams(search)), ip: "1.1.1.1", headers: token ? { authorization: `Bearer ${token}` } : {}, json: async () => body ?? {} } as IncomingRequest);
    return { status: r.status, body: r.body as Body };
  };
  return { call, calls, logger };
}

test("size arithmetic (Desk size_chart.js): running +1.5 cm, width wins upward, the tag maps straight, court is a range, brands meet at the tag", () => {
  assert.equal(sizeFromFootMeasure({ footLength: 25 })?.size, "42");
  assert.equal(sizeFromFootMeasure({ footLength: 23.5, footWidth: 9.8 })?.size, "40 2/3", "width at the top of a band still takes the higher size");
  assert.equal(sizeFromFootMeasure({ footLength: 25, longRun: true })?.size, "42 2/3");
  assert.equal(sizeFromFootMeasure({ footLength: 25, shoeType: "lifestyle" })?.tem, 25.5);
  const court = sizeFromFootMeasure({ footLength: 25.5, shoeType: "court" });
  assert.equal(court?.sizeLow, "41 1/3");
  assert.equal(court?.size, "42", "court never borrows the running +1.5 cm (42 2/3)");
  assert.equal(sizeFromTem("26,5")?.size, "42");
  assert.equal(sizeFromTem("265")?.size, "42", "millimetres read off the tag");
  assert.equal(sizeFromFootMeasure({ footLength: 50 }), null);
  assert.equal(convertSizeBetweenBrands("42", "nike", "adidas")?.to.size, "42");
  assert.equal(sizeFromFootMeasure({ footLength: 25, brand: "asics" })?.size, "26.5cm");
  assert.equal(sockBand("3942")?.letter, "M");
  assert.equal(sockBand("KM"), null);
});

test("Fit Finder settings: defaults take the industry's questions from Xeon; weights not adding to 100 are saved with a warning", async () => {
  const { call, calls } = build();
  const first = await call("GET", "/api/tu-van-size/cau-hinh");
  assert.equal(first.status, 200);
  assert.equal(first.body.daLuu, false);
  assert.deepEqual(first.body.cauHinh.bienKhach, ["Chiều dài chân", "Cự ly thường chạy"]);
  assert.equal(first.body.tongTrongSo, 100);
  assert.equal(calls[0]!.auth, "Bearer ma-nhan-tin");
  const saved = await call("POST", "/api/tu-van-size/cau-hinh", { maModule: "SHOP FIT", tenNoiBo: "Fit", trangThai: "live", trongSo: { mucDich: 30, banChan: 25, tocDoCuLy: 20, ruiRo: 15, banDuoc: 15 }, bienKhach: "Vòm chân\nCân nặng" });
  assert.equal(saved.body.cauHinh.maModule, "SHOP_FIT");
  assert.deepEqual(saved.body.cauHinh.bienKhach, ["Vòm chân", "Cân nặng"]);
  assert.match(saved.body.message, /tổng trọng số hiện là 105/);
  const again = await call("GET", "/api/tu-van-size/cau-hinh");
  assert.equal(again.body.daLuu, true);
  assert.equal(calls.filter((c) => c.route === "/kien-thuc/goi").length, 1, "saved settings do not ask Xeon again");
  assert.equal((await call("GET", "/api/tu-van-size/cau-hinh", undefined, null)).status, 401);

  const measured = await call("POST", "/api/tu-van-size/tinh", { dai: 25, rong: 10.3, hang: "adidas" });
  assert.equal(measured.body.cach, "do-chan");
  assert.equal(measured.body.ketQua.size, "42");
  assert.equal((await call("POST", "/api/tu-van-size/tinh", { tem: "26.5" })).body.ketQua.size, "42");
  assert.equal((await call("POST", "/api/tu-van-size/tinh", { size: "42", hang: "nike", sangHang: "adidas" })).body.cach, "doi-hang");
  assert.equal((await call("POST", "/api/tu-van-size/tinh", { dai: 5 })).status, 400);
  assert.equal((await call("GET", "/api/tu-van-size/bang-size?hang=hoka")).body.brand, "hoka");
});

test("line knowledge: stock from this shop, knowledge from Xeon; publishing keeps lines and assignments here; a product can become its line's template", async () => {
  const LINE = { id: "boston-13", ten: "Adizero Boston 13", hang: "adidas", tuKhoa: ["Boston 13"], danhGia: { thongSo: { drop: "6mm" } } };
  const { call, calls } = build({
    xeon: (route, body) => {
      if (route === "/kien-thuc/mau/xuat-ban") return { body: { ok: true, dong: [LINE, { id: "pegasus-41", ten: "Nike Pegasus 41", tuKhoa: ["Pegasus 41"] }], gan: [{ ma: "JP1", dong: "boston-13" }, { ma: "NK1", dong: "pegasus-41" }], soMau: 2 } };
      if (route === "/kien-thuc/mau/tu-san-pham") return { body: { ok: true, mau: {}, dong: { ...LINE, id: "adizero-boston-13", ten: body["sanPham"].tenDong } } };
      if (route === "/kien-thuc/mau/gop") return { status: 400, body: { ok: false, error: "mau_giu_chua_chon", message: "Mở mẫu muốn giữ lại trước" } };
      return undefined;
    }
  });
  await call("POST", "/api/tu-van-size/goi-y-dong", { pace: "5:30", cuLy: "10km", trinhDo: "new" });
  const rec = calls.find((c) => c.route === "/kien-thuc/dong/goi-y")!;
  assert.deepEqual(rec.body.conHang, ["adidas Adizero Boston 13", "Nike Pegasus 41"], "only visible items with a size in stock");
  assert.deepEqual(rec.body.nhuCau, { pace: "5:30", cuLy: "10km", trinhDo: "new", tamGia: 0 });

  const pub = await call("POST", "/api/kien-thuc/mau/xuat-ban", {});
  assert.equal(pub.status, 200);
  assert.equal(pub.body.soGan, 2);
  const sent = calls.find((c) => c.route === "/kien-thuc/mau/xuat-ban")!;
  assert.deepEqual(Object.keys(sent.body.sanPham[0]).sort(), ["hang", "loai", "ma", "nguon", "ten"], "no price, no stock leaves for Xeon");
  const one = await call("GET", "/api/tu-van-size/dong?ma=JP1");
  assert.equal(one.body.dong.id, "boston-13");
  assert.deepEqual(one.body.dong.danhGia, { thongSo: { drop: "6mm" } });
  const cfg = await call("GET", "/api/tu-van-size/cau-hinh");
  assert.equal(cfg.body.dong.find((l: Body) => l.id === "boston-13").soMa, 1);

  const template = await call("POST", "/api/tu-van-size/dong/tu-san-pham", { ma: "JP1", tenDong: "Adizero Boston 13", tuKhoa: "Boston 13", phuHop: "Tempo" });
  assert.equal(template.status, 200);
  assert.equal(template.body.dong.id, "adizero-boston-13");
  assert.equal(template.body.soGan, 3, "the product itself plus every item carrying the keyword (the hidden one too)");
  assert.equal(calls.find((c) => c.route === "/kien-thuc/mau/tu-san-pham")!.body.sanPham.ma, "JP1");
  assert.equal((await call("POST", "/api/tu-van-size/dong/tu-san-pham", { ma: "KHONG" })).status, 404);

  const refused = await call("POST", "/api/kien-thuc/mau/gop", { ids: ["a", "b"], giu: "c" });
  assert.equal(refused.status, 400);
  assert.match(refused.body.message, /Mở mẫu/);
  await call("POST", "/api/kien-thuc/mau/phan-tich", { id: "boston-13", noiDung: "Drop: 6mm", mau: { id: "boston-13" } });
  assert.deepEqual(calls.find((c) => c.route === "/kien-thuc/mau/phan-tich")!.body, { id: "boston-13", noiDung: "Drop: 6mm", mau: { id: "boston-13" } });
  await call("POST", "/api/kien-thuc/mau/gop-kho", {});
  assert.equal(calls.find((c) => c.route === "/kien-thuc/mau/gop-kho")!.body.sanPham.length, 4);
  await call("POST", "/api/kien-thuc/cham-dong", { nguon: "partner" });
  assert.deepEqual(calls.find((c) => c.route === "/kien-thuc/cham-dong")!.body.sanPham.map((p: Body) => p.ma), ["NK1"]);
  await call("POST", "/api/kien-thuc/nghien-cuu/chay", { toiDa: 99 });
  assert.equal(calls.find((c) => c.route === "/kien-thuc/nghien-cuu/chay")!.body.toiDa, 10);

  const offline = build({ registered: false });
  const r = await offline.call("POST", "/api/kien-thuc/mau", {});
  assert.equal(r.status, 503);
  assert.match(r.body.message, /chưa đăng ký với Xeon/);
});

test("Website Channels: default channel, strict pixel ids, rename on edit, the storefront reads the active channel's pixels; SEO readiness from the catalogue", async () => {
  const { call } = build();
  const first = await call("GET", "/api/kenh-web");
  assert.equal(first.body.kenh.length, 1);
  assert.equal(first.body.seo.congKhai, 3, "hidden items do not count");
  assert.equal(first.body.seo.thieuHang, 1);
  assert.equal(first.body.seo.thieuAnh, 1);
  assert.equal(first.body.seo.duNen, 1);
  assert.equal(first.body.seo.diem, 33);
  assert.equal((await call("POST", "/api/kenh-web", { ten: "Chạy bộ", ga4: "UA-123" })).status, 400);
  assert.equal((await call("POST", "/api/kenh-web", { ten: "Chạy bộ", metaPixel: "abc" })).status, 400);
  const created = await call("POST", "/api/kenh-web", { ten: "Chạy bộ Store", ma: "", diaChi: "https://chay.vn", nganh: "running, trail", trangThai: "planned", ga4: "g-abc1234", metaPixel: "123456789012", tiktokPixel: "c4abcdefghij" });
  assert.equal(created.status, 200);
  assert.equal(created.body.kenh[0].id, "chay-bo-store");
  assert.equal(created.body.kenh[0].tracking.ga4MeasurementId, "G-ABC1234");
  assert.deepEqual(created.body.kenh[0].industries, ["running", "trail"]);
  const edited = await call("POST", "/api/kenh-web", { sua: "chinh", ten: "TopRun", ma: "toprun", trangThai: "active", ga4: "G-MAIN999", metaPixel: "" });
  assert.equal(edited.body.kenh.length, 2);
  assert.ok(edited.body.kenh.some((c: Body) => c.id === "toprun"));
  assert.equal((await call("POST", "/api/kenh-web", { sua: "toprun", ten: "Trùng", ma: "chay-bo-store" })).status, 400);
  const pixels = await call("GET", "/api/kenh-web/theo-doi", undefined, null);
  assert.equal(pixels.status, 200, "public: a customer's browser has no token");
  assert.deepEqual(pixels.body, { ok: true, kenh: "toprun", ga4MeasurementId: "G-MAIN999", metaPixelId: "", tiktokPixelId: "" });
  assert.throws(() => channelFrom({ ten: "x", diaChi: "javascript:alert(1)" }, ""), /Domain/);
  assert.equal(seoReadiness([]).diem, 0);
});

test("SMTP per shop: the shop's settings win over .env, a change needs no restart, and the test button says which SMTP answered", async () => {
  let settings: Record<string, string> = {};
  const built: string[] = [];
  const fallback = new MemoryMailer();
  const mailer = new ShopSettingsMailer(async () => settings, fallback, new MemoryLogger(), (s) => {
    built.push(s.host);
    return { send: async (m: MailMessage) => ({ ok: m.to !== "loi@shop.vn", configured: true }) };
  });
  await mailer.send({ to: "a@b.vn", subject: "x", text: "y" });
  assert.equal(fallback.sent.length, 1, "no shop SMTP: the .env mailer sends");
  settings = { smtp_host: "smtp.shop.vn", smtp_user: "u", smtp_pass: "p" };
  assert.equal((await mailer.send({ to: "a@b.vn", subject: "x", text: "y" })).ok, true);
  await mailer.send({ to: "a@b.vn", subject: "x", text: "y" });
  assert.deepEqual(built, ["smtp.shop.vn"], "one transporter while settings stay the same");
  settings = { ...settings, smtp_host: "smtp2.shop.vn" };
  await mailer.send({ to: "a@b.vn", subject: "x", text: "y" });
  assert.deepEqual(built, ["smtp.shop.vn", "smtp2.shop.vn"], "a changed setting is picked up on the next e-mail");
  assert.equal(await mailer.source(), "shop");

  const memory = new MemoryMailer();
  const logger = new MemoryLogger();
  const clock = new ManualClock(T0);
  const kernelWith = (mail: Mailer) => new Kernel({
    ports: { store: new JsonFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "d9-mail-")), logger), logger, clock, http: new FakeHttpClient(), mail, rateLimiter: new FixedWindowRateLimiter(clock), auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }) },
    logger, modules: [platform], config: { "khung-nen-tang": { deployId: "thu", xeonAddress: "", landingAddress: "" } }
  });
  const post = async (kernel: InstanceType<typeof Kernel>, p: string, body: unknown) => {
    const r = await kernel.handle({ method: "POST", path: p, query: {}, ip: "1.1.1.1", headers: { authorization: `Bearer ${ADMIN}` }, json: async () => body } as IncomingRequest);
    return { status: r.status, body: r.body as Body };
  };
  const k = kernelWith(memory);
  const saved = await post(k, "/api/admin/cau-hinh", { giaTri: { smtp_host: "smtp.gmail.com", smtp_user: "shop@gmail.com", smtp_pass: "matkhauungdung", smtp_port: "465", smtp_secure: "1" } });
  const group = saved.body.nhom.find((g: Body) => g.ma === "email");
  assert.equal(group.muc.find((m: Body) => m.khoa === "smtp_pass").giaTri, "", "the SMTP password never comes back");
  assert.equal((await post(k, "/api/admin/cau-hinh/thu-email", { den: "khong-phai-email" })).status, 400);
  const sent = await post(k, "/api/admin/cau-hinh/thu-email", { den: "chu@shop.vn" });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.nguon, "shop");
  assert.equal(memory.sent[0]!.to, "chu@shop.vn");
  const trial = await post(kernelWith(new TrialModeMailer(logger)), "/api/admin/cau-hinh/thu-email", { den: "chu@shop.vn" });
  assert.equal(trial.status, 409);
  assert.match(trial.body.message, /CHẾ ĐỘ THỬ/);
});

test("Video Studio ticket: the landing asks its Xeon with the inbox token and only passes on a studio address with a VS1 ticket", async () => {
  const { saveXeonRegistration } = await import("../dist/modules/khung-nen-tang/xeon-registration.js");
  const logger = new MemoryLogger();
  const clock = new ManualClock(T0);
  let answer: { status: number; body: Body } = { status: 200, body: { ok: true, diaChi: "https://video.test/video-studio/?ve=VS1.abc.def", hetLuc: "2026-09-17T08:05:00.000Z" } };
  const seen: { url: string; auth: string }[] = [];
  const store = new JsonFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "d9-video-")), logger);
  const kernel = new Kernel({
    ports: {
      store, logger, clock, mail: new MemoryMailer(), rateLimiter: new FixedWindowRateLimiter(clock), auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      http: new FakeHttpClient((url: string, init: HttpRequestInit) => { seen.push({ url, auth: String((init.headers as Record<string, string>)?.["Authorization"] ?? "") }); return jsonResponse(answer.body, answer.status); })
    },
    logger, modules: [platform], config: { "khung-nen-tang": { deployId: "thu", xeonAddress: "", landingAddress: "" } }
  });
  const post = async () => {
    const r = await kernel.handle({ method: "POST", path: "/api/admin/video-studio/ve", query: {}, ip: "1.1.1.1", headers: { authorization: `Bearer ${ADMIN}` }, json: async () => ({}) } as IncomingRequest);
    return { status: r.status, body: r.body as Body };
  };
  assert.equal((await post()).status, 503, "not registered with Xeon");
  await saveXeonRegistration(store, { key: "TR-AAAA-BBBB-CCCC-DDDD", shop: "toprun", tenShop: "TopRun", keyId: "ky-1", khoaCongPem: "pem", maNhanTin: "ma-nhan-tin", diaChiXeon: "https://xeon.test", diaChiLanding: "https://shop.test" }, T0);
  const ok = await post();
  assert.equal(ok.status, 200);
  assert.equal(ok.body.diaChi, "https://video.test/video-studio/?ve=VS1.abc.def");
  assert.deepEqual(seen[0], { url: "https://xeon.test/video/ve", auth: "Bearer ma-nhan-tin" });
  answer = { status: 200, body: { ok: true, diaChi: "https://evil.test/login" } };
  assert.equal((await post()).status, 502, "anything but a studio address with a ticket is not passed to OMI");
  answer = { status: 503, body: { ok: false, error: "video_chua_bat", message: "Video Studio chưa bật trên Xeon" } };
  const off = await post();
  assert.equal(off.status, 503);
  assert.match(off.body.message, /chưa bật/);
});
