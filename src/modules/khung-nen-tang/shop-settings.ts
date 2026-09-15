/**
 * @file SHOP SETTINGS — the merchant's keys and addresses, kept on the landing instead of a `.env`.
 *
 * Sales Desk was one shop on one machine, so every carrier key, page token and tool address sat
 * in a `.env` next to the code. OMI is the same console for MANY shops, and it deliberately keeps
 * no data: a key typed in OMI must land on that shop's own server. Decided 14/09/2026 — "các tính
 * năng này các shop khác đều có, sau chỉ cần cấu hình đúng config".
 *
 * THREE RULES THAT MUST NOT BREAK:
 *
 * 1. A SECRET NEVER LEAVES. `forScreen()` returns whether a secret is set and its last four
 *    characters, never the value. Only `settingsOf()` — read by modules on this server — sees the
 *    real string. OMI therefore cannot print a token, and neither can an XSS in its page.
 *
 * 2. AN UNKNOWN KEY IS DROPPED. `CATALOGUE` is the whole list of what a shop may store here; a
 *    write of anything else is ignored. The store is not a free-form bag someone can smuggle a
 *    second admin token into.
 *
 * 3. AN EMPTY SECRET MEANS "LEAVE IT". The screen cannot show the current value, so it sends an
 *    empty box back on every save. Treating that as "clear" would wipe the carrier keys the first
 *    time someone edits the sender's phone number. Clearing is explicit: `KEEP_CLEAR`.
 *
 * AI keys are absent on purpose: the brain runs on Xeon and holds its own provider key. A shop
 * never buys or types one.
 */

/** One thing a shop can configure. `group` is a screen section; `secret` never leaves the server. */
export interface SettingSpec {
  key: string;
  label: string;
  group: string;
  secret?: boolean;
  hint?: string;
}

/** Sent as a setting's value to erase it — an empty box means "unchanged" (rule 3). */
export const KEEP_CLEAR = "__xoa__";

/** Reader-facing name of each group, in the order the screen draws them. */
export const SETTING_GROUPS: readonly { id: string; name: string; note: string }[] = [
  { id: "van-chuyen", name: "Vận chuyển", note: "Khoá hãng vận chuyển và địa chỉ kho gửi. Thiếu khoá thì nút tạo vận đơn báo thiếu chứ không gọi hãng." },
  { id: "facebook", name: "Facebook / Messenger", note: "Ứng dụng Meta và trang của shop. Webhook trỏ về địa chỉ landing này." },
  { id: "tiktok", name: "TikTok Shop", note: "Chỉ cần nếu shop bán và trả lời tin trên TikTok Shop." },
  { id: "telegram", name: "Telegram báo động", note: "Bot báo cho người trực: bot chuyển người, đơn hoàn tiền." },
  { id: "sapo", name: "Sapo", note: "Đồng bộ tồn kho thời gian thực từ Sapo (nếu shop dùng Sapo)." },
  { id: "site-doi", name: "Site sinh đôi", note: "Website bán lại thứ hai dùng chung kho: địa chỉ, khoá và phần trăm cộng giá." },
  { id: "mua-ho", name: "Mua hộ tự động", note: "Đặt hàng COD hộ trên web nhà cung cấp khi khách đã chuyển khoản." },
  { id: "cong-cu", name: "Công cụ ngoài", note: "Địa chỉ các công cụ OMI mở trong cửa sổ riêng." }
];

/**
 * Every setting a shop may store. Taken from Sales Desk's `.env.example`, minus what belongs to
 * Xeon (AI providers) and minus what the landing already knows about itself (its own address).
 */
