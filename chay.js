// DIEM KHOI DONG cua server khach.
//
// Day la CHO DUY NHAT doc bien moi truong va quyet dinh dung cong nao. Module khong bao gio
// doc `process.env` — no nhan `ctx.cauHinh`. Nho vay doi tu tep JSON sang MySQL, hay doi
// tu Graph API that sang ban gia, chi sua tep nay.

"use strict";

const path = require("path");
const { taoKhung } = require("./loi/khung");
const { taoMayChu } = require("./loi/may-chu");
const { napToKhais, moduleChuaTach } = require("./loi/nap-modules");
const { taoKhoTep } = require("./loi/cong/kho-tep");
const { taoKhoMysql } = require("./loi/cong/kho-mysql");
const { taoCongQuyen } = require("./loi/cong/quyen");
const { taoNhatKy, gioThat, taoHttpNgoai } = require("./loi/cong/co-ban");

async function dungHe({ thuMucDuLieu, env = process.env } = {}) {
  const nhatKy = taoNhatKy();
  // Anh Dung chot 12/09: du lieu khach ve HET MySQL. Duong tep chi con cho may chua co
  // MySQL (chay thu tren may ca nhan) — va no noi ro ra o nhat ky, khong im lang.
  const duongMysql = String(env.TOPRUN_MYSQL_URL || "").trim();
  if (duongMysql && /:3306\//.test(duongMysql)) {
    throw new Error("TOPRUN_MYSQL_URL tro vao cong 3306 — do la du lieu that cua landing dang chay.");
  }
  const kho = duongMysql
    ? await taoKhoMysql({ duongKetNoi: duongMysql, nhatKy })
    : taoKhoTep({ thuMuc: thuMucDuLieu, nhatKy });
  if (!duongMysql) nhatKy.canhBao("[chay] CHUA co TOPRUN_MYSQL_URL — dang chay bang tep JSON, chi dung de thu.");
  const cong = {
    kho,
    nhatKy,
    gio: gioThat,
    httpNgoai: taoHttpNgoai(),
    quyen: taoCongQuyen({
      maQuanTri: env.LANDING_ADMIN_TOKEN,
      maDon: env.LANDING_ORDERS_TOKEN,
      maDichVu: env.BO_NAO_TOKEN
    })
  };

  const thuMucModules = path.join(__dirname, "modules");
  const bat = String(env.MODULE_BAT || "").trim()
    ? String(env.MODULE_BAT).split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const khung = taoKhung({
    cong,
    nhatKy,
    toKhais: napToKhais(thuMucModules, { bat }),
    cauHinh: {
      "hop-thu": {
        verifyToken: String(env.FACEBOOK_VERIFY_TOKEN || "").trim(),
        appSecret: String(env.FACEBOOK_APP_SECRET || "").trim(),
        tokenTrang: String(env.FACEBOOK_PAGE_TOKEN || "").trim()
      }
    }
  });

  // Chay luoc do cua tung module truoc khi nhan yeu cau dau tien.
  if (typeof kho.chayLuocDo === "function") {
    for (const tk of napToKhais(thuMucModules, { bat })) {
      if ((tk.luocDo ?? []).length > 0) await kho.chayLuocDo(tk.id, tk.luocDo);
    }
  }

  const chuaTach = moduleChuaTach(thuMucModules);
  if (chuaTach.length > 0) nhatKy.tin(`[chay] con ${chuaTach.length} module chua tach: ${chuaTach.join(", ")}`);
  return { khung, cong, kho };
}

if (require.main === module) {
  const cong = Number(process.env.PORT || 4180);
  dungHe({ thuMucDuLieu: process.env.THU_MUC_DU_LIEU || path.join(__dirname, "du-lieu") }).then(({ khung }) => {
    taoMayChu(khung).listen(cong, () => {
      console.log(`[chay] server khach nghe o cong ${cong}`);
      for (const d of khung.banDuong()) console.log(`        ${d.method.padEnd(6)} ${d.path}  (${d.moduleId})`);
    });
  }).catch((e) => {
    console.error("[chay] khong khoi dong duoc:", e.message);
    process.exitCode = 1;
  });
}

module.exports = { dungHe };
