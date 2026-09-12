// VIETTEL POST — duong thu hai, dung khi shop khong dung SPX.
//
// Port tu `viettelpost_shipping.js` + `viettelpost-portal-shipment.js`. Cung luat voi SPX:
// khong tu goi mang, khong doc bien moi truong.
//
// Khac SPX o cho phai DANG NHAP lay token truoc. Token co the cho san trong cau hinh
// (shop tu lay tren trang doi tac) — khi do bo qua buoc dang nhap.

"use strict";

const GOC_MAC_DINH = "https://partner.viettelpost.vn";
const DUONG = {
  dangNhap: "/v2/user/login-from-web",
  taoDon: "/v2/order/createOrderNlp",
  traCuu: "/v2/order/getOrderByTrackingNumber"
};

function goc(cauHinh = {}) {
  return String(cauHinh.baseURL || GOC_MAC_DINH).trim().replace(/\/+$/, "");
}

function thieuCauHinh(cauHinh = {}) {
  if (String(cauHinh.token || "").trim()) return [];
  const thieu = [];
  if (!String(cauHinh.username || "").trim()) thieu.push("ViettelPost username");
  if (!String(cauHinh.password || "").trim()) thieu.push("ViettelPost password");
  return thieu;
}

function duLieu(goiRa = {}) {
  return goiRa && goiRa.data !== undefined ? goiRa.data : goiRa;
}

function loiNhan(goiRa = {}, duPhong = "") {
  return String(goiRa.message || goiRa.error || goiRa.data?.message || goiRa.data?.error || duPhong || "").trim();
}

async function goiVtp({ httpNgoai, cauHinh }, duong, tuyChon = {}) {
  const diaChi = `${goc(cauHinh)}${duong.startsWith("/") ? duong : `/${duong}`}`;
  const tieuDe = { Accept: "application/json" };
  if (tuyChon.than !== undefined) tieuDe["Content-Type"] = "application/json";
  if (tuyChon.token) tieuDe.Token = tuyChon.token;
  try {
    const tl = await httpNgoai.goi(diaChi, {
      method: tuyChon.method || (tuyChon.than !== undefined ? "POST" : "GET"),
      hanMs: Number(cauHinh.hanMs || 20000),
      headers: tieuDe,
      body: tuyChon.than !== undefined ? JSON.stringify(tuyChon.than) : undefined
    });
    const goiRa = await tl.json().catch(() => ({}));
    // Viettel Post bao loi bang nhieu kieu khac nhau tuy endpoint — phai soi ca nam cho.
    const ok = tl.ok
      && !goiRa.error
      && goiRa.status !== false
      && !(Number.isFinite(Number(goiRa.status)) && Number(goiRa.status) >= 400)
      && goiRa.success !== false
      && goiRa.ok !== false;
    return { ok, diaChi, duLieu: duLieu(goiRa), tho: goiRa, loiNhan: loiNhan(goiRa, ok ? "success" : `ViettelPost HTTP ${tl.status}`) };
  } catch (e) {
    return {
      ok: false, diaChi,
      loiNhan: e?.name === "AbortError" ? "ViettelPost không phản hồi (quá hạn chờ)." : (e?.message || "Không gọi được ViettelPost.")
    };
  }
}

function bocToken(goiRa = {}) {
  const d = duLieu(goiRa) || {};
  return String(d.token || d.TOKEN || goiRa.token || goiRa.TOKEN || "").trim();
}

async function layToken(cua) {
  const sanCo = String(cua.cauHinh.token || "").trim();
  if (sanCo) return { ok: true, token: sanCo };
  const thieu = thieuCauHinh(cua.cauHinh);
  if (thieu.length) return { ok: false, loiNhan: `Thiếu cấu hình ViettelPost: ${thieu.join(", ")}.` };
  const kq = await goiVtp(cua, DUONG.dangNhap, {
    method: "POST", than: { USERNAME: cua.cauHinh.username, PASSWORD: cua.cauHinh.password }
  });
  const token = bocToken(kq.tho || {});
  return token ? { ok: true, token } : { ok: false, loiNhan: kq.loiNhan || "ViettelPost đăng nhập không trả token." };
}

function duongTraCuu(ma = "") {
  return ma ? `https://viettelpost.com.vn/tra-cuu-hanh-trinh-don/?tracking=${encodeURIComponent(ma)}` : "";
}

function bocMaVanDon(goiRa = {}) {
  const d = duLieu(goiRa) || {};
  return String(d.ORDER_NUMBER || d.orderNumber || d.trackingNumber || d.trackingCode || goiRa.ORDER_NUMBER || "").trim();
}

