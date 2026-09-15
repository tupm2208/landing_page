/**
 * THE CONTENT WORKSHOP — the rules of a post, and the five steps that gate it.
 *
 * Most of these rules exist because a real post went out wrong; three of them exist because a
 * rule that looked obvious blocked a perfectly good post. Both kinds are tested, because the
 * second kind is the one somebody "simplifies" back into a bug.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLE } from "../dist/contract/index.js";
import { FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, TokenAuth, jsonResponse } from "../dist/kernel/index.js";
import { defineModule } from "../dist/contract/index.js";
import { manifest as studio } from "../dist/modules/xuong-noi-dung/module.js";
import {
  CAPTION_MIN_LENGTH, checkCaption, checkCodes, checkComment, hookCapsRun, validateBatch, validatePost
} from "../dist/modules/xuong-noi-dung/studio-rules.js";
import { canAdvance, editPost, pickCodes, planBatch, sellableCodes, stepBatch } from "../dist/modules/xuong-noi-dung/batch.js";

const ADMIN = "ma-quan-tri";
const SITE = "https://shop.test";

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

/** A caption long enough to pass the length rule, so a test about ONE rule fails on that rule only. */
const filler = "Đôi này đế êm, ôm chân vừa phải, đi bộ dài hay chạy nhẹ đều hợp. ".repeat(20);
const captionWith = (first: string, rest = "") => `${first}\n${rest}${filler}`.slice(0, 2100);
const GOOD_HOOK = "BA ĐÔI ĐÁNG CÂN NHẮC cho người mới chạy";

// ---------- the hook ----------

test("the hook opens with 4–10 words in capitals — not fewer, not the whole line", () => {
  assert.equal(hookCapsRun("BA ĐÔI ĐÁNG CÂN NHẮC cho người mới"), 5, "đếm tới chữ thường đầu tiên thì dừng");
  assert.equal(hookCapsRun("Ba đôi đáng cân nhắc"), 0);

  const tooFew = checkCaption(captionWith("ĐÔI NÀY hợp người mới chạy"), { main: "x" });
  assert.ok(tooFew.errors.some((e) => e.id === "hook_caps"), "a two-word capital run is not a hook");

  const shouting = checkCaption(captionWith("BA ĐÔI ĐÁNG CÂN NHẮC CHO NGƯỜI MỚI CHẠY BỘ"), { main: "x" });
  assert.ok(shouting.errors.some((e) => e.id === "hook_hoa_ca_cau"), "a hook in full capitals is shouting");

  const good = checkCaption(captionWith(GOOD_HOOK), { main: GOOD_HOOK });
  assert.ok(!good.errors.some((e) => e.id.startsWith("hook")), JSON.stringify(good.errors));
});

// ---------- the three rules that once blocked GOOD posts ----------

test("5K, 10K, 21K, 42K are RUNNING DISTANCES, not five thousand đồng", () => {
  const distance = checkCaption(captionWith(GOOD_HOOK, "Chạy 5K hay 10K đều ổn, lên 21K thì nên cân nhắc đế dày hơn. "), { main: GOOD_HOOK });
  assert.ok(!distance.errors.some((e) => e.id === "gia_tien"), `a post about distance was blocked as a price: ${JSON.stringify(distance.errors)}`);

  const price = checkCaption(captionWith(GOOD_HOOK, "Giá chỉ 2.890.000đ thôi ạ. "), { main: GOOD_HOOK });
  assert.ok(price.errors.some((e) => e.id === "gia_tien"), "a real price must still be caught");
});

test("a percentage is only banned when it is a DISCOUNT", () => {
  const ratio = checkCaption(captionWith(GOOD_HOOK, "Khoảng 80% chị hỏi em đều hợp mẫu này, 90% trọng lượng dồn lên gân. "), { main: GOOD_HOOK });
  assert.ok(!ratio.errors.some((e) => e.id === "phan_tram"), `an ordinary ratio was blocked: ${JSON.stringify(ratio.errors)}`);

  const discount = checkCaption(captionWith(GOOD_HOOK, "Đang giảm 30% cho mẫu này. "), { main: GOOD_HOOK });
  assert.ok(discount.errors.some((e) => e.id === "phan_tram"), "a discount percentage must still be caught");
});

