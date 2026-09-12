// DOI DIA CHI 3 CAP (he cu) SANG 2 CAP (he 2025) — port nguyen ban tu ban dang chay.
//
// Tu 2025 Viet Nam bo cap quan/huyen: 63 tinh 3 cap thanh 34 tinh 2 cap. SPX nhan ca hai
// he nhung phai bao dung `address_version` (0 = he cu, 2 = he moi; gia tri 1 BI TU CHOI).
// Bang doi nam trong `du-lieu/address-merge-map-2025.json` — du lieu THAM CHIEU cong khai
// (nguon vietmap), khong phai du lieu khach, nen di theo ma nguon.
//
// Doc bang bang `require` chu khong qua cong `kho`: day la du lieu di kem phien ban ma,
// khong phai du lieu cua shop. Doc LUOI (lan dau co ai hoi) de khoi dong khong ton 1,7 MB.

"use strict";

let chiMuc = null;   // Map<"tinh|huyen|xa", entry>
let phienBan = "";

function chuanHoa(giaTri = "") {
  return String(giaTri || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function boTienTo(daChuanHoa = "") {
  return String(daChuanHoa || "")
    .replace(/^(tinh|thanh pho|tp|quan|huyen|thi xa|phuong|xa|thi tran|dac khu)\s+/, "")
    .trim();
}

const TEN_KHAC = { "thua thien hue": "hue" };

function cacKhoa(giaTri = "") {
  const goc = chuanHoa(giaTri);
  if (!goc) return [""];
  const khoa = [goc];
  const daBo = boTienTo(goc);
  if (daBo && daBo !== goc) khoa.push(daBo);
  for (const k of khoa.slice()) {
    const khac = TEN_KHAC[k];
    if (khac && !khoa.includes(khac)) khoa.push(khac);
  }
  return khoa;
}

// Quan 2 va Quan 9 da nhap vao Thu Duc; Cua Lo nhap vao Vinh. Bang doi khong co dong cho
// ten cu nen phai doi ten truoc khi tra.
const HUYEN_KHAC = {
  "quan 2": "thu duc",
  "quan 9": "thu duc",
  "quan thu duc": "thu duc",
  "thi xa cua lo": "vinh",
  "cua lo": "vinh"
};

function napChiMuc() {
  if (chiMuc) return chiMuc;
  let tho;
  try {
    tho = require("./du-lieu/address-merge-map-2025.json");
  } catch {
    return null;  // thieu bang doi: goi y he cu, khong nem
  }
  const m = new Map();
  for (const dong of Array.isArray(tho.entries) ? tho.entries : []) {
    for (const kTinh of cacKhoa(dong.oldProvince)) {
      for (const kHuyen of cacKhoa(dong.oldDistrict)) {
        for (const kXa of cacKhoa(dong.oldWard)) {
          const khoa = `${boTienTo(kTinh)}|${boTienTo(kHuyen)}|${kXa}`;
          if (!m.has(khoa)) m.set(khoa, dong);
        }
      }
    }
  }
  phienBan = String(tho.version || "");
  chiMuc = m;
  return chiMuc;
}

/**
 * @param phan { tinh, huyen, xa }
 * @returns { ok, tinh, xa, mapHo } — `mapHo` = xa cu bi TACH lam nhieu xa moi, dang lay cai
 *          dau tien. Nguoi that nen xac nhan lai; van gui duoc chu khong chan.
 */
function doiSangHaiCap(phan = {}) {
  const m = napChiMuc();
  if (!m) return { ok: false, viSao: "thieu_bang_doi" };

  const kTinh = cacKhoa(phan.tinh).map(boTienTo);
  const kHuyen = cacKhoa(phan.huyen).map(boTienTo);
  for (const k of cacKhoa(phan.huyen)) {
    const khac = HUYEN_KHAC[k];
    if (khac && !kHuyen.includes(khac)) kHuyen.push(khac);
  }
  const kXa = cacKhoa(phan.xa);

  let dong = null;
  for (const a of kTinh) { for (const b of kHuyen) { for (const c of kXa) { dong = m.get(`${a}|${b}|${c}`); if (dong) break; } if (dong) break; } if (dong) break; }
  if (!dong || !Array.isArray(dong.targets) || dong.targets.length === 0) {
    return { ok: false, viSao: "khong_co_trong_bang" };
  }
  const dau = dong.targets[0];
  return {
    ok: true,
    tinh: dau.province,
    xa: dau.ward,
    mapHo: dong.targets.length > 1,
    cacLuaChon: dong.targets,
    xaCu: dong.oldWard,
    phienBan
  };
}

/** Dia chi dinh ky tu hong font (U+FFFD) lam SPX tra loi "location not found" rat kho hieu. */
function hongFont(...phan) {
  return phan.some((p) => String(p || "").includes("�"));
}

module.exports = { doiSangHaiCap, hongFont, chuanHoa, boTienTo, cacKhoa };
