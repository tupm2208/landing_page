// SPX — ky, goi, dung payload, tao van don.
//
// Port tu `spx-portal-shipment.js` + `spx_shipping.js` cua ban dang chay. Hai khac biet:
//   1. Khong tu goi `fetch`, khong doc `process.env` — nhan `httpNgoai` va `cauHinh` tu ngoai.
//      Nho vay bai kiem tra chay het duong tao van don ma khong goi SPX mot lan nao.
//   2. Nhan mot PHIEU GUI da chuan hoa, khong nhan "don hang". Module van chuyen khong duoc
//      biet hinh dang don hang cua shop — do la viec cua module Don hang.
//
// MOI QUIRK DUOI DAY DEU DA PHAI TRA GIA MOI BIET. Doi bat ky dong nao phai co ly do.
// QUY TAC DONG BO: logic payload SPX ton tai o HAI noi (Sales Desk + day). Sua ben nay
// phai sua ben kia cung dot.

"use strict";

const crypto = require("crypto");
const { doiSangHaiCap, hongFont } = require("./dia-chi");

const SPX_THAT = "https://spx.vn";
const SPX_THU = "https://test-stable.spx.vn";
const DUONG = {
  xacMinh: "/open/api/v1/shop/verify_account",
  taoDon: "/open/api/v1/order/create_order",
  timDon: "/open/api/v1/order/search_order",
  huyDon: "/open/api/v1/order/cancel_order",
  tem: "/open/api/v1/order/shipping_label",
  gioLayHang: "/open/api/v1/order/pickup_time"
};

