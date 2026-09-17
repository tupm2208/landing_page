/**
 * Đ6 (17/09/2026) — the long-term message archive on real MySQL (port 3307): upsert by message id
 * (a re-run never duplicates), reading back older messages of one conversation page by page.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ManualClock, MemoryLogger, openMysqlStore } from "../dist/kernel/index.js";
import { ARCHIVE_SCHEMA, ARCHIVE_TABLE, MessageArchive } from "../dist/modules/hop-thu/archive.js";

const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const skip = URL ? {} : { skip: "chưa đặt TOPRUN_MYSQL_URL — bỏ qua bài Đ6" };
if (URL && /:3306\//.test(URL)) throw new Error("Cổng 3306 là dữ liệu thật của landing. Dùng 3307.");

test("Đ6 archive table: upsert twice keeps one row per message; older() pages back in time, oldest first", { ...skip }, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock(new Date("2026-09-17T03:00:00.000Z"));
  const store = await openMysqlStore({ url: URL, logger });
  t.after(() => store.close());
  await store.runSchema("hop-thu", ARCHIVE_SCHEMA);
  await store.table(ARCHIVE_TABLE).truncate();

  const archive = new MessageArchive(store, () => clock.now());
  const message = (i: number, chieu: "den" | "di" = "den") => ({
    maTin: `mid.${i}`, maHoiThoai: "facebook:k1", trang: "trang-1", nguoi: "k1", chieu, chu: `tin ${i} — có dấu`,
    anh: i === 2 ? ["https://scontent.test/x.jpg"] : [], luc: `2026-09-0${i}T00:00:00.000Z`
  });
  await archive.upsert([message(1), message(2, "di"), message(3)]);
  await archive.upsert([message(3), { ...message(2, "di"), chu: "đã sửa" }]);
  await archive.upsert([{ ...message(4), maHoiThoai: "facebook:k2", nguoi: "k2" }]);
  assert.equal(await archive.count(), 4);

  const newest = await archive.older({ maHoiThoai: "facebook:k1", limit: 2 });
  assert.deepEqual(newest.tin.map((m) => [m.maTin, m.chieu, m.chu]), [["mid.2", "di", "đã sửa"], ["mid.3", "den", "tin 3 — có dấu"]]);
  assert.equal(newest.conNua, true);
  assert.deepEqual(newest.tin[0]!.anh, ["https://scontent.test/x.jpg"]);
  const older = await archive.older({ maHoiThoai: "facebook:k1", truoc: newest.tin[0]!.luc, limit: 2 });
  assert.deepEqual(older.tin.map((m) => m.maTin), ["mid.1"]);
  assert.equal(older.conNua, false);
});

test("Đ7 archive batches for training analysis: conversations in id order, a cursor, the last one never cut in half", { ...skip }, async (t) => {
  const logger = new MemoryLogger();
  const clock = new ManualClock(new Date("2026-09-17T03:00:00.000Z"));
  const store = await openMysqlStore({ url: URL, logger });
  t.after(() => store.close());
  await store.runSchema("hop-thu", ARCHIVE_SCHEMA);
  await store.table(ARCHIVE_TABLE).truncate();
  const archive = new MessageArchive(store, () => clock.now());
  const rows = [];
  for (let c = 0; c < 5; c += 1) {
    for (let m = 0; m < 3; m += 1) {
      rows.push({ maTin: `mid.${c}.${m}`, maHoiThoai: `facebook:k${c}`, trang: "trang-1", nguoi: `k${c}`, chieu: (m % 2 ? "di" : "den") as "den" | "di", chu: `tin ${m}`, anh: [], luc: `2026-09-0${m + 1}T00:00:00.000Z` });
    }
  }
  await archive.upsert(rows);
  const first = await archive.conversationBatch({ sau: "", conversations: 2, messagesPerConversation: 2 });
  assert.deepEqual(first.hoiThoai.map((c) => c.ma), ["facebook:k0", "facebook:k1"]);
  assert.deepEqual(first.hoiThoai[0]!.tin.map((m) => m.maTin), ["mid.0.1", "mid.0.2"], "the LAST messages, oldest first");
  assert.equal(first.het, false);
  const second = await archive.conversationBatch({ sau: first.sau, conversations: 10, messagesPerConversation: 5 });
  assert.deepEqual(second.hoiThoai.map((c) => c.ma), ["facebook:k2", "facebook:k3", "facebook:k4"]);
  assert.equal(second.het, true);
  const none = await archive.conversationBatch({ sau: second.sau, conversations: 10, messagesPerConversation: 5 });
  assert.deepEqual([none.hoiThoai.length, none.het], [0, true]);
});