function bocPhi(goiRa = {}) {
  const d = duLieu(goiRa) || {};
  return Number(d.MONEY_TOTALFEE ?? d.moneyTotalFee ?? d.totalFee ?? d.fee ?? 0) || 0;
}

/** Dung payload VTP tu cung PHIEU GUI chuan hoa ma SPX dung. */
function dungPayload({ phieu = {} }) {
  const gui = phieu.nguoiGui ?? {};
  const nhan = phieu.nguoiNhan ?? {};
  const mon = Array.isArray(phieu.mon) ? phieu.mon : [];
  const giaTriHang = Math.round(Math.max(0, Number(
    phieu.giaTriHang ?? mon.reduce((t, m) => t + Math.max(0, Number(m.donGia || 0)) * Math.max(1, Number(m.soLuong || 1)), 0))));
  const cod = Math.round(Math.max(0, Number(phieu.cod || 0)));
  const canNang = Number(phieu.canNangKg ?? mon.reduce(
    (t, m) => t + Math.max(0, Number(m.canNangKg || 0)) * Math.max(1, Number(m.soLuong || 1)), 0));

  return {
    ORDER_NUMBER: String(phieu.maPhieu || "").slice(0, 50),
    SENDER_FULLNAME: String(gui.ten || ""),
    SENDER_PHONE: String(gui.dienThoai || ""),
    SENDER_ADDRESS: [gui.diaChiChiTiet, gui.xa, gui.huyen, gui.tinh].filter(Boolean).join(", "),
    RECEIVER_FULLNAME: String(nhan.ten || ""),
    RECEIVER_PHONE: String(nhan.dienThoai || ""),
    RECEIVER_ADDRESS: String(nhan.diaChiDayDu || "").trim()
      || [nhan.diaChiChiTiet, nhan.xa, nhan.huyen, nhan.tinh].filter(Boolean).join(", "),
    PRODUCT_NAME: String(phieu.tenGoiHang || mon[0]?.ten || "Hàng hoá").slice(0, 250),
    PRODUCT_QUANTITY: mon.reduce((t, m) => t + Math.max(1, Number(m.soLuong || 1)), 0),
    PRODUCT_PRICE: giaTriHang,
    PRODUCT_WEIGHT: Math.max(100, Math.round((canNang || 0) * 1000)),   // VTP tinh bang gram
    MONEY_COLLECTION: cod,
    ORDER_NOTE: String(phieu.danDo || "").slice(0, 250),
    ORDER_PAYMENT: String(phieu.aiTraShip || "").toLowerCase() === "nguoi-gui" ? 1 : 2,
    ORDER_SERVICE: String(phieu.dichVu || "VCN"),
    LIST_ITEM: mon.map((m) => ({
      PRODUCT_NAME: String(m.ten || "").slice(0, 250),
      PRODUCT_PRICE: Math.max(0, Math.round(Number(m.donGia || 0))),
      PRODUCT_QUANTITY: Math.max(1, Number(m.soLuong || 1))
    }))
  };
}

async function taoVanDon(cua, phieu) {
  if (thieuCauHinh(cua.cauHinh).length) return { daGoi: false, viSao: "vtp_chua_cau_hinh" };
  const dangNhap = await layToken(cua);
  if (!dangNhap.ok) return { daGoi: true, ok: false, loiNhan: dangNhap.loiNhan };

  const kq = await goiVtp(cua, DUONG.taoDon, { method: "POST", token: dangNhap.token, than: dungPayload({ phieu }) });
  const ma = bocMaVanDon(kq.tho || {});
  if (!kq.ok || !ma) return { daGoi: true, ok: false, loiNhan: kq.loiNhan || "ViettelPost không trả mã vận đơn." };
  return {
    daGoi: true, ok: true, maVanDon: ma, duongTra: duongTraCuu(ma),
    phiUocTinh: bocPhi(kq.tho || {}), loiNhan: `Đã tạo vận đơn ViettelPost ${ma}.`
  };
}

async function traCuu(cua, maVanDon) {
  const dangNhap = await layToken(cua);
  if (!dangNhap.ok) return { ok: false, loiNhan: dangNhap.loiNhan };
  const kq = await goiVtp(cua, `${DUONG.traCuu}?orderNumber=${encodeURIComponent(maVanDon)}`, { token: dangNhap.token });
  if (!kq.ok) return { ok: false, loiNhan: kq.loiNhan };
  return { ok: true, don: kq.duLieu ?? null, duongTra: duongTraCuu(maVanDon) };
}

module.exports = { DUONG, thieuCauHinh, dungPayload, taoVanDon, traCuu, duongTraCuu, layToken, bocMaVanDon, bocPhi };
