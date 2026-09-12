// Cong du lieu MySQL — chay tren MySQL THAT.
//
// Can container thu o cong 3307. CONG 3306 LA DU LIEU THAT CUA LANDING, CAM DUNG.
//   TOPRUN_MYSQL_URL=mysql://root:thu-nghiem-chi-may-nay@127.0.0.1:3307/toprun_modules_test \
//     node --test test/kho-mysql.test.js
// Khong dat bien thi bo qua ca bo — de `npm test` van chay duoc tren may chua co MySQL.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { taoKhoMysql, dungWhere, tenAnToan } = require("../loi/cong/kho-mysql");
const { taoNhatKyGia } = require("../loi/cong/co-ban");

const DUONG = String(process.env.TOPRUN_MYSQL_URL || "").trim();
const boQua = DUONG ? false : { skip: "chưa đặt TOPRUN_MYSQL_URL — bỏ qua bài MySQL thật" };

if (DUONG && /:3306\//.test(DUONG)) {
  throw new Error("TOPRUN_MYSQL_URL trỏ vào cổng 3306 — đó là dữ liệu thật của landing. Dùng 3307.");
}

// ---------- phan khong can MySQL ----------

test("ten bang/cot phai sach — chan tiem cau lenh", () => {
  assert.equal(tenAnToan("don_hang"), "don_hang");
  assert.throws(() => tenAnToan("don; DROP TABLE x"), /không hợp lệ/);
  assert.throws(() => tenAnToan("`x`"), /không hợp lệ/);
  assert.throws(() => tenAnToan("Don"), /không hợp lệ/);
});

test("dung menh de WHERE: bang nhau, trong danh sach, so sanh, rong", () => {
  assert.deepEqual(dungWhere({ ma: "A" }), { menh: "WHERE `ma` = ?", thamSo: ["A"] });
  assert.deepEqual(dungWhere({ ma: ["A", "B"] }), { menh: "WHERE `ma` IN (?, ?)", thamSo: ["A", "B"] });
  assert.deepEqual(dungWhere({ tao_luc: { ">": "2026-01-01" } }), { menh: "WHERE `tao_luc` > ?", thamSo: ["2026-01-01"] });
  assert.deepEqual(dungWhere({ ghi_chu: null }), { menh: "WHERE `ghi_chu` IS NULL", thamSo: [] });
  assert.deepEqual(dungWhere({}), { menh: "", thamSo: [] });
});

test("danh sach RONG phai ra 'khong dong nao', khong duoc thanh 'moi dong'", () => {
  // `IN ()` khong hop le trong SQL; neu lo bo menh de di thi cau lenh thanh khong dieu kien
  // — tuc la khop MOI dong. Voi DELETE/UPDATE do la mat sach du lieu.
  assert.deepEqual(dungWhere({ ma: [] }), { menh: "WHERE 1 = 0", thamSo: [] });
});

test("phep so sanh la thi tu choi, khong ghep thang vao cau lenh", () => {
  assert.throws(() => dungWhere({ ma: { "; DROP": 1 } }), /không hỗ trợ/);
});

// ---------- phan can MySQL that ----------

