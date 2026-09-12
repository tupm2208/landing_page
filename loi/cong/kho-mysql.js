// CONG DU LIEU — ban MySQL. Anh Dung chot 12/09/2026: "dua het ve mysql, du lieu khach
// luu het ve mysql, thiet ke chuan la duoc".
//
// Cong nay cung HINH DANG voi `kho-tep.js`, cong them phan quan trong nhat: BANG CO DONG.
//
//   kho.bang("don_hang").tim({ trang_thai: "moi" })   <- thiet ke chuan: moi don mot dong
//   kho.so("cau-hinh-web").doc()                      <- van con, cho tai lieu nho
//
// Vi sao giu ca hai: mot so thu that su la MOT tai lieu nho (danh sach ma bi chan, noi dung
// trang chu). Bat chung thanh bang la bay ve. Nhung du lieu KHACH HANG — don, khach, ton,
// tin nhan — deu phai la BANG, vi:
//   - ghi mot don khong duoc keo theo viec ghi lai ca 14 MB danh muc
//   - hai nguoi dat hang cung luc phai khong de len nhau (giao dich lam duoc, tep thi khong)
//   - tim "don cua so dien thoai nay" phai la mot cau lenh, khong phai doc het roi loc
//
// LUOC DO: moi module TU KHAI bang cua no (`luocDo` trong to khai), va ten bang PHAI bat dau
// bang id cua module. Nho vay nhin ten bang la biet chu, va khong module nao lang le sua bang
// cua module khac. Lich su chay luoc do nam trong bang `lich_su_luoc_do`.
//
// KHONG module nao duoc require tep nay — chung nhan `ctx.cong.kho`.

"use strict";

const mysql = require("mysql2/promise");

const BANG_SO = "so_du_lieu";
const BANG_LICH_SU = "lich_su_luoc_do";

/** Ten bang / cot an toan: chi chu thuong, so, gach duoi. */
function tenAnToan(ten, loai = "bảng") {
  const t = String(ten || "");
  if (!/^[a-z][a-z0-9_]*$/.test(t)) throw new Error(`Tên ${loai} không hợp lệ: ${JSON.stringify(ten)}`);
  return t;
}

/**
 * Dung menh de WHERE tu mot doi tuong.
 *   { ma: "X" }                        -> `ma` = ?
 *   { ma: ["A","B"] }                  -> `ma` IN (?, ?)
 *   { tao_luc: { ">": "2026-01-01" } } -> `tao_luc` > ?
 *   { ghi_chu: null }                  -> `ghi_chu` IS NULL
 */
const PHEP_SO_SANH = new Set([">", ">=", "<", "<=", "!=", "like"]);

function dungWhere(dieuKien = {}) {
  const menh = [];
  const thamSo = [];
  for (const [cot, giaTri] of Object.entries(dieuKien ?? {})) {
    const c = tenAnToan(cot, "cột");
    if (giaTri === null) { menh.push(`\`${c}\` IS NULL`); continue; }
    if (Array.isArray(giaTri)) {
      if (giaTri.length === 0) { menh.push("1 = 0"); continue; }  // IN () rong = khong co dong nao
      menh.push(`\`${c}\` IN (${giaTri.map(() => "?").join(", ")})`);
      thamSo.push(...giaTri);
      continue;
    }
    if (giaTri && typeof giaTri === "object") {
      for (const [phep, v] of Object.entries(giaTri)) {
        const p = String(phep).toLowerCase();
        if (!PHEP_SO_SANH.has(p)) throw new Error(`Phép so sánh không hỗ trợ: ${phep}`);
        menh.push(`\`${c}\` ${p.toUpperCase()} ?`);
        thamSo.push(v);
      }
      continue;
    }
    menh.push(`\`${c}\` = ?`);
    thamSo.push(giaTri);
  }
  return { menh: menh.length ? `WHERE ${menh.join(" AND ")}` : "", thamSo };
}

function dungSapXep(sapXep) {
  if (!sapXep) return "";
  const ds = Array.isArray(sapXep) ? sapXep : [sapXep];
  const phan = ds.map((x) => {
    const [cot, chieu = "asc"] = String(x).split(/\s+/);
    const c = tenAnToan(cot, "cột");
    return `\`${c}\` ${String(chieu).toLowerCase() === "desc" ? "DESC" : "ASC"}`;
  });
  return phan.length ? `ORDER BY ${phan.join(", ")}` : "";
}

