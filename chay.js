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
const { sinhMaGhep, SO_KHOA_MAY } = require("./modules/khung-nen-tang/ghep-may");

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

  // MA GHEP MAY — de OMI (va may khac cua chinh shop) duoc CAP khoa rieng, khong ai phai be ma
  // quan tri sang. In ra o duoi, song 15 phut, dung mot lan. `KHONG_GHEP_MAY=1` thi tat han.
  const batGhepMay = String(env.KHONG_GHEP_MAY || "").trim() !== "1";
  const maGhep = batGhepMay ? sinhMaGhep() : "";
  const maGhepHetLuc = batGhepMay ? Date.now() + 15 * 60 * 1000 : 0;

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
      },
      "tien-doi-soat": {
        // Phan tram coc / phi ship / tien to chuyen khoan: neu co manh Khung nen tang thi
        // module Tien doc tu NOI DUNG TRANG (chu shop sua trong man quan tri). Ba bien duoi
        // day chi la ban lui khi chua co noi dung trang.
        phanTramCoc: Number(env.TIEN_PHAN_TRAM_COC || 0) || undefined,
        phiShipMacDinh: env.TIEN_PHI_SHIP === undefined ? undefined : Number(env.TIEN_PHI_SHIP),
        tienToChuyenKhoan: String(env.TIEN_TIEN_TO_CK || "").trim() || undefined,
        // Bao cho NGUOI BAN HANG (khong phai cho khach). Khong khai thi tat — khong bao bua.
        telegram: {
          token: String(env.TELEGRAM_BOT_TOKEN || "").trim(),
          nhom: String(env.TELEGRAM_CHAT_ID || env.TELEGRAM_ALERT_CHAT_ID || "").trim()
        }
      },
      "mua-ho": {
        // Cong doi tac giu phien bang cookie tu ky (anh Dung chot: "giu phien cookie nhu hien
        // nay"). KHONG co khoa nay thi khong ky duoc phien -> doi tac khong vao duoc cong.
        biMatPhien: String(env.BI_MAT_PHIEN_DOI_TAC || "").trim(),
        songGio: Number(env.PHIEN_DOI_TAC_GIO || 12),
        https: String(env.PHIEN_HTTPS || "").trim() === "1"
      },
      "van-chuyen": {
        hangMacDinh: String(env.VAN_CHUYEN_MAC_DINH || "spx").trim(),
        // Dia chi KHO CUA SHOP — nguoi gui tren moi van don. Thieu thi duong "tao van don tu
        // don" tra ve danh sach thieu gi, chu khong goi hang van chuyen voi dia chi rong.
        nguoiGui: {
          ten: String(env.KHO_TEN || "").trim(),
          dienThoai: String(env.KHO_DIEN_THOAI || "").trim(),
          tinh: String(env.KHO_TINH || "").trim(),
          huyen: String(env.KHO_HUYEN || "").trim(),
          xa: String(env.KHO_XA || "").trim(),
          diaChiChiTiet: String(env.KHO_DIA_CHI || "").trim()
        },
        spx: {
          appId: String(env.SPX_APP_ID || "").trim(),
          appSecret: String(env.SPX_APP_SECRET || "").trim(),
          userId: String(env.SPX_USER_ID || "").trim(),
          userSecret: String(env.SPX_USER_SECRET || "").trim()
        },
        vtp: {
          token: String(env.VTP_TOKEN || "").trim(),
          username: String(env.VTP_USERNAME || "").trim(),
          password: String(env.VTP_PASSWORD || "").trim(),
          groupAddressId: String(env.VTP_GROUP_ADDRESS_ID || "").trim()
        }
      },
      "khung-nen-tang": {
        deployId: String(env.DEPLOY_ID || "").trim() || "chua-dat",
        maGhep,
        maGhepHetLuc
      },
      "ctv": {
        // Phien cua cong tac vien cung ky bang khoa nay. Thieu thi khong ky duoc phien ->
        // CTV khong dang nhap duoc (va nhat ky khoi dong noi ro dieu do).
        biMatPhien: String(env.BI_MAT_PHIEN_CTV || env.BI_MAT_PHIEN_DOI_TAC || "").trim(),
        songGio: Number(env.PHIEN_CTV_GIO || 24 * 30),
        https: String(env.PHIEN_HTTPS || "").trim() === "1"
      }
    }
  });

  // NOI RO CAI GI DANG TAT. Mot manh thieu khoa thi no im lang khong lam gi — va im lang la
  // thu kho tim nhat: chu shop tuong Telegram hong, doi tac tuong cong sap. Vi vay bao ngay
  // luc khoi dong, mot lan, ro rang.
  const dangTat = [];
  if (!String(env.TELEGRAM_BOT_TOKEN || "").trim() || !String(env.TELEGRAM_CHAT_ID || env.TELEGRAM_ALERT_CHAT_ID || "").trim()) {
    dangTat.push("bao Telegram cho nguoi ban hang (thieu TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)");
  }
  if (String(env.BI_MAT_PHIEN_DOI_TAC || "").trim().length < 16) {
    dangTat.push("cong doi tac mua ho (thieu BI_MAT_PHIEN_DOI_TAC dai >= 16 ky tu)");
  }
  if (String(env.BI_MAT_PHIEN_CTV || env.BI_MAT_PHIEN_DOI_TAC || "").trim().length < 16) {
    dangTat.push("dang nhap cong tac vien (thieu BI_MAT_PHIEN_CTV dai >= 16 ky tu)");
  }
  if (!String(env.SPX_APP_ID || "").trim() && !String(env.VTP_TOKEN || "").trim()) {
    dangTat.push("tao van don (thieu khoa SPX va Viettel Post)");
  }
  if (!String(env.KHO_TEN || "").trim() || !String(env.KHO_DIEN_THOAI || "").trim()) {
    dangTat.push("tao van don tu don (thieu dia chi kho: KHO_TEN, KHO_DIEN_THOAI, KHO_TINH, KHO_HUYEN, KHO_XA, KHO_DIA_CHI)");
  }
  if (!String(env.FACEBOOK_VERIFY_TOKEN || "").trim()) {
    dangTat.push("nhan tin Fanpage (thieu FACEBOOK_VERIFY_TOKEN)");
  }
  for (const viec of dangTat) nhatKy.canhBao(`[chay] DANG TAT: ${viec}`);

  // Chay luoc do cua tung module truoc khi nhan yeu cau dau tien.
  if (typeof kho.chayLuocDo === "function") {
    for (const tk of napToKhais(thuMucModules, { bat })) {
      if ((tk.luocDo ?? []).length > 0) {
        await kho.chayLuocDo(tk.id, tk.luocDo, { bangKeThua: tk.bangKeThua ?? [] });
      }
    }
  }

  // KHOA MAY DA GHEP tu nhung lan chay truoc: doc lai vao cong quyen. Khong co buoc nay thi
  // moi lan bat lai server, may da ghep lai bi coi la nguoi la — va nguoi ban hang phai ghep lai.
  if (typeof kho.so === "function") {
    const soKhoa = await kho.so(SO_KHOA_MAY).doc();
    const ds = Array.isArray(soKhoa?.khoa) ? soKhoa.khoa : [];
    let daNap = 0;
    for (const k of ds) {
      try {
        if (cong.quyen.themKhoa({ ma: k.ma, ten: k.ten, vai: k.vai || "quan-tri" })) daNap += 1;
      } catch (e) {
        nhatKy.canhBao(`[chay] khoa may "${k?.ten ?? "khong ten"}" trong so khong dung duoc: ${e.message}`);
      }
    }
    if (daNap > 0) nhatKy.tin(`[chay] nap lai ${daNap} khoa may da ghep`);
  }

  const chuaTach = moduleChuaTach(thuMucModules);
  if (chuaTach.length > 0) nhatKy.tin(`[chay] con ${chuaTach.length} module chua tach: ${chuaTach.join(", ")}`);
  // Tra ca ma ghep ra ngoai: cho in no nam o `require.main` — khac pham vi voi cho sinh no.
  return { khung, cong, kho, maGhep, maGhepHetLuc };
}

