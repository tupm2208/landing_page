// NAP TAI KHOAN CONG TAC VIEN THAT vao ban tach.
//
// Doc `data/ctv-accounts.json` cua ban dang chay (CHI DOC) va ghi vao bang `ctv_tai_khoan`.
//
// BAN BAM MAT KHAU DUOC GIU NGUYEN. Ban tach dung dung hinh dang bam cua ban dang chay
// (`pbkdf2$210000$muoi$khoa`), nen 6 CTV that dang nhap duoc NGAY bang mat khau cu — khong ai
// phai dat lai. Do la ly do tep `modules/ctv/mat-khau.js` khong duoc doi hinh dang.
//
// THIET BI THI KHONG NHAP. Ban dang chay giu danh sach thiet bi da duyet trong chinh tep tai
// khoan; nhap sang day la coi nhu duyet san cho nhung may do ma khong ai soi lai. CTV dang nhap
// lan dau tren ban tach se xin duyet lai — mot lan bam cua chu shop, va doi lai la biet chac may
// nao dang duoc vao.

"use strict";

const fs = require("fs");
const path = require("path");

const { taoKhoMysql } = require("../loi/cong/kho-mysql");
const { taoNhatKy } = require("../loi/cong/co-ban");
const { gioMySQL } = require("../../chung/gio-mysql.js");
const mCtv = require("../modules/ctv/module");

const THU_MUC = process.env.THU_MUC_THAT || path.join("D:", "projects", "toprunvn", "data");
const DUONG = String(process.env.TOPRUN_MYSQL_URL || "").trim();
const CHI_XEM = String(process.env.CHI_XEM || "").trim() === "1";
const GHI_DE = String(process.env.GHI_DE || "").trim() === "1";

function chiSo(g) { return String(g ?? "").replace(/[^0-9]/g, ""); }
function chuoi(g, tran = 190) { return String(g ?? "").trim().slice(0, tran); }

async function chay() {
  if (!DUONG) {
    console.error("Can TOPRUN_MYSQL_URL (cong 3307 — cong 3306 la du lieu that cua landing).");
    process.exitCode = 1;
    return;
  }
  if (/:3306\//.test(DUONG)) throw new Error("TOPRUN_MYSQL_URL tro vao cong 3306 — do la du lieu that cua landing.");

  const tep = path.join(THU_MUC, "ctv-accounts.json");
  const tho = JSON.parse(fs.readFileSync(tep, "utf8"));      // CHI DOC
  const cacTk = Array.isArray(tho) ? tho : (tho?.accounts ?? []);
  console.log(`[nap-ctv] doc ${tep} (chi doc): ${cacTk.length} tai khoan`);

  const nhatKy = taoNhatKy();
  const kho = await taoKhoMysql({ duongKetNoi: DUONG, nhatKy });
  try {
    await kho.chayLuocDo("ctv", mCtv.luocDo);
    const bang = kho.bang("ctv_tai_khoan");
    const luc = gioMySQL(new Date());
    let ghi = 0;
    let daCo = 0;
    let bo = 0;

    for (const tk of cacTk) {
      const ma = chuoi(tk?.id || tk?.affiliateId, 64);
      const bam = String(tk?.passwordHash || "");
      if (!ma || !bam.startsWith("pbkdf2$")) {
        console.log(`  bo ${ma || "(khong ma)"}: ${!ma ? "khong co ma" : "ban bam mat khau khong doc duoc"}`);
        bo += 1;
        continue;
      }
      const cu = await bang.mot({ ma });
      if (cu && !GHI_DE) { daCo += 1; continue; }
      if (CHI_XEM) { ghi += 1; continue; }

      await bang.themHoacThay({
        ma,
        ten: chuoi(tk.name),
        dien_thoai: chiSo(tk.phone).slice(0, 32),
        email: chuoi(tk.email).toLowerCase(),
        ten_dang_nhap: chuoi(tk.username || tk.phone),
        ma_gioi_thieu: chuoi(tk.code, 40).toUpperCase(),
        dang_bat: tk.active === false ? 0 : 1,
        cho_bo_logo: tk.allowNoLogo === true ? 1 : 0,
        bam_mat_khau: bam,
        bam_cap_luc: tk.passwordHashUpdatedAt ? gioMySQL(new Date(tk.passwordHashUpdatedAt)) : null,
        tao_luc: tk.createdAt ? gioMySQL(new Date(tk.createdAt)) : luc,
        sua_luc: luc
      });
      ghi += 1;
      const soMay = Array.isArray(tk.devices) ? tk.devices.length : 0;
      console.log(`  ${ma.padEnd(30)} ${chuoi(tk.name).padEnd(18)} ${soMay > 0 ? `(${soMay} máy cũ — KHÔNG nhập, sẽ xin duyệt lại)` : ""}`);
    }

    console.log(`[nap-ctv] ${CHI_XEM ? "sẽ ghi" : "đã ghi"} ${ghi}, đã có ${daCo}, bỏ ${bo}.`);
    const [dem] = await kho.cauLenh("SELECT COUNT(*) AS n FROM ctv_tai_khoan", []);
    console.log(`[nap-ctv] trong so giờ có ${dem[0].n} cộng tác viên.`);
  } finally {
    await kho.dong();
  }
}

chay().catch((e) => {
  console.error("[nap-ctv] hong:", e?.stack || e);
  process.exitCode = 1;
});
