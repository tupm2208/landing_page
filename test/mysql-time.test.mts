/**
 * Time between JS and MySQL — a test that keeps a real bug fixed.
 *
 * DATETIME carries no zone. Reading "2026-09-12 10:00:00" with `new Date(...)` makes Node use the
 * machine's zone (UTC+7 here): seven hours off. An order placed a second ago became seven hours
 * old, the 15-minute edit window closed at once, and Sales Desk saw the wrong `createdAt`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { toMysqlDateTime, fromMysqlDateTime, isoFromMysql } from "../dist/shared/mysql-time.js";

test("writes MySQL strings in UTC", () => {
  const t = new Date("2026-09-12T10:00:00.000Z");
  assert.equal(toMysqlDateTime(t), "2026-09-12 10:00:00");
  assert.equal(toMysqlDateTime(t, { ms: true }), "2026-09-12 10:00:00.000");
});

test("WRITE THEN READ returns the original moment — this is the whole point", () => {
  const t = new Date("2026-09-12T10:00:00.000Z");
  const stored = toMysqlDateTime(t);
  assert.equal(fromMysqlDateTime(stored)!.getTime(), t.getTime(), "any drift breaks the 15-minute window");
  assert.equal(isoFromMysql(stored), "2026-09-12T10:00:00.000Z");
});

test("a string without a zone is read as UTC, NOT machine time", () => {
  assert.equal(isoFromMysql("2026-09-12 10:00:00"), "2026-09-12T10:00:00.000Z");
  assert.equal(isoFromMysql("2026-09-12 10:00:00.123"), "2026-09-12T10:00:00.123Z");
});

test("a string with a zone is kept as is", () => {
  assert.equal(isoFromMysql("2026-09-12T10:00:00.000Z"), "2026-09-12T10:00:00.000Z");
  assert.equal(isoFromMysql("2026-09-12T17:00:00+07:00"), "2026-09-12T10:00:00.000Z");
});

test("a Date from the store passes through", () => {
  const t = new Date("2026-09-12T10:00:00.000Z");
  assert.equal(fromMysqlDateTime(t)!.getTime(), t.getTime());
});

test("unreadable input gives null / empty string, never throws, never Invalid Date", () => {
  for (const bad of ["", null, undefined, 0, "khong-phai-gio", "0000-00-00 00:00:00"]) {
    assert.equal(fromMysqlDateTime(bad), null, `"${String(bad)}" must be null`);
    assert.equal(isoFromMysql(bad), "");
  }
});
