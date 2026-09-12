// Dùng chung cho trang chủ (app.js) và trang sản phẩm (product.js):
// - Giỏ hàng lưu localStorage để hai trang thấy cùng một giỏ.
// - Màn hình sau khi đặt đơn: QR VietQR/MoMo, link theo dõi đơn, chat Zalo/Messenger, lưu đơn vào tài khoản.
// Yêu cầu trang nhúng định nghĩa sẵn: contentText, escapeHTML, formatMoney.

const CART_STORAGE_KEY = "toprun_cart_v1";
const CART_STORAGE_TTL_MS = 24 * 60 * 60 * 1000;

function loadStoredCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const updatedAt = Number(parsed?.updatedAt || 0);
    if (!updatedAt || Date.now() - updatedAt > CART_STORAGE_TTL_MS) {
      localStorage.removeItem(CART_STORAGE_KEY);
      return [];
    }
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items.filter((item) => item && item.key && String(item.size || "").trim() && Number(item.qty || 0) > 0);
  } catch {
    return [];
  }
}

function saveStoredCart(items = []) {
  try {
    if (!items.length) {
      localStorage.removeItem(CART_STORAGE_KEY);
      return;
    }
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ items, updatedAt: Date.now() }));
  } catch {}
}

function hasBankTransfer() {
  return Boolean(contentText("bankCode", "") && contentText("bankAccountNumber", ""));
}

function paymentDepositPercent() {
  const percent = Number(contentText("momoDepositPercent", "20"));
  return Math.max(1, Math.min(100, percent || 20));
}

function defaultShippingFee() {
  const fee = Number(contentText("shippingFeeDefault", "30000"));
  return Number.isFinite(fee) && fee >= 0 ? Math.round(fee) : 30000;
}

function shippingNoteText() {
  return `Phí ship ${formatMoney(defaultShippingFee())}/đơn — miễn phí khi thanh toán trước 100%.`;
}

// Khớp cách server làm tròn cọc: về hàng chục nghìn, tối thiểu 10.000đ, không vượt tổng đơn.
function depositAmountForOrder(order = {}) {
  const explicit = Number(order.paymentAmount || 0);
  if (explicit > 0) return explicit;
  return depositAmountForPercent(order, paymentDepositPercent());
}

// 02/09 (anh Dũng giao): khách hàng order cần mức giữ đơn 20% song song với mức cọc cấu hình.
// Tách phần tính tiền ra theo % để dùng lại cho nhiều mức, giữ nguyên cách làm tròn cũ.
function depositAmountForPercent(order = {}, percent = 20) {
  const total = Number(order.total || 0);
  if (total <= 0) return 0;
  const safePercent = Math.max(1, Math.min(100, Number(percent) || 20));
  const rounded = Math.max(10000, Math.round(total * safePercent / 100 / 10000) * 10000);
  return Math.min(Math.ceil(total), rounded);
}

// Mức "giữ đơn 20%" chỉ hiện khi mức cọc cấu hình KHÁC 20 — tránh bày hai lựa chọn trùng số tiền.
const HOLD_ORDER_DEPOSIT_PERCENT = 20;
function showsHoldOrderChoice() {
  return paymentDepositPercent() !== HOLD_ORDER_DEPOSIT_PERCENT;
}

function bankQrImageUrl(order = {}, amountOverride = 0) {
  if (!hasBankTransfer()) return "";
  const bank = contentText("bankCode", "");
  const account = contentText("bankAccountNumber", "");
  const params = new URLSearchParams({
    amount: String(Math.round(Number(amountOverride || order.paymentAmount || order.total || 0)) || 0),
    addInfo: String(order.paymentReference || order.id || "").replace(/[^A-Za-z0-9\-]/g, ""),
    accountName: contentText("bankAccountName", "")
  });
  return `https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(account)}-compact2.png?${params.toString()}`;
}