if (require.main === module) {
  const cong = Number(process.env.PORT || 4180);
  dungHe({ thuMucDuLieu: process.env.THU_MUC_DU_LIEU || path.join(__dirname, "du-lieu") }).then(({ khung, maGhep, maGhepHetLuc }) => {
    taoMayChu(khung).listen(cong, () => {
      console.log(`[chay] server khach nghe o cong ${cong}`);
      for (const d of khung.banDuong()) console.log(`        ${d.method.padEnd(6)} ${d.path}  (${d.moduleId})`);
      // MA GHEP in SAU CUNG, to va ro: day la thu nguoi ban hang phai doc de noi OMI vao.
      if (maGhep) {
        const den = new Date(maGhepHetLuc).toLocaleTimeString("vi-VN");
        console.log("");
        console.log("  ┌───────────────────────────────────────────────┐");
        console.log(`  │  MA GHEP MAY:  ${maGhep}                         │`);
        console.log(`  │  Song den ${den}, dung MOT lan.            │`);
        console.log("  │  Mo OMI -> Cai dat -> go dia chi + ma nay.     │");
        console.log("  └───────────────────────────────────────────────┘");
        console.log("");
      }
    });
  }).catch((e) => {
    console.error("[chay] khong khoi dong duoc:", e.message);
    process.exitCode = 1;
  });
}

module.exports = { dungHe };