export const CATALOGUE: readonly SettingSpec[] = [
  // --- Vận chuyển ---
  { key: "van_chuyen_mac_dinh", label: "Hãng mặc định (spx / vtp)", group: "van-chuyen", hint: "Bỏ trống = SPX." },
  { key: "kho_ten", label: "Tên người gửi", group: "van-chuyen" },
  { key: "kho_dien_thoai", label: "Điện thoại người gửi", group: "van-chuyen" },
  { key: "kho_tinh", label: "Tỉnh/thành kho gửi", group: "van-chuyen" },
  { key: "kho_huyen", label: "Quận/huyện kho gửi", group: "van-chuyen" },
  { key: "kho_xa", label: "Phường/xã kho gửi", group: "van-chuyen" },
  { key: "kho_dia_chi", label: "Địa chỉ chi tiết kho gửi", group: "van-chuyen" },
  { key: "spx_app_id", label: "SPX App ID", group: "van-chuyen" },
  { key: "spx_app_secret", label: "SPX App Secret", group: "van-chuyen", secret: true },
  { key: "spx_user_id", label: "SPX User ID", group: "van-chuyen" },
  { key: "spx_user_secret", label: "SPX Secret Key", group: "van-chuyen", secret: true },
  { key: "spx_moi_truong", label: "SPX môi trường (live / test)", group: "van-chuyen", hint: "test = sandbox của SPX." },
  { key: "vtp_dia_chi", label: "ViettelPost địa chỉ API", group: "van-chuyen", hint: "Bỏ trống = địa chỉ chuẩn của hãng." },
  { key: "vtp_tai_khoan", label: "ViettelPost tài khoản", group: "van-chuyen" },
  { key: "vtp_mat_khau", label: "ViettelPost mật khẩu", group: "van-chuyen", secret: true },
  { key: "vtp_token", label: "ViettelPost token", group: "van-chuyen", secret: true },
  { key: "vtp_ma_kho", label: "ViettelPost mã nhóm địa chỉ kho", group: "van-chuyen" },

  // --- Facebook ---
  { key: "fb_app_id", label: "Meta App ID", group: "facebook" },
  { key: "fb_app_secret", label: "Meta App Secret", group: "facebook", secret: true },
  { key: "fb_verify_token", label: "Chuỗi xác minh webhook", group: "facebook", secret: true, hint: "Tự nghĩ một chuỗi; điền đúng chuỗi này ở trang webhook của Meta." },
  { key: "fb_page_id", label: "ID trang", group: "facebook" },
  { key: "fb_page_token", label: "Token của trang", group: "facebook", secret: true },
  { key: "fb_graph_phien_ban", label: "Phiên bản Graph API", group: "facebook", hint: "Ví dụ v21.0. Bỏ trống = bản mặc định." },

  // --- TikTok ---
  { key: "tiktok_client_key", label: "Client key", group: "tiktok" },
  { key: "tiktok_client_secret", label: "Client secret", group: "tiktok", secret: true },
  { key: "tiktok_shop_id", label: "Shop ID", group: "tiktok" },
  { key: "tiktok_access_token", label: "Access token", group: "tiktok", secret: true },
  { key: "tiktok_refresh_token", label: "Refresh token", group: "tiktok", secret: true },
  { key: "tiktok_webhook_secret", label: "Webhook secret", group: "tiktok", secret: true },

  // --- Telegram ---
  { key: "telegram_bot_token", label: "Token bot", group: "telegram", secret: true },
  { key: "telegram_chat_bao_dong", label: "Chat ID nhóm trực", group: "telegram" },
  { key: "telegram_chat_hoan_tien", label: "Chat ID nhóm hoàn tiền", group: "telegram" },

  // --- Sapo ---
  { key: "sapo_dia_chi", label: "Địa chỉ cửa hàng Sapo", group: "sapo" },
  { key: "sapo_api_key", label: "API key", group: "sapo" },
  { key: "sapo_api_secret", label: "API secret", group: "sapo", secret: true },

  // --- Site sinh đôi ---
  { key: "site_doi_ten", label: "Tên site thứ hai", group: "site-doi" },
  { key: "site_doi_dia_chi", label: "Địa chỉ site thứ hai", group: "site-doi" },
  { key: "site_doi_token", label: "Khoá quản trị site thứ hai", group: "site-doi", secret: true },
  { key: "site_doi_cong_gia", label: "Cộng giá (%)", group: "site-doi", hint: "Giá site thứ hai = giá gốc cộng thêm bấy nhiêu phần trăm." },

  // --- Mua hộ ---
  { key: "mua_ho_bat", label: "Bật đặt hàng hộ tự động (1 = bật)", group: "mua-ho" },
  { key: "mua_ho_nguoi_nhan", label: "Tên người nhận khi đặt hộ", group: "mua-ho" },
  { key: "mua_ho_dien_thoai", label: "Điện thoại người nhận khi đặt hộ", group: "mua-ho" },

  // --- Công cụ ---
  { key: "cong_cu_video", label: "Địa chỉ Xưởng video", group: "cong-cu", hint: "OMI mở trong cửa sổ riêng." },
  { key: "cong_cu_anh", label: "Địa chỉ công cụ ảnh", group: "cong-cu" },
  { key: "cong_cu_sao_luu", label: "Thư mục sao lưu (Google Drive)", group: "cong-cu" }
];