/** Mot bang, gan voi mot nguoi chay cau lenh (pool hoac ket noi trong giao dich). */
function taoBang(chay, ten) {
  const t = tenAnToan(ten);
  return {
    async tim({ dieuKien = {}, sapXep = null, gioiHan = 0, bo = 0, cot = "*" } = {}) {
      const { menh, thamSo } = dungWhere(dieuKien);
      const cotChon = cot === "*" ? "*" : (Array.isArray(cot) ? cot : [cot]).map((c) => `\`${tenAnToan(c, "cột")}\``).join(", ");
      let sql = `SELECT ${cotChon} FROM \`${t}\` ${menh} ${dungSapXep(sapXep)}`;
      if (gioiHan > 0) { sql += " LIMIT ?"; thamSo.push(Number(gioiHan)); }
      if (bo > 0) { sql += " OFFSET ?"; thamSo.push(Number(bo)); }
      const [dong] = await chay(sql, thamSo);
      return dong;
    },

    async mot(dieuKien = {}) {
      const dong = await this.tim({ dieuKien, gioiHan: 1 });
      return dong[0] ?? null;
    },

    async dem(dieuKien = {}) {
      const { menh, thamSo } = dungWhere(dieuKien);
      const [dong] = await chay(`SELECT COUNT(*) AS n FROM \`${t}\` ${menh}`, thamSo);
      return Number(dong[0]?.n ?? 0);
    },

    async them(giaTri = {}) {
      const cot = Object.keys(giaTri).map((c) => tenAnToan(c, "cột"));
      if (cot.length === 0) throw new Error(`Thêm dòng rỗng vào bảng "${t}"`);
      const [kq] = await chay(
        `INSERT INTO \`${t}\` (${cot.map((c) => `\`${c}\``).join(", ")}) VALUES (${cot.map(() => "?").join(", ")})`,
        Object.values(giaTri)
      );
      return { id: kq.insertId ?? null, soDong: kq.affectedRows ?? 0 };
    },

    /** Them, dong da co (trung khoa) thi cap nhat cac cot dua vao. */
    async themHoacThay(giaTri = {}) {
      const cot = Object.keys(giaTri).map((c) => tenAnToan(c, "cột"));
      if (cot.length === 0) throw new Error(`Thêm dòng rỗng vào bảng "${t}"`);
      const [kq] = await chay(
        `INSERT INTO \`${t}\` (${cot.map((c) => `\`${c}\``).join(", ")}) VALUES (${cot.map(() => "?").join(", ")}) ` +
        `ON DUPLICATE KEY UPDATE ${cot.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(", ")}`,
        Object.values(giaTri)
      );
      return { id: kq.insertId ?? null, soDong: kq.affectedRows ?? 0 };
    },

    /**
     * Chen NHIEU dong trong mot cau lenh. Danh muc co hang chuc nghin bien the — chen tung
     * dong la hang chuc nghin luot di ve, mat vai phut cho mot viec dang le vai giay.
     * Cat thanh lo de khong vuot gioi han goi tin cua MySQL (`max_allowed_packet`).
     */
    async themNhieu(cacDong = [], { moiLo = 500 } = {}) {
      const ds = Array.isArray(cacDong) ? cacDong.filter(Boolean) : [];
      if (ds.length === 0) return { soDong: 0 };
      const cot = Object.keys(ds[0]).map((c) => tenAnToan(c, "cột"));
      if (cot.length === 0) throw new Error(`Them dong rong vao bang "${t}"`);

      let soDong = 0;
      for (let i = 0; i < ds.length; i += moiLo) {
        const lo = ds.slice(i, i + moiLo);
        const thamSo = [];
        for (const d of lo) {
          // Moi dong phai co DUNG bo cot cua dong dau — thieu mot cot la lech ca cau lenh.
          const thieu = cot.filter((c) => !(c in d));
          if (thieu.length > 0) throw new Error(`Dong thu ${i + lo.indexOf(d) + 1} thieu cot: ${thieu.join(", ")}`);
          for (const c of cot) thamSo.push(d[c]);
        }
        const mauMotDong = `(${cot.map(() => "?").join(", ")})`;
        const [kq] = await chay(
          `INSERT INTO \`${t}\` (${cot.map((c) => `\`${c}\``).join(", ")}) VALUES ${lo.map(() => mauMotDong).join(", ")}`,
          thamSo
        );
        soDong += kq.affectedRows ?? 0;
      }
      return { soDong };
    },

    async thay(dieuKien = {}, giaTri = {}) {
      const cot = Object.keys(giaTri).map((c) => tenAnToan(c, "cột"));
      if (cot.length === 0) return 0;
      const { menh, thamSo } = dungWhere(dieuKien);
      // Khong cho UPDATE khong dieu kien: mot lan lo tay la sua ca bang.
      if (!menh) throw new Error(`Sửa bảng "${t}" mà không có điều kiện — bị chặn.`);
      const [kq] = await chay(
        `UPDATE \`${t}\` SET ${cot.map((c) => `\`${c}\` = ?`).join(", ")} ${menh}`,
        [...Object.values(giaTri), ...thamSo]
      );
      return kq.affectedRows ?? 0;
    },

    /** Xoa SACH bang. Phai goi ro rang — `xoa({})` van bi chan de khong ai lo tay. */
    async xoaSach() {
      const [kq] = await chay(`DELETE FROM \`${t}\``, []);
      return kq.affectedRows ?? 0;
    },

    async xoa(dieuKien = {}) {
      const { menh, thamSo } = dungWhere(dieuKien);
      if (!menh) throw new Error(`Xoá bảng "${t}" mà không có điều kiện — bị chặn.`);
      const [kq] = await chay(`DELETE FROM \`${t}\` ${menh}`, thamSo);
      return kq.affectedRows ?? 0;
    }
  };
}

