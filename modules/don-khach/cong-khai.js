// BAN CONG KHAI CUA MOT DON — nhung gi khach duoc thay khi tra don.
//
// Ba ban, khac nhau o "khach chung minh duoc bao nhieu":
//
//   detail  — co DUNG ma don + ma tra cuu (link tu email/popup dat hang). Thay ca ho so
//             nguoi nhan, va trong 15 phut dau con sua/huy duoc.
//   secret  — co ma don + ma bi mat. Thay mon va van don, KHONG thay dia chi, KHONG thay
//             trang thai noi bo.
//   status  — chi co ma don + so dien thoai. Chi thay don dang di den dau.
//
// HAI DIEU KHONG DUOC PHA:
//
// 1. KHONG NOI TEN KHO / TEN DOI TAC ra cho khach (anh Dung 10/09/2026). Ban `status` va
//    `secret` khong mang ten kho; ban `detail` la don cua chinh khach nen giu nhu ban dang
//    chay, nhung tuyet doi khong them gia von vao bat ky ban nao.
// 2. TIEN KHONG TU SUY DIEN. `paidAmount`/`remainingAmount` do module Tien tinh bang
//    `order-money-kit`, truyen vao day. Tep nay khong tu cong tru mot dong nao.
//
// Ca tep la ham thuan — vao mot don, ra mot doi tuong. Khong doc kho, khong doc gio he thong
// (gio truyen vao), nen bai kiem tra goi thang duoc.

"use strict";

/** Khach tu sua / tu huy duoc bao lau sau khi dat. Giong ban dang chay. */
const PHUT_TU_SUA = 15;

/** Nhan trang thai cho khach doc. Copy y nguyen tu ban dang chay de khach khong thay khac. */
function nhanTrangThai(trangThai = "", trangThaiGiao = "", maVanDon = "", don = {}, theVanDon = "") {
  const k = String(trangThai || "").toLowerCase();
  const g = String(trangThaiGiao || "").toLowerCase();
  const monTrangThai = (Array.isArray(don.items) ? don.items : []).map((m) => String(m.procurementStatus || "").toLowerCase());
  if (k === "cancelled" || k === "canceled") return "Đơn đã hủy";
  if (k === "completed" || k === "done") return "Đơn đã hoàn tất";
  if (theVanDon === "partial") return "Một phần đơn đã có vận đơn";
  if (maVanDon || ["shipped", "in_transit", "shipping"].includes(g)) return "Đơn đã có vận đơn";
  if (["packed", "ready_to_ship"].includes(g)) return "Đơn đã sẵn sàng giao";
  if (["purchase_complete", "partner_confirmed", "ready_to_ship", "sent_to_sapo"].includes(k)
    || (monTrangThai.length > 0 && monTrangThai.every((v) => ["purchase_complete", "purchased"].includes(v)))) {
    return "Đã chuẩn bị đủ hàng - chờ giao vận";
  }
  if (["partner_assigned", "purchase_ready", "purchase_partial", "waiting_purchase", "deposit_received"].includes(k)
    || (monTrangThai.length > 0 && monTrangThai.every((v) => ["stock_confirmed", "confirmed_in_stock", "available", "purchase_ready", "purchase_partial", "purchase_complete", "purchased"].includes(v)))) {
    return "Đã xác nhận có hàng - đang chuẩn bị hàng";
  }
  if (["payment_pending", "stock_confirmed"].includes(k) || g === "stock_reserved") return "Đã xác nhận có hàng";
  if (k === "waiting_partner_confirm" || g === "waiting_partner_confirm") return "TopRun đang xác nhận hàng";
  if (["confirmed", "processing"].includes(k)) return "Đơn đang được xử lý";
  return "TopRun đã nhận đơn";
}

