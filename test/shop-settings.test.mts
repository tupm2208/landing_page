/**
 * SHOP SETTINGS — the shop's own keys and addresses, replacing Sales Desk's `.env`.
 *
 * Three promises, one test each, plus the one that matters most in practice: shipping picks the
 * keys up from here without a restart, and an owner who edits only the sender's phone number does
 * not wipe the carrier keys they cannot see.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLE } from "../dist/contract/index.js";
import { FakeHttpClient, FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, MemoryMailer, TokenAuth, jsonResponse } from "../dist/kernel/index.js";
import { manifest as platform } from "../dist/modules/khung-nen-tang/module.js";
import { forScreen, mergeSettings, settingsOf, KEEP_CLEAR } from "../dist/modules/khung-nen-tang/shop-settings.js";
import { manifest as shipping } from "../dist/modules/van-chuyen/module.js";

const ADMIN = "ma-quan-tri";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cau-hinh-"));
const SPX_CREATED = { ret_code: 0, message: "success", data: { orders: [{ tracking_no: "SPXVN123456789", order_id: "DH-1", estimated_shipping_fee: 25000 }] } };

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

function build() {
  const clock = new ManualClock();
  const logger = new MemoryLogger();
  const http = new FakeHttpClient(() => jsonResponse(SPX_CREATED));
  const kernel = new Kernel({
    ports: {
      store: new JsonFileStore(tmp()), logger, clock, http,
      auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }), rateLimiter: new FixedWindowRateLimiter(clock), mail: new MemoryMailer()
    },
    logger, modules: [platform, shipping], config: { "van-chuyen": { defaultCarrier: "spx" } }
  });
  const read = (token: string | null = ADMIN) => kernel.handle({
    method: "GET", path: "/api/admin/cau-hinh", query: {}, headers: token ? { authorization: `Bearer ${token}` } : {}, ip: "1.1.1.1"
  });
  const write = (giaTri: Record<string, string>, token: string | null = ADMIN) => kernel.handle({
    method: "POST", path: "/api/admin/cau-hinh", query: {},
    headers: token ? { authorization: `Bearer ${token}` } : {}, ip: "1.1.1.1", json: async () => ({ giaTri })
  });
  const fieldOf = (body: Body, key: string): Body =>
    (body["nhom"] as Body[]).flatMap((g: Body) => g["muc"] as Body[]).find((m: Body) => m["khoa"] === key) as Body;
  return { kernel, read, write, fieldOf, http, logger };
}

test("a secret never leaves: saved, it comes back as set plus its last four — never the value", async () => {
  const { read, write, fieldOf } = build();
  await write({ spx_app_secret: "abcdef123456", spx_app_id: "app-77" });

  const r = await read();
  assert.equal(r.status, 200);
  const secret = fieldOf(r.body as Body, "spx_app_secret");
  assert.equal(secret["biMat"], true);
  assert.equal(secret["daDat"], true);
  assert.equal(secret["giaTri"], "", "the value itself must not be on the wire");
  assert.equal(secret["duoi"], "••••3456");
  assert.ok(!JSON.stringify(r.body).includes("abcdef123456"), "no copy of the secret anywhere in the reply");

  const plain = fieldOf(r.body as Body, "spx_app_id");
  assert.equal(plain["biMat"], false);
  assert.equal(plain["giaTri"], "app-77", "a non-secret is shown so the owner can check it");
});

test("an unknown key is dropped — the store is not a free-form bag", () => {
  const { next, changed } = mergeSettings({}, { admin_token: "cua-sau", spx_app_id: "app-1" });
  assert.deepEqual(Object.keys(next), ["spx_app_id"]);
  assert.deepEqual(changed, ["spx_app_id"]);
  assert.deepEqual(settingsOf({ giaTri: { admin_token: "cua-sau", spx_app_id: "app-1" }, updatedAt: "" }), { spx_app_id: "app-1" });
});

test("an empty secret means LEAVE IT; erasing is explicit", async () => {
  const { read, write, fieldOf } = build();
  await write({ spx_app_secret: "khoa-that-su", vtp_token: "token-vtp" });

  // The screen cannot show a secret, so it sends the box back empty on every save.
  await write({ spx_app_secret: "", kho_dien_thoai: "0900000000" });
  let body = (await read()).body as Body;
  assert.equal(fieldOf(body, "spx_app_secret")["daDat"], true, "editing the phone must not wipe the carrier key");
  assert.equal(fieldOf(body, "kho_dien_thoai")["giaTri"], "0900000000");

  await write({ spx_app_secret: KEEP_CLEAR });
  body = (await read()).body as Body;
  assert.equal(fieldOf(body, "spx_app_secret")["daDat"], false);
  assert.equal(fieldOf(body, "vtp_token")["daDat"], true, "clearing one key leaves the others alone");
});

test("the save reply names the keys that changed, and the log never carries a value", async () => {
  const { write, logger } = build();
  const r = await write({ spx_app_secret: "rat-bi-mat", kho_ten: "Kho TopRun" });
  assert.equal(r.status, 200);
  assert.deepEqual(((r.body as Body)["daDoi"] as string[]).sort(), ["kho_ten", "spx_app_secret"]);

  const lines = logger.lines.map((l) => l.text).join("\n");
  assert.ok(lines.includes("spx_app_secret"), "the log says which key changed");
  assert.ok(!lines.includes("rat-bi-mat"), "the log never carries the value");

  // Nothing changed = nothing written, so a "save" on an untouched form is not a false edit.
  const again = await write({ kho_ten: "Kho TopRun" });
  assert.deepEqual((again.body as Body)["daDoi"], []);
});

test("only the owner reads the configuration", async () => {
  const { read, write } = build();
  assert.equal((await read(null)).status, 401);
  assert.equal((await write({ kho_ten: "x" }, null)).status, 401);
});

test("shipping picks the shop's keys up from here — no `.env`, no restart", async () => {
  const { kernel, write, http } = build();
  // No keys anywhere yet: the slip is refused before any carrier is called.
  const before = await kernel.handle({
    method: "POST", path: "/api/van-chuyen/tao", query: {}, headers: { authorization: `Bearer ${ADMIN}` }, ip: "1.1.1.1",
    json: async () => ({ maPhieu: "DH-1", nguoiNhan: { ten: "A", dienThoai: "0912345678", tinh: "Hà Nội" }, mon: [{ ten: "Giày", soLuong: 1, donGia: 100000 }] })
  });
  assert.equal(before.status, 400);
  assert.equal(http.calls.length, 0, "a shipment is never attempted without keys");

  await write({ spx_app_id: "app-1", spx_app_secret: "secret-1", spx_user_id: "user-1", spx_user_secret: "secret-2" });
  const after = await kernel.handle({
    method: "POST", path: "/api/van-chuyen/tao", query: {}, headers: { authorization: `Bearer ${ADMIN}` }, ip: "1.1.1.1",
    json: async () => ({
      maPhieu: "DH-1",
      nguoiGui: { ten: "Kho", dienThoai: "0900000000", tinh: "Hà Nội", huyen: "Ba Đình", xa: "Cống Vị", diaChiChiTiet: "1 Đội Cấn" },
      nguoiNhan: { ten: "A", dienThoai: "0912345678", tinh: "Hà Nội", huyen: "Ba Đình", xa: "Cống Vị", diaChiChiTiet: "2 Đội Cấn" },
      mon: [{ ten: "Giày", soLuong: 1, donGia: 100000 }]
    })
  });
  assert.equal(after.status, 200, JSON.stringify(after.body));
  assert.ok(http.calls.length > 0, "with the keys in place the carrier is really called");
});

test("the screen shape: every group has a reader-facing name and at least one field", () => {
  const groups = forScreen({});
  assert.ok(groups.length >= 8);
  for (const g of groups) {
    assert.ok(g.ten.length > 0, `group ${g.ma} needs a name`);
    assert.ok(g.muc.length > 0, `group ${g.ma} has no field`);
    for (const m of g.muc) assert.ok(m.nhan.length > 0, `${m.khoa} needs a label`);
  }
});
