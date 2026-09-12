const params = new URLSearchParams(window.location.search);
const form = document.getElementById("lookup-form");
const message = document.getElementById("lookup-message");
const resultBox = document.getElementById("order-status-result");
let currentOrderId = "";
let currentToken = "";
// Thông tin ngân hàng (bankCode/bankAccountNumber/bankAccountName) để dựng QR thanh toán phần còn thiếu.
const landingContentPromise = fetch("/api/content")
  .then((res) => (res.ok ? res.json() : {}))
  .catch(() => ({}));

initOrderStatus();

function initOrderStatus() {
  currentOrderId = params.get("order") || params.get("orderId") || "";
  currentToken = params.get("token") || "";
  if (currentOrderId) form.elements.orderId.value = currentOrderId;
  if (currentOrderId && currentToken) {
    form.hidden = true;
    loadOrderByToken(currentOrderId, currentToken);
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const response = await postJSON("/api/orders/lookup", data);
    renderResult(response);
  });
}

async function loadOrderByToken(orderId, token) {
  const response = await fetch(`/api/orders/public?order=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`)
    .then((res) => res.json().then((payload) => ({ ok: res.ok && payload.ok !== false, ...payload })))
    .catch(() => ({ ok: false, message: "Không kết nối được máy chủ." }));
  renderResult(response);
}

async function renderResult(response) {
  if (!response?.ok || !response.order) {
    resultBox.hidden = true;
    message.textContent = response?.message || "Không tìm thấy đơn hàng phù hợp.";
    return;
  }
  const order = response.order;
  message.textContent = "";
  resultBox.hidden = false;
  resultBox.innerHTML = order.view === "detail"
    ? orderDetailHTML(order)
    : order.view === "secret"
      ? secretOrderHTML(order)
      : statusOnlyHTML(order);
  const content = await landingContentPromise;
  resultBox.insertAdjacentHTML("beforeend", paymentTransferHTML(order, content));
  bindOrderDetailActions(order);
}

// Khối "Thanh toán chuyển khoản": chỉ hiện khi đơn còn phải thanh toán và landing đã cấu hình ngân hàng.
function paymentTransferHTML(order, content = {}) {
  const remaining = Math.round(Number(order.remainingAmount || 0));
  const bankCode = String(content.bankCode || "");
  const bankAccount = String(content.bankAccountNumber || "");
  if (!(remaining > 0) || !bankCode || !bankAccount) return "";
  const reference = String(order.paymentReference || order.id || "");
  const qrParams = new URLSearchParams({
    amount: String(remaining),
    addInfo: reference.replace(/[^A-Za-z0-9\-]/g, ""),
    accountName: String(content.bankAccountName || "")
  });
  const qrUrl = `https://img.vietqr.io/image/${encodeURIComponent(bankCode)}-${encodeURIComponent(bankAccount)}-compact2.png?${qrParams.toString()}`;
  return `
    <div class="order-payment-transfer">
      <strong>Thanh toán chuyển khoản</strong>
      <p class="muted">Còn phải thanh toán: <b>${escapeHTML(formatMoney(remaining))}</b></p>
      <img class="order-payment-qr" src="${escapeAttr(qrUrl)}" alt="QR chuyển khoản ngân hàng" loading="lazy">
      <p class="order-payment-reference">Mã CK <b>${escapeHTML(reference)}</b> <button type="button" data-copy-payment-reference="${escapeAttr(reference)}">Copy mã CK</button></p>
      <p class="muted">Quét bằng app ngân hàng — số tiền &amp; nội dung đã điền sẵn. TopRun chỉ đối soát theo đúng mã CK này.</p>
    </div>
  `;
}

function statusOnlyHTML(order) {
  return `
    <div>
      <strong>${escapeHTML(order.statusLabel || "Trạng thái đơn hàng")}</strong>
      <p class="muted">Mã đơn: ${escapeHTML(order.id || "")}</p>
      <p>${escapeHTML(order.statusNote || "")}</p>
      ${order.shippingProvider ? `<p>Đơn vị vận chuyển: <b>${escapeHTML(order.shippingProvider)}</b></p>` : ""}
      ${order.trackingCode ? `<p>Mã tracking: <b>${escapeHTML(order.trackingCode)}</b></p>` : ""}
      ${orderShipmentsHTML(order)}
      ${order.updatedAt ? `<p class="muted small">Cập nhật gần nhất: ${escapeHTML(formatDateTime(order.updatedAt))}</p>` : ""}
    </div>
  `;
}