test("the words on the cover must be TAKEN FROM the hook — and must not swallow it", () => {
  const away = checkCaption(captionWith(GOOD_HOOK), { main: "Khuyến mãi tháng chín siêu hời" });
  assert.ok(away.warnings.some((w) => w.id === "anh_khong_theo_hook"));

  const swallowed = checkCaption(captionWith(GOOD_HOOK), { main: GOOD_HOOK });
  assert.ok(swallowed.warnings.some((w) => w.id === "anh_nuot_hook"), "if the image says the whole hook there is nothing left to open");

  const right = checkCaption(captionWith(GOOD_HOOK), { main: "BA ĐÔI ĐÁNG CÂN NHẮC" });
  assert.deepEqual(right.warnings.filter((w) => w.id.startsWith("anh_")), [], "taking part of the hook is exactly right");

  // These stay WARNINGS: a person can fix an image by hand, so they must not block a publish.
  assert.equal(away.errors.length, 0);
});

// ---------- what may never be published ----------

test("the banned phrases: stock claims, delivery promises, wrong forms of address", () => {
  const cases: [string, string][] = [
    ["co_san", "Hàng có sẵn nhé các bác. "],
    ["du_size", "Bên kho còn đủ size cho cả nhà. "],
    ["hua_giao", "Đặt hôm nay là kịp trước lễ ạ. "],
    ["xach_tay", "Đây là hàng xách tay chuẩn. "],
    ["xung_ho_sai", "Mình nhé, cứ yên tâm. "],
    ["ben_em", "Ở bên em lúc nào cũng đủ mẫu. "]
  ];
  for (const [id, sentence] of cases) {
    const verdict = checkCaption(captionWith(GOOD_HOOK, sentence), { main: "BA ĐÔI ĐÁNG CÂN NHẮC" });
    assert.ok(verdict.errors.some((e) => e.id === id), `"${sentence.trim()}" phải bị chặn bởi luật ${id}`);
  }
});

test("a caption that is too short or too long is refused", () => {
  const short = checkCaption(`${GOOD_HOOK}\nNgắn quá.`, { main: "BA ĐÔI" });
  assert.ok(short.errors.some((e) => e.id === "caption_ngan"));
  const long = checkCaption(`${GOOD_HOOK}\n${"x".repeat(CAPTION_MIN_LENGTH * 3)}`, { main: "BA ĐÔI" });
  assert.ok(long.errors.some((e) => e.id === "caption_dai"));
});

// ---------- the first comment ----------

test("links in the first comment must point at THIS shop — Desk had one shop's domain in a regex", () => {
  const ours = checkComment(`Chi tiết em để link ạ ${SITE}/giay-chay`, { siteOrigin: SITE });
  assert.deepEqual(ours.errors, []);

  const stray = checkComment(`Xem ở ${SITE}/a và https://shopkhac.vn/b nhé`, { siteOrigin: SITE });
  assert.ok(stray.errors.some((e) => e.id === "comment_link_la"));

  // Another shop's landing judges against ITS own origin, not ours.
  const theirs = checkComment("Xem ở https://shopkhac.vn/b nhé em", { siteOrigin: "https://shopkhac.vn" });
  assert.deepEqual(theirs.errors, []);

  assert.ok(checkComment("Inbox em nhé", { siteOrigin: SITE }).errors.some((e) => e.id === "comment_thieu_link"));
  assert.ok(checkComment(`tinyurl.com/abc ${SITE}/a inbox em`, { siteOrigin: SITE }).errors.some((e) => e.id === "tinyurl"));
});

// ---------- the product codes ----------

interface FakeProduct { code: string; name: string; sizes: { size?: string; qty: number }[]; images: number }

/** Twelve sellable codes — a day of five slots needs more than a handful, as a real shop has. */
const SELLABLE: FakeProduct[] = Array.from({ length: 12 }, (_v, i) => ({
  code: `A${i + 1}`, name: `Giày chạy A${i + 1}`, sizes: [{ size: "42", qty: i + 1 }], images: 1
}));

const CATALOGUE = new Map<string, FakeProduct>([
  ...SELLABLE.map((p) => [p.code, p] as [string, FakeProduct]),
  ["HET", { code: "HET", name: "Giày hết size", sizes: [{ size: "42", qty: 0 }], images: 1 }],
  ["KHONGANH", { code: "KHONGANH", name: "Giày chưa có ảnh", sizes: [{ size: "42", qty: 2 }], images: 0 }]
]);

