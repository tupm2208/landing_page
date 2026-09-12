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
const { taoBoDemGoi } = require("./loi/cong/han-goi");
const { taoBoVe } = require("./loi/cong/ve");
const { bocCheDoThu } = require("./loi/cong/che-do-thu");
const { taoCongTepTinh } = require("./loi/cong/tep-tinh");

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
  if (String(env.CHE_DO_THAT || "").trim() !== "1") {
    nhatKy.canhBao("[chay] CHE DO THU: khong gui tin cho khach, khong tao van don that, khong bao Telegram.");
  } else {
    nhatKy.canhBao("[chay] CHE DO THAT: moi loi goi ra ngoai la THAT. Kiem lai truoc khi chay tren du lieu that.");
  }
  if (String(env.BI_MAT_VE || "").trim().length < 16) {
    nhatKy.canhBao("[chay] CHUA co BI_MAT_VE — ve 15 phut dang TAT, moi ben van dung khoa dai han.");
  }
  const cong = {
    kho,
    nhatKy,
    gio: gioThat,
    // CHE DO THU BAT THEO MAC DINH. Phai khai ro `CHE_DO_THAT=1` moi cho goi that ra ngoai.
    // Anh Dung chot 12/09: ban thu duoc doc realtime tu Graph API nhung KHONG duoc tra loi
    // khach. Mac dinh la "an toan" chu khong phai "tien": quen dat bien thi khong ai bi
    // nhan tin oan.
    httpNgoai: String(env.CHE_DO_THAT || "").trim() === "1"
      ? taoHttpNgoai()
      : bocCheDoThu({ httpNgoaiThat: taoHttpNgoai(), nhatKy }),
    quyen: taoCongQuyen({
      // Khoa dai han CO TEN — nho vay nhat ky ghi duoc "sales-desk vua goi".
      cacKhoa: [
        { ma: env.LANDING_ADMIN_TOKEN, ten: "quan-tri", vai: "quan-tri" },
        { ma: env.LANDING_ORDERS_TOKEN, ten: "don-hang", vai: "quan-tri" },
        { ma: env.IMAGE_TOOL_TOKEN, ten: "image-tool", vai: "quan-tri" },
        { ma: env.BO_NAO_TOKEN, ten: "bo-nao", vai: "dich-vu" }
      ].filter((k) => String(k.ma || "").trim() !== ""),
      boVe: String(env.BI_MAT_VE || "").trim().length >= 16
        ? taoBoVe({ biMat: env.BI_MAT_VE, gio: gioThat })
        : null,
      nhatKy
    }),
    hanGoi: taoBoDemGoi({ gio: gioThat }),
    // Mat web: module chi thay thu muc `goc/` cua chinh no, va chi nhung duoi tep da khai.
    tepTinh: taoCongTepTinh({ thuMucGoc: path.join(__dirname, "modules"), nhatKy })
  };

  const thuMucModules = path.join(__dirname, "modules");
  const bat = String(env.MODULE_BAT || "").trim()
    ? String(env.MODULE_BAT).split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const khung = taoKhung({
    cong,
    nhatKy,
    // Tren hosting/Cloudflare thi dia chi that nam o tieu de. BAT khi co proxy that o truoc;
    // bat khi KHONG co proxy la de nguoi ta tu khai IP va lach han goi.
    tinProxy: String(env.TIN_PROXY || "").trim() === "1",
    toKhais: napToKhais(thuMucModules, { bat }),
    cauHinh: {
      "hop-thu": {
        verifyToken: String(env.FACEBOOK_VERIFY_TOKEN || "").trim(),
        appSecret: String(env.FACEBOOK_APP_SECRET || "").trim(),
        tokenTrang: String(env.FACEBOOK_PAGE_TOKEN || "").trim()
      },
      "gian-hang": {
        // Goc site that, dung cho the OG (crawler Facebook doc the nay khi khach share link).
        gocSite: String(env.LANDING_SITE_BASE_URL || env.SITE_URL || "https://toprun.site").trim(),
        // 33.809 tep anh san pham (7,6 GB) KHONG duoc cop sang ban tach. Khai bien nay thi anh
        // nao khong co o day se duoc 302 sang site that de trinh duyet tu lay — may thu khong
        // goi ra ngoai, no chi chi duong.
        gocAnhThat: String(env.GOC_ANH_THAT || "").trim()
      }
    }
  });

  // Chay luoc do cua tung module truoc khi nhan yeu cau dau tien.
  if (typeof kho.chayLuocDo === "function") {
    for (const tk of napToKhais(thuMucModules, { bat })) {
      if ((tk.luocDo ?? []).length > 0) {
        await kho.chayLuocDo(tk.id, tk.luocDo, { bangKeThua: tk.bangKeThua ?? [] });
      }
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
