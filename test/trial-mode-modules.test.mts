/**
 * Trial mode through the real modules: the inbox must not message a customer, shipping must not
 * create a real shipment — and both must SAY so instead of reporting success.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FixedWindowRateLimiter, MemoryUploadPort, JsonFileStore, Kernel, ManualClock, MemoryLogger, ROLE, TokenAuth, TrialModeHttpClient, jsonResponse,
  type AnyManifest, type HttpClient
} from "../dist/index.js";
import { manifest as inbox } from "../dist/modules/hop-thu/module.js";
import { manifest as shipping } from "../dist/modules/van-chuyen/module.js";

const ADMIN = "ma-quan-tri";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "trial-mod-"));

function trialKernel(modules: AnyManifest[], config: Record<string, unknown>, realAnswer: unknown) {
  const clock = new ManualClock();
  const logger = new MemoryLogger();
  const realCalls: string[] = [];
  const real: HttpClient = { async fetch(url) { realCalls.push(String(url)); return jsonResponse(realAnswer); } };
  const kernel = new Kernel({
    ports: { store: new JsonFileStore(tmp()), logger, clock, http: new TrialModeHttpClient({ real, logger }), auth: new TokenAuth({ keys: [{ token: ADMIN, name: "quan-tri", role: ROLE.admin }], clock }), rateLimiter: new FixedWindowRateLimiter(clock), uploads: new MemoryUploadPort() },
    logger, modules, config
  });
  return { kernel, realCalls };
}

test("the brain asks the inbox to send: in trial mode the answer is 502 and NOTHING is sent", async () => {
  const { kernel, realCalls } = trialKernel([inbox], { "hop-thu": { verifyToken: "v", appSecret: "s", pageToken: "tk" } }, {});
  const r = await kernel.handle({
    method: "POST", path: "/api/hop-thu/gui", ip: "1.1.1.1", headers: { authorization: `Bearer ${ADMIN}` },
    json: async () => ({ nguoi: "khach-1", chu: "Dạ còn size 42 anh nhé" })
  });
  assert.equal(r.status, 502, "not being able to send must be reported, never claimed as success");
  assert.match(String((r.body as { message: string }).message), /Chế độ thử/);
  assert.equal(realCalls.length, 0, "NOT ONE real call to Meta");
});

test("creating a shipment: in trial mode no real shipment is created", async () => {
  const { kernel, realCalls } = trialKernel([shipping], { "van-chuyen": { defaultCarrier: "spx", spx: { appId: "a", appSecret: "b", userId: "1", userSecret: "c" } } }, { ret_code: 0 });
  const r = await kernel.handle({
    method: "POST", path: "/api/van-chuyen/tao", ip: "1.1.1.1", headers: { authorization: `Bearer ${ADMIN}` },
    json: async () => ({
      maPhieu: "ORD-thu",
      nguoiGui: { ten: "Shop", dienThoai: "0900000000", tinh: "Hà Nội", huyen: "Quận Ba Đình", xa: "Phường Giảng Võ", diaChiChiTiet: "1" },
      nguoiNhan: { ten: "Khách", dienThoai: "0911111111", tinh: "Hà Nội", huyen: "Quận Ba Đình", xa: "Phường Điện Biên", diaChiChiTiet: "2" },
      mon: [{ ten: "Giày", soLuong: 1, donGia: 100000, canNangKg: 0.75 }]
    })
  });
  assert.notEqual(r.status, 200, "no real shipment in trial mode");
  assert.equal(realCalls.length, 0);
});