/** Tai lieu nho: mot dong trong `so_du_lieu`, noi dung la JSON. */
function taoSo(chay, ten) {
  const khoa = String(ten || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(khoa)) throw new Error(`Tên sổ không hợp lệ: ${ten}`);
  return {
    async doc(macDinh = null) {
      const [dong] = await chay(`SELECT noi_dung FROM \`${BANG_SO}\` WHERE ten = ?`, [khoa]);
      if (dong.length === 0) return macDinh;
      const tho = dong[0].noi_dung;
      return typeof tho === "string" ? JSON.parse(tho) : tho;
    },
    async ghi(giaTri) {
      await chay(
        `INSERT INTO \`${BANG_SO}\` (ten, noi_dung, sua_luc) VALUES (?, ?, NOW(3)) ` +
        "ON DUPLICATE KEY UPDATE noi_dung = VALUES(noi_dung), sua_luc = VALUES(sua_luc)",
        [khoa, JSON.stringify(giaTri)]
      );
      return giaTri;
    },
    /**
     * Doc - sua - ghi trong MOT giao dich, co KHOA DONG (`FOR UPDATE`).
     * Day la cho tep JSON khong lam duoc: hai yeu cau cung sua mot so thi nguoi thu hai
     * DOI, khong doc ban cu roi ghi de mat viec cua nguoi thu nhat.
     */
    capNhat: null   // duoc gan o `taoKhoMysql` vi can ket noi rieng cho giao dich
  };
}

