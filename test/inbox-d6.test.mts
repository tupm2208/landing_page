/**
 * Đ6 (17/09/2026) — Fanpage + Zalo đủ việc, chưa cần AI: images kept, "tải thêm" cursor, the thread
 * panel (profile, orders, note, bot mode, order card), Zalo staff, private replies, the original
 * post, quick replies, the webhook log, pages through the central Meta app on Xeon, the long-term
 * archive with its checkpoint, and "cần người" on Telegram. No Internet: fake Meta, Xeon, Telegram.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLE, defineModule, type HttpRequestInit, type IncomingRequest } from "../dist/contract/index.js";
import { FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, MemoryUploadPort, TokenAuth, jsonResponse } from "../dist/kernel/index.js";
import { manifest as inbox, type Config } from "../dist/modules/hop-thu/module.js";
import { parseTelegramCommand } from "../dist/modules/hop-thu/handoff-alerts.js";

const ADMIN = "ma-quan-tri-d6";
const SERVICE = "ve-dich-vu-d6";
const T0 = new Date("2026-09-17T08:00:00.000Z");

type Answer = (url: string, init: HttpRequestInit) => unknown;

function build({ answer = (() => ({})) as Answer, settings = {} as Record<string, string>, siteUrl = "https://shop.test" } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hop-thu-d6-"));
  const logger = new MemoryLogger();
  const clock = new ManualClock(T0);
  const http = new FakeHttpClient((url: string, init: HttpRequestInit) => {
    if (url.includes("/tin-den")) return jsonResponse({ ok: true });
    const r = answer(url, init) as { __status?: number } | undefined;
    return jsonResponse(r ?? {}, r?.__status ?? 200);
  });
  const store = new JsonFileStore(directory, logger);
  const platform = defineModule({
    id: "khung-nen-tang", name: "Nền giả", tier: "khung", runsOn: "server-khach", version: "0.0.1",
    provides: {
      "khung-nen-tang.xeon": async () => ({ shop: "toprun", diaChiXeon: "https://xeon.test", maNhanTin: "ma-nhan-tin" }),
      "khung-nen-tang.settings": async () => ({ telegram_bot_token: "tk-bot", telegram_chat_bao_dong: "-100", ...settings })
    }
  });
  const config: Config = { verifyToken: "", appSecret: "", pageToken: "", siteUrl, brain: { address: "https://xeon.test", token: "ma-nhan-tin", tenant: "toprun" } };
  const kernel = new Kernel({
    ports: {
      store, logger, clock, http, rateLimiter: new FixedWindowRateLimiter(clock), uploads: new MemoryUploadPort(),
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }, { token: SERVICE, name: "xeon", role: ROLE.service }], clock })
    },
    logger,
    modules: [inbox, platform],
    config: { "hop-thu": config }
  });
  const call = async (method: string, p: string, body?: unknown, { token = ADMIN, headers = {} as Record<string, string> } = {}) => {
    const [pathname, search = ""] = p.split("?");
    const query = Object.fromEntries(new URLSearchParams(search));
    return kernel.handle({
      method, path: pathname!, query, ip: "1.1.1.1",
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, json: async () => body ?? {}
    } as IncomingRequest);
  };
  const b = (r: { body?: unknown }) => r.body as Record<string, unknown>;
  return { kernel, http, store, clock, call, b };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tick = async (n = 3) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };
const bodyOf = (init: HttpRequestInit) => JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
const toBrain = (http: FakeHttpClient) => http.calls.filter((c) => c.url.includes("/tin-den"));

const messagePacket = (page: string, customer: string, mid: string, text: string, images: string[] = [], at = T0.getTime() - 60000) => ({
  object: "page",
  entry: [{ id: page, time: at, messaging: [{ sender: { id: customer }, recipient: { id: page }, timestamp: at, message: { mid, text, attachments: images.map((url) => ({ type: "image", payload: { url } })) } }] }]
});

test("Đ6 images: a Messenger photo and a comment photo keep their ADDRESSES in the thread; what we send keeps ours", async () => {
  const { call, b } = build({ answer: () => ({ message_id: "m.di", ok: true, ketQua: [] }) });
  await call("POST", "/api/admin/fanpage/credentials", { pages: [{ pageId: "trang-1", name: "TopRun", accessToken: "tk-1" }] });
  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: messagePacket("trang-1", "k1", "m.1", "", ["https://scontent.test/a.jpg", "https://scontent.test/b.jpg", "javascript:alert(1)"]) }, { token: SERVICE });
  const thread = b(await call("GET", "/api/hop-thu/hoi-thoai/facebook:k1"))["hoiThoai"] as { tin: { anh?: string[]; soAnh: number }[]; tinCuoi: string };
  assert.deepEqual(thread.tin[0]!.anh, ["https://scontent.test/a.jpg", "https://scontent.test/b.jpg"]);
  assert.equal(thread.tin[0]!.soAnh, 3, "three image attachments, two usable addresses");
  assert.equal(thread.tinCuoi, "(3 ảnh)");

  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: { object: "page", entry: [{ id: "trang-1", time: 1, changes: [{ field: "feed", value: { item: "comment", verb: "add", from: { id: "k9", name: "Nam" }, message: "", photo: "https://scontent.test/c.jpg", comment_id: "c.1", post_id: "trang-1_99", created_time: 1789459200 } }] }] } }, { token: SERVICE });
  const comment = b(await call("GET", "/api/hop-thu/hoi-thoai/facebook-binh-luan:k9"))["hoiThoai"] as { tin: { anh?: string[] }[] };
  assert.deepEqual(comment.tin[0]!.anh, ["https://scontent.test/c.jpg"]);

  const sent = await call("POST", "/api/hop-thu/gui", { kenh: "facebook", nguoi: "k1", chu: "", anhUrl: "/api/fanpage-media/fbm_1.png" });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const after = b(await call("GET", "/api/hop-thu/hoi-thoai/facebook:k1"))["hoiThoai"] as { tin: { chieu: string; anh?: string[] }[] };
  assert.deepEqual(after.tin.at(-1)!.anh, ["https://shop.test/api/fanpage-media/fbm_1.png"]);
});

test("Đ6 tải thêm: a full page returns a cursor; the next page starts strictly after it and ends with none", async () => {
  const { call, b } = build();
  for (let i = 0; i < 5; i += 1) {
    await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: messagePacket("trang-1", `k${i}`, `m.${i}`, `tin ${i}`, [], 1789459200000 + i * 1000) }, { token: SERVICE });
  }
  const first = b(await call("GET", "/api/hop-thu/hoi-thoai?limit=2"));
  assert.deepEqual((first["hoiThoai"] as { nguoi: string }[]).map((t) => t.nguoi), ["k4", "k3"]);
  assert.ok(String(first["conTruoc"]).includes("|facebook:k3"));
  const second = b(await call("GET", `/api/hop-thu/hoi-thoai?limit=2&truoc=${encodeURIComponent(String(first["conTruoc"]))}`));
  assert.deepEqual((second["hoiThoai"] as { nguoi: string }[]).map((t) => t.nguoi), ["k2", "k1"]);
  const third = b(await call("GET", `/api/hop-thu/hoi-thoai?limit=2&truoc=${encodeURIComponent(String(second["conTruoc"]))}`));
  assert.deepEqual((third["hoiThoai"] as { nguoi: string }[]).map((t) => t.nguoi), ["k0"]);
  assert.equal(third["conTruoc"], "");
});

test("Đ6 thread panel: link a profile and orders, reject a suggestion, note; bot OFF files the next message without answering", async () => {
  const { call, b, http } = build();
  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: messagePacket("trang-1", "k1", "m.1", "alo") }, { token: SERVICE });
  await tick();
  assert.equal(toBrain(http).length, 1);
  assert.equal((await call("POST", "/api/hop-thu/hoi-thoai/facebook:khong-co/thong-tin", { ghiChu: "x" })).status, 404);
  assert.equal((await call("POST", "/api/hop-thu/hoi-thoai/facebook:k1/thong-tin", {})).status, 400);

  let r = await call("POST", "/api/hop-thu/hoi-thoai/facebook:k1/thong-tin", { maKhach: "kh_1", ganDon: "MAN-1", ghiChu: "chân bè, hay hỏi size 42" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await call("POST", "/api/hop-thu/hoi-thoai/facebook:k1/thong-tin", { boGoiYDon: "LAND-9" });
  await call("POST", "/api/hop-thu/hoi-thoai/facebook:k1/thong-tin", { ganDon: "LAND-9" });
  r = await call("POST", "/api/hop-thu/hoi-thoai/facebook:k1/thong-tin", { boGanDon: "MAN-1" });
  const t = b(r)["hoiThoai"] as Record<string, unknown>;
  assert.equal(t["maKhach"], "kh_1");
  assert.deepEqual(t["donGan"], ["LAND-9"]);
  assert.deepEqual(t["donBoGoiY"], [], "linking a rejected suggestion un-rejects it");
  assert.equal(t["ghiChu"], "chân bè, hay hỏi size 42");

  assert.equal((await call("POST", "/api/hop-thu/hoi-thoai/facebook:k1/thong-tin", { bot: "tu-dong" })).status, 400);
  assert.equal((await call("POST", "/api/hop-thu/hoi-thoai/facebook:k1/thong-tin", { theDatHang: { ma: "", soLuong: 1 } })).status, 400);
  r = await call("POST", "/api/hop-thu/hoi-thoai/facebook:k1/thong-tin", { bot: "off", theDatHang: { ma: "A1", ten: "Giày A1", size: "42", soLuong: 2, gia: 2500000, dienThoai: "0911 111 111", diaChi: "12 Đội Cấn" } });
  const draft = (b(r)["hoiThoai"] as Record<string, unknown>)["theDatHang"] as Record<string, unknown>;
  assert.equal(draft["dienThoai"], "0911111111");
  assert.equal(draft["luuLuc"], T0.toISOString());

  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: messagePacket("trang-1", "k1", "m.2", "còn không shop") }, { token: SERVICE });
  await tick();
  assert.equal(toBrain(http).length, 1, "bot off: filed, not pushed");
  const rows = b(await call("GET", "/api/hop-thu/hoi-thoai"))["hoiThoai"] as Record<string, unknown>[];
  assert.equal(rows[0]!["tinCuoi"], "còn không shop");
  assert.equal(rows[0]!["bot"], "off");
});

test("Đ6 Zalo: the shop's people are not customers; an internal group is never answered; settings are partial", async () => {
  const { call, b, http } = build();
  let r = await call("POST", "/api/hop-thu/cau-hinh", { nguoiCuaShop: "Dũng TopRun, Lan trực ,Dũng TopRun", phutQuaHan: 20, mauXacNhan: "Nhắn OK giúp shop ạ" });
  assert.equal(r.status, 200);
  const cfg = b(r)["cauHinh"] as Record<string, unknown>;
  assert.deepEqual(cfg["nguoiCuaShop"], ["Dũng TopRun", "Lan trực"]);
  assert.equal(cfg["nguongTinCuGio"], 24, "untouched field keeps its value");
  assert.equal((await call("POST", "/api/hop-thu/cau-hinh", { phutQuaHan: 0 })).status, 400);

  r = await call("POST", "/api/hop-thu/tin-vao", { tin: [
    { kenh: "zalo", nguoi: "g1", tenNguoi: "Nhóm A · lan trực", chu: "để em check", maTin: "z1", luc: T0.toISOString() },
    { kenh: "zalo", nguoi: "g1", tenNguoi: "Nhóm A · Khách Hoa", chu: "còn 38 không", maTin: "z2", luc: T0.toISOString() }
  ] });
  assert.equal(b(r)["cuaShop"], 1);
  await tick();
  assert.equal(toBrain(http).length, 1, "only the customer's message goes to the brain");
  const thread = b(await call("GET", "/api/hop-thu/hoi-thoai/zalo:g1"))["hoiThoai"] as { tin: { chieu: string; boi: string }[] };
  assert.deepEqual(thread.tin.map((m) => [m.chieu, m.boi]), [["di", "lan trực"], ["den", "khach"]]);

  await call("POST", "/api/hop-thu/hoi-thoai/zalo:g1/thong-tin", { daXacNhan: true, noiBo: true, bot: "off", tenKhach: "Hoa", maDon: "DH-1" });
  await call("POST", "/api/hop-thu/tin-vao", { tin: [{ kenh: "zalo", nguoi: "g1", tenNguoi: "Nhóm A · Khách Hoa", chu: "alo", maTin: "z3", luc: T0.toISOString() }] });
  await tick();
  assert.equal(toBrain(http).length, 1, "internal group: never answered");
});

test("Đ6 comments: private reply opens the Messenger thread, notes it under the comment, can also reply publicly; the post is read", async () => {
  const graph: string[] = [];
  const { call, b } = build({
    answer: (url, init) => {
      graph.push(`${init.method ?? "GET"} ${url.split("?")[0]}`);
      if (url.includes("/messages")) return { recipient_id: "psid-9", message_id: "m.rieng" };
      if (url.includes("/comments")) return { id: "c.tra" };
      if (url.includes("trang-1_99")) return { id: "trang-1_99", message: "Pegasus 41 về hàng", created_time: "2026-09-10T02:00:00+0000", permalink_url: "https://fb.test/p/99", full_picture: "https://scontent.test/p.jpg", attachments: { data: [{ type: "album", subattachments: { data: [{ media: { image: { src: "https://scontent.test/1.jpg" } }, title: "đen" }, { media: { image: { src: "https://scontent.test/2.jpg" } } }] } }] } };
      if (url.includes("/meta/trang")) return { ok: true, ketQua: [] };
      return {};
    }
  });
  await call("POST", "/api/admin/fanpage/credentials", { pages: [{ pageId: "trang-1", name: "TopRun", accessToken: "tk-1" }] });
  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: { object: "page", entry: [{ id: "trang-1", time: 1, changes: [{ field: "feed", value: { item: "comment", verb: "add", from: { id: "k9", name: "Nam" }, message: "giá sao", comment_id: "c.1", post_id: "trang-1_99", created_time: 1789459200 } }] }] } }, { token: SERVICE });

  assert.equal((await call("POST", "/api/hop-thu/tra-loi-rieng", { maHoiThoai: "facebook:k1", chu: "x" })).status, 404);
  assert.equal((await call("POST", "/api/hop-thu/tra-loi-rieng", { maHoiThoai: "facebook-binh-luan:k9", chu: " " })).status, 400);
  const r = await call("POST", "/api/hop-thu/tra-loi-rieng", { maHoiThoai: "facebook-binh-luan:k9", chu: "Dạ em inbox giá ạ", traLoiCongKhai: "Page đã nhắn tin cho bạn" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(b(r)["maHoiThoaiMessenger"], "facebook:psid-9");
  assert.ok(graph.includes("POST https://graph.facebook.com/v21.0/trang-1/messages"));
  assert.ok(graph.includes("POST https://graph.facebook.com/v21.0/c.1/comments"));
  const messenger = b(await call("GET", "/api/hop-thu/hoi-thoai/facebook:psid-9"))["hoiThoai"] as { trang: string; tin: { chu: string }[] };
  assert.equal(messenger.trang, "trang-1");
  assert.equal(messenger.tin[0]!.chu, "Dạ em inbox giá ạ");
  const under = b(await call("GET", "/api/hop-thu/hoi-thoai/facebook-binh-luan:k9"))["hoiThoai"] as { tin: { chu: string }[] };
  assert.deepEqual(under.tin.map((m) => m.chu), ["giá sao", "(Đã nhắn riêng) Dạ em inbox giá ạ", "Page đã nhắn tin cho bạn"]);

  const post = await call("GET", "/api/hop-thu/bai-viet?maHoiThoai=facebook-binh-luan:k9");
  assert.equal(post.status, 200, JSON.stringify(post.body));
  const bai = b(post)["bai"] as Record<string, unknown>;
  assert.equal(bai["noiDung"], "Pegasus 41 về hàng");
  assert.equal(bai["lienKet"], "https://fb.test/p/99");
  assert.deepEqual(bai["anhCon"], [{ anh: "https://scontent.test/1.jpg", tieuDe: "đen" }, { anh: "https://scontent.test/2.jpg", tieuDe: "" }]);
  assert.equal((await call("GET", "/api/hop-thu/bai-viet?maHoiThoai=facebook:psid-9")).status, 404);
});

test("Đ6 quick replies: save, edit, clash on shortcut, delete; webhook log decodes packets newest first", async () => {
  const { call, b } = build();
  let r = await call("POST", "/api/hop-thu/mau-tra-loi", { tat: "#stk", chu: "STK 123 Vietcombank" });
  assert.equal(r.status, 200);
  const id = (b(r)["mau"] as { ma: string }).ma;
  assert.equal((await call("POST", "/api/hop-thu/mau-tra-loi", { tat: "STK", chu: "khác" })).status, 400, "shortcut clash");
  assert.equal((await call("POST", "/api/hop-thu/mau-tra-loi", { tat: "do", chu: "" })).status, 400);
  r = await call("POST", "/api/hop-thu/mau-tra-loi", { ma: id, tat: "stk", chu: "STK 456", anhUrl: "/api/fanpage-media/qr.png" });
  assert.equal(r.status, 200);
  let list = b(await call("GET", "/api/hop-thu/mau-tra-loi"))["mau"] as { ma: string; chu: string; anhUrl: string }[];
  assert.deepEqual(list.map((m) => [m.ma, m.chu, m.anhUrl]), [[id, "STK 456", "/api/fanpage-media/qr.png"]]);
  assert.equal((await call("POST", "/api/hop-thu/mau-tra-loi/xoa", { ma: id })).status, 200);
  assert.equal((await call("POST", "/api/hop-thu/mau-tra-loi/xoa", { ma: id })).status, 404);
  list = b(await call("GET", "/api/hop-thu/mau-tra-loi"))["mau"] as never;
  assert.equal(list.length, 0);

  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: messagePacket("trang-1", "k1", "m.1", "một") }, { token: SERVICE });
  await call("POST", "/api/hop-thu/tin-vao", { tin: [{ kenh: "zalo", nguoi: "g1", chu: "hai", maTin: "z1" }] });
  const log = b(await call("GET", "/api/hop-thu/nhat-ky-webhook?limit=5"));
  const events = log["suKien"] as { nguon: string; goi: Record<string, unknown> }[];
  assert.deepEqual(events.map((e) => e.nguon), ["omi", "xeon"]);
  assert.equal((events[1]!.goi["entry"] as unknown[]).length, 1);
});

test("Đ6 pages through the central Meta app: log in via Xeon, collect the pages, subscribe one, disconnect one", async () => {
  const xeon: { path: string; body: Record<string, unknown> }[] = [];
  let collected = false;
  const { call, b } = build({
    answer: (url, init) => {
      if (!url.startsWith("https://xeon.test")) return {};
      const p = url.slice("https://xeon.test".length);
      xeon.push({ path: p, body: bodyOf(init) });
      assert.equal((init.headers ?? {})["Authorization"], "Bearer ma-nhan-tin");
      if (p === "/meta/dang-nhap") return { ok: true, url: "https://www.facebook.com/dialog/oauth?state=s1", maPhien: "s1", hetSauGiay: 900 };
      if (p.startsWith("/meta/dang-nhap/ket-qua")) return collected ? { ok: true, xong: true, trang: [{ ma: "trang-1", ten: "TopRun", token: "tk-1" }, { ma: "trang-2", ten: "TopRun 2", token: "tk-2" }] } : { ok: true, xong: false, loi: "" };
      if (p === "/meta/trang") return { ok: true, ketQua: (bodyOf(init)["trang"] as { ma: string }[]).map((x) => ({ ma: x.ma, ok: true, ten: x.ma, daDangKyNhanTin: true })) };
      if (p === "/meta/trang/ngat") return { ok: true, daNgat: ["trang-2"], huyDangKy: [{ ma: "trang-2", ok: true }] };
      return { __status: 404 };
    }
  });
  let r = await call("POST", "/api/hop-thu/ket-noi-facebook");
  assert.equal(r.status, 200);
  assert.equal(b(r)["maPhien"], "s1");
  r = await call("POST", "/api/hop-thu/ket-noi-facebook/xong", { maPhien: "s1" });
  assert.equal(r.status, 409, "the person has not granted yet");
  collected = true;
  r = await call("POST", "/api/hop-thu/ket-noi-facebook/xong", { maPhien: "s1" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual((b(r)["trang"] as { ma: string; coToken: boolean }[]).map((p) => [p.ma, p.coToken]), [["trang-1", true], ["trang-2", true]]);
  assert.ok(!JSON.stringify(r.body).includes("tk-1"), "a token never comes back to the screen");
  assert.deepEqual(xeon.find((x) => x.path === "/meta/trang")!.body["trang"], [{ ma: "trang-1", ten: "TopRun", token: "tk-1" }, { ma: "trang-2", ten: "TopRun 2", token: "tk-2" }]);

  r = await call("POST", "/api/hop-thu/trang/dang-ky", { ma: "trang-1" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await call("POST", "/api/hop-thu/trang/dang-ky", { ma: "trang-9" })).status, 404);

  r = await call("POST", "/api/hop-thu/trang/ngat", { ma: ["trang-2"] });
  assert.equal(r.status, 200);
  assert.deepEqual(xeon.at(-1)!.body, { trang: [{ ma: "trang-2", token: "tk-2" }] }, "Xeon gets the token to unsubscribe at Meta");
  assert.deepEqual((b(await call("GET", "/api/hop-thu/trang"))["trang"] as { ma: string }[]).map((p) => p.ma), ["trang-1"]);
});

test("Đ6 archive: backfill walks conversations and messages with a checkpoint, stops at the since-date, restarts without duplicates, pauses", async () => {
  const graph: string[] = [];
  let failNext = false;
  const { call, b } = build({
    answer: (url) => {
      if (url.includes("/meta/trang")) return { ok: true, ketQua: [] };
      if (!url.startsWith("https://graph.facebook.com")) return {};
      const u = new URL(url);
      graph.push(`${u.pathname}${u.searchParams.get("after") ? `@${u.searchParams.get("after")}` : ""}`);
      if (failNext) { failNext = false; return { __status: 500, error: { message: "Meta bận" } }; }
      if (u.pathname.endsWith("/trang-1/conversations")) {
        return u.searchParams.get("after") === "p2"
          ? { data: [{ id: "t_3", updated_time: "2024-01-02T00:00:00+0000", participants: { data: [{ id: "trang-1" }, { id: "k3" }] } }, { id: "t_old", updated_time: "2022-06-01T00:00:00+0000", participants: { data: [{ id: "k4" }] } }], paging: { cursors: { after: "p3" }, next: "https://graph/next" } }
          : { data: [{ id: "t_1", updated_time: "2026-09-01T00:00:00+0000", participants: { data: [{ id: "k1", name: "A" }, { id: "trang-1" }] } }], paging: { cursors: { after: "p2" }, next: "https://graph/next" } };
      }
      if (u.pathname.endsWith("/t_1/messages")) {
        return u.searchParams.get("after") === "m2"
          ? { data: [{ id: "mid.3", message: "hỏi size", from: { id: "k1" }, created_time: "2026-08-01T00:00:00+0000" }] }
          : { data: [{ id: "mid.1", message: "dạ còn ạ", from: { id: "trang-1" }, created_time: "2026-09-01T00:00:00+0000" }, { id: "mid.2", message: "", from: { id: "k1" }, created_time: "2026-08-31T00:00:00+0000", attachments: { data: [{ image_data: { url: "https://scontent.test/x.jpg" } }] } }], paging: { cursors: { after: "m2" }, next: "https://graph/n" } };
      }
      if (u.pathname.endsWith("/t_3/messages")) return { data: [{ id: "mid.9", message: "cũ", from: { id: "k3" }, created_time: "2024-01-02T00:00:00+0000" }, { id: "mid.8", message: "quá cũ", from: { id: "k3" }, created_time: "2022-01-01T00:00:00+0000" }] };
      return { data: [] };
    }
  });
  assert.equal((await call("POST", "/api/hop-thu/luu-tru/bat-dau", {})).status, 409, "no page connected yet");
  assert.equal((await call("POST", "/api/hop-thu/luu-tru/buoc", {})).status, 409);
  await call("POST", "/api/admin/fanpage/credentials", { pages: [{ pageId: "trang-1", name: "TopRun", accessToken: "tk-1" }] });

  failNext = true;
  let r = await call("POST", "/api/hop-thu/luu-tru/bat-dau", {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let state: Record<string, unknown> = {};
  for (let i = 0; i < 400; i += 1) { await wait(50); state = b(await call("GET", "/api/hop-thu/luu-tru"))["luuTru"] as Record<string, unknown>; if (state["trangThai"] !== "dang-chay") break; }
  assert.equal(state["trangThai"], "loi", `an error stops the loop and is shown: ${JSON.stringify(state)} ${JSON.stringify(graph)}`);
  assert.match(String(state["loiCuoi"]), /Meta bận/);

  r = await call("POST", "/api/hop-thu/luu-tru/bat-dau", {});
  for (let i = 0; i < 400; i += 1) { await wait(50); state = b(await call("GET", "/api/hop-thu/luu-tru"))["luuTru"] as Record<string, unknown>; if (state["trangThai"] !== "dang-chay") break; }
  assert.equal(state["trangThai"], "xong", JSON.stringify(state));
  const page = (state["trang"] as Record<string, Record<string, unknown>>)["trang-1"]!;
  assert.equal(page["xong"], true);
  assert.equal(page["soHoiThoai"], 2);
  assert.equal(page["soTin"], 4, "the 2022 message and the 2022 conversation are left out");
  assert.equal((state["tong"] as Record<string, number>)["trongKho"], 4);

  const older = b(await call("GET", "/api/hop-thu/luu-tru/tin?maHoiThoai=facebook:k1&limit=2"));
  assert.deepEqual((older["tin"] as { maTin: string; chieu: string }[]).map((m) => [m.maTin, m.chieu]), [["mid.2", "den"], ["mid.1", "di"]]);
  assert.equal(older["conNua"], true);
  const oldest = b(await call("GET", "/api/hop-thu/luu-tru/tin?maHoiThoai=facebook:k1&truoc=2026-08-31T00:00:00.000Z"));
  assert.deepEqual((oldest["tin"] as { maTin: string }[]).map((m) => m.maTin), ["mid.3"]);
  assert.deepEqual(((older["tin"] as { anh: string[] }[])[0]!).anh, ["https://scontent.test/x.jpg"]);

  // Restart from the beginning: cursors reset, the archive does not double.
  r = await call("POST", "/api/hop-thu/luu-tru/bat-dau", { lamLai: true });
  assert.equal(b(r)["luuTru"] && ((b(r)["luuTru"] as Record<string, unknown>)["trang"] as Record<string, Record<string, unknown>>)["trang-1"]!["sau"], "");
  // Pause right away: the loop honours it after the step in flight.
  await call("POST", "/api/hop-thu/luu-tru/dung", {});
  for (let i = 0; i < 400; i += 1) { await wait(50); state = b(await call("GET", "/api/hop-thu/luu-tru"))["luuTru"] as Record<string, unknown>; if (state["trangThai"] !== "dang-dung" && state["trangThai"] !== "dang-chay") break; }
  assert.equal(state["trangThai"], "da-dung");
  // One step by hand continues from the checkpoint.
  r = await call("POST", "/api/hop-thu/luu-tru/buoc", {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (let i = 0; i < 5; i += 1) await call("POST", "/api/hop-thu/luu-tru/buoc", {});
  state = b(await call("GET", "/api/hop-thu/luu-tru"))["luuTru"] as Record<string, unknown>;
  assert.equal((state["tong"] as Record<string, number>)["trongKho"], 4, "upsert: no duplicates after a full re-run");
});

test("Đ6 cần người on Telegram: alert on handoff, overdue reminder once, webhook set with a secret, /xong and /tra from the on-duty group only", async () => {
  const telegram: { method: string; body: Record<string, unknown> }[] = [];
  const { call, b, clock } = build({
    answer: (url, init) => {
      if (url.startsWith("https://api.telegram.org/bottk-bot/")) { telegram.push({ method: url.split("/").pop()!, body: bodyOf(init) }); return { ok: true }; }
      if (url.includes("/messages")) return { message_id: "m.tg" };
      return {};
    }
  });
  await call("POST", "/api/admin/fanpage/credentials", { pages: [{ pageId: "trang-1", name: "TopRun", accessToken: "tk-1" }] });
  await call("POST", "/api/hop-thu/meta-tu-xeon", { goi: messagePacket("trang-1", "k1", "m.1", "đổi size được không") }, { token: SERVICE });
  await call("POST", "/api/hop-thu/can-nguoi", { maHoiThoai: "facebook:k1", kenh: "facebook", nguoi: "k1", lyDo: "đổi trả", tinCuoi: "đổi size được không" }, { token: SERVICE });
  await tick();
  assert.equal(telegram.length, 1);
  assert.equal(telegram[0]!.body["chat_id"], "-100");
  assert.match(String(telegram[0]!.body["text"]), /Cần người trả lời[\s\S]*facebook:k1[\s\S]*\/tra facebook:k1/);

  let r = await call("POST", "/api/hop-thu/can-nguoi/quet-qua-han", {});
  assert.equal(b(r)["quaHan"], 0);
  clock.advance(16 * 60 * 1000);
  r = await call("POST", "/api/hop-thu/can-nguoi/quet-qua-han", {});
  assert.deepEqual([b(r)["quaHan"], b(r)["daBao"]], [1, 1]);
  assert.match(String(telegram.at(-1)!.body["text"]), /Quá 15 phút/);
  r = await call("POST", "/api/hop-thu/can-nguoi/quet-qua-han", {});
  assert.equal(b(r)["quaHan"], 0, "reminded once, not every scan");

  r = await call("POST", "/api/hop-thu/telegram/dat-webhook", {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const set = telegram.find((x) => x.method === "setWebhook")!;
  assert.equal(set.body["url"], "https://shop.test/api/hop-thu/telegram/webhook");
  const secret = String(set.body["secret_token"]);
  assert.ok(secret.length >= 32);
  assert.ok(!JSON.stringify((await call("GET", "/api/hop-thu/cau-hinh")).body).includes(secret), "the secret never leaves");

  const hook = (text: string, chat = "-100", token = secret) => call("POST", "/api/hop-thu/telegram/webhook", { message: { chat: { id: chat }, from: { first_name: "Lan" }, text } }, { token: "", headers: { "x-telegram-bot-api-secret-token": token } });
  assert.equal((await hook("/xong facebook:k1", "-100", "sai-bi-mat-sai-bi-mat-sai-bi-mat-00000000")).status, 401);
  assert.equal(b(await hook("/xong facebook:k1", "999"))["boQua"], "khong_phai_nhom_truc");
  r = await hook("/tra facebook:k1 Dạ đổi được trong 7 ngày ạ");
  assert.equal(b(r)["viec"], "tra");
  const thread = b(await call("GET", "/api/hop-thu/hoi-thoai/facebook:k1"))["hoiThoai"] as { tin: { chu: string; boi: string }[] };
  assert.deepEqual([thread.tin.at(-1)!.chu, thread.tin.at(-1)!.boi], ["Dạ đổi được trong 7 ngày ạ", "telegram:Lan"]);
  r = await hook("/xong facebook:k1");
  assert.equal(b(r)["found"], true);
  assert.equal(b(await call("GET", "/api/hop-thu/can-nguoi"))["soDangCho"], 0);

  assert.deepEqual(parseTelegramCommand("/tra@TopRunBot zalo:g1 ok ạ"), { viec: "tra", ma: "zalo:g1", chu: "ok ạ" });
  assert.equal(parseTelegramCommand("/tra zalo:g1"), null);
  assert.equal(parseTelegramCommand("xin chào"), null);
});

test("Đ6 Telegram webhook needs an https site address", async () => {
  const { call } = build({ siteUrl: "http://127.0.0.1:4181" });
  assert.equal((await call("POST", "/api/hop-thu/telegram/dat-webhook", {})).status, 409);
});