test("MySQL thật", { ...(boQua || {}) }, async (t) => {
  const nhatKy = taoNhatKyGia();
  const kho = await taoKhoMysql({ duongKetNoi: DUONG, nhatKy });
  const BANG = "thu_bang_don";

  t.after(async () => {
    try { await kho.cauLenh(`DROP TABLE IF EXISTS \`${BANG}\``, []); } catch { /* thoi */ }
    try { await kho.cauLenh("DELETE FROM lich_su_luoc_do WHERE module = ?", ["thu-bang"]); } catch { /* thoi */ }
    try { await kho.cauLenh("DELETE FROM so_du_lieu WHERE ten LIKE ?", ["thu-%"]); } catch { /* thoi */ }
    await kho.dong();
  });

  await t.test("chay luoc do mot lan, chay lai khong sao", async () => {
    const buoc = [{
      ten: "001-tao-bang",
      bang: [BANG],
      sql: `CREATE TABLE IF NOT EXISTS \`${BANG}\` (
              ma VARCHAR(64) NOT NULL,
              khach VARCHAR(190) NOT NULL DEFAULT '',
              tien DECIMAL(14,2) NOT NULL DEFAULT 0,
              trang_thai VARCHAR(32) NOT NULL DEFAULT 'moi',
              tao_luc DATETIME(3) NOT NULL,
              PRIMARY KEY (ma)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    }];
    await kho.chayLuocDo("thu-bang", buoc);
    await kho.chayLuocDo("thu-bang", buoc);   // lan hai phai la khong lam gi
    const [dong] = await kho.cauLenh("SELECT COUNT(*) AS n FROM lich_su_luoc_do WHERE module = ?", ["thu-bang"]);
    assert.equal(Number(dong[0].n), 1);
  });

  await t.test("GAY khi module khai mot bang khong mang ten cua chinh no", async () => {
    await assert.rejects(
      () => kho.chayLuocDo("thu-bang", [{ ten: "002-bang-la", bang: ["don_hang_cua_nguoi_khac"], sql: "SELECT 1" }]),
      /tên bảng phải bắt đầu bằng "thu_bang_"/
    );
  });

  await t.test("thêm, tìm, đếm, sửa, xoá", async () => {
    const bang = kho.bang(BANG);
    await bang.them({ ma: "D1", khach: "Anh A", tien: 100000, tao_luc: "2026-09-12 10:00:00" });
    await bang.them({ ma: "D2", khach: "Anh B", tien: 250000, tao_luc: "2026-09-12 11:00:00" });

    assert.equal(await bang.dem(), 2);
    assert.equal((await bang.mot({ ma: "D1" })).khach, "Anh A");
    assert.equal((await bang.tim({ dieuKien: { tien: { ">": 200000 } } })).length, 1);
    assert.equal((await bang.tim({ dieuKien: { ma: ["D1", "D2"] }, sapXep: "tien desc" }))[0].ma, "D2");

    assert.equal(await bang.thay({ ma: "D1" }, { trang_thai: "xong" }), 1);
    assert.equal((await bang.mot({ ma: "D1" })).trang_thai, "xong");

    assert.equal(await bang.xoa({ ma: "D2" }), 1);
    assert.equal(await bang.dem(), 1);
  });

  await t.test("CHAN sua hoac xoa ca bang khi quen dieu kien", async () => {
    const bang = kho.bang(BANG);
    await assert.rejects(() => bang.thay({}, { trang_thai: "xx" }), /không có điều kiện/);
    await assert.rejects(() => bang.xoa({}), /không có điều kiện/);
  });

  await t.test("them lai cung khoa thi cap nhat, khong nem", async () => {
    const bang = kho.bang(BANG);
    await bang.themHoacThay({ ma: "D1", khach: "Anh A sửa", tien: 120000, tao_luc: "2026-09-12 10:00:00" });
    assert.equal((await bang.mot({ ma: "D1" })).khach, "Anh A sửa");
    assert.equal(await bang.dem(), 1, "phải sửa dòng cũ chứ không thêm dòng mới");
  });

  await t.test("giao dich: hong giua chung thi khong con dau vet gi", async () => {
    const bang = kho.bang(BANG);
    const truoc = await bang.dem();
    await assert.rejects(() => kho.giaoDich(async (trong) => {
      await trong.bang(BANG).them({ ma: "D9", khach: "Sẽ bị huỷ", tien: 1, tao_luc: "2026-09-12 12:00:00" });
      throw new Error("hỏng giữa chừng");
    }), /hỏng giữa chừng/);
    assert.equal(await bang.dem(), truoc, "dòng thêm trong giao dịch hỏng phải biến mất");
    assert.equal(await bang.mot({ ma: "D9" }), null);
  });

  await t.test("giao dich: chay tron thi ghi that", async () => {
    const bang = kho.bang(BANG);
    await kho.giaoDich(async (trong) => {
      await trong.bang(BANG).them({ ma: "D10", khach: "Giữ lại", tien: 5, tao_luc: "2026-09-12 12:00:00" });
    });
    assert.equal((await bang.mot({ ma: "D10" })).khach, "Giữ lại");
  });

  await t.test("so nho: doc, ghi, va cap nhat co khoa dong", async () => {
    const so = kho.so("thu-cau-hinh");
    assert.equal(await so.doc(), null);
    await so.ghi({ ten: "TopRun", dem: 0 });
    assert.equal((await so.doc()).ten, "TopRun");

    // Hai luot cap nhat cung luc: tep JSON se mat mot luot, MySQL co khoa dong thi khong.
    await Promise.all([
      so.capNhat((cu) => ({ ...cu, dem: (cu?.dem ?? 0) + 1 }), { dem: 0 }),
      so.capNhat((cu) => ({ ...cu, dem: (cu?.dem ?? 0) + 1 }), { dem: 0 })
    ]);
    assert.equal((await so.doc()).dem, 2, "hai lượt cùng lúc phải cộng đủ hai, không mất lượt nào");
  });

  await t.test("so ten la thi tu choi", () => {
    assert.throws(() => kho.so("Sổ Lạ"), /Tên sổ không hợp lệ/);
  });
});
