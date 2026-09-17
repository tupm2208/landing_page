/**
 * Đ7 — AI ở Xeon, the landing's half: reply modes decide what reaches the brain, drafts are stored
 * and never sent, operator edits and analysis results only ever become CANDIDATES, archived chats
 * lose their personal data before leaving, the brain reads approved knowledge only, external
 * products, photo memory, size signals, and the token / price proxies. Fake Xeon, fake Meta.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLE, defineModule, type HttpRequestInit, type IncomingRequest } from "../dist/contract/index.js";
import { FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, MemoryUploadPort, TokenAuth, jsonResponse } from "../dist/kernel/index.js";
import { manifest as inbox } from "../dist/modules/hop-thu/module.js";
import { MessageArchive } from "../dist/modules/hop-thu/archive.js";
import { manifest as assistant } from "../dist/modules/tro-ly-ai/module.js";
import { manifest as gateway } from "../dist/modules/cong-bo-nao/module.js";
import { stripPII } from "../dist/modules/tro-ly-ai/pii.js";
import { effectiveMode, patchOps, readOps, applicationFor, approveReview, enqueueCandidates, reviewCandidate } from "../dist/modules/tro-ly-ai/training.js";
import { extractFitSignals } from "../dist/modules/tro-ly-ai/fit-signals.js";
import { parsePrice, settle, activeFor } from "../dist/modules/tro-ly-ai/external-products.js";

const ADMIN = "ma-quan-tri-d7";
const SERVICE = "ve-dich-vu-d7";
const T0 = new Date("2026-09-17T08:00:00.000Z");
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

const DRAFT = {
  ok: true, traLoi: "Dạ Boston 13 size 42 còn ạ", nguonTraLoi: "agent", hanhDong: "ai_fallback_draft", choPhepTuGui: false, canNguoi: false, lyDo: "Agent trả lời sau 2 bước.",
  y: "", duKien: {}, canXacNhan: [], tinKhach: "còn size 42 không",
  dauVet: [{ buoc: 1, loai: "doc", ten: "Đọc hội thoại", chiTiet: "1 tin" }, { buoc: 2, loai: "cong-cu", ten: "tra_kho", chiTiet: "{\"ten\":\"Boston\"} → JP9252" }]
};

type Answer = (url: string, init: HttpRequestInit) => unknown;

function build({ answer = (() => undefined) as Answer } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tro-ly-ai-"));
  const logger = new MemoryLogger();
  const clock = new ManualClock(T0);
  const http = new FakeHttpClient((url: string, init: HttpRequestInit) => {
    const custom = answer(url, init) as { __status?: number; __bytes?: string } | undefined;
    if (custom?.__bytes !== undefined) {
      const bytes = Buffer.from(custom.__bytes);
      return { ok: true, status: 200, json: async () => ({}), text: async () => custom.__bytes!, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
    }
    if (custom !== undefined) return jsonResponse(custom, custom.__status ?? 200);
    if (url.includes("/tin-den")) return jsonResponse({ ok: true });
    if (url.includes("/ai/goi-y")) return jsonResponse(DRAFT);
    return jsonResponse({ message_id: "m.di", recipient_id: "k1" });
  });
  const store = new JsonFileStore(directory, logger);
  const platform = defineModule({
    id: "khung-nen-tang", name: "Nền giả", tier: "khung", runsOn: "server-khach", version: "0.0.1",
    provides: { "khung-nen-tang.xeon": async () => ({ shop: "toprun", diaChiXeon: "https://xeon.test", maNhanTin: "ma-nhan-tin" }) }
  });
  const catalogue = defineModule({
    id: "hang-kho", name: "Kho giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
    provides: { "hang-kho.search": async () => [], "hang-kho.stock": async () => [] }
  });
  const kernel = new Kernel({
    ports: {
      store, logger, clock, http, rateLimiter: new FixedWindowRateLimiter(clock), uploads: new MemoryUploadPort(),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }, { token: SERVICE, name: "xeon", role: ROLE.service }], clock })
    },
    logger,
    modules: [inbox, assistant, platform, catalogue, gateway],
    config: { "hop-thu": { verifyToken: "", appSecret: "", pageToken: "tk-chung", siteUrl: "https://shop.test" }, "cong-bo-nao": { siteUrl: "https://shop.test" } }
  });
  const call = async (method: string, p: string, body?: unknown, { token = ADMIN } = {}) => {
    const [pathname, search = ""] = p.split("?");
    return kernel.handle({ method, path: pathname!, query: Object.fromEntries(new URLSearchParams(search)), ip: "1.1.1.1", headers: token ? { authorization: `Bearer ${token}` } : {}, json: async () => body ?? {} } as IncomingRequest);
  };
  const b = (r: { body?: unknown }) => r.body as Body;
  return { kernel, http, store, clock, call, b };
}

const tick = async (n = 5) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bodyOf = (init: HttpRequestInit) => JSON.parse(String(init.body ?? "{}")) as Body;
const packet = (customer: string, mid: string, textValue: string, page = "trang-1") => ({
  object: "page",
  entry: [{ id: page, time: T0.getTime() - 60000, messaging: [{ sender: { id: customer }, recipient: { id: page }, timestamp: T0.getTime() - 60000, message: { mid, text: textValue } }] }]
});

test("stripPII: phone, e-mail, account number, address, the customer's name — gone; sizes, prices and product codes stay", () => {
  const out = stripPII("Em tên Nguyễn Thị Mai, sđt 0912 345 678, mail mai@gmail.com, STK 0123456789012, địa chỉ: 12 Đội Cấn, Ba Đình. Lấy JP9252 size 42 giá 3.290k nhé. Chị Mai Anh ơi", ["Mai Anh"]);
  for (const leaked of ["Nguyễn Thị Mai", "0912 345 678", "mai@gmail.com", "0123456789012", "Đội Cấn", "Mai Anh"]) assert.ok(!out.includes(leaked), `${leaked} leaked: ${out}`);
  for (const kept of ["JP9252", "size 42", "3.290k"]) assert.ok(out.includes(kept), `${kept} lost: ${out}`);
  assert.doesNotMatch(stripPII("giao về số 5 ngõ 12 Láng Hạ giúp em"), /Láng Hạ/);
});

test("reply mode: internal or page-off beats everything; the conversation's own mode beats the shop default; a person on duty turns auto into suggest", () => {
  const base = readOps(null);
  assert.equal(effectiveMode(base, null), "auto", "nothing configured = the Đ6 behaviour");
  assert.equal(effectiveMode(base, { bot: "off" }), "off");
  const shop = patchOps(base, { cheDoTraLoi: "suggest", trang: "trang-2", trangTatBot: true }, T0);
  assert.equal(effectiveMode(shop, null), "suggest");
  assert.equal(effectiveMode(shop, { bot: "auto" }), "auto");
  assert.equal(effectiveMode(shop, { bot: "auto", trang: "trang-2" }), "off");
  assert.equal(effectiveMode(shop, { bot: "auto", noiBo: true }), "off");
  assert.equal(effectiveMode(patchOps(base, { nguoiTruc: true }, T0), { bot: "auto" }), "suggest");
  assert.equal(effectiveMode(patchOps(base, { epNguoi: true }, T0), null), "suggest");
  assert.throws(() => patchOps(base, { cheDoTraLoi: "tu-dong" }, T0), /Chế độ/);
  assert.throws(() => patchOps(base, { nguongTinCay: 20 }, T0), /Ngưỡng/);
});

test("the queue: a fixed answer with a price becomes a live-data rule; duplicates are skipped; approval is the only way to a Q&A", () => {
  assert.equal(applicationFor("static_qa", "Dạ giá 3.290.000đ ạ"), "dynamic_rule");
  assert.equal(applicationFor("static_qa", "Dạ shop mở cửa 8h ạ"), "static_qa");
  assert.equal(applicationFor("static_qa", "x", "handoff"), "handoff_rule");
  const at = T0;
  const one = reviewCandidate({ loai: "ai_analysis", intent: "shipping", cauKhach: "Ship mấy ngày?", traLoiDeXuat: "Dạ nội thành một ngày ạ" }, at, 1);
  const same = reviewCandidate({ loai: "ai_analysis", intent: "Shipping", cauKhach: "ship  mấy ngày?", traLoiDeXuat: "dạ nội thành một ngày ạ" }, at, 2);
  const queue = enqueueCandidates(null, [one, same]);
  assert.equal(queue.added.length, 1);
  assert.equal(queue.book.muc[0]!.trangThai, "candidate");
  const approved = approveReview(queue.book, null, one.id, at);
  assert.equal(approved.item.trangThai, "approved");
  assert.equal(approved.qa.muc[0]!.nguon, "review_approved");
  assert.throws(() => approveReview(approved.review, approved.qa, one.id, at), /đã được xử lý/);
});

test("Đ7 routing: suggest mode drafts WITHOUT answering, auto mode pushes with cheDo auto, a page switched off does neither", async () => {
  const { call, b, http } = build();
  assert.equal((await call("POST", "/api/ai/van-hanh", { cheDoTraLoi: "suggest" })).status, 200);
  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: packet("k1", "m.1", "còn size 42 không") }, { token: SERVICE });
  await tick();
  await wait(20);
  assert.equal(http.calls.filter((c) => c.url.includes("/tin-den")).length, 0, "suggest: the brain does not answer");
  const asked = http.calls.filter((c) => c.url.includes("/ai/goi-y"));
  assert.equal(asked.length, 1, "suggest: a draft is prepared");
  assert.deepEqual(bodyOf(asked[0]!.init), { maHoiThoai: "facebook:k1", kenh: "facebook", cheDo: "suggest", nguon: "tu-dong" });
  const stored = b(await call("GET", "/api/ai/goi-y?maHoiThoai=facebook:k1"))["goiY"];
  assert.equal(stored.traLoi, "Dạ Boston 13 size 42 còn ạ");
  assert.equal(stored.dauVet.length, 2);
  assert.ok(!http.calls.some((c) => c.url.includes("graph.facebook.com") && c.url.includes("/messages")), "a draft is never sent to Meta");

  await call("POST", "/api/hop-thu/hoi-thoai/facebook:k1/thong-tin", { bot: "auto" });
  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: packet("k1", "m.2", "shop ơi") }, { token: SERVICE });
  await tick();
  const pushed = http.calls.filter((c) => c.url.includes("/tin-den"));
  assert.equal(pushed.length, 1);
  assert.equal(bodyOf(pushed[0]!.init)["cheDo"], "auto");

  await call("POST", "/api/ai/van-hanh", { trang: "trang-1", trangTatBot: true });
  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: packet("k1", "m.3", "alo") }, { token: SERVICE });
  await tick();
  assert.equal(http.calls.filter((c) => c.url.includes("/tin-den")).length, 1, "page off: nothing pushed");
  assert.equal(http.calls.filter((c) => c.url.includes("/ai/goi-y")).length, 1, "page off: no draft either");
  assert.deepEqual(b(await call("GET", "/api/ai/van-hanh"))["vanHanh"].trangTatBot, ["trang-1"]);
});

test("Đ7 'Soạn bot' + 'Lưu sửa đổi & đưa vào Training': the draft comes back and is kept; the edit is a CANDIDATE, not a Q&A", async () => {
  const { call, b } = build();
  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: packet("k1", "m.1", "còn size 42 không") }, { token: SERVICE });
  await tick();
  assert.equal((await call("POST", "/api/ai/goi-y", { maHoiThoai: "facebook:khong-co" })).status, 404);
  const r = await call("POST", "/api/ai/goi-y", { maHoiThoai: "facebook:k1" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(b(r)["goiY"].nguon, "nguoi");
  const edit = await call("POST", "/api/ai/phan-hoi-goi-y", { maHoiThoai: "facebook:k1", traLoiAiGoc: "Dạ còn ạ", traLoiSua: "Dạ mẫu nào bác nhỉ, em kiểm size 42 ngay", lyDoSua: "missing_question", intent: "ask_size" });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const item = b(edit)["hangDuyet"];
  assert.deepEqual([item.trangThai, item.cachApDung, item.cauKhach, item.loai], ["candidate", "clarification_rule", "còn size 42 không", "facebook_ai_operator_edit"]);
  assert.equal(b(await call("POST", "/api/ai/phan-hoi-goi-y", { maHoiThoai: "facebook:k1", traLoiAiGoc: "Dạ còn ạ", traLoiSua: "Dạ mẫu nào bác nhỉ, em kiểm size 42 ngay", lyDoSua: "missing_question", intent: "ask_size" }))["hangDuyet"], null, "the same edit twice is one candidate");
  const training = b(await call("GET", "/api/ai/huan-luyen"));
  assert.deepEqual(training["dem"], { kichBan: 0, canDuyet: 1, daDuyet: 0 });
});

test("Đ7 training: the brain reads APPROVED knowledge only; approving and blocking are a person's clicks", async () => {
  const { call, b } = build();
  const toolOpen = b(await call("GET", "/api/bo-nao/cong-cu", undefined, { token: SERVICE }))["congCu"] as string[];
  assert.ok(toolOpen.includes("training.knowledge"));
  await call("POST", "/api/ai/hoi-dap", { intent: "shipping", cauHoi: "ship mấy ngày", traLoi: "Dạ nội thành 1 ngày ạ" });
  assert.equal((await call("POST", "/api/ai/hoi-dap", { intent: "x" })).status, 400);
  const style = await call("POST", "/api/ai/cau-mau", { cauKhach: "tìm giày chạy", traLoiAi: "Dạ có ạ", traLoiDuyet: "Dạ bác chạy cự ly bao nhiêu ạ?", lyDo: "hỏi nhu cầu trước" });
  assert.equal(style.status, 200, JSON.stringify(style.body));
  const again = await call("POST", "/api/ai/cau-mau", { ma: b(style)["cauMau"].id, cauKhach: "tìm giày chạy", traLoiDuyet: "Dạ bác chạy 5K hay 21K ạ?" });
  assert.equal(b(again)["cauMau"].maDuyet, b(style)["cauMau"].maDuyet, "re-saving updates the same candidate");
  await call("POST", "/api/ai/kien-thuc", { maSp: "JP9252", tenSp: "Boston 13", form: "ôm", tuVanSize: "lên nửa size" });
  await call("POST", "/api/ai/ho-so-mau", { ten: "Anh chạy 21K", sizeQuen: "42", tomTat: "chân bè" });
  await call("POST", "/api/ai/thu-vien", { id: "Tennis Moi", ten: "Tennis", duongDan: "knowledge/tennis.md", dungKhi: "tennis, vợt", noiDung: "# Tennis" });
  assert.match(b(await call("POST", "/api/ai/thu-vien/noi-dung", { ten: "Tennis", moTa: "cho người mới", dungKhi: "tennis" }))["noiDung"], /# Tennis[\s\S]*- tennis/);

  const queue = b(await call("GET", "/api/ai/huan-luyen"))["hangDuyet"] as Body[];
  assert.equal(queue.length, 1);
  const ask = async (q: string) => b(await call("POST", "/api/bo-nao/cong-cu", { ten: "training.knowledge", input: { q, conversationId: "facebook:k1" } }, { token: SERVICE }))["data"];
  let k = await ask("ship boston JP9252 tennis");
  assert.equal(k.hoiDap.length, 1);
  assert.equal(k.quyTac.length, 0, "a candidate is NOT knowledge");
  assert.equal(k.cauMau[0].traLoi, "Dạ bác chạy 5K hay 21K ạ?");
  assert.equal(k.kienThuc[0].ma, "JP9252");
  assert.equal(k.thuVien[0].ten, "Tennis", "a library whose useWhen matches the question");
  assert.equal((await ask("giày chạy")).thuVien.length, 0, "an unrelated question gets no library");

  assert.equal((await call("POST", `/api/ai/hang-duyet/${queue[0]!["id"]}/duyet`)).status, 200);
  assert.equal((await call("POST", `/api/ai/hang-duyet/${queue[0]!["id"]}/duyet`)).status, 409);
  k = await ask("tìm giày chạy");
  assert.equal(k.quyTac.length + k.hoiDap.length, 2, "approved: the style candidate is now usable");
  const qaId = (b(await call("GET", "/api/ai/huan-luyen"))["hoiDap"] as Body[]).find((q) => q["intent"] === "shipping")!["id"];
  assert.equal((await call("POST", `/api/ai/hoi-dap/${qaId}/trang-thai`, { trangThai: "retired" })).status, 200);
  assert.equal((await call("POST", `/api/ai/hoi-dap/${qaId}/trang-thai`, { trangThai: "xoa" })).status, 400);
  assert.ok(!(await ask("ship")).hoiDap.some((q: Body) => q["intent"] === "shipping"), "a retired Q&A is not read");
  assert.equal((await call("POST", "/api/ai/hang-duyet/khong-co/chan")).status, 404);
});

test("Đ7 analysis: archived conversations go to Xeon in batches WITHOUT personal data; results enter the queue only on request, as candidates", async () => {
  const seen: Body[] = [];
  const { call, b, store } = build({
    answer: (url, init) => {
      if (!url.includes("/ai/phan-tich-lo")) return undefined;
      seen.push(bodyOf(init));
      return { ok: true, ketQua: { tomTat: "hỏi size", nguyenTac: [{ tieuDe: "Hỏi mã trước", chiTiet: "Hỏi mã", loai: "hoi_lai" }], cauHoi: [{ intent: "ask_size", cauHoi: "còn size không", traLoi: "Dạ bác cho em mã", loai: "clarification_rule", lyDo: "hay gặp" }] } };
    }
  });
  const archive = new MessageArchive(store, () => T0);
  const rows = [];
  for (let c = 0; c < 25; c += 1) {
    rows.push({ maTin: `a${c}`, maHoiThoai: `facebook:k${String(c).padStart(2, "0")}`, trang: "trang-1", nguoi: `k${c}`, chieu: "den" as const, chu: `còn size 42 không, gọi 0912345678 nhé`, anh: [], luc: "2025-01-01T00:00:00.000Z" });
    rows.push({ maTin: `b${c}`, maHoiThoai: `facebook:k${String(c).padStart(2, "0")}`, trang: "trang-1", nguoi: `k${c}`, chieu: "di" as const, chu: "dạ còn ạ", anh: [], luc: "2025-01-01T00:01:00.000Z" });
  }
  await archive.upsert(rows);
  assert.equal((await call("POST", "/api/ai/phan-tich/dua-vao-hang-duyet")).status, 409, "nothing to import before the job is done");
  assert.equal((await call("POST", "/api/ai/phan-tich/bat-dau", {})).status, 200);
  let state: Body = {};
  for (let i = 0; i < 200; i += 1) { await wait(20); state = b(await call("GET", "/api/ai/phan-tich"))["phanTich"]; if (state["trangThai"] !== "dang-chay") break; }
  assert.equal(state["trangThai"], "xong", JSON.stringify(state));
  assert.equal(seen.length, 2, "25 conversations = two batches of 20");
  assert.equal(state["soHoiThoai"], 25);
  const sent = JSON.stringify(seen);
  assert.doesNotMatch(sent, /0912345678|facebook:k/, "no phone, no conversation id leaves the landing");
  assert.equal(state["cauHoi"].length, 1, "the same question from two batches is one");
  assert.equal(b(await call("GET", "/api/ai/huan-luyen"))["tongHangDuyet"], 0, "a finished job alone does not fill the queue");
  const imported = await call("POST", "/api/ai/phan-tich/dua-vao-hang-duyet");
  assert.equal(b(imported)["soMoi"], 2);
  assert.equal(b(await call("POST", "/api/ai/phan-tich/dua-vao-hang-duyet"))["soMoi"], 0);
  const queue = b(await call("GET", "/api/ai/huan-luyen"));
  assert.ok((queue["hangDuyet"] as Body[]).every((r) => r["trangThai"] === "candidate"), "NEVER auto-approved");
  assert.equal(queue["dem"].kichBan, 0);
});

test("Đ7 external product: settle + send the card through the inbox; the brain is told; un-settling stops it", async () => {
  assert.equal(parsePrice("boston 12 xanh sale 1.490k"), 1490000);
  assert.equal(parsePrice("1tr490"), 1490000);
  const settled = settle(null, { maHoiThoai: "facebook:k1", ten: "Boston 12", gia: "1490000" }, T0);
  assert.match(settled.item.ma, /^NG-0917-01$/);
  assert.equal(activeFor(settled.book, "facebook:k1", new Date(T0.getTime() + 8 * 86400000)), null, "7 days without an order = not settled any more");

  const { call, b, http } = build({ answer: (url) => (url.includes("/ai/doc-anh") ? { ok: true, doc: { brand: "adidas", model: "Adizero Boston 12", color: "xanh", code: "", confidence: 0.7 }, ungVien: [] } : undefined) });
  await call("POST", "/api/admin/fanpage/credentials", { pages: [{ pageId: "trang-1", name: "TopRun", accessToken: "tk-1" }] });
  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: packet("k1", "m.1", "mẫu này còn không") }, { token: SERVICE });
  await tick();
  const hint = await call("POST", "/api/ai/sp-ngoai/goi-y", { anh: ["https://scontent.test/boston.jpg"], goiY: "sale 1.490k", maHoiThoai: "facebook:k1" });
  assert.deepEqual([b(hint)["goiY"].ten, b(hint)["goiY"].gia], ["adidas Adizero Boston 12 xanh", 1490000]);
  assert.equal((await call("POST", "/api/ai/sp-ngoai", { maHoiThoai: "facebook:k1", ten: "", gia: 1 })).status, 400);
  const r = await call("POST", "/api/ai/sp-ngoai", { maHoiThoai: "facebook:k1", ten: "adidas Boston 12 xanh", size: "42", gia: "1.490.000", anh: "https://scontent.test/boston.jpg", gui: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(b(r)["spNgoai"].guiLuc);
  const graph = http.calls.filter((c) => c.url.includes("/messages"));
  assert.equal(graph.length, 2, "text then image");
  const view = b(await call("GET", "/api/ai/sp-ngoai?maHoiThoai=facebook:k1"));
  assert.equal(view["dangChot"].ten, "adidas Boston 12 xanh");
  assert.equal(view["ganDay"].length, 1);
  const k = b(await call("POST", "/api/bo-nao/cong-cu", { ten: "training.knowledge", input: { conversationId: "facebook:k1" } }, { token: SERVICE }))["data"];
  assert.deepEqual(k.spNgoai, { ma: view["dangChot"].ma, ten: "adidas Boston 12 xanh", size: "42", gia: 1490000 });
  assert.equal((await call("POST", `/api/ai/sp-ngoai/${view["dangChot"].id}/trang-thai`, { trangThai: "bo" })).status, 200);
  assert.equal(b(await call("GET", "/api/ai/sp-ngoai?maHoiThoai=facebook:k1"))["dangChot"], null);
});

test("Đ7 photos: the same image bytes are recognised after a person confirms the code; forgetting works; Xeon's candidates come along", async () => {
  const { call, b } = build({
    answer: (url) => {
      if (url.startsWith("https://scontent.test/")) return { __bytes: "anh-giay-boston" };
      if (url.includes("/ai/doc-anh")) return { ok: true, doc: { brand: "adidas", model: "Boston 13", code: "JP9252" }, ungVien: [{ ma: "JP9252", ten: "ADIZERO BOSTON 13 M", gia: 3290000 }] };
      return undefined;
    }
  });
  const first = b(await call("POST", "/api/ai/doc-anh", { maHoiThoai: "facebook:k1", anh: ["https://scontent.test/a.jpg", "javascript:alert(1)"] }));
  assert.equal(first["anh"].length, 1);
  assert.equal(first["anh"][0].nho, null);
  assert.equal(first["ungVien"][0].ma, "JP9252");
  const hash = first["anh"][0].bam as string;
  assert.match(hash, /^[a-f0-9]{24}$/);
  assert.equal((await call("POST", "/api/ai/anh-nho", { bam: hash, ma: "" })).status, 400);
  await call("POST", "/api/ai/anh-nho", { bam: hash, ma: "jp9252", ten: "Boston 13" });
  const again = b(await call("POST", "/api/ai/doc-anh", { anh: ["https://scontent.test/khac-duong-dan.jpg"] }));
  assert.equal(again["anh"][0].nho.ma, "JP9252", "different URL, same bytes");
  assert.equal(b(await call("POST", "/api/ai/anh-nho/quen", { bam: hash }))["daGo"], true);
  assert.equal(b(await call("POST", "/api/ai/doc-anh", { anh: ["https://scontent.test/a.jpg"] }))["anh"][0].nho, null);
});

test("Đ7 size signals: read from the customer's messages only, the last one wins, a dismissed one stops showing", async () => {
  const signals = extractFitSignals([
    { chieu: "den", chu: "chân em dài 26.5cm, ngang 10cm", luc: "1" },
    { chieu: "di", chu: "size 44 nhé", luc: "2" },
    { chieu: "den", chu: "em đang đi pegasus 41 size 42", luc: "3" },
    { chieu: "den", chu: "à size 42.5 mới vừa", luc: "4" }
  ]);
  assert.equal(signals.find((x) => x.value === "42")!.brand, "Nike", "a size said next to a model is that brand's size");
  assert.deepEqual(signals.map((s) => `${s.type}:${s.value}`).sort(), ["footLength:26.5", "footWidth:10", "sizeEU:42", "sizeEU:42.5", "wearing:pegasus 41 size 42"].sort());
  const { call, b } = build();
  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: packet("k1", "m.1", "chân em dài 26.5cm size 42") }, { token: SERVICE });
  await tick();
  const listed = b(await call("GET", "/api/ai/tin-hieu-size?maHoiThoai=facebook:k1"))["tinHieu"] as Body[];
  assert.equal(listed.length, 2);
  await call("POST", "/api/ai/tin-hieu-size/bo", { maHoiThoai: "facebook:k1", khoa: listed[0]!["khoa"] });
  assert.equal((b(await call("GET", "/api/ai/tin-hieu-size?maHoiThoai=facebook:k1"))["tinHieu"] as Body[]).length, 1);
});

test("Đ7 token + price table + demo go through to Xeon with the inbox token; refusals keep Xeon's reason", async () => {
  const { call, b, http } = build({
    answer: (url, init) => {
      if (url.endsWith("/ai/token")) return { ok: true, soToken: { days: bodyOf(init)["soNgay"], totals: { calls: 3 } } };
      if (url.endsWith("/ai/bang-gia") && init.method === "GET") return { ok: true, pricing: { rateVndPerUsd: 26120, models: [] }, source: "default", duocSua: false };
      if (url.endsWith("/ai/bang-gia")) return { ok: false, error: "khong_duoc_sua_bang_gia", message: "Bảng giá AI dùng chung mọi shop.", __status: 403 };
      if (url.endsWith("/ai/hop-cat")) return { ok: true, traLoi: "Dạ bác chạy cự ly nào ạ?", dauVet: [] };
      if (url.endsWith("/ai/de-xuat-kien-thuc")) return { ok: false, error: "chua_co_mo_hinh", message: "Xeon chưa cấu hình mô hình AI.", __status: 503 };
      return undefined;
    }
  });
  assert.equal(b(await call("POST", "/api/ai/token", { soNgay: 30 }))["soToken"].days, 30);
  assert.equal(http.calls.find((c) => c.url.endsWith("/ai/token"))!.init.headers!["Authorization"], "Bearer ma-nhan-tin");
  assert.equal(b(await call("GET", "/api/ai/bang-gia"))["duocSua"], false);
  const refused = await call("POST", "/api/ai/bang-gia", { rateVndPerUsd: 25000, models: [] });
  assert.deepEqual([refused.status, b(refused)["message"]], [403, "Bảng giá AI dùng chung mọi shop."]);
  assert.equal(b(await call("POST", "/api/ai/hop-cat", { lichSu: [{ ai: "khach", chu: "alo" }], chu: "tìm giày" }))["goiY"].traLoi, "Dạ bác chạy cự ly nào ạ?");
  const noModel = await call("POST", "/api/ai/thu-vien/de-xuat", { chuDe: "tennis" });
  assert.deepEqual([noModel.status, b(noModel)["error"]], [503, "chua_co_mo_hinh"]);
  assert.equal((await call("POST", "/api/ai/thu-vien/de-xuat", {})).status, 400);
  assert.equal((await call("GET", "/api/ai/huan-luyen", undefined, { token: "" })).status, 401, "OMI / web admin only");
});