test("a post may only use codes that can really be sold", () => {
  const verdict = checkCodes({ format: "so_sanh", codes: ["A1", "A2", "A3", "HET", "KHONGANH", "KHONGCO"] }, { productsByCode: CATALOGUE });
  assert.ok(verdict.errors.some((e) => e.id === "het_size"));
  assert.ok(verdict.errors.some((e) => e.id === "khong_co_anh"));
  assert.ok(verdict.errors.some((e) => e.id === "ma_khong_ton_tai"));
});

test("each shape of post has its own code count, and the album never exceeds six", () => {
  const tooFew = checkCodes({ format: "so_sanh", codes: ["A1"] }, { productsByCode: CATALOGUE });
  assert.ok(tooFew.errors.some((e) => e.id === "thieu_ma"), "so sánh cần ít nhất 4 mã");

  const single = checkCodes({ format: "mot_san_pham", codes: ["A1"] }, { productsByCode: CATALOGUE });
  assert.ok(single.errors.some((e) => e.id === "thieu_gallery"), "một sản phẩm phải có gallery nhiều góc chụp");

  const noFormat = checkCodes({ codes: ["A1", "A2", "A3", "A4", "A1", "A2", "A3"] }, { productsByCode: CATALOGUE });
  assert.ok(noFormat.errors.some((e) => e.id === "qua_6_ma"));
});

// ---------- the batch ----------

test("two posts on one page must be at least two hours apart", () => {
  const post = (time: string) => ({
    page: "trang-1", date: "2026-09-20", time, format: "so_sanh", codes: ["A1", "A2", "A3", "A4"],
    caption: captionWith(GOOD_HOOK), main: "BA ĐÔI ĐÁNG CÂN NHẮC", comment: `Xem ở ${SITE}/a, inbox em nhé`
  });
  const ctx = { productsByCode: CATALOGUE, siteOrigin: SITE, nowMs: Date.parse("2026-09-19T00:00:00+07:00") };

  const tooClose = validateBatch([post("10:00"), post("11:00")], ctx);
  assert.ok(tooClose.errors.some((e) => e.id === "gian_cach"));

  const fine = validateBatch([post("10:00"), post("14:00")], ctx);
  assert.deepEqual(fine.errors, []);
  assert.ok(fine.ok, JSON.stringify(fine.theoBai.flatMap((v) => v.errors)));
});

test("a slot in the past, or under the lead time, is refused before Meta refuses it", () => {
  const base = {
    page: "trang-1", date: "2026-09-20", format: "so_sanh", codes: ["A1", "A2", "A3", "A4"],
    caption: captionWith(GOOD_HOOK), main: "BA ĐÔI", comment: `Xem ở ${SITE}/a, inbox em nhé`
  };
  const nowMs = Date.parse("2026-09-20T09:55:00+07:00");
  assert.ok(validatePost({ ...base, time: "10:00" }, { productsByCode: CATALOGUE, siteOrigin: SITE, nowMs }).errors.some((e) => e.id === "qua_gio"), "5 phút nữa là Meta từ chối");
  assert.ok(!validatePost({ ...base, time: "14:00" }, { productsByCode: CATALOGUE, siteOrigin: SITE, nowMs }).errors.some((e) => e.id === "qua_gio"));
});

// ---------- planning ----------