/** Document name — on-disk contract. */
export const SHOP_SETTINGS_DOCUMENT = "khung-nen-tang-cau-hinh";

export interface ShopSettingsDocument {
  giaTri: Record<string, string>;
  updatedAt: string;
}

/** One field as the screen sees it: a secret shows only whether it is set, plus its last four. */
export interface SettingOnScreen {
  khoa: string;
  nhan: string;
  goiY: string;
  biMat: boolean;
  daDat: boolean;
  giaTri: string;
  duoi: string;
}

export interface GroupOnScreen {
  ma: string;
  ten: string;
  chuThich: string;
  muc: SettingOnScreen[];
}

const byKey = new Map(CATALOGUE.map((s) => [s.key, s]));

/** Is this a key the shop is allowed to store? (rule 2) */
export function isKnownSetting(key: string): boolean {
  return byKey.has(key);
}

export function specOf(key: string): SettingSpec | undefined {
  return byKey.get(key);
}

const text = (v: unknown): string => String(v ?? "").trim();

/** Last four characters of a secret — enough to tell two keys apart, not enough to use one. */
function tail(value: string): string {
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}

/** The whole configuration as the screen draws it: grouped, secrets masked (rule 1). */
export function forScreen(values: Record<string, string>): GroupOnScreen[] {
  return SETTING_GROUPS.map((group) => ({
    ma: group.id,
    ten: group.name,
    chuThich: group.note,
    muc: CATALOGUE.filter((spec) => spec.group === group.id).map((spec) => {
      const raw = text(values[spec.key]);
      return {
        khoa: spec.key,
        nhan: spec.label,
        goiY: spec.hint ?? "",
        biMat: spec.secret === true,
        daDat: raw !== "",
        giaTri: spec.secret === true ? "" : raw,
        duoi: spec.secret === true && raw !== "" ? tail(raw) : ""
      };
    })
  }));
}

/**
 * Merges what the screen sent into what is stored. Returns the next value map and the keys that
 * actually changed (for the operating log — the log names the key, never the value).
 */
export function mergeSettings(current: Record<string, string>, incoming: Record<string, unknown>): { next: Record<string, string>; changed: string[] } {
  const next: Record<string, string> = { ...current };
  const changed: string[] = [];
  for (const [key, rawValue] of Object.entries(incoming)) {
    const spec = byKey.get(key);
    if (spec === undefined) continue;                       // rule 2
    const value = text(rawValue);
    if (value === KEEP_CLEAR) {
      if (text(next[key]) !== "") { delete next[key]; changed.push(key); }
      continue;
    }
    if (spec.secret === true && value === "") continue;     // rule 3
    if (text(next[key]) === value) continue;
    if (value === "") delete next[key]; else next[key] = value;
    changed.push(key);
  }
  return { next, changed };
}

/** Reads the stored values, dropping anything no longer in the catalogue. */
export function settingsOf(stored: Partial<ShopSettingsDocument> | null): Record<string, string> {
  const raw = stored?.giaTri;
  if (raw === null || raw === undefined || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!byKey.has(key)) continue;
    const clean = text(value);
    if (clean !== "") out[key] = clean;
  }
  return out;
}