function momoInstructionBlock(order = {}, options = {}) {
  const amount = Number(options.amount || 0) > 0 ? Number(options.amount) : Number(order.paymentAmount || order.total || 0);
  const compact = Boolean(options.compact);
  const extraNote = options.extraNote ? `<p class="payment-method-note"><b>${escapeHTML(options.extraNote)}</b></p>` : "";
  const bankQr = bankQrImageUrl(order, amount);
  const reference = order.paymentReference || order.id || "";
  if (bankQr) {
    // Bản gọn (compact): QR to ở giữa + mã CK, thông tin chuyển khoản thủ công thu vào <details>.
    if (compact) {
      return `
    <div class="momo-payment-box momo-payment-compact">
      <img class="momo-qr-image" src="${escapeHTML(bankQr)}" alt="QR chuyển khoản ngân hàng">
      <div class="payment-reference-line">Mã CK: <b>${escapeHTML(reference)}</b> <button type="button" class="copy-reference-button" data-copy-payment-reference="${escapeHTML(reference)}">Copy mã CK</button></div>
      <p class="payment-compact-hint">Quét bằng app ngân hàng — số tiền &amp; nội dung đã điền sẵn. TopRun chỉ đối soát theo đúng mã CK này.</p>
      <details class="payment-manual-details">
        <summary>Chuyển khoản thủ công ▾</summary>
        <div class="payment-manual-body">
          ${extraNote}
          <p>${escapeHTML(contentText("bankInstruction", "Quét QR bằng app ngân hàng bất kỳ, số tài khoản, số tiền và nội dung chuyển khoản sẽ được điền sẵn."))}</p>
          <dl>
            <dt>Ngân hàng</dt><dd>${escapeHTML(contentText("bankName", contentText("bankCode", "")))}</dd>
            <dt>Số tài khoản</dt><dd><code>${escapeHTML(contentText("bankAccountNumber", ""))}</code></dd>
            <dt>Chủ tài khoản</dt><dd>${escapeHTML(contentText("bankAccountName", ""))}</dd>
            <dt>Số tiền</dt><dd>${escapeHTML(formatMoney(amount))}</dd>
          </dl>
          <p class="payment-method-note">Nếu đơn không thể xử lý do hết size/hết hàng, shop sẽ liên hệ đổi lựa chọn hoặc hoàn tiền.</p>
        </div>
      </details>
    </div>
  `;
    }
    return `
    <div class="momo-payment-box">
      <div>
        <strong>Chuyển khoản ngân hàng</strong>
        ${extraNote}
        <p>${escapeHTML(contentText("bankInstruction", "Quét QR bằng app ngân hàng bất kỳ, số tài khoản, số tiền và nội dung chuyển khoản sẽ được điền sẵn."))}</p>
        <dl>
          <dt>Ngân hàng</dt><dd>${escapeHTML(contentText("bankName", contentText("bankCode", "")))}</dd>
          <dt>Số tài khoản</dt><dd><code>${escapeHTML(contentText("bankAccountNumber", ""))}</code></dd>
          <dt>Chủ tài khoản</dt><dd>${escapeHTML(contentText("bankAccountName", ""))}</dd>
          <dt>Số tiền</dt><dd>${escapeHTML(formatMoney(amount))}</dd>
          <dt>Nội dung CK</dt><dd><code>${escapeHTML(reference)}</code></dd>
        </dl>
        <button type="button" class="secondary-button" data-copy-payment-reference="${escapeHTML(reference)}">Copy nội dung CK</button>
        <div class="payment-safe-notes">
          <span>TopRun chỉ đối soát theo đúng mã CK này.</span>
          <span>Nếu đơn không thể xử lý do hết size/hết hàng, shop sẽ liên hệ đổi lựa chọn hoặc hoàn tiền.</span>
        </div>
      </div>
      <img class="momo-qr-image" src="${escapeHTML(bankQr)}" alt="QR chuyển khoản ngân hàng">
    </div>
  `;
  }
  const qr = contentText("momoQrImageUrl", "");
  if (compact) {
    return `
    <div class="momo-payment-box momo-payment-compact">
      ${qr ? `<img class="momo-qr-image" src="${escapeHTML(qr)}" alt="QR MoMo cá nhân">` : ""}
      <div class="payment-reference-line">Mã CK: <b>${escapeHTML(reference)}</b> <button type="button" class="copy-reference-button" data-copy-payment-reference="${escapeHTML(reference)}">Copy mã CK</button></div>
      <p class="payment-compact-hint">Quét bằng app MoMo — chuyển đúng ${escapeHTML(formatMoney(amount))}, nội dung ghi đúng mã CK. TopRun chỉ đối soát theo đúng mã CK này.</p>
      <details class="payment-manual-details">
        <summary>Chuyển khoản thủ công ▾</summary>
        <div class="payment-manual-body">
          ${extraNote}
          <p>${escapeHTML(contentText("momoInstruction", "Quét QR MoMo cá nhân, chuyển đúng số tiền và ghi đúng nội dung chuyển khoản để TopRun đối soát."))}</p>
          <dl>
            <dt>Người nhận</dt><dd>${escapeHTML(contentText("momoOwnerName", "TopRun"))}</dd>
            <dt>Số MoMo</dt><dd>${escapeHTML(contentText("momoPhone", ""))}</dd>
            <dt>Số tiền</dt><dd>${escapeHTML(formatMoney(amount))}</dd>
          </dl>
          <p class="payment-method-note">Nếu đơn không thể xử lý do hết size/hết hàng, shop sẽ liên hệ đổi lựa chọn hoặc hoàn tiền.</p>
        </div>
      </details>
    </div>
  `;
  }
  return `
    <div class="momo-payment-box">
      <div>
        <strong>Chuyển khoản MoMo cá nhân</strong>
        ${extraNote}
        <p>${escapeHTML(contentText("momoInstruction", "Quét QR MoMo cá nhân, chuyển đúng số tiền và ghi đúng nội dung chuyển khoản để TopRun đối soát."))}</p>
        <dl>
          <dt>Người nhận</dt><dd>${escapeHTML(contentText("momoOwnerName", "TopRun"))}</dd>
          <dt>Số MoMo</dt><dd>${escapeHTML(contentText("momoPhone", ""))}</dd>
          <dt>Số tiền</dt><dd>${escapeHTML(formatMoney(amount))}</dd>
          <dt>Nội dung CK</dt><dd><code>${escapeHTML(order.paymentReference || order.id || "")}</code></dd>
        </dl>
        <button type="button" class="secondary-button" data-copy-payment-reference="${escapeHTML(order.paymentReference || order.id || "")}">Copy nội dung CK</button>
        <div class="payment-safe-notes">
          <span>TopRun chỉ đối soát theo đúng mã CK này.</span>
          <span>Nếu đơn không thể xử lý do hết size/hết hàng, shop sẽ liên hệ đổi lựa chọn hoặc hoàn tiền.</span>
        </div>
      </div>
      ${qr ? `<img class="momo-qr-image" src="${escapeHTML(qr)}" alt="QR MoMo cá nhân">` : ""}
    </div>
  `;
}