test("planning picks only sellable codes, oldest-posted first, and never twice in one batch", () => {
  const pool = [...CATALOGUE.values()].map((p) => ({ ...p }));
  assert.deepEqual(sellableCodes(pool).map((p) => p.code).sort(), SELLABLE.map((p) => p.code).sort(), "hết size / chưa có ảnh không được lên kế hoạch");

  const dated = [
    { code: "A1", name: "A1", images: 1, sizes: [{ qty: 1 }], dangLuc: "2026-09-14" },
    { code: "A2", name: "A2", images: 1, sizes: [{ qty: 1 }], dangLuc: "2026-09-01" },
    { code: "A3", name: "A3", images: 1, sizes: [{ qty: 1 }], dangLuc: "" }
  ];
  assert.deepEqual(pickCodes(dated, 2, new Set()), ["A3", "A2"], "mã lâu chưa đăng lên trước");
  assert.deepEqual(pickCodes(dated, 2, new Set(["A3"])), ["A2", "A1"], "mã đã dùng trong lô không lặp lại");

  const batch = planBatch({
    ma: "lo_1", ngay: "2026-09-20",
    khung: [{ page: "trang-1", time: "10:00" }, { page: "trang-1", time: "14:00" }],
    pool, at: "2026-09-19T00:00:00.000Z"
  });
  assert.equal(batch.buoc, "ke-hoach");
  assert.equal(batch.bai.length, 2);
  assert.notDeepEqual(batch.bai[0]?.format, batch.bai[1]?.format, "năm bài một ngày cùng một dạng là máy viết, không phải người");
  const used = batch.bai.flatMap((p) => p.codes);
  assert.equal(new Set(used).size, used.length, "một mã không được dùng hai lần trong cùng lô");
});

// ---------- the gate between steps ----------

test("the batch cannot skip a step, and going BACK is always allowed", () => {
  const pool = [...CATALOGUE.values()].map((p) => ({ ...p }));
  let batch = planBatch({
    ma: "lo_2", ngay: "2026-09-20",
    khung: [{ page: "trang-1", time: "10:00", format: "so_sanh" }],
    pool, at: "2026-09-19T00:00:00.000Z"
  });

  // kế hoạch -> viết bài: fine, the post has codes.
  batch = stepBatch(batch, "toi", "t1").batch;
  assert.equal(batch.buoc, "viet-bai");

  // viết bài -> phản biện: refused while the caption is empty.
  const blocked = stepBatch(batch, "toi", "t2");
  assert.equal(blocked.ok, false);
  assert.match(blocked.viSao, /chưa có caption/);

  batch = { ...batch, bai: batch.bai.map((p) => editPost(p, { caption: captionWith(GOOD_HOOK), main: "BA ĐÔI", comment: `Xem ở ${SITE}/a, inbox em nhé` })) };
  batch = stepBatch(batch, "toi", "t3").batch;
  assert.equal(batch.buoc, "phan-bien");

  // phản biện -> tối ưu: refused until the posts have been judged.
  assert.equal(stepBatch(batch, "toi", "t4").ok, false);
  batch = { ...batch, bai: batch.bai.map((p) => ({ ...p, trangThai: "hong", loi: [{ id: "x", message: "còn lỗi" }] })) };
  batch = stepBatch(batch, "toi", "t5").batch;
  assert.equal(batch.buoc, "toi-uu");

  // tối ưu -> lên lịch: refused while any post still has errors.
  const stillBroken = stepBatch(batch, "toi", "t6");
  assert.equal(stillBroken.ok, false);
  assert.match(stillBroken.viSao, /còn lỗi/);

  // Going back needs no verdict: fixing after a review is the normal shape of the work.
  assert.equal(stepBatch(batch, "lui", "t7").batch.buoc, "phan-bien");

  batch = { ...batch, bai: batch.bai.map((p) => ({ ...p, trangThai: "dat", loi: [] })) };
  assert.equal(stepBatch(batch, "toi", "t8").batch.buoc, "len-lich");
});

test("a post dropped from the day does not hold the batch back", () => {
  const pool = [...CATALOGUE.values()].map((p) => ({ ...p }));
  const batch = planBatch({
    ma: "lo_3", ngay: "2026-09-20",
    khung: [{ page: "trang-1", time: "10:00" }, { page: "trang-1", time: "14:00" }],
    pool, at: "2026-09-19T00:00:00.000Z"
  });
  const withDrop = {
    ...batch,
    bai: [
      editPost(batch.bai[0]!, { caption: captionWith(GOOD_HOOK), main: "BA ĐÔI", comment: `Xem ở ${SITE}/a, inbox em nhé` }),
      editPost(batch.bai[1]!, { boQua: "Hết mã hợp dạng bài" })
    ],
    buoc: "viet-bai" as const
  };
  assert.equal(canAdvance(withDrop).ok, true, "bài đã bỏ qua không phải viết");
});

