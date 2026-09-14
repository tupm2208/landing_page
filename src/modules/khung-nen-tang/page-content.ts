/**
 * @file Page content: the words on the home page, bank details, the default shipping fee, message templates.
 *
 * This is the MERCHANT'S CONFIGURATION, not business data: the owner edits it in the admin
 * screen, the storefront reads it to show text and to build the bank-transfer block. That is why
 * it lives in the platform base — the "initial setup" part the spec says is not sold separately
 * and cannot be switched off.
 *
 * Field names are taken VERBATIM from the running site (`defaultLandingContent`). The old UI reads
 * these names directly; renaming one makes a spot on the web lose its text and nobody notices.
 *
 * ONE THING TO REMEMBER: this document is PUBLIC (the storefront reads it without logging in), so
 * it may only hold what a customer is allowed to see. The bank account number is INTENTIONAL —
 * the customer needs it to transfer money. A Telegram token, an admin key, or any secret is
 * forbidden here. The allow-list below is the fence that keeps them out.
 */

/** Every public content field. The key list IS the `/api/content` wire shape. */
export interface PageContent {
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
  primaryButtonText: string;
  secondaryButtonText: string;
  productIntroTitle: string;
  productIntroDefault: string;
  orderNote: string;
  cartNote: string;
  shippingFeeDefault: string;
  contactNote: string;
  momoEnabled: string;
  momoOwnerName: string;
  momoPhone: string;
  momoQrImageUrl: string;
  momoDepositPercent: string;
  momoTransferPrefix: string;
  momoInstruction: string;
  bankCode: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  bankInstruction: string;
  messengerUrl: string;
  zaloUrl: string;
  zaloPhone: string;
  orderEmailSubject: string;
  orderEmailBody: string;
  chatMessageTemplate: string;
  productSectionTitle: string;
  /** Policies for the bot (14/09/2026): the bot ONLY asserts a policy it can read from here. Empty = it does not know and hands over to a human. */
  chinhSachDoiTra: string;
  chinhSachShip: string;
  chinhSachBaoHanh: string;
  /** How many days an order-only item takes to arrive — the bot uses it for "how long until it is in stock". */
  soNgayHangOrder: string;
  updatedAt: string;
}

/** The default content. Also the list of fields allowed to be written: an unknown key is dropped. */
export function defaultPageContent(): PageContent {
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
    chinhSachDoiTra: "",
    chinhSachShip: "",
    chinhSachBaoHanh: "",
    soNgayHangOrder: "7",
    updatedAt: ""
  };
}

/** The allow-listed field names, in wire order. */
export const PAGE_CONTENT_FIELDS: readonly (keyof PageContent)[] = Object.keys(defaultPageContent()) as (keyof PageContent)[];

/**
 * Normalises: keeps ONLY the fields of the default content, every value a trimmed string.
 *
 * This is the write door from the admin screen, so "only declared fields" is a fence: whoever
 * sends an extra field (on purpose or through a bad paste) does not get it into the document,
 * and it never leaks out through the public door.
 */
export function normalisePageContent(input: unknown, at: Date | string = new Date()): PageContent {
  const source = input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const base = defaultPageContent();
  const out = {} as Record<keyof PageContent, string>;
  for (const key of PAGE_CONTENT_FIELDS) out[key] = String(source[key] ?? base[key] ?? "").trim();
  out.updatedAt = (at instanceof Date ? at : new Date(at)).toISOString();
  return out as PageContent;
}

/** The numbers the money module needs, read out of the content. Field names are the service contract with `tien-doi-soat`. */
export interface MoneySettings {
  phanTramCoc: number | null;
  phiShipMacDinh: number | null;
  tienToChuyenKhoan: string | null;
}

/**
 * The money module's numbers. An EMPTY string means "not set" — the other side uses its own
 * default. The string "0" is a REAL choice of the owner (free shipping) and must not be quietly
 * turned into 30,000.
 */
export function moneySettingsFrom(content: Partial<Record<keyof PageContent, unknown>>): MoneySettings {
  const number = (value: unknown): number => {
    const text = String(value ?? "").trim();
    return text === "" ? NaN : Number(text);
  };
  const percent = number(content.momoDepositPercent);
  const shippingFee = number(content.shippingFeeDefault);
  return {
    phanTramCoc: Number.isFinite(percent) && percent > 0 && percent <= 100 ? Math.round(percent) : null,
    phiShipMacDinh: Number.isFinite(shippingFee) && shippingFee >= 0 ? Math.round(shippingFee) : null,
    tienToChuyenKhoan: String(content.momoTransferPrefix ?? "").trim() || null
  };
}