function chatLinks() {
  const links = [];
  const messengerUrl = contentText("messengerUrl", "");
  const zaloUrl = contentText("zaloUrl", "") || (contentText("zaloPhone", "") ? `https://zalo.me/${contentText("zaloPhone", "").replace(/\D/g, "")}` : "");
  if (zaloUrl) links.push({ label: "Nhắn Zalo", url: zaloUrl, className: "primary-button chat-zalo" });
  if (messengerUrl) links.push({ label: "Nhắn Messenger", url: messengerUrl, className: "primary-button chat-messenger" });
  return links;
}

function chatMessageForOrder(order = {}) {
  return contentText("chatMessageTemplate", "Em đã đặt đơn {orderId}, mã CK {paymentReference}, tổng {total}. Nhờ TopRun xác nhận giúp em ạ.")
    .replaceAll("{orderId}", order.id || "")
    .replaceAll("{paymentReference}", order.paymentReference || order.id || "")
    .replaceAll("{total}", formatMoney(order.total || 0));
}

function copyText(value) {
  navigator.clipboard?.writeText(String(value || "")).catch(() => {});
}

// BAN TACH (12/09/2026): POST /api/orders tra ve { ok, id, token, total } chu khong tra ca
// don nhu ban dang chay. Popup thanh toan can ma don + ma tra cuu, nen ghep lai o day —
// mot cho duy nhat, va van chay duoc voi ban cu (ban cu co `order` thi dung luon `order`).
function orderFromCreateResult(result = {}, payload = {}) {
  if (result && typeof result.order === "object" && result.order) return result.order;
  const id = String(result?.id || "").trim();
  if (!id) return payload;
  const token = String(result?.token || result?.lookupToken || "").trim();
  return {
    ...payload,
    id,
    total: Number(result?.total ?? payload?.total ?? 0),
    lookupToken: token,
    lookupUrl: `/order-status.html?order=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`
  };
}
window.orderFromCreateResult = orderFromCreateResult;