/** Cau giai thich di kem nhan. Cung copy y nguyen. */
function ghiChuTrangThai(trangThai = "", trangThaiGiao = "", maVanDon = "", don = {}, theVanDon = "") {
  const k = String(trangThai || "").toLowerCase();
  const g = String(trangThaiGiao || "").toLowerCase();
  const monTrangThai = (Array.isArray(don.items) ? don.items : []).map((m) => String(m.procurementStatus || "").toLowerCase());
  if (k === "cancelled" || k === "canceled") return "Đơn hàng đã được hủy. Vui lòng liên hệ TopRun nếu bạn cần kiểm tra thêm.";
  if (k === "completed" || k === "done") return "Đơn hàng đã hoàn tất. Cảm ơn bạn đã mua hàng tại TopRun.";
  if (theVanDon === "partial") return "Một phần đơn đã có mã vận chuyển. Bạn có thể theo dõi từng kiện đã được bàn giao.";
  if (maVanDon) return "Đơn đã có mã vận chuyển. Bạn có thể bấm theo dõi vận chuyển để xem hành trình giao hàng.";
  if (["packed", "ready_to_ship", "shipped", "in_transit", "shipping"].includes(g)) return "Đơn đang ở bước giao hàng.";
  if (["purchase_complete", "partner_confirmed", "ready_to_ship", "sent_to_sapo"].includes(k)
    || (monTrangThai.length > 0 && monTrangThai.every((v) => ["purchase_complete", "purchased"].includes(v)))) {
    return "TopRun đã chuẩn bị đủ sản phẩm và đang chờ bàn giao cho đơn vị vận chuyển.";
  }
  if (["partner_assigned", "purchase_ready", "purchase_partial", "waiting_purchase", "deposit_received"].includes(k)
    || (monTrangThai.length > 0 && monTrangThai.every((v) => ["stock_confirmed", "confirmed_in_stock", "available", "purchase_ready", "purchase_partial", "purchase_complete", "purchased"].includes(v)))) {
    return "Sản phẩm đã được xác nhận có hàng. TopRun đang mua hoặc chuẩn bị hàng cho đơn của bạn.";
  }
  if (["payment_pending", "stock_confirmed"].includes(k) || g === "stock_reserved") return "Sản phẩm trong đơn đã được xác nhận có hàng và đang chờ bước xử lý tiếp theo.";
  if (k === "waiting_partner_confirm" || g === "waiting_partner_confirm") return "TopRun đang xác nhận tồn kho và size sản phẩm trong đơn.";
  if (["confirmed", "processing"].includes(k)) return "TopRun đang xử lý đơn hàng của bạn.";
  return "TopRun đã nhận đơn và sẽ kiểm tra tồn kho/size trước khi xác nhận tiếp.";
}

function duongTraVanDon(don = {}) {
  const san = String(don.trackingUrl || "").trim();
  if (san) return san;
  const ma = String(don.trackingCode || "").trim();
  if (!ma) return "";
  const hang = String(don.shippingProvider || don.carrier || "").trim().toLowerCase();
  if (hang === "spx" || hang.includes("spx") || ma.toUpperCase().startsWith("SPX")) {
    return `https://spx.vn/track?${encodeURIComponent(ma)}`;
  }
  return "";
}

/**
 * Han khach tu sua / tu huy.
 *
 * Doc cot `can_cancel_until` neu don co (bang cua ban dang chay co cot nay); khong co thi
 * tinh tu luc dat + 15 phut — dung bang nhau, vi ban dang chay cung ghi dung nhu vay.
 */
function hanTuSua(don = {}) {
  const khai = String(don.canCancelUntil || "").trim();
  if (khai) {
    const t = new Date(khai);
    if (!Number.isNaN(t.getTime())) return t;
  }
  const tao = new Date(String(don.createdAt || ""));
  if (Number.isNaN(tao.getTime())) return null;
  return new Date(tao.getTime() + PHUT_TU_SUA * 60 * 1000);
}

/** Con sua duoc khong. Don da huy thi khong, het 15 phut thi khong. */
function suaDuoc(don = {}, bayGio = new Date()) {
  const tt = String(don.status || "").toLowerCase();
  if (tt === "cancelled" || tt === "canceled") return false;
  const han = hanTuSua(don);
  if (!han) return false;
  return bayGio.getTime() <= han.getTime();
}

