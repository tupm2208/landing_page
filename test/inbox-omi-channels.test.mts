/**
 * LINE 2 — Zalo / personal Facebook through OMI (decided 14/09/2026).
 *
 * OMI reads a message -> /api/hop-thu/tin-vao -> inbox -> brain. The brain replies -> outbox ->
 * the on-duty OMI pulls -> types -> reports back. Messages older than the threshold are not auto-answered.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EVENTS, ROLE } from "../dist/contract/index.js";
import { FakeHttpClient, FixedWindowRateLimiter, MemoryUploadPort, JsonFileStore, Kernel, ManualClock, MemoryLogger, TokenAuth, jsonResponse } from "../dist/kernel/index.js";
import { generateSigningKey, signTicket } from "../dist/shared/ticket-kit.js";
import { OUTBOX_DOCUMENT, manifest as inbox } from "../dist/modules/hop-thu/module.js";
import { Outbox, type OutboxBook } from "../dist/modules/hop-thu/outbox.js";

const ADMIN = "ma-quan-tri-thu";
const BRAIN = "ma-bo-nao-thu";
const SHOP = "toprun";
const T0 = "2026-09-14T08:00:00.000Z";

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

function build() {
  const logger = new MemoryLogger();
  const clock = new ManualClock(T0);
  const http = new FakeHttpClient(() => jsonResponse({ ok: true }));
  const store = new JsonFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "hop-thu-omi-")), logger);
  const signingKey = generateSigningKey();
  const auth = new TokenAuth({
    keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }, { token: BRAIN, name: "bo-nao", role: ROLE.service }],
    xeon: { keyId: signingKey.keyId, publicKeyPem: signingKey.khoaCongPem, shop: SHOP },
    clock, logger
  });
  const kernel = new Kernel({
    ports: { store, logger, clock, http, auth, rateLimiter: new FixedWindowRateLimiter(clock), uploads: new MemoryUploadPort() },
    logger, modules: [inbox],
    config: { "hop-thu": { verifyToken: "v", appSecret: "s", pageToken: "tk", brain: { address: "https://xeon.test", token: "nt-thu", tenant: SHOP } } }
  });
  const events: { name: "den" | "di"; payload: Body }[] = [];
  kernel.bus.on(EVENTS.messageIn, "thu", (p) => events.push({ name: "den", payload: p as Body }));
  kernel.bus.on(EVENTS.messageOut, "thu", (p) => events.push({ name: "di", payload: p as Body }));
  const ticket = ({ onDuty = true, machine = "may 1", features = ["hop-thu"] }: { onDuty?: boolean; machine?: string; features?: string[] } = {}) => {
    const t = clock.now().getTime();
    return signTicket({ vai: "quan-tri", shop: SHOP, tenShop: "TopRun", maMay: `may-${machine}-xxxxxxxxxxxxxxx`, tenMay: machine, manh: features, truc: onDuty, phatLuc: t, hetLuc: t + 7 * 3600 * 1000 }, signingKey);
  };
  const call = (method: string, route: string, { token = ADMIN, body, query = {} }: { token?: string; body?: unknown; query?: Record<string, string> } = {}) =>
    kernel.handle({ method, path: route, query, ip: "1.1.1.1", headers: { authorization: `Bearer ${token}` }, json: async () => body ?? {} });
  const wait = () => new Promise((r) => setTimeout(r, 15));
  const pushedToXeon = () => http.calls.filter((c) => c.url.endsWith("/tin-den")).map((c) => JSON.parse(c.init.body!) as Body);
  return { kernel, call, clock, logger, http, store, events, ticket, wait, pushedToXeon };
}

const MESSAGE = (n = 1, extra: Record<string, unknown> = {}) => ({ kenh: "zalo", nguoi: "zalo-khach-1", tenNguoi: "Anh Nam", chu: `con size 42 khong ${n}`, maTin: `z-${n}`, luc: T0, ...extra });

test("OMI pushes Zalo messages in: stored, announced, pushed to the brain; duplicate ids skipped; bad shapes counted apart; unknown channel refused", async () => {
  const { call, wait, events, pushedToXeon } = build();
  const r1 = await call("POST", "/api/hop-thu/tin-vao", { body: { tin: [MESSAGE(1), MESSAGE(2), MESSAGE(1), { kenh: "zalo", nguoi: "x" }, MESSAGE(3, { kenh: "telegram" })] } });
  assert.equal(r1.status, 200);
  const b1 = r1.body as Body;
  assert.deepEqual({ daNhan: b1.daNhan, trung: b1.trung, saiHinhDang: b1.saiHinhDang }, { daNhan: 2, trung: 1, saiHinhDang: 2 });
  await wait();
  assert.equal(events.filter((e) => e.name === "den").length, 2);
  assert.equal(pushedToXeon().length, 2);
  assert.equal(pushedToXeon()[0]!.kenh, "zalo");
  assert.equal(pushedToXeon()[0]!.maHoiThoai, "zalo:zalo-khach-1");
  assert.equal(pushedToXeon()[0]!.tenant, SHOP);

  // The screen is re-scanned and the same message sent again: not filed twice.
  const r2 = (await call("POST", "/api/hop-thu/tin-vao", { body: MESSAGE(2) })).body as Body;
  assert.equal(r2.daNhan, 0);
  assert.equal(r2.trung, 1);

  // The inbox returns OMI messages and Meta messages in ONE shape.
  const box = (await call("GET", "/api/facebook/webhook-inbox")).body as Body;
  assert.equal(box.tin.length, 2);
  assert.equal(box.tin[0].kenh, "zalo");
  assert.equal(box.tin[0].tenNguoi, "Anh Nam");
  assert.equal(box.tin[0].daXacMinh, true);
});

test("personal Facebook: a new conversation starts with the bot off (filed, not pushed); the shop's bot switch turns it on", async () => {
  const { call, wait, pushedToXeon } = build();
  const fb = (n: number) => MESSAGE(n, { kenh: "fb-ca-nhan", nguoi: "fb-khach-1", maTin: `f-${n}` });
  const r1 = (await call("POST", "/api/hop-thu/tin-vao", { body: fb(1) })).body as Body;
  assert.equal(r1.daNhan, 1);
  assert.equal(r1.dayBoNao, 0, "bot is off by default on a personal account");
  await wait();
  assert.equal(pushedToXeon().length, 0);
  const thread = ((await call("GET", "/api/hop-thu/hoi-thoai/fb-ca-nhan:fb-khach-1")).body as Body);
  assert.equal(thread.hoiThoai.bot, "off", "the switch in OMI shows the bot as off");

  assert.equal((await call("POST", "/api/hop-thu/hoi-thoai/fb-ca-nhan:fb-khach-1/thong-tin", { body: { bot: "auto" } })).status, 200);
  const r2 = (await call("POST", "/api/hop-thu/tin-vao", { body: fb(2) })).body as Body;
  assert.equal(r2.dayBoNao, 1, "switched on, the bot answers");

  // Zalo is unchanged: a new group is answered as before.
  assert.equal(((await call("POST", "/api/hop-thu/tin-vao", { body: MESSAGE(9) })).body as Body).dayBoNao, 1);
});

test("a message older than the threshold (default 24 hours) is not pushed to the brain but stays in the inbox; the shop can change the threshold", async () => {
  const { call, wait, clock, logger, pushedToXeon } = build();
  clock.advance(30 * 3600 * 1000);
  const r = (await call("POST", "/api/hop-thu/tin-vao", { body: { tin: [MESSAGE(1), MESSAGE(2, { luc: clock.now().toISOString() })] } })).body as Body;
  assert.equal(r.daNhan, 2);
  assert.equal(r.dayBoNao, 1, "only the fresh message is pushed");
  await wait();
  assert.equal(pushedToXeon().length, 1);
  assert.equal(pushedToXeon()[0]!.maTin, "z-2");
  assert.ok(logger.has(/cu 30 gio — khong tu tra loi/));
  assert.equal(((await call("GET", "/api/facebook/webhook-inbox")).body as Body).tin.length, 2, "the old message is still in the inbox");

  assert.equal(((await call("GET", "/api/hop-thu/cau-hinh")).body as Body).cauHinh.nguongTinCuGio, 24);
  assert.equal((await call("POST", "/api/hop-thu/cau-hinh", { body: { nguongTinCuGio: 0 } })).status, 400);
  assert.equal(((await call("POST", "/api/hop-thu/cau-hinh", { body: { nguongTinCuGio: 48 } })).body as Body).cauHinh.nguongTinCuGio, 48);
  const r2 = (await call("POST", "/api/hop-thu/tin-vao", { body: MESSAGE(3) })).body as Body;
  assert.equal(r2.dayBoNao, 1, "with a 48-hour threshold a 30-hour-old message is still answered");
});

test("the brain replying on zalo -> queued, no outbound call; on facebook -> sent right away through Graph", async () => {
  const { call, http, store } = build();
  const z = await call("POST", "/api/hop-thu/gui", { token: BRAIN, body: { kenh: "zalo", nguoi: "zalo-khach-1", chu: "Dạ còn size 42 ạ" } });
  assert.equal(z.status, 200, JSON.stringify(z.body));
  const zb = z.body as Body;
  assert.equal(zb.ketQua.xepHang, true);
  assert.match(zb.ketQua.id, /^cg_/);
  assert.equal(http.calls.length, 0, "no Graph call for the zalo channel");
  const book = (await store.document<OutboxBook>(OUTBOX_DOCUMENT).read())!;
  assert.equal(book.muc.length, 1);
  assert.equal(book.muc[0]!.nguon, "bo-nao");

  const f = await call("POST", "/api/hop-thu/gui", { token: BRAIN, body: { kenh: "facebook", nguoi: "psid-1", chu: "Dạ" } });
  assert.equal((f.body as Body).ketQua.guiNgay, true);
  assert.equal(http.calls.length, 1);

  assert.equal((await call("POST", "/api/hop-thu/gui", { token: BRAIN, body: { kenh: "telegram", nguoi: "x", chu: "y" } })).status, 502);
  assert.equal((await call("POST", "/api/hop-thu/gui", { token: BRAIN, body: { kenh: "zalo", nguoi: "", chu: "y" } })).status, 502);
});

test("the outbox: only the ON-DUTY machine pulls; a claim is exclusive for 3 minutes; reporting done -> da-gui + message-out event; a failed send retries 3 times then fails", async () => {
  const { call, clock, ticket, events } = build();
  for (let i = 1; i <= 3; i += 1) await call("POST", "/api/hop-thu/gui", { token: BRAIN, body: { kenh: "zalo", nguoi: `k${i}`, chu: `tra loi ${i}` } });
  await call("POST", "/api/hop-thu/gui", { token: BRAIN, body: { kenh: "fb-ca-nhan", nguoi: "fb-1", chu: "tra loi fb" } });

  const offDuty = await call("POST", "/api/hop-thu/cho-gui/nhan", { token: ticket({ onDuty: false, machine: "may 2" }), body: { kenh: "zalo" } });
  assert.equal(offDuty.status, 403);
  assert.equal((offDuty.body as Body).error, "khong_phai_may_truc");

  const badChannel = await call("POST", "/api/hop-thu/cho-gui/nhan", { token: ticket(), body: { kenh: "telegram" } });
  assert.equal(badChannel.status, 400);

  const n1 = await call("POST", "/api/hop-thu/cho-gui/nhan", { token: ticket(), body: { kenh: "zalo", gioiHan: 2 } });
  assert.equal(n1.status, 200);
  const n1b = n1.body as Body;
  assert.equal(n1b.tin.length, 2);
  assert.equal(n1b.nhanSongGiay, 180);
  assert.ok(!("boi" in n1b.tin[0]));

  // A second machine (say, just made on-duty) cannot get those 2 within 3 minutes; only the remaining one.
  const n2 = (await call("POST", "/api/hop-thu/cho-gui/nhan", { token: ticket({ machine: "may 3" }), body: { kenh: "zalo", gioiHan: 10 } })).body as Body;
  assert.equal(n2.tin.length, 1);
  assert.equal(n2.tin[0].nguoi, "k3");
  assert.equal(((await call("POST", "/api/hop-thu/cho-gui/xong", { token: ticket({ machine: "may 3" }), body: { id: n2.tin[0].id, ok: true } })).body as Body).trangThai, "da-gui");

  // Report item 1 done; item 2 stays silent past 3 minutes and returns to the queue.
  const x1 = (await call("POST", "/api/hop-thu/cho-gui/xong", { token: ticket(), body: { id: n1b.tin[0].id, ok: true } })).body as Body;
  assert.equal(x1.trangThai, "da-gui");
  assert.ok(events.some((e) => e.name === "di" && e.payload.nguoi === "k1" && e.payload.boi === "toprun:may 1"));
  assert.equal((await call("POST", "/api/hop-thu/cho-gui/xong", { token: ticket(), body: { id: n1b.tin[0].id, ok: true } })).status, 404, "done twice");
  clock.advance(3 * 60 * 1000 + 1000);
  const n3 = (await call("POST", "/api/hop-thu/cho-gui/nhan", { token: ADMIN, body: { kenh: "zalo" } })).body as Body;
  assert.deepEqual(n3.tin.map((t: Body) => t.nguoi), ["k2"], "item 2 is back in the queue; a long-lived key may pull too");

  // A failed send: retried 3 times, then failed.
  const id = n3.tin[0].id;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const x = (await call("POST", "/api/hop-thu/cho-gui/xong", { token: ticket(), body: { id, ok: false, loi: `selector truot ${attempt}` } })).body as Body;
    assert.equal(x.thuLai, attempt);
    assert.equal(x.trangThai, attempt < 3 ? "cho" : "hong");
    if (attempt < 3) {
      const n = (await call("POST", "/api/hop-thu/cho-gui/nhan", { token: ticket(), body: { kenh: "zalo" } })).body as Body;
      assert.equal(n.tin[0].id, id);
    }
  }
  const list = (await call("GET", "/api/hop-thu/cho-gui")).body as Body;
  assert.equal(list.tomTat["da-gui"], 2);
  assert.equal(list.tomTat.hong, 1);
  assert.equal(list.tomTat.cho, 1, "the fb-ca-nhan item is still waiting");
  assert.equal(list.muc.find((m: Body) => m.trangThai === "hong").loi, "selector truot 3");
});

test("Outbox (pure): past 12 hours an item expires; the document keeps only 500 finished items", () => {
  const outbox = new Outbox();
  const t0 = new Date(T0);
  outbox.enqueue({ channel: "zalo", recipient: "a", text: "x" }, t0);
  const later = new Date(t0.getTime() + 12 * 3600 * 1000 + 1);
  assert.equal(outbox.claim({ channel: "zalo", by: "m" }, later).length, 0);
  assert.equal(outbox.summary()["qua-han"], 1);

  for (let i = 0; i < 600; i += 1) {
    const item = outbox.enqueue({ channel: "zalo", recipient: `n${i}`, text: "x" }, later);
    outbox.claim({ channel: "zalo", by: "m", limit: 1 }, later);
    outbox.complete({ id: item.id, ok: true }, later);
  }
  outbox.enqueue({ channel: "zalo", recipient: "cuoi", text: "x" }, later);
  assert.equal(outbox.book.muc.filter((m) => m.trangThai === "da-gui").length, 500);
  assert.equal(outbox.book.muc.filter((m) => m.trangThai === "cho").length, 1, "a waiting item is never cut");
});

test("a human in OMI replying through /api/hop-thu/gui is recorded with source omi", async () => {
  const { call, ticket, store } = build();
  await call("POST", "/api/hop-thu/gui", { token: ticket(), body: { kenh: "zalo", nguoi: "k1", chu: "nguoi that tra loi" } });
  const book = (await store.document<OutboxBook>(OUTBOX_DOCUMENT).read())!;
  assert.equal(book.muc[0]!.nguon, "omi");
});

test("handoff to a human: the brain reports /api/hop-thu/can-nguoi; OMI lists; marking done", async () => {
  const { call } = build();
  assert.equal((await call("POST", "/api/hop-thu/can-nguoi", { token: BRAIN, body: { kenh: "zalo", nguoi: "k1" } })).status, 400, "missing conversation id");
  const report = await call("POST", "/api/hop-thu/can-nguoi", { token: BRAIN, body: { kenh: "zalo", nguoi: "k1", maHoiThoai: "zalo:k1", lyDo: "khong chac", tinCuoi: "co doi duoc khong" } });
  assert.equal(report.status, 200);
  await call("POST", "/api/hop-thu/can-nguoi", { token: BRAIN, body: { kenh: "zalo", nguoi: "k1", maHoiThoai: "zalo:k1", lyDo: "lan hai" } });
  const list = (await call("GET", "/api/hop-thu/can-nguoi")).body as Body;
  assert.equal(list.soDangCho, 1, "the same conversation reported twice is one row");
  assert.equal(list.muc[0].lyDo, "lan hai");
  assert.equal((await call("POST", "/api/hop-thu/can-nguoi/xong", { body: { maHoiThoai: "zalo:k1" } })).status, 200);
  assert.equal(((await call("GET", "/api/hop-thu/can-nguoi")).body as Body).soDangCho, 0);
  assert.equal((await call("POST", "/api/hop-thu/can-nguoi/xong", { body: { maHoiThoai: "zalo:k1" } })).status, 404);
});