function secretOrderHTML(order) {
  return `
    <div>
      <strong>${escapeHTML(order.statusLabel || "Trạng thái đơn hàng")}</strong>
      <p class="muted">Mã đơn: ${escapeHTML(order.id || "")}</p>
      ${order.customerName ? `<p>Khách hàng: <b>${escapeHTML(order.customerName)}</b></p>` : ""}
      <p>${escapeHTML(order.statusNote || "")}</p>
      <div class="order-items-editor">
        <strong>Sản phẩm</strong>
        ${(order.items || []).map((item) => itemRowHTML(item, 0, false)).join("") || `<p class="muted">Đơn chưa có sản phẩm.</p>`}
      </div>
      ${order.shippingProvider ? `<p>Đơn vị vận chuyển: <b>${escapeHTML(order.shippingProvider)}</b></p>` : ""}
      ${order.trackingCode ? `<p>Mã vận đơn: <b>${escapeHTML(order.trackingCode)}</b></p>` : ""}
      ${order.trackingUrl ? `<p><a href="${escapeAttr(order.trackingUrl)}" target="_blank" rel="noopener">Theo dõi vận chuyển</a></p>` : ""}
      ${orderShipmentsHTML(order)}
      ${order.updatedAt ? `<p class="muted small">Cập nhật gần nhất: ${escapeHTML(formatDateTime(order.updatedAt))}</p>` : ""}
    </div>
  `;
}

function orderDetailHTML(order) {
  const editable = Boolean(order.canEdit);
  return `
    <div class="order-detail-head">
      <div>
        <strong>${escapeHTML(order.statusLabel || "Trạng thái đơn hàng")}</strong>
        <p class="muted">Mã đơn: ${escapeHTML(order.id || "")}</p>
        <p>${escapeHTML(order.statusNote || "")}</p>
        <p class="muted small">${escapeHTML(order.privacyNote || "")}</p>
        ${order.canEditUntil ? `<p class="muted small">Có thể tự chỉnh sửa đến: ${escapeHTML(formatDateTime(order.canEditUntil))}</p>` : ""}
      </div>
      ${editable ? `<button class="danger-action action-3d" type="button" id="cancel-order-button">Hủy đơn</button>` : ""}
    </div>
    <form id="order-edit-form" class="order-edit-form">
      ${editable ? customerEditHTML(order.customer || {}) : ""}
      ${!editable ? `<div class="notice">Đơn hàng đã quá thời gian tự chỉnh sửa. Thông tin người nhận đã được ẩn để bảo mật.</div>` : ""}
      <div class="order-items-editor">
        <strong>Chi tiết đơn hàng</strong>
        ${(order.items || []).map((item, index) => itemRowHTML(item, index, editable)).join("") || `<p class="muted">Đơn chưa có sản phẩm.</p>`}
      </div>
      ${order.shippingProvider ? `<p>Đơn vị vận chuyển: <b>${escapeHTML(order.shippingProvider)}</b></p>` : ""}
      ${order.trackingCode ? `<p>Mã tracking: <b>${escapeHTML(order.trackingCode)}</b></p>` : ""}
      ${orderShipmentsHTML(order)}
      ${editable ? `<button class="primary action-3d" type="submit">Lưu thay đổi</button>` : ""}
    </form>
  `;
}

function orderShipmentsHTML(order) {
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  if (!shipments.length) return "";
  return `<div class="order-items-editor"><strong>Các kiện hàng</strong>${shipments.map((shipment) => `
    <div class="item-row">
      <div><b>${escapeHTML(shipment.id || "")}</b><br><span class="muted">${escapeHTML(shipment.warehouseName || "")}</span></div>
      <div>Giá trị: ${formatMoney(shipment.productTotal || 0)}<br>COD: ${formatMoney(shipment.codAmount || 0)}</div>
      <div>${escapeHTML(shipment.shippingProvider || "")} ${escapeHTML(shipment.trackingCode || "")}${shipment.trackingUrl ? `<br><a href="${escapeHTML(shipment.trackingUrl)}" target="_blank" rel="noopener">Theo dõi vận chuyển</a>` : ""}</div>
    </div>`).join("")}</div>`;
}

