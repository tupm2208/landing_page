/**
 * The MySQL store port: statement splitting and WHERE building (pure), then real tables,
 * transactions, documents with row locks, and the schema runner.
 *
 *   TOPRUN_MYSQL_URL=mysql://root:...@127.0.0.1:3307/toprun_modules_test node --test test-mysql/mysql-store.test.mts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryLogger, buildWhere, openMysqlStore, splitStatements } from "../dist/kernel/index.js";

const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const skip = URL ? {} : { skip: "TOPRUN_MYSQL_URL not set — skipping the MySQL store tests" };
if (URL && /:3306\//.test(URL)) throw new Error("Port 3306 holds the landing's REAL data. Use 3307.");

// ---------- pure parts ----------

test("splits a SQL block into statements, dropping comments first", () => {
  const statements = splitStatements("-- ghi chu; co cham phay\nCREATE TABLE a (x INT); CREATE TABLE b (y INT);");
  assert.equal(statements.length, 2);
  assert.match(statements[0]!, /CREATE TABLE a/);
  assert.match(statements[1]!, /CREATE TABLE b/);
  assert.ok(!statements.join(" ").includes("ghi chu"), "comments are removed before splitting");
  assert.equal(splitStatements("/* ghi chu; nhieu dong */ CREATE TABLE a (x INT); CREATE TABLE b (y INT);").length, 2);
});

test("builds WHERE clauses: equals, IN, comparison, IS NULL, empty", () => {
  assert.deepEqual(buildWhere({ ma: "A" }), { clause: "WHERE `ma` = ?", params: ["A"] });
  assert.deepEqual(buildWhere({ ma: ["A", "B"] }), { clause: "WHERE `ma` IN (?, ?)", params: ["A", "B"] });
  assert.deepEqual(buildWhere({ tao_luc: { ">": "2026-01-01" } }), { clause: "WHERE `tao_luc` > ?", params: ["2026-01-01"] });
  assert.deepEqual(buildWhere({ ghi_chu: null }), { clause: "WHERE `ghi_chu` IS NULL", params: [] });
  assert.deepEqual(buildWhere({}), { clause: "", params: [] });
});

test("an EMPTY list matches NO row, never EVERY row", () => {
  // `IN ()` is invalid SQL; dropping the clause would match everything — for DELETE/UPDATE that is data loss.
  assert.deepEqual(buildWhere({ ma: [] }), { clause: "WHERE 1 = 0", params: [] });
});

test("an unknown comparison is refused, not spliced into the statement", () => {
  assert.throws(() => buildWhere({ ma: { "; DROP": 1 } as never }), /Unsupported comparison/);
});

// ---------- real MySQL ----------

