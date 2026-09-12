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
const { taoCongQuyen } = require("./loi/cong/quyen");
const { taoNhatKy, gioThat, taoHttpNgoai } = require("./loi/cong/co-ban");

function dungHe({ thuMucDuLieu, env = process.env } = {}) {
  const nhatKy = taoNhatKy();
  const cong = {
    kho: taoKhoTep({ thuMuc: thuMucDuLieu, nhatKy }),
    nhatKy,
    gio: gioThat,
    httpNgoai: taoHttpNgoai(),
    quyen: taoCongQuyen({ maQuanTri: env.LANDING_ADMIN_TOKEN, maDon: env.LANDING_ORDERS_TOKEN })
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

  const chuaTach = moduleChuaTach(thuMucModules);
  if (chuaTach.length > 0) nhatKy.tin(`[chay] con ${chuaTach.length} module chua tach: ${chuaTach.join(", ")}`);
  return { khung, cong };
}

if (require.main === module) {
  const cong = Number(process.env.PORT || 4180);
  const { khung } = dungHe({ thuMucDuLieu: process.env.THU_MUC_DU_LIEU || path.join(__dirname, "du-lieu") });
  taoMayChu(khung).listen(cong, () => {
    console.log(`[chay] server khach nghe o cong ${cong}`);
    for (const d of khung.banDuong()) console.log(`        ${d.method.padEnd(6)} ${d.path}  (${d.moduleId})`);
  });
}

module.exports = { dungHe };
