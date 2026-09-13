// GHEP MAY — cach mot may (OMI) duoc server cap khoa rieng, KHONG ai phai be ma quan tri sang.
//
// Vi sao co tep nay (anh Dung nhac 13/09/2026): "thiet ke ma phai tu mo file gi do de app moi
// chay duoc thi vo ly". Dung. Truoc do OMI chi vao duoc khi nguoi ta mo `cau-hinh.json` ra dan
// ma quan tri bang tay — ma quan tri la khoa cua CA server, nen:
//
//   - mot may bi lo la ca he bi lo, va khong thu hoi duoc rieng may do;
//   - nhat ky chi ghi "quan-tri vua goi", khong biet may nao;
//   - va nguoi ban hang phai lam mot viec cua ky thuat vien.
//
// Cach dung ra:
//
//   1. Server in mot MA GHEP ngan luc khoi dong (6 chu so, song 15 phut, dung MOT lan).
//   2. Nguoi ban hang mo OMI, go dia chi server + ma ghep do vao man Cai dat.
//   3. Server cap cho may do MOT KHOA RIENG co ten ("omi:<ten may>"), OMI tu luu vao cau hinh
//      cua chinh no. Tu day nhat ky ghi duoc "omi:may-ban-hang-1 vua goi", va bo mot may la bo
//      mot dong trong so.
//
// BA LUAT:
//
//   1. MA GHEP DUNG MOT LAN. Ghep xong la ma do chet — de lai mot ma con song trong nhat ky
//      server la de mot cua mo.
//   2. CO HAN GIO. Het 15 phut thi phai bat lai server (hoac xin ma moi) — ma ghep khong duoc
//      nam cho do ca thang.
//   3. CHAN GOI DON THAT. Ma 6 chu so thi do duoc: 10 lan / 15 phut cho mot dia chi, va sai
//      qua 10 lan thi ma do CHET (khong phai cho het gio).

"use strict";

const crypto = require("crypto");

const SO_LAN_SAI_TOI_DA = 10;
const SO_KHOA_MAY = "khung-nen-tang-khoa-may";
const SONG_MS_MAC_DINH = 15 * 60 * 1000;
const SONG_MS_TOI_DA = 60 * 60 * 1000;

/** Ma ghep: 6 chu so, de doc qua dien thoai. Sinh bang nguon ngau nhien that. */
function sinhMaGhep() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

/** Khoa rieng cua mot may: dai, ngau nhien, khong mang y nghia gi. */
function sinhKhoaMay() {
  return `may_${crypto.randomBytes(24).toString("base64url")}`;
}

function tenKhoaCuaMay(tenMay) {
  const sach = String(tenMay || "").trim().replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 60);
  return `omi:${sach === "" ? "khong-ten" : sach}`;
}

/**
 * Trang thai cua ma ghep trong MOT lan chay server.
 *
 * De trong bo nho co y: bat lai server la ma moi. Ma ghep khong phai thu de dai lau — no chi
 * de bat tay lan dau.
 */
function taoSoGhep({ ma = "", hetLuc = 0 } = {}) {
  return { ma: String(ma || ""), hetLuc: Number(hetLuc || 0), soLanSai: 0, daDung: false };
}

/**
 * CAP MOT MA GHEP MOI luc dang chay — chu shop bam mot nut tren man Quan tri may, khong phai bat
 * lai may chu.
 *
 * MOT LUC CHI CO MOT MA SONG: cap ma moi la ma cu chet ngay. Co y — hai ma cung song la hai cua
 * mo, va chu shop khong the nho minh da doc ma nao cho ai.
 */
function moMaMoi(so, bayGio, { songMs = SONG_MS_MAC_DINH } = {}) {
  const song = Math.min(SONG_MS_TOI_DA, Math.max(60 * 1000, Number(songMs) || SONG_MS_MAC_DINH));
  so.ma = sinhMaGhep();
  so.hetLuc = bayGio.getTime() + song;
  so.soLanSai = 0;
  so.daDung = false;
  return { ma: so.ma, hetLuc: so.hetLuc, songGiay: Math.round(song / 1000) };
}

/**
 * Trang thai ma ghep, de man Quan tri may hien duoc.
 *
 * Ma CHI ra man hinh khi con song. Mot ma da dung hoac het han hien ra chi de nguoi ta doc cho
 * nguoi khac go, roi ca hai khong hieu vi sao truot.
 */
function xemSo(so, bayGio) {
  const luc = bayGio.getTime();
  const dangSong = so.ma !== "" && !so.daDung && so.hetLuc > luc && so.soLanSai < SO_LAN_SAI_TOI_DA;
  return {
    co: so.ma !== "",
    dangSong,
    ma: dangSong ? so.ma : "",
    conLaiGiay: dangSong ? Math.max(0, Math.round((so.hetLuc - luc) / 1000)) : 0,
    soLanSai: so.soLanSai,
    daDung: so.daDung
  };
}

/**
 * Ghep mot may.
 *
 * @param so      so ghep trong bo nho (tu `taoSoGhep`)
 * @param bayGio  Date
 * @param vao     { maGhep, tenMay }
 * @returns { ok, khoa?, ten?, viSao? }
 */
function ghep(so, bayGio, vao = {}) {
  const maGhep = String(vao.maGhep || "").trim();
  const luc = bayGio.getTime();

  if (so.ma === "") return { ok: false, viSao: "chua_bat_ghep_may", message: "Máy chủ chưa bật ghép máy." };
  if (so.daDung) return { ok: false, viSao: "ma_da_dung", message: "Mã ghép này đã dùng rồi. Chủ shop bấm \"Tạo mã ghép mới\" trong OMI (tab Máy & khoá) để cấp mã khác." };
  if (so.hetLuc <= luc) return { ok: false, viSao: "ma_het_han", message: "Mã ghép đã hết hạn. Chủ shop bấm \"Tạo mã ghép mới\" trong OMI (tab Máy & khoá) để cấp mã khác." };
  if (so.soLanSai >= SO_LAN_SAI_TOI_DA) {
    return { ok: false, viSao: "sai_qua_nhieu", message: "Nhập sai quá nhiều lần — mã này đã bị khoá. Chủ shop cấp mã mới trong OMI (tab Máy & khoá)." };
  }

  // So tung byte, khong tra loi som: ma 6 chu so thi moi cai gi giup do deu dang.
  const dung = maGhep.length === so.ma.length
    && crypto.timingSafeEqual(Buffer.from(maGhep, "utf8"), Buffer.from(so.ma, "utf8"));
  if (!dung) {
    so.soLanSai += 1;
    const con = Math.max(0, SO_LAN_SAI_TOI_DA - so.soLanSai);
    return {
      ok: false, viSao: "ma_sai",
      message: `Mã ghép không đúng. Còn ${con} lần thử.`
    };
  }

  so.daDung = true;                      // LUAT 1: dung mot lan
  return { ok: true, khoa: sinhKhoaMay(), ten: tenKhoaCuaMay(vao.tenMay) };
}

module.exports = {
  sinhMaGhep, sinhKhoaMay, tenKhoaCuaMay, taoSoGhep, ghep, moMaMoi, xemSo,
  SO_LAN_SAI_TOI_DA, SO_KHOA_MAY, SONG_MS_MAC_DINH
};