test("real MySQL", { ...skip }, async (t) => {
  const logger = new MemoryLogger();
  const store = await openMysqlStore({ url: URL, logger });
  const TABLE = "thu_bang_don";

  t.after(async () => {
    try { await store.execute(`DROP TABLE IF EXISTS \`${TABLE}\``); } catch { /* fine */ }
    try { await store.execute("DELETE FROM lich_su_luoc_do WHERE module = ?", ["thu-bang"]); } catch { /* fine */ }
    try { await store.execute("DELETE FROM so_du_lieu WHERE ten LIKE ?", ["thu-%"]); } catch { /* fine */ }
    await store.close();
  });

  await t.test("runs a schema once; running it again does nothing", async () => {
    const steps = [{
      name: "001-tao-bang",
      tables: [TABLE],
      sql: `CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
              ma VARCHAR(64) NOT NULL,
              khach VARCHAR(190) NOT NULL DEFAULT '',
              tien DECIMAL(14,2) NOT NULL DEFAULT 0,
              trang_thai VARCHAR(32) NOT NULL DEFAULT 'moi',
              tao_luc DATETIME(3) NOT NULL,
              PRIMARY KEY (ma)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    }];
    await store.runSchema("thu-bang", steps);
    await store.runSchema("thu-bang", steps);
    const rows = await store.rows<{ n: number }>("SELECT COUNT(*) AS n FROM lich_su_luoc_do WHERE module = ?", ["thu-bang"]);
    assert.equal(Number(rows[0]!.n), 1);
  });

  await t.test("BREAKS when a module declares a table without its own prefix", async () => {
    await assert.rejects(
      () => store.runSchema("thu-bang", [{ name: "002-bang-la", tables: ["don_hang_cua_nguoi_khac"], sql: "SELECT 1" }]),
      /must start with "thu_bang_"/
    );
  });

  await t.test("an INHERITED table may be created without the prefix — only when declared", async () => {
    await store.runSchema("thu-bang", [{ name: "003-bang-ke-thua", tables: ["thu_bang_ke_thua"], sql: "CREATE TABLE IF NOT EXISTS thu_bang_ke_thua (x INT)" }], { inheritedTables: ["thu_bang_ke_thua"] });
    await store.execute("DROP TABLE IF EXISTS thu_bang_ke_thua");
    await assert.rejects(
      () => store.runSchema("thu-bang", [{ name: "004-la", tables: ["orders"], sql: "SELECT 1" }], { inheritedTables: ["order_items"] }),
      /listed in `inheritedTables`/
    );
  });

  await t.test("a column the inherited table already has is skipped — only in a one-clause ALTER", async () => {
    await store.execute("DROP TABLE IF EXISTS thu_bang_co_san");
    await store.execute("CREATE TABLE thu_bang_co_san (x INT, shipping_fee DECIMAL(14,2))");
    await store.runSchema("thu-bang", [{
      name: "005-cot-co-san", tables: ["thu_bang_co_san"],
      sql: "ALTER TABLE thu_bang_co_san ADD COLUMN shipping_fee DECIMAL(14,2) NOT NULL DEFAULT 0; ALTER TABLE thu_bang_co_san ADD COLUMN tags VARCHAR(10) NOT NULL DEFAULT ''"
    }], { inheritedTables: ["thu_bang_co_san"] });
    const cols = await store.rows("SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'thu_bang_co_san'");
    assert.ok(cols.some((r) => String(r["c"]).toLowerCase() === "tags"), "the next statement still ran");
    await assert.rejects(
      () => store.runSchema("thu-bang", [{
        name: "006-nhieu-menh-de", tables: ["thu_bang_co_san"],
        sql: "ALTER TABLE thu_bang_co_san ADD COLUMN x2 INT, ADD COLUMN shipping_fee INT"
      }], { inheritedTables: ["thu_bang_co_san"] }),
      /Duplicate column/
    );
    await store.execute("DROP TABLE IF EXISTS thu_bang_co_san");
  });

  await t.test("insert, find, count, update, delete", async () => {
    const table = store.table(TABLE);
    await table.insert({ ma: "D1", khach: "Anh A", tien: 100000, tao_luc: "2026-09-12 10:00:00" });
    await table.insert({ ma: "D2", khach: "Anh B", tien: 250000, tao_luc: "2026-09-12 11:00:00" });
    assert.equal(await table.count(), 2);
    assert.equal((await table.one({ ma: "D1" }))!["khach"], "Anh A");
    assert.equal((await table.find({ where: { tien: { ">": 200000 } } })).length, 1);
    assert.equal((await table.find({ where: { ma: ["D1", "D2"] }, orderBy: "tien desc" }))[0]!["ma"], "D2");
    assert.equal(await table.update({ ma: "D1" }, { trang_thai: "xong" }), 1);
    assert.equal((await table.one({ ma: "D1" }))!["trang_thai"], "xong");
    assert.equal(await table.delete({ ma: "D2" }), 1);
    assert.equal(await table.count(), 1);
  });

  await t.test("REFUSES to update or delete a whole table when the condition is forgotten", async () => {
    const table = store.table(TABLE);
    await assert.rejects(() => table.update({}, { trang_thai: "xx" }), /without a condition/);
    await assert.rejects(() => table.delete({}), /without a condition/);
  });

  await t.test("upsert on an existing key updates instead of throwing", async () => {
    const table = store.table(TABLE);
    await table.upsert({ ma: "D1", khach: "Anh A sửa", tien: 120000, tao_luc: "2026-09-12 10:00:00" });
    assert.equal((await table.one({ ma: "D1" }))!["khach"], "Anh A sửa");
    assert.equal(await table.count(), 1, "the old row is updated, not duplicated");
  });

  await t.test("insertMany in batches; a row missing a column breaks the batch", async () => {
    const table = store.table(TABLE);
    const r = await table.insertMany([
      { ma: "M1", khach: "x", tien: 1, tao_luc: "2026-09-12 10:00:00" },
      { ma: "M2", khach: "y", tien: 2, tao_luc: "2026-09-12 10:00:00" }
    ], { batchSize: 1 });
    assert.equal(r.affectedRows, 2);
    await assert.rejects(() => table.insertMany([{ ma: "M3", khach: "z", tien: 1, tao_luc: "2026-09-12 10:00:00" }, { ma: "M4", khach: "z" }]), /missing columns/);
    await table.delete({ ma: ["M1", "M2"] });
  });

  await t.test("a transaction that fails midway leaves no trace", async () => {
    const table = store.table(TABLE);
    const before = await table.count();
    await assert.rejects(() => store.transaction(async (tx) => {
      await tx.table(TABLE).insert({ ma: "D9", khach: "Sẽ bị huỷ", tien: 1, tao_luc: "2026-09-12 12:00:00" });
      throw new Error("hỏng giữa chừng");
    }), /hỏng giữa chừng/);
    assert.equal(await table.count(), before);
    assert.equal(await table.one({ ma: "D9" }), null);
  });

  await t.test("a transaction that completes is written; nested transactions reuse the outer one", async () => {
    await store.transaction(async (tx) => {
      await tx.table(TABLE).insert({ ma: "D10", khach: "Giữ lại", tien: 5, tao_luc: "2026-09-12 12:00:00" });
      await tx.transaction(async (inner) => { await inner.table(TABLE).update({ ma: "D10" }, { tien: 6 }); });
    });
    assert.equal(Number((await store.table(TABLE).one({ ma: "D10" }))!["tien"]), 6);
  });

  await t.test("documents: read, write, and update with a row lock", async () => {
    const doc = store.document<{ ten: string; dem: number }>("thu-cau-hinh");
    assert.equal(await doc.read(), null);
    await doc.write({ ten: "TopRun", dem: 0 });
    assert.equal((await doc.read())!.ten, "TopRun");
    // Two concurrent updates: a JSON file would lose one; MySQL's row lock keeps both.
    await Promise.all([
      doc.update((cur) => ({ ten: cur?.ten ?? "", dem: (cur?.dem ?? 0) + 1 }), { ten: "", dem: 0 }),
      doc.update((cur) => ({ ten: cur?.ten ?? "", dem: (cur?.dem ?? 0) + 1 }), { ten: "", dem: 0 })
    ]);
    assert.equal((await doc.read())!.dem, 2, "both increments must land");
    assert.deepEqual(await doc.update(() => undefined), await doc.read(), "returning undefined leaves the document untouched");
  });

  await t.test("a bad document name is refused", () => {
    assert.throws(() => store.document("Sổ Lạ"), /Invalid document name/);
  });
});