async function taoKhoMysql({ duongKetNoi, nhatKy, soKetNoiToiDa = 10, hanCauLenhMs = 30000 } = {}) {
  if (!duongKetNoi) throw new Error("khoMysql cần `duongKetNoi` (mysql://user:pass@host:port/db)");
  const ky = nhatKy ?? { tin: () => {}, canhBao: () => {} };

  const pool = mysql.createPool({
    uri: duongKetNoi,
    connectionLimit: soKetNoiToiDa,
    waitForConnections: true,
    namedPlaceholders: false,
    dateStrings: true,
    // Han moi cau lenh: mot cau lenh treo khong duoc giu ket noi vo han (bai hoc tu A4).
    connectAttributes: { program_name: "toprun-server-khach" }
  });

  const chay = async (sql, thamSo = []) => {
    const ketNoi = await pool.getConnection();
    try {
      const dongHo = setTimeout(() => { try { ketNoi.destroy(); } catch { /* dang dong */ } }, hanCauLenhMs);
      try { return await ketNoi.query(sql, thamSo); }
      finally { clearTimeout(dongHo); }
    } finally {
      try { ketNoi.release(); } catch { /* da destroy */ }
    }
  };

  // Hai bang cua rieng khung.
  await chay(
    `CREATE TABLE IF NOT EXISTS \`${BANG_SO}\` (
       ten VARCHAR(190) NOT NULL,
       noi_dung LONGTEXT NOT NULL,
       sua_luc DATETIME(3) NOT NULL,
       PRIMARY KEY (ten)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, []);
  await chay(
    `CREATE TABLE IF NOT EXISTS \`${BANG_LICH_SU}\` (
       module VARCHAR(64) NOT NULL,
       ten VARCHAR(190) NOT NULL,
       chay_luc DATETIME(3) NOT NULL,
       PRIMARY KEY (module, ten)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, []);

  function boc(chayRieng) {
    const kho = {
      bang: (ten) => taoBang(chayRieng, ten),
      so(ten) {
        const s = taoSo(chayRieng, ten);
        s.capNhat = async (sua, macDinh = null) => {
          // Trong giao dich thi da co khoa cua giao dich ngoai; ngoai thi mo giao dich rieng.
          return kho.giaoDich(async (trong) => {
            const [dong] = await trong.cauLenh(`SELECT noi_dung FROM \`${BANG_SO}\` WHERE ten = ? FOR UPDATE`, [ten]);
            const cu = dong.length === 0 ? macDinh
              : (typeof dong[0].noi_dung === "string" ? JSON.parse(dong[0].noi_dung) : dong[0].noi_dung);
            const moi = await sua(cu);
            if (moi === undefined) return cu;
            await trong.so(ten).ghi(moi);
            return moi;
          });
        };
        return s;
      },
      cauLenh: (sql, thamSo = []) => chayRieng(sql, thamSo),
      async giaoDich(viec) {
        const ketNoi = await pool.getConnection();
        try {
          await ketNoi.beginTransaction();
          const trong = boc((sql, ts = []) => ketNoi.query(sql, ts));
          trong.giaoDich = (v) => v(trong);   // giao dich long nhau = dung chinh giao dich ngoai
          const kq = await viec(trong);
          await ketNoi.commit();
          return kq;
        } catch (e) {
          try { await ketNoi.rollback(); } catch { /* ket noi da chet */ }
          throw e;
        } finally {
          ketNoi.release();
        }
      },
      /** Chay luoc do cua mot module. Da chay roi thi bo qua — chay lai bao nhieu lan cung duoc. */
      async chayLuocDo(moduleId, cacBuoc = []) {
        const tienTo = `${String(moduleId).replace(/-/g, "_")}_`;
        for (const buoc of cacBuoc) {
          const daCo = await chayRieng(`SELECT 1 FROM \`${BANG_LICH_SU}\` WHERE module = ? AND ten = ?`, [moduleId, buoc.ten]);
          if (daCo[0].length > 0) continue;
          for (const b of Array.isArray(buoc.bang) ? buoc.bang : []) {
            if (!String(b).startsWith(tienTo)) {
              throw new Error(`Module "${moduleId}" khai bảng "${b}" — tên bảng phải bắt đầu bằng "${tienTo}".`);
            }
          }
          // Mot buoc co the co nhieu cau lenh. KHONG bat `multipleStatements` cua trinh
          // dieu khien (bat la mo duong tiem cau lenh o moi cho khac); cat tay o day.
          for (const cau of String(buoc.sql).split(";").map((x) => x.trim()).filter(Boolean)) {
            await chayRieng(cau, []);
          }
          await chayRieng(`INSERT INTO \`${BANG_LICH_SU}\` (module, ten, chay_luc) VALUES (?, ?, NOW(3))`, [moduleId, buoc.ten]);
          ky.tin(`[kho] chạy lược đồ ${moduleId}/${buoc.ten}`);
        }
      },
      choXong: async () => undefined,   // MySQL khong co hang doi ghi trong bo nho
      dong: () => pool.end()
    };
    return kho;
  }

  return boc(chay);
}

module.exports = { taoKhoMysql, dungWhere, dungSapXep, tenAnToan, BANG_SO, BANG_LICH_SU };