/** Phan chung cua ca ba ban: don dang di den dau. */
function banTrangThai(don = {}) {
  const trangThai = String(don.status || "pending").trim() || "pending";
  const trangThaiGiao = String(don.fulfillmentStatus || "").trim();
  const maVanDon = String(don.trackingCode || "").trim();
  // Chua tach module Van chuyen ra khoi don, nen chua co danh sach kien. Mot kien = ca don.
  const cacKien = Array.isArray(don.shipments) ? don.shipments : [];
  const soKienCoMa = cacKien.filter((k) => k.trackingCode).length;
  const theVanDon = maVanDon || (cacKien.length > 0 && soKienCoMa === cacKien.length)
    ? "full"
    : soKienCoMa > 0 ? "partial" : "";
  const maHieuLuc = maVanDon || String(cacKien.find((k) => k.trackingCode)?.trackingCode || "");
  return {
    id: don.id || "",
    status: trangThai,
    statusLabel: nhanTrangThai(trangThai, trangThaiGiao, maHieuLuc, don, theVanDon),
    statusNote: ghiChuTrangThai(trangThai, trangThaiGiao, maHieuLuc, don, theVanDon),
    fulfillmentStatus: trangThaiGiao,
    shippingProvider: String(don.shippingProvider || ""),
    trackingCode: maVanDon,
    trackingUrl: duongTraVanDon(don),
    shipments: cacKien,
    updatedAt: don.updatedAt || don.createdAt || "",
    createdAt: don.createdAt || ""
  };
}

function monRutGon(m = {}, { coGia = true } = {}) {
  const ra = {
    productCode: m.productCode || "",
    productName: m.productName || "",
    size: m.size || "",
    qty: Number(m.qty ?? m.quantity ?? 1),
    quantity: Number(m.qty ?? m.quantity ?? 1),
    imageUrl: m.imageUrl || ""
  };
  if (!coGia) return ra;
  return {
    ...ra,
    price: Number(m.price || 0),
    warehouseId: m.warehouseId || "",
    warehouseName: m.warehouseName || m.warehouse || "",
    brand: m.brand || "",
    productKind: m.productKind || "",
    sourceName: m.sourceName || ""
  };
}

/**
 * Ban DETAIL — khach co ma tra cuu cua chinh don minh.
 * @param tien { daTra, conPhaiTra } do module Tien tinh. Khong co thi de 0 va noi ro la 0,
 *             chu khong tu tinh o day (LUAT 3 cua module Don).
 */
function banChiTiet(don = {}, { bayGio = new Date(), tien = null } = {}) {
  const sua = suaDuoc(don, bayGio);
  const han = hanTuSua(don);
  return {
    ...banTrangThai(don),
    view: "detail",
    canEdit: sua,
    canCancel: sua,
    canEditUntil: han ? han.toISOString() : "",
    privacyNote: sua
      ? "Bạn có thể sửa thông tin hoặc hủy đơn trong 15 phút sau khi đặt."
      : "Đơn hàng đã quá thời gian tự chỉnh sửa. Để bảo mật, thông tin người nhận đã được ẩn.",
    items: (Array.isArray(don.items) ? don.items : []).map((m) => monRutGon(m)),
    total: Number(don.total || 0),
    paymentReference: String(don.paymentReference || ""),
    paymentAmount: Number(don.paymentAmount || 0),
    paidAmount: Number(tien?.daTra || 0),
    remainingAmount: Number(tien?.conPhaiTra ?? Math.max(0, Number(don.total || 0) - Number(tien?.daTra || 0))),
    customer: sua ? {
      customerName: don.customerName || "",
      phone: don.phone || "",
      email: don.email || "",
      province: don.province || "",
      district: don.district || "",
      ward: don.ward || "",
      addressDetail: don.addressDetail || "",
      address: don.address || "",
      note: don.note || ""
    } : null
  };
}

/** Ban SECRET — co ma bi mat. Thay mon va van don, KHONG thay dia chi, KHONG thay trang thai noi bo. */
function banBiMat(don = {}) {
  const { status, fulfillmentStatus, ...conLai } = banTrangThai(don);
  return {
    ...conLai,
    view: "secret",
    customerName: String(don.customerName || ""),
    items: (Array.isArray(don.items) ? don.items : []).map((m) => monRutGon(m, { coGia: false })),
    shipments: (conLai.shipments || []).map((k) => ({
      id: k.id || "",
      shippingProvider: k.shippingProvider || "",
      trackingCode: k.trackingCode || "",
      trackingUrl: k.trackingUrl || "",
      items: (k.items || []).map((m) => monRutGon(m, { coGia: false }))
    }))
  };
}

/** Ban STATUS — chi co ma don + so dien thoai. Chi thay don di den dau. */
function banChiTrangThai(don = {}) {
  return { ...banTrangThai(don), view: "status" };
}

module.exports = {
  PHUT_TU_SUA,
  nhanTrangThai, ghiChuTrangThai, duongTraVanDon,
  hanTuSua, suaDuoc,
  banTrangThai, banChiTiet, banBiMat, banChiTrangThai
};
