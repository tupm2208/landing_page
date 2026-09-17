/**
 * Đ8 — Content đăng thật, the landing's half: `dang-bai` really publishes and schedules on Meta
 * (fake Graph API), an album needs 5 pictures, first comments with tags, link comments under new
 * posts, product cards and covers rendered with sharp in the shop's brand; `xuong-noi-dung` runs a
 * whole batch through Xeon (fake), keeps topics, ranks the code pool, schedules chosen posts for
 * real, and keeps the library, styles and trend cards. No network, no key.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { ROLE, defineModule, type HttpRequestInit, type IncomingRequest } from "../dist/contract/index.js";
import { FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, MemoryUploadPort, TokenAuth, jsonResponse } from "../dist/kernel/index.js";
import { manifest as inbox } from "../dist/modules/hop-thu/module.js";
import { manifest as publishing } from "../dist/modules/dang-bai/module.js";
import { manifest as studio } from "../dist/modules/xuong-noi-dung/module.js";
import { imageCountError, renderTags } from "../dist/modules/dang-bai/publish-jobs.js";
import { pickSeedTopic, pickSeedVariant } from "../dist/modules/dang-bai/seed-comments.js";
import { coverSvg, cleanBrand } from "../dist/modules/dang-bai/card-renderer.js";
import { clampHot, modelLineOf } from "../dist/modules/xuong-noi-dung/trends.js";
import { detectAngle, emptyIndex, priorityScore } from "../dist/modules/xuong-noi-dung/priority.js";

const ADMIN = "ma-quan-tri-d8";
const SITE = "https://shop.test";
const TOKEN = "tk-trang-bi-mat";
const T0 = new Date("2026-09-19T00:00:00.000Z");
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

const JPEG = await sharp({ create: { width: 60, height: 60, channels: 3, background: "#dddddd" } }).jpeg().toBuffer();
const filler = "Đôi này đế êm, ôm chân vừa phải, đi bộ dài hay chạy nhẹ đều hợp. ".repeat(20);
const GOOD_HOOK = "BA ĐÔI ĐÁNG CÂN NHẮC cho người mới chạy";
const GOOD = { caption: `${GOOD_HOOK}\n${filler}`.slice(0, 2100), chuAnh: "BA ĐÔI ĐÁNG CÂN NHẮC", comment: `Xem ở ${SITE}/a, inbox em nhé` };

const PRODUCTS = Array.from({ length: 14 }, (_, i) => ({
  code: `M${String(i + 1).padStart(2, "0")}`, name: `Giày chạy Mẫu ${i + 1}`, brand: i % 2 ? "Asics" : "Adidas", category: "Running", slug: `mau-${i + 1}`,
  sizes: [{ size: "41", qty: 2 }, { size: "42", qty: i === 3 ? 0 : 1 }, { size: "43", qty: 1 }], price: 1_000_000, salePrice: 1_000_000 - i * 10_000, listPrice: 2_000_000,
  discountPercent: i === 5 ? 55 : 10, thumbnailImage: `/api/hang-kho/anh/m${i + 1}.jpg`, highImage: "", galleryImages: [`/api/hang-kho/anh/m${i + 1}-a.jpg`, `/api/hang-kho/anh/m${i + 1}-b.jpg`],
  partnerCampaign: false, source: "own", productKind: "Giày", status: "active"
}));

interface Seen { url: string; init: HttpRequestInit; form: URLSearchParams; json: Body | null }

function build({ graph = (() => undefined) as (s: Seen) => unknown, xeon = (() => undefined) as (s: Seen) => unknown } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dang-bai-"));
  const logger = new MemoryLogger();
  const clock = new ManualClock(T0);
  const seen: Seen[] = [];
  let photo = 0;
  const http = new FakeHttpClient((url: string, init: HttpRequestInit) => {
    const body = String(init.body ?? "");
    const s: Seen = { url, init, form: new URLSearchParams(url.includes("?") && !body ? url.split("?")[1] : body), json: body.startsWith("{") ? JSON.parse(body) as Body : null };
    seen.push(s);
    if (url.startsWith(`${SITE}/api/hang-kho/anh/`)) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => "", arrayBuffer: async () => JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.length) as ArrayBuffer };
    }
    if (url.startsWith("https://graph.facebook.com/")) {
      const custom = graph(s) as { __status?: number } | undefined;
      if (custom !== undefined) return jsonResponse(custom, custom.__status ?? 200);
      if (url.includes("/photos")) return jsonResponse({ id: `ph_${++photo}` });
      if (url.includes("/feed")) return jsonResponse({ id: "trang-1_901", post_id: "trang-1_901" });
      if (url.includes("/comments")) return jsonResponse({ id: "binh-luan-1" });
      if (url.includes("/insights")) return jsonResponse({ data: [{ values: [{ value: 400 }] }] });
      if (url.includes("published_posts")) return jsonResponse({ data: [] });
      if (init.method === "GET") return jsonResponse({ is_published: true, permalink_url: "https://facebook.com/901", created_time: "2026-09-19T03:00:00+0000", shares: { count: 2 }, reactions: { summary: { total_count: 30 } }, comments: { summary: { total_count: 4 } } });
      return jsonResponse({ success: true });
    }
    if (url.startsWith("https://xeon.test/")) {
      const custom = xeon(s);
      if (custom !== undefined) return jsonResponse(custom);
      if (url.endsWith("/viet-bai")) return jsonResponse({ ok: true, ban: GOOD, model: "script" });
      if (url.endsWith("/noi-dung/phan-bien")) return jsonResponse({ ok: true, dat: true, chuyenMon: { diem: 8 }, giong: { diem: 8 }, dangBai: { diem: 9 }, ghiChu: ["Chuyên môn 8/10. ổn"] });
      if (url.endsWith("/noi-dung/toi-uu")) return jsonResponse({ ok: true, caption: GOOD.caption, chuAnh: GOOD.chuAnh });
      if (url.endsWith("/noi-dung/xu-huong")) return jsonResponse({ ok: true, dong: [] });
    }
    throw new Error(`no fake for ${url}`);
  });
  const store = new JsonFileStore(directory, logger);
  const platform = defineModule({
    id: "khung-nen-tang", name: "Nền giả", tier: "khung", runsOn: "server-khach", version: "0.0.1",
    provides: { "khung-nen-tang.xeon": async () => ({ shop: "toprun", diaChiXeon: "https://xeon.test", maNhanTin: "ma-nhan-tin" }) }
  });
  const catalogue = defineModule({
    id: "hang-kho", name: "Kho giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
    provides: {
      "hang-kho.search": async () => PRODUCTS.map((p) => ({ ...p })),
      "hang-kho.read": async (_ctx: unknown, code: string) => PRODUCTS.find((p) => p.code === code) ?? null
    }
  });
  const uploads = new MemoryUploadPort();
  const kernel = new Kernel({
    ports: { store, logger, clock, http, uploads, rateLimiter: new FixedWindowRateLimiter(clock), auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }) },
    logger,
    modules: [inbox, publishing, studio, platform, catalogue],
    config: { "hop-thu": { verifyToken: "", appSecret: "", pageToken: "" }, "dang-bai": { siteUrl: SITE, attributionSecret: "bi-mat-gan-nguon" }, "xuong-noi-dung": { siteUrl: SITE }, "hang-kho": {} }
  });
  const call = async (method: string, p: string, body?: unknown, { token = ADMIN } = {}) => {
    const [pathname, search = ""] = p.split("?");
    return kernel.handle({ method, path: pathname!, query: Object.fromEntries(new URLSearchParams(search)), ip: "1.1.1.1", headers: token ? { authorization: `Bearer ${token}` } : {}, json: async () => body ?? {} } as IncomingRequest);
  };
  const connectPage = () => store.document("hop-thu-trang").write({ version: 1, graph: "v21.0", trang: [{ ma: "trang-1", ten: "TopRun", token: TOKEN, capLuc: "" }], updatedAt: "" });
  const graphCalls = () => seen.filter((s) => s.url.startsWith("https://graph.facebook.com/"));
  return { call, clock, seen, graphCalls, connectPage, uploads, logger };
}

const b = (r: { body?: unknown }) => r.body as Body;
const later = (hours: number) => new Date(T0.getTime() + hours * 3600_000).toISOString();
const FIVE = ["/api/dang-bai/anh/a.jpg", "/api/dang-bai/anh/b.jpg", "https://cdn.test/c.jpg", "https://cdn.test/d.jpg", "https://cdn.test/e.jpg"];

test("pure rules: 5 pictures or none, tags, topics by whole words, rotation, the hot clamp, angles", () => {
  assert.equal(imageCountError([]), "", "bài chữ vẫn hợp lệ");
  assert.match(imageCountError(["a", "b"]), /tối thiểu 5 ảnh/);
  assert.equal(imageCountError(FIVE), "");
  assert.equal(renderTags("Xem {PRODUCT_NAME} tại {PRODUCT_LINK} · {PAGE_NAME}", { shopLink: SITE, productLink: "", productName: "Boston", productCode: "B1", pageName: "TopRun" }), `Xem Boston tại ${SITE} · TopRun`, "không có link sản phẩm thì dùng link shop");
  const topics = [{ id: "chay", label: "giày chạy bộ", keywords: ["chạy bộ"], link: `${SITE}/?q=chay` }, { id: "all", label: "tất cả", keywords: [], link: SITE }];
  assert.equal(pickSeedTopic("Ba đôi CHẠY BỘ cho người mới", topics)?.id, "chay");
  assert.equal(pickSeedTopic("chạy bộc phát", topics), null, "khớp trọn từ, không khớp nửa chữ");
  assert.deepEqual([pickSeedVariant(["a", "b"], 0).template, pickSeedVariant(["a", "b"], 1).template, pickSeedVariant(["a", "b"], 2).template], ["a", "b", "a"]);
  assert.deepEqual(clampHot(10, 20), { value: 15, clamped: true }, "một lần nghiên cứu chỉ nhích ±5");
  assert.equal(clampHot(null, 18).value, 18);
  assert.equal(modelLineOf("Giày chạy nam Adidas Adizero Boston 13", "Adidas"), "chay adizero");
  assert.equal(detectAngle("Giày cho người mới tập chạy"), "nguoi_moi");
  const index = emptyIndex(T0.getTime());
  const row = { code: "X", name: "x", brand: "", category: "", salePrice: 1, listPrice: 2, discountPercent: 50, sizeCount: 8, imageCount: 5, galleryReady: true };
  const fresh = priorityScore(row, index).score;
  index.lastPostedAt.set("X", T0.getTime() - 3600_000);
  assert.ok(priorityScore(row, index).score < fresh, "vừa lên bài thì hạ điểm để xoay vòng");
  assert.ok(priorityScore({ ...row, sizeCount: 1 }, emptyIndex(T0.getTime())).score < fresh, "còn một size thì không đẩy mạnh");
  assert.doesNotMatch(coverSvg({ main: "<script>" }, cleanBrand({}, SITE)), /<script>/, "chữ trên ảnh được thoát ký tự");
  assert.equal(cleanBrand({ mauNhan: "đỏ", tenHienThi: "SHOP HAI" }, SITE).mauNhan, "#FF7022", "màu sai thì về mặc định");
});

test("dang-bai: draft never calls Meta; schedule is refused under 5 pictures and too close; a real schedule uploads the album and asks Meta to keep it", async () => {
  const { call, graphCalls, connectPage } = build();
  const draft = await call("POST", "/api/dang-bai/bai", { mode: "draft", noiDung: "nháp" });
  assert.equal(draft.status, 200, JSON.stringify(b(draft)));
  assert.equal(b(draft)["job"]["trangThai"], "draft");
  assert.equal(graphCalls().length, 0);

  await connectPage();
  assert.equal((await call("POST", "/api/dang-bai/bai", { mode: "schedule", trang: "trang-1", noiDung: "x", anh: FIVE.slice(0, 3), lichDang: later(5) })).status, 400);
  const tooClose = await call("POST", "/api/dang-bai/bai", { mode: "schedule", trang: "trang-1", noiDung: "x", anh: FIVE, lichDang: later(0.1) });
  assert.match(String(b(tooClose)["message"]), /10 phút/);
  assert.equal(graphCalls().length, 0, "bị từ chối thì không tải nửa album lên Meta");

  const r = await call("POST", "/api/dang-bai/bai", { mode: "schedule", trang: "trang-1", noiDung: "Bài lên lịch", anh: FIVE, lichDang: later(5), binhLuan: { cheDo: "template", mauId: "mau_shop" }, nguon: { maSP: ["M01"] } });
  assert.equal(r.status, 200, JSON.stringify(b(r)));
  const job = b(r)["job"];
  assert.equal(job["trangThai"], "scheduled");
  assert.equal(job["binhLuan"]["trangThai"], "pending", "comment chờ bài lên sóng");
  const photos = graphCalls().filter((s) => s.url.includes("/trang-1/photos"));
  assert.equal(photos.length, 5);
  assert.equal(photos[0]!.form.get("url"), `${SITE}/api/dang-bai/anh/a.jpg`, "Meta tải ảnh bằng địa chỉ tuyệt đối của landing");
  assert.equal(photos[0]!.form.get("published"), "false");
  const feed = graphCalls().find((s) => s.url.endsWith("/trang-1/feed"))!;
  assert.equal(feed.form.get("scheduled_publish_time"), String(Math.floor(Date.parse(later(5)) / 1000)));
  assert.equal(JSON.parse(feed.form.get("attached_media")!).length, 5);
  assert.ok(!JSON.stringify(b(r)).includes(TOKEN), "token trang không bao giờ ra ngoài");

  const edited = await call("PUT", `/api/dang-bai/bai/${job["id"]}`, { noiDung: "Chữ mới", anh: FIVE, lichDang: job["lichDang"], binhLuan: { cheDo: "template", mauId: "mau_shop" } });
  assert.equal(edited.status, 200, JSON.stringify(b(edited)));
  const update = graphCalls().at(-1)!;
  assert.ok(update.url.endsWith("/trang-1_901"), update.url);
  assert.equal(update.form.get("message"), "Chữ mới");

  const now = await call("POST", `/api/dang-bai/bai/${job["id"]}/dang-ngay`);
  assert.equal(b(now)["job"]["trangThai"], "published");
  const comment = graphCalls().find((s) => s.url.includes("/trang-1_901/comments"))!;
  assert.match(comment.form.get("message")!, new RegExp(`${SITE.replace(/\./g, "\\.")}.*TopRun`), "thẻ {SHOP_LINK} {PAGE_NAME} được điền");
  assert.equal(b(now)["job"]["binhLuan"]["trangThai"], "published");

  const list = b(await call("GET", "/api/dang-bai/bai?trangThai=published"));
  assert.equal(list["lenh"].length, 1);
  assert.equal(list["dem"]["draft"], 1);
  assert.deepEqual(list["trang"], [{ ma: "trang-1", ten: "TopRun" }]);

  const synced = await call("POST", "/api/dang-bai/dong-bo", {});
  assert.equal(b(synced)["soBai"], 1);
  const after = b(await call("GET", "/api/dang-bai/bai"))["lenh"].find((j: Body) => j["id"] === job["id"]);
  assert.equal(after["soLieu"]["camXuc"], 30);
  assert.equal(after["soLieu"]["tiepCan"], 400);
  assert.ok(after["hieuQua"]["diem"] > 0);

  const deleted = await call("POST", `/api/dang-bai/bai/${job["id"]}/xoa`);
  assert.equal(b(deleted)["job"]["trangThai"], "deleted");
  assert.equal(graphCalls().at(-1)!.init.method, "DELETE");
});

test("dang-bai: a scheduled post synced after Meta published it becomes published and gets its first comment; cancel deletes on Meta; Meta refusals are kept with the token masked", async () => {
  let refuse = false;
  const { call, graphCalls, connectPage } = build({ graph: (s) => (refuse && s.url.includes("/feed") ? { __status: 400, error: { code: 100, message: `bad token ${TOKEN}` } } : undefined) });
  await connectPage();
  const one = b(await call("POST", "/api/dang-bai/bai", { mode: "schedule", trang: "trang-1", noiDung: "A", lichDang: later(3), binhLuan: { cheDo: "custom", chu: "Link {SHOP_LINK}" } }))["job"];
  await call("POST", "/api/dang-bai/dong-bo", { ma: one["id"] });
  const synced = b(await call("GET", "/api/dang-bai/bai"))["lenh"][0];
  assert.equal(synced["trangThai"], "published");
  assert.equal(synced["binhLuan"]["chuDaDang"], `Link ${SITE}`);

  const two = b(await call("POST", "/api/dang-bai/bai", { mode: "schedule", trang: "trang-1", noiDung: "B", lichDang: later(4) }))["job"];
  const cancelled = await call("POST", `/api/dang-bai/bai/${two["id"]}/huy`);
  assert.equal(b(cancelled)["job"]["trangThai"], "cancelled");
  assert.equal(graphCalls().at(-1)!.init.method, "DELETE");

  refuse = true;
  const failed = await call("POST", "/api/dang-bai/bai", { mode: "now", trang: "trang-1", noiDung: "C" });
  assert.equal(failed.status, 502);
  assert.equal(b(failed)["job"]["trangThai"], "failed");
  assert.ok(!String(b(failed)["message"]).includes(TOKEN));
  refuse = false;
  const retried = await call("PUT", `/api/dang-bai/bai/${b(failed)["job"]["id"]}`, { mode: "now", noiDung: "C sửa" });
  assert.equal(b(retried)["job"]["trangThai"], "published", "Sửa & thử lại gửi lại lên Meta");

  const withPictures = b(await call("POST", "/api/dang-bai/bai", { mode: "now", trang: "trang-1", noiDung: "Nền màu", nenChu: "1881421442117417", anhBinhLuan: ["/api/dang-bai/anh/x.jpg", "https://cdn.test/y.jpg"] }))["job"];
  assert.equal(graphCalls().filter((s) => s.url.endsWith("/trang-1/feed")).at(-1)!.form.get("text_format_preset_id"), "1881421442117417");
  const pictureComments = graphCalls().filter((s) => s.form.get("attachment_url"));
  assert.deepEqual(pictureComments.map((s) => s.form.get("attachment_url")), [`${SITE}/api/dang-bai/anh/x.jpg`, "https://cdn.test/y.jpg"], "ảnh comment lần lượt, đúng thứ tự");
  assert.ok(withPictures["anhBinhLuan"].every((a: Body) => a["trangThai"] === "published"));

  const noPage = await call("POST", "/api/dang-bai/bai", { mode: "now", trang: "trang-khac", noiDung: "D" });
  assert.equal(b(noPage)["job"]["trangThai"], "failed");
  assert.match(String(b(noPage)["message"]), /token/);
});

test("comment phủ link: only posts after switching on, after the delay, topic link signed, sentences rotate; a spam block pauses", async () => {
  let block = false;
  const posts = [
    { id: "trang-1_old", message: "bài cũ chạy bộ", created_time: "2026-09-18T00:00:00+0000", permalink_url: "https://facebook.com/old" },
    { id: "trang-1_new", message: "Ba đôi CHẠY BỘ cho người mới", created_time: "2026-09-19T00:10:00+0000", permalink_url: "https://facebook.com/new" },
    { id: "trang-1_two", message: "Áo khoác mùa đông", created_time: "2026-09-19T00:11:00+0000", permalink_url: "https://facebook.com/two" }
  ];
  const { call, clock, graphCalls, connectPage } = build({
    graph: (s) => (s.url.includes("published_posts") ? { data: posts } : block && s.url.includes("/comments") ? { __status: 400, error: { code: 368, message: "Tạm chặn vì spam" } } : undefined)
  });
  await connectPage();
  const saved = await call("POST", "/api/dang-bai/phu-link/cau-hinh", {
    enabled: true, maxPerDay: 10, delayMinMinutes: 3, delayMaxMinutes: 5,
    topics: [{ label: "giày chạy bộ", keywords: "chạy bộ, running", link: `${SITE}/?q=chay` }, { label: "tất cả", keywords: "", link: `${SITE}/` }],
    variants: "Xem {LABEL} 👉 {LINK}\n---\nSăn {LABEL} ở {LINK}"
  });
  assert.equal(saved.status, 200, JSON.stringify(b(saved)));
  const bad = await call("POST", "/api/dang-bai/phu-link/cau-hinh", { variants: "không có link" });
  assert.equal(bad.status, 400);

  await call("POST", "/api/dang-bai/phu-link/quet");
  let state = b(await call("GET", "/api/dang-bai/phu-link"));
  assert.equal(state["recent"].length, 2, "bài trước lúc bật không bị đụng");
  assert.equal(graphCalls().filter((s) => s.url.includes("/comments")).length, 0, "chưa hết thời gian trễ thì chưa comment");

  clock.advance(20 * 60_000);
  await call("POST", "/api/dang-bai/phu-link/quet");
  const comments = graphCalls().filter((s) => s.url.includes("/comments"));
  assert.equal(comments.length, 2);
  const first = comments.find((c) => c.url.includes("trang-1_new"))!.form.get("message")!;
  assert.match(first, /giày chạy bộ/);
  assert.match(first, /tr_sig=/, "link được ký để thống kê ghi công bài");
  const second = comments.find((c) => c.url.includes("trang-1_two"))!.form.get("message")!;
  assert.match(second, /tất cả/, "không khớp chủ đề nào thì dùng chủ đề chung");
  assert.notEqual(first.split(" ")[0], second.split(" ")[0], "câu comment xoay vòng");
  state = b(await call("GET", "/api/dang-bai/phu-link"));
  assert.equal(state["daily"]["count"], 2);

  posts.push({ id: "trang-1_three", message: "chạy bộ", created_time: "2026-09-19T00:30:00+0000", permalink_url: "" });
  block = true;
  clock.advance(20 * 60_000);
  await call("POST", "/api/dang-bai/phu-link/quet");
  state = b(await call("GET", "/api/dang-bai/phu-link"));
  assert.equal(state["config"]["settings"]["paused"], true);
  assert.match(state["config"]["settings"]["pausedReason"], /spam/);
  await call("POST", "/api/dang-bai/phu-link/cau-hinh", { resume: true });
  assert.equal(b(await call("GET", "/api/dang-bai/phu-link"))["config"]["settings"]["paused"], false);
});

test("pictures: a product card and a cover rendered in the shop's brand, served publicly for Meta; uploads must be images", async () => {
  const { call } = build();
  await call("POST", "/api/dang-bai/thuong-hieu", { tenHienThi: "SHOPHAI", tenMien: "shop.test", mauNhan: "#123456" });
  const card = await call("POST", "/api/dang-bai/the-sp", { ma: "M02" });
  assert.equal(card.status, 200, JSON.stringify(b(card)));
  assert.equal(b(card)["urlCongKhai"], `${SITE}${b(card)["url"]}`);
  const served = await call("GET", String(b(card)["url"]), undefined, { token: "" });
  assert.equal(served.status, 200, "Meta tải ảnh không cần mã");
  const bytes = (served as unknown as { file: { data: Buffer } }).file.data;
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.width, 1000);

  const cover = await call("POST", "/api/dang-bai/anh-bia", { main: "BA ĐÔI ĐÁNG CÂN NHẮC", sub: "cho người mới" });
  assert.equal((await sharp(((await call("GET", String(b(cover)["url"]), undefined, { token: "" })) as unknown as { file: { data: Buffer } }).file.data).metadata()).width, 1080);

  const search = b(await call("GET", "/api/dang-bai/the-sp/tim?sort=sale-desc&brand=Asics"));
  assert.ok(search["products"].every((p: Body) => p["brand"] === "Asics"));
  assert.ok(search["filters"]["brands"].some((x: Body) => x["id"] === "Adidas"));
  assert.equal((await call("POST", "/api/dang-bai/anh", { anh: Buffer.from("không phải ảnh").toString("base64") })).status, 400);
  assert.equal((await call("POST", "/api/dang-bai/anh", { anh: `data:image/jpeg;base64,${JPEG.toString("base64")}` })).status, 200);
});

test("the content batch end to end: topic first, write all, three judges, optimise, schedule the chosen posts on Meta with a 5-picture album", async () => {
  const { call, seen, graphCalls, connectPage } = build({
    xeon: (s) => (s.url.endsWith("/noi-dung/phan-bien") && String(s.json?.["bai"]?.["ma"]).endsWith("-2") && !s.json?.["bai"]?.["caption"]?.includes("SỬA") ? { ok: true, dat: false, chuyenMon: { diem: 6 }, giong: { diem: 8 }, dangBai: { diem: 8 }, ghiChu: ["Chuyên môn 6/10"] } : s.url.endsWith("/noi-dung/toi-uu") ? { ok: true, caption: `${GOOD.caption.slice(0, 1500)} SỬA`, chuAnh: GOOD.chuAnh } : undefined)
  });
  await connectPage();
  await call("POST", "/api/noi-dung/phong-cach", { id: "ke_chuyen", ten: "Kể chuyện", luatViet: "Xưng em, gọi các bác" });
  const topic = await call("POST", "/api/noi-dung/chu-de", { text: "Giày cho người mới tập chạy", priority: "today" });
  assert.equal(topic.status, 200, JSON.stringify(b(topic)));

  const planned = b(await call("POST", "/api/noi-dung/lo", { ngay: "2026-09-20", trang: ["trang-1"], khungGio: ["08:00", "12:00"] }))["lo"];
  assert.equal(planned["bai"][0]["chuDe"], "Giày cho người mới tập chạy", "chủ đề anh gợi ý được dùng trước");
  assert.equal(planned["bai"][0]["goc"], "nguoi_moi");
  const ma = planned["ma"];

  const written = await call("POST", `/api/noi-dung/lo/${ma}/chay`, { viec: "viet", doiXong: true });
  assert.equal(written.status, 200, JSON.stringify(b(written)));
  assert.equal(b(written)["xong"], 2);
  const brief = seen.find((s) => s.url.endsWith("/viet-bai"))!.json!;
  assert.equal(brief["phongCach"]["ten"], "Kể chuyện", "phong cách của shop đi theo brief");
  assert.equal(brief["goc"]["ten"], "Người mới bắt đầu");

  const reviewed = b(await call("POST", `/api/noi-dung/lo/${ma}/chay`, { viec: "phan-bien", doiXong: true }))["lo"];
  assert.equal(reviewed["bai"][0]["trangThai"], "dat");
  assert.equal(reviewed["bai"][1]["trangThai"], "hong", "người chấm chưa đạt thì bài chưa đạt dù luật máy sạch");
  assert.equal(reviewed["bai"][1]["phanBien"]["chuyenMon"], 6);
  const judgeBody = seen.find((s) => s.url.endsWith("/noi-dung/phan-bien"))!.json!;
  assert.deepEqual(judgeBody["loiLuat"], [], "lỗi luật do landing quét gửi kèm");

  const optimised = b(await call("POST", `/api/noi-dung/lo/${ma}/chay`, { viec: "toi-uu", doiXong: true }))["lo"];
  assert.equal(optimised["bai"][1]["trangThai"], "dat");
  assert.match(optimised["bai"][1]["caption"], /SỬA/);
  assert.deepEqual(optimised["chon"].sort(), optimised["bai"].map((p: Body) => p["id"]).sort(), "mặc định tick bài đạt");

  await call("POST", `/api/noi-dung/lo/${ma}/chon`, { chon: [optimised["bai"][0]["id"]] });
  const scheduled = await call("POST", `/api/noi-dung/lo/${ma}/len-lich`, {});
  assert.equal(scheduled.status, 200, JSON.stringify(b(scheduled)));
  assert.equal(b(scheduled)["soBai"], 1, JSON.stringify(b(scheduled)["loi"]));
  const post = b(scheduled)["lo"]["bai"][0];
  assert.equal(post["trangThai"], "da-len-lich");
  assert.ok(String(post["maLenh"]).startsWith("fbpub_"));
  const feed = graphCalls().find((s) => s.url.endsWith("/trang-1/feed"))!;
  assert.equal(feed.form.get("scheduled_publish_time"), String(Math.floor(Date.parse("2026-09-20T08:00:00+07:00") / 1000)));
  assert.ok(JSON.parse(feed.form.get("attached_media")!).length >= 5, "album ít nhất 5 ảnh: bìa + card + gallery");
  assert.equal(b(await call("GET", "/api/noi-dung/chu-de"))["counts"]["used"], 1, "chủ đề đã dùng khi bài lên lịch");
  assert.equal((await call("PUT", `/api/noi-dung/lo/${ma}/bai/${post["id"]}`, { caption: "x" })).status, 409, "bài đã lên lịch thì khoá");

  const dropped = await call("POST", `/api/noi-dung/lo/${ma}/bai/${optimised["bai"][1]["id"]}/bo`);
  assert.equal(b(dropped)["bai"]["boQua"], "anh_bo");
  await call("POST", `/api/noi-dung/lo/${ma}/hoan-tac`);
  const restored = b(await call("GET", `/api/noi-dung/lo/${ma}`))["lo"];
  assert.match(restored["bai"][1]["caption"], /SỬA/);
  assert.equal(restored["bai"][0]["trangThai"], "da-len-lich", "hoàn tác không gỡ bài đã lên lịch");

  const kept = await call("POST", `/api/noi-dung/lo/${ma}/bai/${post["id"]}/vao-kho`);
  assert.equal(kept.status, 200, JSON.stringify(b(kept)));
  const library = b(await call("GET", "/api/noi-dung/kho-bai?kenh=facebook"));
  assert.equal(library["muc"][0]["trangThai"], "published");

  const suggestion = b(await call("POST", `/api/noi-dung/lo/${ma}/bai/${optimised["bai"][1]["id"]}/goi-y-ma`));
  assert.ok(suggestion["ma"].length > 0);
  assert.ok(suggestion["ma"].every((c: string) => !post["codes"].includes(c)), "gợi ý không lấy mã của bài khác trong lô");
});

test("kho mã ranks by priority, trend research clamps and waits a week, the heartbeat is a service door", async () => {
  let hot = 20;
  const { call, clock } = build({ xeon: (s) => (s.url.endsWith("/noi-dung/xu-huong") ? { ok: true, dong: (s.json!["dong"] as Body[]).map((d) => ({ key: d["key"], hang: d["hang"], dong: d["dong"], hotScore: hot, trendStatus: "rising", trendReason: "hot", story: "", styling: [], sampleCaptions: [], confidence: 0.7 })) } : undefined) });
  const pool = b(await call("GET", "/api/noi-dung/kho-ma"));
  assert.equal(pool["total"], 14);
  assert.equal(pool["rows"][0]["code"], "M06", "giảm sâu nhất đứng đầu khi chưa có tín hiệu khác");
  assert.ok(pool["rows"].find((r: Body) => r["code"] === "M06")["priorityReasons"].some((x: string) => /giảm 55%/.test(x)));
  assert.deepEqual(pool["brands"], ["Adidas", "Asics"]);

  const first = b(await call("POST", "/api/noi-dung/xu-huong/chay"));
  assert.equal(first["lastStatus"], "ok", JSON.stringify(first));
  assert.equal(first["cards"][0]["hotScore"], 20);
  hot = 0;
  const due = await call("POST", "/api/noi-dung/nhip");
  assert.equal(b(due)["xuHuong"], "chưa đến hạn");
  clock.advance(8 * 24 * 3600_000);
  await call("POST", "/api/noi-dung/nhip");
  const cards = b(await call("GET", "/api/noi-dung/xu-huong"))["cards"];
  assert.equal(cards[0]["hotScore"], 15, "một tuần chỉ tụt tối đa 5 điểm");
  assert.equal((await call("POST", "/api/noi-dung/nhip", {}, { token: "" })).status, 401);
});