test("editing a judged post puts it back to `nhap` — a caption that passed and then changed has NOT passed", () => {
  const passed = { id: "p1", page: "t", date: "d", time: "10:00", format: "so_sanh", codes: ["A1"], caption: "cũ", main: "m", comment: "c", chuDe: "", trangThai: "dat", loi: [], canhBao: [], boQua: "" };
  assert.equal(editPost(passed, { caption: "mới" }).trangThai, "nhap");
  assert.deepEqual(editPost(passed, { caption: "mới" }).loi, []);
  assert.equal(editPost(passed, { chuDe: "đổi brief thôi" }).trangThai, "dat", "sửa brief không phải sửa bài");
});

// ---------- the whole flow through the kernel ----------

const fakeCatalogue = defineModule({
  id: "hang-kho", name: "Kho giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
  provides: {
    "hang-kho.search": async () => [...CATALOGUE.values()].map((p) => ({
      code: p.code, name: p.name, sizes: p.sizes, thumbnailImage: p.images > 0 ? "anh.jpg" : "", galleryImages: []
    }))
  }
});

function build() {
  const clock = new ManualClock("2026-09-19T00:00:00.000Z");
  const logger = new MemoryLogger();
  const kernel = new Kernel({
    ports: {
      store: new JsonFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "noi-dung-"))), logger, clock, http: new FakeHttpClient(),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock)
    },
    logger, modules: [fakeCatalogue, studio], config: { "hang-kho": {}, "xuong-noi-dung": { siteUrl: SITE } }
  });
  const admin = { authorization: `Bearer ${ADMIN}` };
  const call = (method: string, p: string, payload?: unknown) => kernel.handle({ method, path: p, query: {}, headers: admin, ip: "1.1.1.1", json: async () => payload ?? {} });
  return { kernel, call, admin };
}

test("the whole flow: plan a day, write, judge, fix, schedule — and no step can be skipped", async () => {
  const { kernel, call } = build();

  const planned = await call("POST", "/api/noi-dung/lo", { ngay: "2026-09-20", trang: ["trang-1"], khungGio: ["10:00", "14:00"] });
  assert.equal(planned.status, 200, JSON.stringify(planned.body));
  const batch = (planned.body as Body)["lo"];
  assert.equal(batch["bai"].length, 2);
  assert.equal(batch["buoc"], "ke-hoach");

  // Jumping straight to scheduling is refused.
  const early = await call("POST", `/api/noi-dung/lo/${batch["ma"]}/len-lich`);
  assert.equal(early.status, 409);

  await call("POST", `/api/noi-dung/lo/${batch["ma"]}/buoc`, { huong: "toi" });
  for (const post of batch["bai"]) {
    await call("PUT", `/api/noi-dung/lo/${batch["ma"]}/bai/${post["id"]}`, {
      caption: captionWith(GOOD_HOOK), chuAnh: "BA ĐÔI ĐÁNG CÂN NHẮC", comment: `Xem ở ${SITE}/a, inbox em nhé`
    });
  }
  await call("POST", `/api/noi-dung/lo/${batch["ma"]}/buoc`, { huong: "toi" });

  const judged = await call("POST", `/api/noi-dung/lo/${batch["ma"]}/cham`);
  assert.equal(judged.status, 200, JSON.stringify(judged.body));
  const posts = ((judged.body as Body)["lo"]["bai"]) as Body[];
  assert.ok(posts.every((p) => p["trangThai"] === "dat"), JSON.stringify(posts.map((p) => p["loi"])));

  await call("POST", `/api/noi-dung/lo/${batch["ma"]}/buoc`, { huong: "toi" });
  const toSchedule = await call("POST", `/api/noi-dung/lo/${batch["ma"]}/buoc`, { huong: "toi" });
  assert.equal((toSchedule.body as Body)["buoc"], "len-lich");

  const scheduled = await call("POST", `/api/noi-dung/lo/${batch["ma"]}/len-lich`);
  assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body));
  assert.equal((scheduled.body as Body)["soBai"], 2);
  assert.equal((scheduled.body as Body)["chuaDang"], true, "lên lịch KHÔNG gọi Meta — đăng thật là việc sau");

  const list = (await call("GET", "/api/noi-dung/lo")).body as Body;
  assert.equal(list["lo"][0]["soDat"], 2);

  assert.equal((await kernel.handle({ method: "GET", path: "/api/noi-dung/lo", query: {}, headers: {}, ip: "1.1.1.1" })).status, 401, "xưởng nội dung là màn của chủ shop");
});

