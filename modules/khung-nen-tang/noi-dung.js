// NOI DUNG TRANG WEB — chu tren trang chu, so tai khoan, phi ship mac dinh, mau tin nhan.
//
// Day la CAU HINH CUA NHA BAN HANG, khong phai du lieu nghiep vu: chu shop sua trong man quan
// tri, mat web doc no de hien chu va de dung khoi chuyen khoan. Vi vay no nam o Khung nen tang
// — phan "cau hinh ban dau" ma giao keo da ghi la khong ban rieng, khong tat duoc.
//
// Ten truong lay Y NGUYEN cua ban dang chay (`defaultLandingContent`). Giao dien cu doc thang
// nhung ten nay; doi mot ten la mot cho tren web mat chu ma khong ai biet.
//
// MOT DIEU PHAI NHO: ban nay CONG KHAI (mat web doc duoc khi chua dang nhap), nen chi duoc
// chua thu ma khach hang duoc thay. So tai khoan la CO Y — khach phai doc de chuyen khoan.
// Cam them ma Telegram, ma quan tri, hay bat ky khoa nao vao day.

"use strict";

/** Ban mac dinh. Cung la danh sach truong duoc phep ghi: khoa la thi bo. */
function noiDungMacDinh() {
  return {
    heroEyebrow: "TOPRUN VIETNAM",
    heroTitle: "Tổng hợp hàng sale order",
    heroDescription: "Catalog cập nhật theo file sản phẩm mới, hiển thị size còn, giá niêm yết, giá sale và ảnh đại diện để khách lọc nhanh trước khi đặt hàng.",
    primaryButtonText: "Xem sản phẩm",
    secondaryButtonText: "Chỉ hiện hàng đang bán",
    productIntroTitle: "Giới thiệu sản phẩm",
    productIntroDefault: "{productName} là sản phẩm hàng order đang được TopRun tổng hợp trong catalog sale. Phù hợp nhóm {productKind}. Khách chọn size còn hàng và để lại thông tin, TopRun sẽ xác nhận lại trước khi chốt đơn.",
    orderNote: "Khách đặt hàng, TopRun liên hệ xác nhận tồn kho và size.",
    cartNote: "Hàng order thanh toán trước 20%, đặt hàng thông thường từ 3-7 ngày.",
    shippingFeeDefault: "30000",
    contactNote: "Xin liên hệ fanpage toprunvn hoặc Zalo để xác nhận đơn hàng và chuyển khoản.",
    momoEnabled: "false",
    momoOwnerName: "",
    momoPhone: "",
    momoQrImageUrl: "",
    momoDepositPercent: "20",
    momoTransferPrefix: "TR",
    momoInstruction: "Quét QR MoMo cá nhân, chuyển đúng số tiền và ghi đúng nội dung chuyển khoản để TopRun đối soát.",
    bankCode: "",
    bankName: "",
    bankAccountNumber: "",
    bankAccountName: "",
    bankInstruction: "Quét QR bằng app ngân hàng bất kỳ, số tài khoản, số tiền và nội dung chuyển khoản sẽ được điền sẵn. Kiểm tra đúng thông tin trước khi xác nhận.",
    messengerUrl: "",
    zaloUrl: "",
    zaloPhone: "",
    orderEmailSubject: "TopRun đã nhận đơn hàng {orderId}",
    orderEmailBody: "Xin chào {customerName},\n\nTopRun đã nhận đơn {orderId}.\n\nBạn có thể xem lại đơn hàng và theo dõi trạng thái tại:\n{orderUrl}\n\nTrong 15 phút đầu, bạn có thể kiểm tra và chỉnh sửa thông tin đơn hàng qua link trên. Sau thời gian này, thông tin người nhận sẽ được ẩn để bảo mật.\n\nTopRun sẽ liên hệ lại nếu cần xác nhận thêm về size/tồn kho.",
    chatMessageTemplate: "Em đã đặt đơn {orderId}, mã CK {paymentReference}, tổng {total}. Nhờ TopRun xác nhận giúp em ạ.",
    productSectionTitle: "Sản phẩm toprunvn",
    updatedAt: ""
  };
}

/**
 * Chuan hoa: CHI giu nhung truong co trong ban mac dinh, va moi gia tri la chuoi da trim.
 *
 * Day la cua ghi tu man quan tri, nen "chi giu truong da khai" la mot cai chan: ai gui thua
 * mot truong (co tinh hay do dan sai) thi truong do khong vao so, khong lo ra ban cong khai.
 */
function chuanHoa(vao = {}, luc = new Date()) {
  const goc = noiDungMacDinh();
  const ra = {};
  for (const khoa of Object.keys(goc)) {
    const g = vao?.[khoa];
    ra[khoa] = String(g ?? goc[khoa] ?? "").trim();
  }
  ra.updatedAt = (luc instanceof Date ? luc : new Date(luc)).toISOString();
  return ra;
}

/** Nhung con so ma module Tien can, doc ra tu noi dung. */
function soCuaTien(noiDung = {}) {
  // Chuoi RONG la "chua khai" — de ben kia dung mac dinh cua no. Chuoi "0" la mot lua chon
  // THAT cua chu shop (mien phi ship), khong duoc lang le doi thanh 30.000.
  const so = (g) => {
    const chu = String(g ?? "").trim();
    return chu === "" ? NaN : Number(chu);
  };
  const phanTram = so(noiDung.momoDepositPercent);
  const phiShip = so(noiDung.shippingFeeDefault);
  return {
    phanTramCoc: Number.isFinite(phanTram) && phanTram > 0 && phanTram <= 100 ? Math.round(phanTram) : null,
    phiShipMacDinh: Number.isFinite(phiShip) && phiShip >= 0 ? Math.round(phiShip) : null,
    tienToChuyenKhoan: String(noiDung.momoTransferPrefix || "").trim() || null
  };
}

module.exports = { noiDungMacDinh, chuanHoa, soCuaTien };