function showPaymentChatPrompt(order = {}) {
  // Cho chọn thanh toán trước khi có QR ngân hàng hoặc MoMo được bật.
  const hasPrepay = contentText("momoEnabled", "false") === "true" || hasBankTransfer();
  const total = Number(order.total || 0);
  const depositAmount = depositAmountForOrder(order);
  const links = chatLinks();
  const reference = order.paymentReference || order.id || "";
  // Mobile (≤720px, gồm cả trang /mobile): popup 2 bước — chọn thanh toán trước,
  // bấm nút mới sang phần "Thông báo cho shop". Desktop: hiện liền một màn.
  const twoStep = Boolean(window.matchMedia && window.matchMedia("(max-width: 720px)").matches);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const chatMessage = chatMessageForOrder(order);
  const orderUrl = order.lookupUrl || `/order-status.html?order=${encodeURIComponent(order.id || "")}&token=${encodeURIComponent(order.lookupToken || "")}`;
  overlay.innerHTML = `
    <div class="order-modal payment-confirm-modal">
      <div class="modal-header">
        <div>
          <p class="eyebrow">Đã nhận đơn</p>
          <h2>${escapeHTML(order.id || "Đơn hàng")}</h2>
          <p>TopRun đã nhận đơn và sẽ kiểm tra tồn kho/size trước khi xác nhận tiếp.</p>
        </div>
        <button type="button" class="icon-button" id="payment-confirm-close">X</button>
      </div>
      <div class="payment-step" data-pay-step="a">
        <div class="payment-method-box">
          <strong>Chọn cách thanh toán</strong>
          <p class="payment-method-note">Tiền hàng ${escapeHTML(formatMoney(total))} + phí ship ${escapeHTML(formatMoney(defaultShippingFee()))} (miễn phí ship nếu thanh toán trước 100%). Bạn chọn một trong các cách dưới đây:</p>
          <label class="payment-choice">
            <input type="radio" name="payment-choice-option" value="confirm_first" ${hasPrepay ? "" : "checked"}>
            <span><b>Xác nhận đơn trước, thanh toán sau</b><small>Shop kiểm tra tồn kho và liên hệ lại, bạn chưa cần chuyển khoản.</small></span>
          </label>
          ${hasPrepay && showsHoldOrderChoice() ? `
          <label class="payment-choice">
            <input type="radio" name="payment-choice-option" value="deposit_hold">
            <span><b>Giữ đơn ${HOLD_ORDER_DEPOSIT_PERCENT}% — ${escapeHTML(formatMoney(depositAmountForPercent(order, HOLD_ORDER_DEPOSIT_PERCENT)))}</b><small>Mức tối thiểu để shop đặt hàng order. Số còn lại + phí ship ${escapeHTML(formatMoney(defaultShippingFee()))} thanh toán khi nhận hàng.</small></span>
          </label>
          ` : ""}
          ${hasPrepay ? `
          <label class="payment-choice featured">
            <input type="radio" name="payment-choice-option" value="deposit" checked>
            <span><b>Thanh toán trước ${paymentDepositPercent()}% — ${escapeHTML(formatMoney(depositAmount))}</b><small>Số còn lại + phí ship ${escapeHTML(formatMoney(defaultShippingFee()))} thanh toán khi nhận hàng.</small></span>
          </label>
          <label class="payment-choice">
            <input type="radio" name="payment-choice-option" value="full">
            <span><b>Thanh toán trước 100% — ${escapeHTML(formatMoney(total))}</b><small>Miễn phí ship, không phải trả thêm khi nhận hàng.</small></span>
          </label>
          ` : ""}
          <div id="payment-choice-detail"></div>
        </div>
        ${twoStep ? `<button type="button" class="primary-button pay-step-next" data-pay-next>Lưu mã thanh toán · Thông báo cho shop</button>` : ""}
      </div>
      <div class="payment-step" data-pay-step="b" ${twoStep ? "hidden" : ""}>
        ${links.length ? `
        <div class="quick-chat-box">
          <strong>Thông báo cho shop</strong>
          <p class="payment-method-note">Đơn ${escapeHTML(order.id || "")} · Mã CK ${escapeHTML(reference)}</p>
          <p>QR thanh toán + thông tin đơn sẽ chờ sẵn trong tin nhắn — tin nhắn đã copy sẵn, dán vào Zalo là xong.</p>
          <div class="split-actions">
            ${links.map((link) => `<a class="${escapeHTML(link.className)}" href="${escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(link.label)}</a>`).join("")}
            <button type="button" class="secondary-button" id="copy-chat-message">Copy tin nhắn</button>
          </div>
        </div>
        ` : ""}
        <div class="order-follow-box">
          <strong>Xem lại đơn hàng của bạn</strong>
          <p>Bạn có thể dùng link riêng này để theo dõi trạng thái đơn. Hãy lưu lại link để kiểm tra khi cần.</p>
          <div class="split-actions">
            <a class="primary-button" href="${escapeHTML(orderUrl)}">Xem lại đơn hàng</a>
            <button class="secondary-button" type="button" data-copy-order-link="${escapeHTML(orderUrl)}">Copy link đơn</button>
          </div>
        </div>
        ${accountPromptInlineBlock(order)}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("payment-confirm-close").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#copy-chat-message")?.addEventListener("click", () => copyText(chatMessage));
  overlay.querySelector("[data-copy-order-link]")?.addEventListener("click", (event) => copyText(event.currentTarget.dataset.copyOrderLink));
  overlay.querySelector("[data-pay-next]")?.addEventListener("click", () => {
    // Bước mobile: chốt lựa chọn hiện tại + copy sẵn tin nhắn rồi mới sang phần Thông báo cho shop.
    const checked = overlay.querySelector('input[name="payment-choice-option"]:checked');
    if (checked) persistPaymentChoice(order, checked.value);
    try { copyText(chatMessage); } catch {}
    overlay.querySelector('[data-pay-step="a"]')?.setAttribute("hidden", "");
    overlay.querySelector('[data-pay-step="b"]')?.removeAttribute("hidden");
    const modal = overlay.querySelector(".order-modal");
    if (modal) modal.scrollTop = 0;
  });
  bindPaymentChoiceOptions(overlay, order);
  bindAccountPromptInline(overlay, order);
}

function bindPaymentChoiceOptions(root, order = {}) {
  const inputs = root.querySelectorAll('input[name="payment-choice-option"]');
  if (!inputs.length) return;
  inputs.forEach((input) => {
    input.addEventListener("change", () => {
      renderPaymentChoiceDetail(root, order, input.value);
      persistPaymentChoice(order, input.value);
      window.toprunAnalytics?.track?.("payment_choice", { orderId: order.id || "", choice: input.value });
    });
  });
  const checked = root.querySelector('input[name="payment-choice-option"]:checked');
  renderPaymentChoiceDetail(root, order, checked ? checked.value : "confirm_first");
}

// Báo server lựa chọn của khách để đơn ghi đúng phí ship (0đ nếu CK 100%) cho shop đối soát.
function persistPaymentChoice(order = {}, choice = "") {
  const orderId = String(order.id || "").trim();
  const token = String(order.lookupToken || "").trim();
  if (!orderId || !token || !choice) return;
  fetch("/api/orders/public/payment-choice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, token, choice })
  }).catch(() => {});
}

function renderPaymentChoiceDetail(root, order = {}, choice = "confirm_first") {
  const detail = root.querySelector("#payment-choice-detail");
  if (!detail) return;
  const total = Number(order.total || 0);
  const shipFee = defaultShippingFee();
  if (choice === "deposit" || choice === "deposit_hold") {
    const isHold = choice === "deposit_hold";
    const percent = isHold ? HOLD_ORDER_DEPOSIT_PERCENT : paymentDepositPercent();
    const depositAmount = isHold ? depositAmountForPercent(order, HOLD_ORDER_DEPOSIT_PERCENT) : depositAmountForOrder(order);
    const codAmount = Math.max(0, total - depositAmount) + shipFee;
    detail.innerHTML = momoInstructionBlock(order, {
      amount: depositAmount,
      compact: true,
      extraNote: `${isHold ? "Giữ đơn" : "Đặt cọc"} ${percent}%: chuyển đúng ${formatMoney(depositAmount)}. Khi nhận hàng thanh toán nốt ${formatMoney(codAmount)} (gồm phí ship ${formatMoney(shipFee)}).`
    });
  } else if (choice === "full") {
    detail.innerHTML = momoInstructionBlock(order, {
      amount: total,
      compact: true,
      extraNote: `Thanh toán 100%: chuyển đủ ${formatMoney(total)} — miễn phí ship, không phải trả thêm khi nhận hàng.`
    });
  } else {
    detail.innerHTML = `<p class="payment-method-note">TopRun sẽ xác nhận tồn kho và liên hệ hướng dẫn thanh toán sau. Bạn chưa cần chuyển khoản. Tổng dự kiến khi nhận hàng: ${escapeHTML(formatMoney(total + shipFee))} (gồm phí ship ${escapeHTML(formatMoney(shipFee))}).</p>`;
  }
  detail.querySelectorAll("[data-copy-payment-reference]").forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copyPaymentReference));
  });
}

function accountPromptInlineBlock(order = {}) {
  const orderId = order.id || "";
  const orderToken = order.lookupToken || "";
  return `
    <div class="account-follow-box">
      <div>
        <strong>Đăng nhập hoặc tạo tài khoản để lưu đơn này</strong>
        <p>Đây là cách thuận tiện nhất để xem lại đơn trong tài khoản, quản lý nhiều đơn và nhận ưu đãi của shop. Tạo tài khoản cần email để có thể khôi phục mật khẩu.</p>
      </div>
      <div class="account-tab-bar" role="tablist">
        <button type="button" class="account-tab active" data-account-tab="login">Đăng nhập</button>
        <button type="button" class="account-tab" data-account-tab="register">Tạo tài khoản</button>
      </div>
      <div class="account-inline-forms" data-order-id="${escapeHTML(orderId)}" data-order-token="${escapeHTML(orderToken)}">
        <form class="mini-auth-form" data-inline-auth="login">
          <label>Tên đăng nhập hoặc email
            <input name="login" required autocomplete="username">
          </label>
          <label>Mật khẩu
            <input name="password" type="password" required autocomplete="current-password">
          </label>
          <button class="primary-button" type="submit">Đăng nhập và lưu đơn</button>
        </form>
        <form class="mini-auth-form" data-inline-auth="register" hidden>
          <label>Tên đăng nhập
            <input name="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]{3,32}" autocomplete="username">
          </label>
          <label>Email
            <input name="email" type="email" required autocomplete="email">
          </label>
          <label>Mật khẩu
            <input name="password" type="password" required minlength="6" autocomplete="new-password">
          </label>
          <label>Xác nhận mật khẩu
            <input name="confirmPassword" type="password" required minlength="6" autocomplete="new-password">
          </label>
          <button class="primary-button" type="submit">Tạo tài khoản và lưu đơn</button>
        </form>
      </div>
      <p class="form-message" data-inline-auth-message></p>
    </div>
  `;
}

function bindAccountPromptInline(root, order = {}) {
  // 2 tab Đăng nhập / Tạo tài khoản — mỗi lúc chỉ hiện một form.
  const tabs = Array.from(root.querySelectorAll("[data-account-tab]"));
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((other) => other.classList.toggle("active", other === tab));
      root.querySelectorAll("[data-inline-auth]").forEach((form) => {
        form.hidden = form.dataset.inlineAuth !== tab.dataset.accountTab;
      });
    });
  });
  root.querySelectorAll("[data-inline-auth]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const container = form.closest(".account-follow-box");
      const message = container?.querySelector("[data-inline-auth-message]");
      const data = Object.fromEntries(new FormData(form).entries());
      const meta = container?.querySelector(".account-inline-forms");
      data.orderId = order.id || meta?.dataset.orderId || "";
      data.orderToken = order.lookupToken || meta?.dataset.orderToken || "";
      if (form.dataset.inlineAuth === "register" && data.password !== data.confirmPassword) {
        if (message) message.textContent = "Mật khẩu xác nhận chưa khớp.";
        return;
      }
      const button = form.querySelector("button[type='submit']");
      const original = button?.textContent || "";
      if (button) {
        button.disabled = true;
        button.textContent = "Đang xử lý...";
      }
      const endpoint = form.dataset.inlineAuth === "register" ? "/api/account/register" : "/api/account/login";
      const result = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      }).then((res) => res.json().then((payload) => ({ ok: res.ok && payload.ok !== false, ...payload }))).catch(() => ({ ok: false, message: "Không kết nối được máy chủ." }));
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
      if (!result.ok) {
        if (message) message.textContent = result.message || "Chưa lưu được đơn vào tài khoản.";
        return;
      }
      if (message) message.textContent = result.linkedOrder?.ok ? "Đơn hàng đã được lưu vào tài khoản của bạn." : "Đã đăng nhập, nhưng chưa gắn được đơn hàng.";
      setTimeout(() => { window.location.href = "/account-manage.html"; }, 900);
    });
  });
}