test("a post the rules reject blocks the schedule until it is fixed", async () => {
  const { call } = build();
  const batch = ((await call("POST", "/api/noi-dung/lo", { ngay: "2026-09-20", trang: ["trang-1"], khungGio: ["10:00"] })).body as Body)["lo"];
  const postId = batch["bai"][0]["id"];

  await call("POST", `/api/noi-dung/lo/${batch["ma"]}/buoc`, { huong: "toi" });
  await call("PUT", `/api/noi-dung/lo/${batch["ma"]}/bai/${postId}`, {
    caption: captionWith(GOOD_HOOK, "Hàng có sẵn nhé các bác. "), chuAnh: "BA ĐÔI", comment: `Xem ở ${SITE}/a, inbox em nhé`
  });
  await call("POST", `/api/noi-dung/lo/${batch["ma"]}/buoc`, { huong: "toi" });

  const judged = (await call("POST", `/api/noi-dung/lo/${batch["ma"]}/cham`)).body as Body;
  assert.equal(judged["lo"]["bai"][0]["trangThai"], "hong");
  assert.ok((judged["lo"]["bai"][0]["loi"] as Body[]).some((e) => e["id"] === "co_san"));

  await call("POST", `/api/noi-dung/lo/${batch["ma"]}/buoc`, { huong: "toi" });
  const blocked = await call("POST", `/api/noi-dung/lo/${batch["ma"]}/buoc`, { huong: "toi" });
  assert.equal(blocked.status, 409);
  assert.match(String((blocked.body as Body)["message"]), /còn lỗi/);
});

// ---------- the brain writes, THIS server judges ----------

/** Plays the platform module: says which Xeon holds the brain and with which private token. */
const fakeXeon = defineModule({
  id: "khung-nen-tang", name: "Khung giả", tier: "khung", runsOn: "server-khach", version: "0.0.1",
  provides: { "khung-nen-tang.xeon": async () => ({ shop: "toprun", diaChiXeon: "https://xeon.test", maNhanTin: "ma-nhan-tin-rieng" }) }
});

/** Builds a kernel where the brain is a scripted fake: no network, no key, no cost. */
function buildWithBrain(answers: unknown[]) {
  const clock = new ManualClock("2026-09-19T00:00:00.000Z");
  const logger = new MemoryLogger();
  const asked: { url: string; body: Record<string, any> }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads the brief
  let round = 0;
  const http = new FakeHttpClient((url, init) => {
    asked.push({ url, body: JSON.parse(String(init.body ?? "{}")) });
    const answer = answers[Math.min(round, answers.length - 1)];
    round += 1;
    return jsonResponse(answer);
  });
  const kernel = new Kernel({
    ports: {
      store: new JsonFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "noi-dung-ai-"))), logger, clock, http,
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }),
      rateLimiter: new FixedWindowRateLimiter(clock)
    },
    logger, modules: [fakeCatalogue, fakeXeon, studio], config: { "hang-kho": {}, "xuong-noi-dung": { siteUrl: SITE } }
  });
  const admin = { authorization: `Bearer ${ADMIN}` };
  const call = (method: string, p: string, payload?: unknown) => kernel.handle({ method, path: p, query: {}, headers: admin, ip: "1.1.1.1", json: async () => payload ?? {} });
  return { call, asked, logger };
}

const goodDraft = {
  ok: true,
  ban: { caption: captionWith(GOOD_HOOK), chuAnh: "BA ĐÔI ĐÁNG CÂN NHẮC", comment: `Xem ở ${SITE}/a, inbox em nhé` },
  model: "claude-opus-5"
};

async function planOne(call: (m: string, p: string, payload?: unknown) => Promise<{ body: unknown }>) {
  const batch = ((await call("POST", "/api/noi-dung/lo", { ngay: "2026-09-20", trang: ["trang-1"], khungGio: ["10:00"] })).body as Body)["lo"];
  return { ma: batch["ma"] as string, baiId: batch["bai"][0]["id"] as string };
}

