// HANG CHO GUI — cho cac kenh landing KHONG tu gui duoc (Zalo, Facebook ca nhan).
//
// Anh Dung chot 14/09/2026: luong 2 (Zalo, FB ca nhan, automation) chay tren OMI o may shop.
// Bo nao tra loi vao landing nhu moi kenh khac; landing khong gui duoc kenh nay nen xep vao
// hang cho; OMI (may truc) keo ve, go bang automation, roi bao lai da gui.
//
// Luat, moi luat mot bai kiem tra (hop-thu-kenh-omi.test.js):
//   - NHAN (claim) la doc quyen 3 phut: may nhan roi im lang la tin tro lai hang cho, may khac
//     nhan duoc — khong ai gui trung vi trong 3 phut do chi mot may cam.
//   - Tin cho qua 12 gio la QUA HAN: khong gui nua (tra loi mot cau hoi tu hom qua la lam
//     khach kho chiu), nhung van giu de nguoi that thay.
//   - Gui hong thi thu lai toi 3 lan, sau do dung lai va noi ro vi sao.
//   - So chi giu 500 muc da xong gan nhat; muc dang cho/dang gui khong bao gio bi cat.
//
// Tep nay la HAM THUAN tren mot doi tuong so — khong cong, khong gio that — de kiem duoc tron.

"use strict";

const NHAN_SONG_MS = 3 * 60 * 1000;
const QUA_HAN_MS = 12 * 60 * 60 * 1000;
const THU_LAI_TOI_DA = 3;
const GIU_XONG_TOI_DA = 500;
const TRANG_THAI = ["cho", "dang-gui", "da-gui", "hong", "qua-han"];

function soMacDinh() {
  return { version: 1, muc: [], dem: 0, updatedAt: "" };
}

function chuan(so) {
  const s = so && typeof so === "object" ? so : soMacDinh();
  if (!Array.isArray(s.muc)) s.muc = [];
  if (!Number.isInteger(s.dem)) s.dem = 0;
  return s;
}

/** Xep mot tin vao hang cho. Tra ve muc vua xep. */
function xepVao(so, { kenh, nguoi, chu, nguon = "bo-nao", maHoiThoai = "" }, luc) {
  const s = chuan(so);
  s.dem += 1;
  const muc = {
    id: `cg_${luc.getTime()}_${s.dem}`,
    kenh: String(kenh), nguoi: String(nguoi), chu: String(chu), nguon: String(nguon),
    maHoiThoai: String(maHoiThoai || `${kenh}:${nguoi}`),
    taoLuc: luc.toISOString(), trangThai: "cho",
    nhanLuc: "", boi: "", guiLuc: "", loi: "", thuLai: 0
  };
  s.muc.push(muc);
  s.updatedAt = luc.toISOString();
  return muc;
}

/** Don dep: tin cho qua han -> qua-han; may nhan roi im lang -> tra ve cho. */
function donDep(so, luc) {
  const s = chuan(so);
  const t = luc.getTime();
  for (const m of s.muc) {
    if (m.trangThai === "dang-gui" && t - Date.parse(m.nhanLuc) > NHAN_SONG_MS) {
      m.trangThai = "cho"; m.nhanLuc = ""; m.boi = "";
    }
    if (m.trangThai === "cho" && t - Date.parse(m.taoLuc) > QUA_HAN_MS) {
      m.trangThai = "qua-han"; m.loi = "cho qua 12 gio, khong gui nua";
    }
  }
  return s;
}

/** May `boi` nhan toi da `gioiHan` tin dang cho (cua `kenh`, hoac moi kenh neu rong). */
function nhan(so, { kenh = "", boi = "", gioiHan = 10 }, luc) {
  const s = donDep(so, luc);
  const ra = [];
  for (const m of s.muc) {
    if (ra.length >= gioiHan) break;
    if (m.trangThai !== "cho") continue;
    if (kenh && m.kenh !== kenh) continue;
    m.trangThai = "dang-gui"; m.nhanLuc = luc.toISOString(); m.boi = String(boi || "");
    ra.push(m);
  }
  s.updatedAt = luc.toISOString();
  return ra.map((m) => ({ id: m.id, kenh: m.kenh, nguoi: m.nguoi, chu: m.chu, maHoiThoai: m.maHoiThoai, taoLuc: m.taoLuc, nguon: m.nguon }));
}

/** May bao ket qua. `ok` -> da-gui; khong -> thu lai (toi 3 lan) roi hong. Tra muc, hoac null neu khong co / khong phai dang gui. */
function xong(so, { id, ok, loi = "" }, luc) {
  const s = chuan(so);
  const m = s.muc.find((x) => x.id === id);
  if (!m || m.trangThai !== "dang-gui") return null;
  if (ok) {
    m.trangThai = "da-gui"; m.guiLuc = luc.toISOString(); m.loi = "";
  } else {
    m.thuLai += 1;
    m.loi = String(loi || "gui hong").slice(0, 300);
    if (m.thuLai >= THU_LAI_TOI_DA) { m.trangThai = "hong"; } else { m.trangThai = "cho"; m.nhanLuc = ""; m.boi = ""; }
  }
  s.updatedAt = luc.toISOString();
  catBot(s);
  return m;
}

/** Giu moi muc dang cho / dang gui; muc da xong chi giu 500 gan nhat. */
function catBot(so) {
  const s = chuan(so);
  const dangSong = s.muc.filter((m) => m.trangThai === "cho" || m.trangThai === "dang-gui");
  const daXong = s.muc.filter((m) => m.trangThai !== "cho" && m.trangThai !== "dang-gui").slice(-GIU_XONG_TOI_DA);
  s.muc = [...dangSong, ...daXong].sort((a, b) => a.taoLuc.localeCompare(b.taoLuc));
  return s;
}

function tomTat(so) {
  const s = chuan(so);
  const dem = Object.fromEntries(TRANG_THAI.map((t) => [t, 0]));
  for (const m of s.muc) dem[m.trangThai] = (dem[m.trangThai] ?? 0) + 1;
  return dem;
}

module.exports = { soMacDinh, xepVao, donDep, nhan, xong, catBot, tomTat, NHAN_SONG_MS, QUA_HAN_MS, THU_LAI_TOI_DA, GIU_XONG_TOI_DA, TRANG_THAI };