function customerEditHTML(customer) {
  return `
    <div class="customer-edit-grid">
      <label>Họ tên
        <input name="customerName" required value="${escapeAttr(customer.customerName || "")}">
      </label>
      <label>Số điện thoại
        <input name="phone" required inputmode="tel" value="${escapeAttr(customer.phone || "")}">
      </label>
      <label>Email
        <input name="email" type="email" value="${escapeAttr(customer.email || "")}">
      </label>
      <label>Tỉnh/TP
        <input name="province" required value="${escapeAttr(customer.province || "")}">
      </label>
      <label>Huyện/Quận
        <input name="district" required value="${escapeAttr(customer.district || "")}">
      </label>
      <label>Xã/Phường
        <input name="ward" required value="${escapeAttr(customer.ward || "")}">
      </label>
      <label class="span-2">Địa chỉ chi tiết
        <input name="addressDetail" required value="${escapeAttr(customer.addressDetail || "")}">
      </label>
      <label class="span-2">Ghi chú
        <input name="note" value="${escapeAttr(customer.note || "")}">
      </label>
    </div>
  `;
}

function itemRowHTML(item, index, editable) {
  return `
    <div class="order-item-edit-row" data-item-row>
      ${item.imageUrl ? `<img src="${escapeAttr(item.imageUrl)}" alt="">` : ""}
      <div>
        <strong>${escapeHTML(item.productName || item.productCode || "Sản phẩm")}</strong>
        <p class="muted">${escapeHTML(item.productCode || "")} - Size ${escapeHTML(item.size || "")}</p>
        ${editable ? hiddenItemFields(item, index) : ""}
      </div>
      ${editable ? `
        <label>Số lượng
          <input name="items[${index}].qty" type="number" min="0" max="99" value="${Number(item.qty || item.quantity || 1)}">
        </label>
      ` : `<b>x${Number(item.qty || item.quantity || 1)}</b>`}
    </div>
  `;
}

function hiddenItemFields(item, index) {
  const fields = ["productCode", "productName", "size", "price", "imageUrl", "warehouseId", "warehouseName", "brand", "productKind", "sourceName"];
  return fields.map((field) => `<input type="hidden" name="items[${index}].${field}" value="${escapeAttr(item[field] || "")}">`).join("");
}

function bindOrderDetailActions(order) {
  resultBox.querySelectorAll("[data-copy-payment-reference]").forEach((button) => {
    button.addEventListener("click", () => {
      navigator.clipboard?.writeText(String(button.dataset.copyPaymentReference || "")).catch(() => {});
    });
  });
  const editForm = document.getElementById("order-edit-form");
  editForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!order.canEdit) return;
    const payload = editableOrderPayload(editForm);
    payload.orderId = currentOrderId || order.id;
    payload.token = currentToken;
    const response = await fetch("/api/orders/public", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then((res) => res.json().then((data) => ({ ok: res.ok && data.ok !== false, ...data }))).catch(() => ({ ok: false, message: "Không kết nối được máy chủ." }));
    renderResult(response);
    message.textContent = response.ok ? "Đã lưu thay đổi đơn hàng." : (response.message || "Chưa lưu được thay đổi.");
  });
  document.getElementById("cancel-order-button")?.addEventListener("click", async () => {
    if (!confirm("Bạn chắc chắn muốn hủy đơn hàng này?")) return;
    const response = await postJSON("/api/orders/public/cancel", { orderId: currentOrderId || order.id, token: currentToken });
    renderResult(response);
    message.textContent = response.ok ? "Đơn hàng đã được hủy." : (response.message || "Chưa hủy được đơn hàng.");
  });
}

function editableOrderPayload(editForm) {
  const formData = new FormData(editForm);
  const payload = Object.fromEntries(formData.entries());
  const items = [];
  for (const [key, value] of formData.entries()) {
    const match = key.match(/^items\[(\d+)]\.(.+)$/);
    if (!match) continue;
    const index = Number(match[1]);
    const field = match[2];
    items[index] = items[index] || {};
    items[index][field] = value;
  }
  payload.items = items
    .filter(Boolean)
    .map((item) => ({ ...item, qty: Math.max(0, Number(item.qty || 0)) }))
    .filter((item) => item.qty > 0);
  return payload;
}

async function postJSON(url, data) {
  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok && payload.ok !== false, ...payload };
  } catch {
    return { ok: false, message: "Không kết nối được máy chủ." };
  }
}

function escapeHTML(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHTML(value).replace(/`/g, "&#96;");
}

function formatMoney(value) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("vi-VN", { hour12: false });
}