function goc(cauHinh = {}) {
  const dat = String(cauHinh.baseURL || "").trim().replace(/\/+$/, "");
  if (dat && /^https?:\/\//i.test(dat)) return dat;
  return String(cauHinh.moiTruong || "").trim().toLowerCase() === "thu" ? SPX_THU : SPX_THAT;
}

function thieuCauHinh(cauHinh = {}) {
  const thieu = [];
  if (!String(cauHinh.appId || "").trim()) thieu.push("SPX App ID");
  if (!String(cauHinh.appSecret || "").trim()) thieu.push("SPX App Secret");
  if (!String(cauHinh.userId || "").trim()) thieu.push("SPX User ID");
  if (!String(cauHinh.userSecret || "").trim()) thieu.push("SPX Secret Key");
  return thieu;
}

/** SPX nhan user_id kieu so khi no la so va khong qua 16 chu so; dai hon thi phai gui chuoi. */
function maNguoiDung(userId) {
  const chu = String(userId || "").trim();
  return /^\d+$/.test(chu) && chu.length <= 16 ? Number(chu) : chu;
}

function kySo(appId, appSecret, moc, soNgauNhien, than) {
  return crypto.createHmac("sha256", String(appSecret || ""))
    .update(`${appId}_${moc}_${soNgauNhien}_${than}`, "utf8").digest("hex");
}

async function goiSpx({ httpNgoai, gio, cauHinh }, duong, than = {}) {
  const thieu = thieuCauHinh(cauHinh);
  if (thieu.length) return { ok: false, loi: "spx_chua_cau_hinh", loiNhan: `Thiếu cấu hình SPX: ${thieu.join(", ")}.` };

  const appId = String(cauHinh.appId || "").trim();
  const goiTin = { user_id: maNguoiDung(cauHinh.userId), user_secret: String(cauHinh.userSecret || "").trim(), ...than };
  const thanChu = JSON.stringify(goiTin);
  const moc = Math.floor(gio.bayGio().getTime() / 1000);
  const soNgauNhien = crypto.randomInt(1, 281474976710655);
  const diaChi = `${goc(cauHinh)}${duong.startsWith("/") ? duong : `/${duong}`}`;

  try {
    const tl = await httpNgoai.goi(diaChi, {
      method: "POST",
      hanMs: Number(cauHinh.hanMs || 30000),
      headers: {
        "Content-Type": "application/json",
        "app-id": appId,
        "check-sign": kySo(appId, cauHinh.appSecret, moc, soNgauNhien, thanChu),
        "timestamp": String(moc),
        "random-num": String(soNgauNhien)
      },
      body: thanChu
    });
    const goiRa = await tl.json().catch(() => ({}));
    const maTra = Number(goiRa?.ret_code ?? goiRa?.retcode ?? NaN);
    const ok = tl.ok && maTra === 0;
    return {
      ok, diaChi, maHttp: tl.status,
      maTra: Number.isFinite(maTra) ? maTra : null,
      loiNhan: String(goiRa?.message || (ok ? "success" : `SPX HTTP ${tl.status}`)),
      duLieu: goiRa?.data ?? null,
      tho: goiRa
    };
  } catch (e) {
    return {
      ok: false, diaChi, loi: "spx_goi_that_bai",
      loiNhan: e?.name === "AbortError" ? "SPX không phản hồi (quá hạn chờ)." : (e?.message || "Không gọi được SPX.")
    };
  }
}

function duongTraCuu(maVanDon = "") {
  return maVanDon ? `https://spx.vn/express/track?${new URLSearchParams({ spx_tn: maVanDon })}` : "";
}

/**
 * Dung payload SPX tu mot PHIEU GUI da chuan hoa.
 * Tra ve `{ payload, thieu, cod, giaTriHang }` — `thieu` khong rong thi CHUA duoc gui.
 */
function dungPayload({ phieu = {}, cauHinh = {} }) {
  const gui = phieu.nguoiGui ?? {};
  const nhan = phieu.nguoiNhan ?? {};
  const mon = Array.isArray(phieu.mon) ? phieu.mon : [];
  const thieu = [];

  if (!String(gui.ten || "").trim()) thieu.push("tên người gửi");
  if (!String(gui.dienThoai || "").trim()) thieu.push("số điện thoại người gửi");
  if (!gui.tinh || !gui.huyen || !gui.xa) thieu.push("địa chỉ lấy hàng đủ ba cấp");
  // Dia chi hong font lam bang doi khong khop -> roi ve he 3 cap -> SPX bao "location not
  // found" rat kho hieu. Chan som voi loi noi ro (dieu tra 23/08/2026).
  if (hongFont(gui.tinh, gui.huyen, gui.xa, gui.diaChiChiTiet)) {
    thieu.push("địa chỉ lấy hàng bị hỏng font — cần đồng bộ lại");
  }
  if (!String(nhan.ten || "").trim()) thieu.push("tên khách nhận");
  if (!String(nhan.dienThoai || "").trim()) thieu.push("số điện thoại khách nhận");

  const nhanHaiCap = String(nhan.heDiaChi || "") === "2-cap";
  if (nhanHaiCap) {
    if (!nhan.tinh || !nhan.xa) thieu.push("địa chỉ nhận hai cấp tỉnh/phường");
  } else if (!nhan.tinh || !nhan.huyen || !nhan.xa) {
    thieu.push("địa chỉ nhận ba cấp tỉnh/quận/phường");
  }
  if (!(nhan.diaChiChiTiet || nhan.diaChiDayDu)) thieu.push("địa chỉ chi tiết của khách nhận");
  if (mon.length === 0) thieu.push("sản phẩm trong đơn");

  const doiGui = (gui.tinh && gui.huyen && gui.xa)
    ? doiSangHaiCap({ tinh: gui.tinh, huyen: gui.huyen, xa: gui.xa })
    : { ok: false };
  const guiHaiCap = Boolean(doiGui.ok && !doiGui.mapHo);

  const doiNhan = (!nhanHaiCap && nhan.tinh && nhan.huyen && nhan.xa)
    ? doiSangHaiCap({ tinh: nhan.tinh, huyen: nhan.huyen, xa: nhan.xa })
    : null;
  const nhanChuan = nhanHaiCap || Boolean(doiNhan && doiNhan.ok && !doiNhan.mapHo);
  const nhanTinh = nhanChuan && !nhanHaiCap ? doiNhan.tinh : nhan.tinh;
  const nhanXa = nhanChuan && !nhanHaiCap ? doiNhan.xa : nhan.xa;

  const cod = Math.round(Math.max(0, Number(phieu.cod || 0)));
  const giaTriHang = Math.round(Math.max(0, Number(
    phieu.giaTriHang ?? mon.reduce((t, m) => t + Math.max(0, Number(m.donGia || 0)) * Math.max(1, Number(m.soLuong || 1)), 0)
  )));
  // Chot 25/08/2026: BO TRONG = NGUOI NHAN TRA. Truoc do don khong ghi ai tra ship thi roi
  // ve 1 (shop chiu phi) du khong ai chon — shop mat tien oan.
  const aiTra = String(phieu.aiTraShip || "").trim().toLowerCase();
  const vaiTraTien = ["nguoi-gui", "sender", "shop", "seller"].includes(aiTra) ? 1 : 2;

  const canNang = Number(phieu.canNangKg ?? mon.reduce(
    (t, m) => t + Math.max(0, Number(m.canNangKg || 0)) * Math.max(1, Number(m.soLuong || 1)), 0));

  const payload = {
    order_id: String(phieu.maPhieu || "").slice(0, 32),
    base_info: { service_type: 1 },
    sender_info: {
      sender_name: String(gui.ten || "").slice(0, 64),
      sender_phone: String(gui.dienThoai || "").trim(),
      sender_state: guiHaiCap ? doiGui.tinh : gui.tinh,
      sender_city: guiHaiCap ? doiGui.xa : gui.huyen,
      sender_district: guiHaiCap ? "" : gui.xa,
      sender_detail_address: String(gui.diaChiChiTiet || "").slice(0, 256),
      // 0 = he cu ba cap, 2 = he moi hai cap. Gia tri 1 BI SPX TU CHOI.
      sender_address_version: guiHaiCap ? 2 : 0
    },
    deliver_info: {
      deliver_name: String(nhan.ten || "").trim().slice(0, 64),
      deliver_phone: String(nhan.dienThoai || "").trim(),
      deliver_state: nhanTinh,
      deliver_city: nhanChuan ? nhanXa : nhan.huyen,
      deliver_district: nhanChuan ? "" : nhan.xa,
      deliver_detail_address: String(nhan.diaChiChiTiet || nhan.diaChiDayDu || "").slice(0, 256),
      deliver_instruction: String(phieu.danDo || "").slice(0, 256),
      deliver_address_version: nhanChuan ? 2 : 0
    },
    fulfillment_info: {
      payment_role: vaiTraTien,
      cod_collection: cod > 0 ? 1 : 0,
      ...(cod > 0 ? { cod_amount: Math.min(cod, 20000000) } : {}),
      high_value_processing_collection: giaTriHang >= 3000000 ? 1 : 0,
      collect_type: Number(cauHinh.collectType || 2),
      // Chot 03/09/2026: mac dinh CHI cho xem hang (dong kiem), KHONG cho thu hang.
      allow_mutual_check: 1,
      allow_try_on: 0
    },
    parcel_info: {
      parcel_weight: Math.max(0.1, Math.round((canNang || 0) * 100) / 100),
      parcel_item_name: String(phieu.tenGoiHang || mon[0]?.ten || "Hàng hoá").slice(0, 256),
      parcel_item_quantity: mon.reduce((t, m) => t + Math.max(1, Number(m.soLuong || 1)), 0),
      ...(giaTriHang >= 3000000 ? { express_insured_value: Math.min(giaTriHang, 20000000) } : {}),
      item_list: mon.map((m) => ({
        item_name: String(m.ten || "").slice(0, 128),
        // SPX bat item_price kieu CHUOI. Gui so bi loi unmarshal 11001.
        item_price: String(Math.max(0, Math.round(Number(m.donGia || 0)))),
        item_quantity: Math.max(1, Number(m.soLuong || 1))
      }))
    }
  };

  return { payload, thieu, cod, giaTriHang };
}

async function khungGioLayHangDauTien(cua) {
  const kq = await goiSpx(cua, DUONG.gioLayHang, { service_type: 1 });
  if (!kq.ok) return { ok: false, loiNhan: kq.loiNhan };
  const cacNgay = Array.isArray(kq.duLieu) ? kq.duLieu : [];
  for (const ngay of cacNgay) {
    const gio = Number(ngay?.pickup_time || 0);
    const o = (Array.isArray(ngay?.slots) ? ngay.slots : []).find((x) => x && x.pickup_time_range_id !== undefined);
    if (gio && o) {
      return { ok: true, gioLay: gio, maKhung: Number(o.pickup_time_range_id), khung: String(o.pickup_time_range || "") };
    }
  }
  return { ok: false, loiNhan: "SPX không trả khung giờ lấy hàng nào." };
}

function laLoiTrungMaDon(loiNhan = "") {
  return /used already|has been used|da ton tai|đã tồn tại/i.test(String(loiNhan || ""));
}

/**
 * Tao van don. Ba ket qua:
 *   { daGoi: false, viSao, thieu? }                       chua goi SPX (thieu cau hinh/du lieu)
 *   { daGoi: true, ok: true, maVanDon, duongTra, ... }    tao duoc
 *   { daGoi: true, ok: false, loiNhan }                   SPX tu choi that su
 */
async function taoVanDon(cua, phieu) {
  if (thieuCauHinh(cua.cauHinh).length) return { daGoi: false, viSao: "spx_chua_cau_hinh" };

  const ban = dungPayload({ phieu, cauHinh: cua.cauHinh });
  if (ban.thieu.length) return { daGoi: false, viSao: "phieu_thieu", thieu: ban.thieu };

  if (Number(cua.cauHinh.collectType || 2) === 1) {
    const khung = await khungGioLayHangDauTien(cua);
    if (!khung.ok) return { daGoi: true, ok: false, loiNhan: `Không lấy được khung giờ SPX đến lấy hàng: ${khung.loiNhan}` };
    ban.payload.fulfillment_info.pickup_time = khung.gioLay;
    ban.payload.fulfillment_info.pickup_time_range_id = khung.maKhung;
    if (khung.khung) ban.payload.fulfillment_info.pickup_time_range = khung.khung;
  }

  const maGoc = ban.payload.order_id;
  let loiCuoi = "";
  // SPX khoa VINH VIEN mot order_id da nop, ke ca lan nop truoc do that bai va khong luu
  // duoc ma van don. Tu dong thu lai voi hau to -R2/-R3 thay vi bat nguoi ban sua tay
  // (su co ORD-1785739667173).
  for (let lan = 1; lan <= 3; lan += 1) {
    const hauTo = lan === 1 ? "" : `-R${lan}`;
    ban.payload.order_id = hauTo ? `${maGoc.slice(0, 32 - hauTo.length)}${hauTo}` : maGoc;

    const kq = await goiSpx(cua, DUONG.taoDon, { orders: [ban.payload] });
    const daTao = (Array.isArray(kq.duLieu?.orders) ? kq.duLieu.orders : [])
      .find((d) => String(d.tracking_no || d.trackingNo || "").trim());

    if (kq.ok && daTao) {
      const maVanDon = String(daTao.tracking_no || daTao.trackingNo || "").trim();
      return {
        daGoi: true, ok: true, maVanDon,
        duongTra: String(daTao.tracking_link || "").trim() || duongTraCuu(maVanDon),
        maDonSpx: String(daTao.order_id || ban.payload.order_id),
        phiUocTinh: Number(daTao.estimated_shipping_fee ?? daTao.basic_shipping_fee ?? 0) || 0,
        cod: ban.cod,
        loiNhan: `Đã tạo vận đơn SPX ${maVanDon}.`
      };
    }
    const hong = (Array.isArray(kq.duLieu?.fail_list) ? kq.duLieu.fail_list : [])
      .map((d) => String(d.message || d.reason || "")).filter(Boolean).join("; ");
    loiCuoi = hong || kq.loiNhan || "SPX không trả kết quả tạo vận đơn.";
    if (!laLoiTrungMaDon(loiCuoi)) break;
  }
  return { daGoi: true, ok: false, loiNhan: `SPX từ chối tạo vận đơn: ${loiCuoi}` };
}

async function traCuu(cua, maVanDon) {
  const kq = await goiSpx(cua, DUONG.timDon, { tracking_no_list: [String(maVanDon || "")] });
  if (!kq.ok) return { ok: false, loiNhan: kq.loiNhan };
  const dong = (Array.isArray(kq.duLieu?.orders) ? kq.duLieu.orders : [])[0] ?? null;
  return { ok: true, don: dong, duongTra: duongTraCuu(maVanDon) };
}

module.exports = {
  DUONG, SPX_THAT, SPX_THU,
  thieuCauHinh, kySo, goiSpx, dungPayload, taoVanDon, traCuu, duongTraCuu,
  laLoiTrungMaDon, khungGioLayHangDauTien
};