test("the brain writes and THIS server judges: the brief carries the shop's rules and only sellable sizes", async () => {
  const { call, asked } = buildWithBrain([goodDraft]);
  const { ma, baiId } = await planOne(call);

  const r = await call("POST", `/api/noi-dung/lo/${ma}/bai/${baiId}/viet`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const post = (r.body as Body)["bai"];
  assert.equal(post["trangThai"], "dat", "bài đạt luật thì lưu luôn là đạt");
  assert.equal((r.body as Body)["soLuot"], 1, "đạt ngay lượt đầu thì không gọi mô hình lần hai");

  assert.equal(asked.length, 1);
  assert.match(asked[0]!.url, /https:\/\/xeon\.test\/viet-bai/);
  const brief = asked[0]!.body;
  assert.equal(brief["dangBai"], "gom_nhu_cau");
  assert.ok(String(brief["huongDan"]).length > 0, "hướng dẫn dạng bài đi kèm brief");
  assert.equal(brief["luat"]["captionToiThieu"], CAPTION_MIN_LENGTH);
  assert.equal(brief["luat"]["gocLink"], SITE, "mỗi shop chấm link theo site của chính mình");
  assert.ok((brief["luat"]["cam"] as string[]).some((c) => /có sẵn/.test(c)), "luật cấm của bộ chấm được nói lại cho người viết");
  for (const item of brief["mon"] as Body[]) {
    assert.ok(String(item["ten"]).length > 0, "mã nào cũng phải kèm tên thật, không để mô hình tự bịa");
    assert.ok(Array.isArray(item["size"]));
  }
});

test("a draft that breaks a rule is sent back ONCE with exactly what was wrong", async () => {
  const bad = { ok: true, ban: { caption: captionWith(GOOD_HOOK, "Hàng có sẵn nhé các bác. "), chuAnh: "BA ĐÔI", comment: `Xem ở ${SITE}/a, inbox em nhé` }, model: "claude-opus-5" };
  const { call, asked } = buildWithBrain([bad, goodDraft]);
  const { ma, baiId } = await planOne(call);

  const r = await call("POST", `/api/noi-dung/lo/${ma}/bai/${baiId}/viet`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((r.body as Body)["soLuot"], 2);
  assert.equal((r.body as Body)["bai"]["trangThai"], "dat");

  assert.equal(asked.length, 2, "đúng hai lượt, không phải một vòng lặp tốn tiền");
  const secondBrief = asked[1]!.body;
  assert.ok(Array.isArray(secondBrief["loiLanTruoc"]));
  assert.ok((secondBrief["loiLanTruoc"] as string[]).some((e) => /có sẵn/.test(e)), "lượt hai phải nói rõ lượt một sai chỗ nào");
});

test("two bad drafts: the second one is still returned, with its verdict — a person fixes the last mile", async () => {
  const bad = { ok: true, ban: { caption: captionWith(GOOD_HOOK, "Đặt hôm nay là kịp trước lễ ạ. "), chuAnh: "BA ĐÔI", comment: `Xem ở ${SITE}/a, inbox em nhé` }, model: "claude-opus-5" };
  const { call, asked } = buildWithBrain([bad, bad]);
  const { ma, baiId } = await planOne(call);

  const r = await call("POST", `/api/noi-dung/lo/${ma}/bai/${baiId}/viet`);
  assert.equal(r.status, 200);
  assert.equal(asked.length, 2, "dừng ở hai lượt");
  const post = (r.body as Body)["bai"];
  assert.equal(post["trangThai"], "hong");
  assert.ok((post["loi"] as Body[]).some((e) => e["id"] === "hua_giao"), "màn hình phải thấy vì sao bản nháp vẫn hỏng");
  assert.ok(String(post["caption"]).length > 0, "vẫn giữ bản nháp để người sửa nốt");
});

test("no Xeon registration: the door says so plainly instead of pretending", async () => {
  const { call } = build();   // built WITHOUT the platform module
  const batch = ((await call("POST", "/api/noi-dung/lo", { ngay: "2026-09-20", trang: ["trang-1"], khungGio: ["10:00"] })).body as Body)["lo"];
  const r = await call("POST", `/api/noi-dung/lo/${batch["ma"]}/bai/${batch["bai"][0]["id"]}/viet`);
  assert.equal(r.status, 503);
  assert.match(String((r.body as Body)["message"]), /Soạn tay/, "một câu nói rõ phải làm gì, không phải caption rỗng trông như lỗi");
});
