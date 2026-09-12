const statusBox = document.getElementById("manage-status");
const message = document.getElementById("manage-message");
const content = document.getElementById("manage-content");
const profileForm = document.getElementById("profile-form");
const addressForm = document.getElementById("address-form");
const ordersList = document.getElementById("orders-list");
let currentCustomer = null;
let currentAddress = null;
let currentOrders = [];
let adminUnitsPromise = null;

initManagePage();

async function initManagePage() {
  bindManageEvents();
  await loadProfile();
}

function bindManageEvents() {
  document.getElementById("logout-button").addEventListener("click", async () => {
    await postJSON("/api/account/logout", {});
    window.location.href = "/account.html";
  });
  document.getElementById("refresh-orders").addEventListener("click", loadOrders);
  document.querySelectorAll("[data-manage-view]").forEach((button) => {
    button.addEventListener("click", () => showManageView(button.dataset.manageView || "orders"));
  });
  profileForm.addEventListener("submit", submitProfileChange);
  addressForm.addEventListener("submit", submitAddressChange);
  ordersList.addEventListener("click", async (event) => {
    const detailTrigger = event.target.closest("[data-order-detail]");
    if (detailTrigger) {
      toggleOrderDetail(detailTrigger.dataset.orderDetail || "");
      return;
    }
    const button = event.target.closest("[data-cancel-order]");
    if (!button) return;
    const orderId = button.dataset.cancelOrder;
    if (!orderId || !confirm("Bạn chắc chắn muốn hủy đơn này?")) return;
    const result = await postJSON("/api/account/orders/cancel", { orderId });
    message.textContent = result.message || (result.ok ? "Đã hủy đơn." : "Chưa hủy được đơn.");
    await loadOrders();
  });
}

async function submitProfileChange(event) {
  event.preventDefault();
  const payload = { ...formData(profileForm), ...formData(addressForm) };
  const addressError = validateSelectedAdminUnit(payload);
  if (addressError) {
    message.textContent = addressError;
    return;
  }
  const result = await postJSON("/api/account/request-change", {
    changeType: "profile",
    ...payload
  });
  message.textContent = result.message || (result.ok ? "Đã gửi yêu cầu xác thực." : "Chưa gửi được yêu cầu.");
}

async function submitAddressChange(event) {
  event.preventDefault();
  const payload = { ...formData(profileForm), ...formData(addressForm) };
  const addressError = validateSelectedAdminUnit(payload);
  if (addressError) {
    message.textContent = addressError;
    return;
  }
  const result = await postJSON("/api/account/request-change", {
    changeType: "profile",
    ...payload
  });
  message.textContent = result.message || (result.ok ? "Đã gửi yêu cầu xác thực." : "Chưa gửi được yêu cầu.");
}

function showManageView(view) {
  document.querySelectorAll("[data-manage-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.manageView === view);
  });
  document.querySelectorAll("[data-manage-panel]").forEach((panel) => {
    const active = panel.dataset.managePanel === view;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
}

async function loadProfile() {
  const result = await fetch("/api/account/profile", { credentials: "same-origin" }).then((res) => res.json()).catch(() => null);
  if (!result?.ok) {
    statusBox.textContent = "Bạn cần đăng nhập để quản lý tài khoản.";
    message.innerHTML = `<a class="primary nav-button action-3d" href="/account.html">Đăng nhập</a>`;
    return;
  }
  currentCustomer = result.customer || {};
  currentAddress = result.address || {};
  renderProfile();
  await Promise.all([
    bindAddressSelectors(addressForm),
    loadOrders()
  ]);
  content.hidden = false;
  statusBox.textContent = "Đang hiển thị các đơn hàng của bạn.";
}

function renderProfile() {
  document.getElementById("welcome-line").textContent = `Chào mừng ${currentCustomer.name || currentCustomer.username || "bạn"} quay lại TopRun`;
  profileForm.elements.username.value = currentCustomer.username || "";
  profileForm.elements.name.value = currentCustomer.name || "";
  profileForm.elements.dateOfBirth.value = normalizeDateInput(currentCustomer.dateOfBirth);
  profileForm.elements.gender.value = currentCustomer.gender || "";
  profileForm.elements.email.value = currentCustomer.email || "";
  profileForm.elements.phone.value = currentCustomer.phone || currentAddress.phone || "";
  addressForm.elements.province.value = currentAddress.province || "";
  addressForm.elements.district.value = currentAddress.district || "";
  addressForm.elements.ward.value = currentAddress.ward || "";
  addressForm.elements.addressDetail.value = currentAddress.addressDetail || "";
  addressForm.elements.fullAddress.value = currentAddress.fullAddress || "";
  document.getElementById("email-status").textContent = currentCustomer.emailVerified ? "Đã xác thực" : "Chưa xác thực";
}

async function loadOrders() {
  ordersList.innerHTML = `<p class="muted">Đang tải đơn hàng...</p>`;
  const result = await fetch("/api/account/orders", { credentials: "same-origin" }).then((res) => res.json()).catch(() => null);
  currentOrders = Array.isArray(result?.data) ? result.data : [];
  document.getElementById("order-count").textContent = String(currentOrders.length);
  if (!currentOrders.length) {
    ordersList.innerHTML = `<p class="muted">Chưa có đơn hàng nào trong tài khoản này.</p>`;
    return;
  }
  ordersList.innerHTML = currentOrders.map(orderCard).join("");
}

function orderCard(order) {
  const canCancel = canCancelOrder(order);
  const items = Array.isArray(order.items) ? order.items : [];
  const firstItem = items[0] || {};
  const tracking = trackingText(order);
  return `
    <article class="order-card" data-order-card="${escapeHTML(order.id || "")}">
      <div class="order-top">
        <div>
          <button class="order-id-button" type="button" data-order-detail="${escapeHTML(order.id || "")}">${escapeHTML(order.id || "")}</button>
          <p class="muted">${formatDate(order.createdAt)}</p>
        </div>
        <span class="status-pill">${escapeHTML(orderStatusLabel(order.status))}</span>
      </div>
      <div class="order-summary-grid">
        <div>
          <span>Sản phẩm</span>
          <strong>${escapeHTML(firstItem.productName || firstItem.productCode || `${items.length} sản phẩm`)}</strong>
        </div>
        <div>
          <span>Tổng tiền</span>
          <strong>${formatMoney(order.total || 0)}</strong>
        </div>
        <div>
          <span>Vận chuyển</span>
          <strong>${escapeHTML(tracking || "Chưa có tracking")}</strong>
        </div>
      </div>
      <div class="order-items">
        ${items.slice(0, 4).map((item) => `<span>${escapeHTML(item.productCode || "")} ${escapeHTML(item.size || "")} x${Number(item.qty || item.quantity || 1)}</span>`).join("")}
        ${items.length > 4 ? `<span>+${items.length - 4} sản phẩm</span>` : ""}
      </div>
      <div class="order-actions">
        <button class="secondary compact action-3d" type="button" data-order-detail="${escapeHTML(order.id || "")}">Xem chi tiết</button>
        ${canCancel ? `<button class="secondary compact action-3d danger-action" type="button" data-cancel-order="${escapeHTML(order.id || "")}">Hủy đơn</button>` : ""}
      </div>
      <div class="order-detail" id="order-detail-${cssId(order.id || "")}" hidden>
        ${orderDetailHTML(order)}
      </div>
    </article>
  `;
}

function toggleOrderDetail(orderId) {
  const detail = document.getElementById(`order-detail-${cssId(orderId)}`);
  if (!detail) return;
  detail.hidden = !detail.hidden;
}

function orderDetailHTML(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  return `
    <div class="detail-grid">
      <section>
        <h3>Sản phẩm đã đặt</h3>
        <div class="detail-items">
          ${items.map(orderItemHTML).join("") || `<p class="muted">Không có dòng sản phẩm.</p>`}
        </div>
      </section>
      <section>
        <h3>Thông tin giao hàng</h3>
        <dl class="detail-list">
          <dt>Trạng thái</dt><dd>${escapeHTML(orderStatusLabel(order.status))}</dd>
          <dt>Xử lý kho</dt><dd>${escapeHTML(fulfillmentLabel(order.fulfillmentStatus))}</dd>
          <dt>Đơn vị vận chuyển</dt><dd>${escapeHTML(order.shippingProvider || "Chưa cập nhật")}</dd>
          <dt>Tracking</dt><dd>${trackingLink(order)}</dd>
          <dt>Địa chỉ</dt><dd>${escapeHTML(order.address || "")}</dd>
          <dt>Ghi chú</dt><dd>${escapeHTML(order.note || "-")}</dd>
        </dl>
      </section>
      <section class="wide-detail">
        <h3>Hành trình đơn hàng</h3>
        ${orderJourneyHTML(order)}
      </section>
      ${orderShipmentsHTML(order)}
    </div>
  `;
}

function orderShipmentsHTML(order) {
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  if (!shipments.length) return "";
  return `<section class="wide-detail"><h3>C&aacute;c ki&#7879;n h&agrave;ng</h3><div class="detail-items">${shipments.map((shipment) => `
    <div class="detail-item"><div class="item-placeholder">${escapeHTML(String(shipment.id || "").split("-").pop() || "")}</div><div>
      <strong>${escapeHTML(shipment.id || "")}</strong><p class="muted">${escapeHTML(shipment.warehouseName || "")}</p>
      <p>Gi&aacute; tr&#7883; ${formatMoney(shipment.productTotal || 0)} · COD ${formatMoney(shipment.codAmount || 0)}</p>
      <p>${escapeHTML(shipment.shippingProvider || "")} ${shipment.trackingCode ? `· ${escapeHTML(shipment.trackingCode)}` : ""}</p>
      ${shipment.trackingUrl ? `<a href="${escapeHTML(shipment.trackingUrl)}" target="_blank" rel="noopener">Theo d&otilde;i v&#7853;n chuy&#7875;n</a>` : ""}
    </div></div>`).join("")}</div></section>`;
}

function orderItemHTML(item) {
  return `
    <div class="detail-item">
      ${item.imageUrl ? `<img src="${escapeHTML(item.imageUrl)}" alt="">` : `<div class="item-placeholder">${escapeHTML(item.productCode || "")}</div>`}
      <div>
        <strong>${escapeHTML(item.productName || item.productCode || "")}</strong>
        <p class="muted">${escapeHTML(item.productCode || "")} - Size ${escapeHTML(item.size || "")} x${Number(item.qty || item.quantity || 1)}</p>
        <p>${formatMoney(Number(item.price || 0) * Number(item.qty || item.quantity || 1))}</p>
      </div>
    </div>
  `;
}

function orderJourneyHTML(order) {
  const rows = journeyRows(order);
  return `
    <ol class="order-timeline">
      ${rows.map((row) => `
        <li class="${row.active ? "active" : ""}">
          <span></span>
          <div>
            <strong>${escapeHTML(row.label)}</strong>
            <p>${escapeHTML([row.time, row.note].filter(Boolean).join(" - "))}</p>
          </div>
        </li>
      `).join("")}
    </ol>
  `;
}

function journeyRows(order) {
  const logs = Array.isArray(order.statusLogs) ? order.statusLogs : [];
  if (logs.length) {
    return logs.map((log) => ({
      label: orderStatusLabel(log.status),
      time: formatDate(log.createdAt),
      note: log.note || "",
      active: true
    }));
  }
  const status = String(order.status || "pending").toLowerCase();
  const shipped = Boolean(order.trackingCode || ["shipped", "completed"].includes(status));
  const completed = status === "completed";
  const cancelled = status === "cancelled";
  const rows = [
    { key: "created", label: "Đã nhận đơn", time: formatDate(order.createdAt), active: true },
    { key: "confirmed", label: "Shop xác nhận", note: "TopRun kiểm tra size và tồn kho", active: !cancelled && !["pending"].includes(status) },
    { key: "shipping", label: "Đang giao / có tracking", note: trackingText(order) || "Chưa có tracking", active: !cancelled && shipped },
    { key: "completed", label: "Hoàn tất", note: "Đơn đã hoàn tất", active: !cancelled && completed }
  ];
  if (cancelled) rows.push({ key: "cancelled", label: "Đã hủy", time: formatDate(order.cancelledAt || order.updatedAt), active: true });
  return rows;
}

function trackingText(order) {
  return [order.shippingProvider, order.trackingCode].map((item) => String(item || "").trim()).filter(Boolean).join(" - ");
}

function trackingLink(order) {
  const code = String(order.trackingCode || "").trim();
  if (!code) return "Chưa cập nhật";
  return `<span>${escapeHTML(code)}</span>`;
}

function canCancelOrder(order) {
  if (!["pending", "processing"].includes(String(order.status || ""))) return false;
  const fulfillment = String(order.fulfillmentStatus || "");
  if (!["", "not_assigned", "processing"].includes(fulfillment)) return false;
  const until = new Date(order.canCancelUntil || "");
  return Number.isFinite(until.getTime()) && Date.now() <= until.getTime();
}

function orderStatusLabel(status) {
  return {
    pending: "Đang xử lý",
    processing: "Đang xử lý",
    cancelled: "Đã hủy",
    confirmed: "Đã xác nhận",
    shipped: "Đã gửi hàng",
    completed: "Hoàn tất",
    purchase_complete: "Đã mua hàng",
    purchase_partial: "Đang gom hàng",
    partner_assigned: "Đang xử lý kho"
  }[status] || status || "Đang xử lý";
}

function fulfillmentLabel(status) {
  return {
    not_assigned: "Chưa phân kho",
    processing: "Đang xử lý",
    partner_assigned: "Đã phân nguồn",
    ready_to_ship: "Sẵn sàng giao",
    shipped: "Đã gửi hàng",
    completed: "Hoàn tất"
  }[String(status || "")] || status || "Chưa cập nhật";
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
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

function normalizeDateInput(value) {
  return String(value || "").slice(0, 10);
}

function loadAdminUnits() {
  if (!adminUnitsPromise) {
    adminUnitsPromise = fetch("/assets/admin-units-v1.json?v=20260620")
      .then((response) => response.ok ? response.json() : [])
      .then((units) => {
        window.__toprunManageAdminUnits = units;
        return units;
      })
      .catch(() => []);
  }
  return adminUnitsPromise;
}

async function bindAddressSelectors(form) {
  const provinceInput = form.elements.province;
  const districtInput = form.elements.district;
  const wardInput = form.elements.ward;
  if (!provinceInput || !districtInput || !wardInput) return;
  const units = await loadAdminUnits();
  const suffix = String(Date.now());
  const provinceList = createDatalist(`manage-province-list-${suffix}`, units.map((item) => item.name));
  const districtList = createDatalist(`manage-district-list-${suffix}`, []);
  const wardList = createDatalist(`manage-ward-list-${suffix}`, []);
  form.append(provinceList, districtList, wardList);
  provinceInput.setAttribute("list", provinceList.id);
  districtInput.setAttribute("list", districtList.id);
  wardInput.setAttribute("list", wardList.id);

  const setInitialDistricts = () => {
    const province = findByName(units, provinceInput.value);
    setDatalistOptions(districtList, province ? province.districts.map((item) => item.name) : []);
    const district = province ? findByName(province.districts, districtInput.value) : null;
    setDatalistOptions(wardList, district ? district.wards.map((item) => item.name) : []);
  };

  provinceInput.addEventListener("input", () => {
    const province = findByName(units, provinceInput.value);
    setDatalistOptions(districtList, province ? province.districts.map((item) => item.name) : []);
    if (!province || !findByName(province.districts, districtInput.value)) {
      districtInput.value = "";
      wardInput.value = "";
      setDatalistOptions(wardList, []);
    }
    districtInput.placeholder = province ? "Tìm Huyện/Quận" : "Chọn Tỉnh/TP trước";
    wardInput.placeholder = "Chọn Huyện/Quận trước";
  });

  districtInput.addEventListener("input", () => {
    const province = findByName(units, provinceInput.value);
    const district = province ? findByName(province.districts, districtInput.value) : null;
    setDatalistOptions(wardList, district ? district.wards.map((item) => item.name) : []);
    if (!district || !findByName(district.wards, wardInput.value)) {
      wardInput.value = "";
    }
    wardInput.placeholder = district ? "Tìm Xã/Phường" : "Chọn Huyện/Quận trước";
  });

  setInitialDistricts();
}

function createDatalist(id, values) {
  const list = document.createElement("datalist");
  list.id = id;
  setDatalistOptions(list, values);
  return list;
}

function setDatalistOptions(list, values) {
  list.innerHTML = values.map((value) => `<option value="${escapeHTML(value)}"></option>`).join("");
}

const ADMIN_TEXT_ALIASES = { "thua thien hue": "hue" };

function adminTextKeys(value) {
  const base = normalizeAdminText(value)
    .replace(/đ/g, "d")
    .replace(/[-–—._/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return [];
  const keys = [base];
  const short = base.replace(/^(tinh|thanh pho|tp|quan|huyen|thi xa|phuong|xa|thi tran|dac khu)\s+/, "");
  if (short && short !== base) keys.push(short);
  keys.slice().forEach((key) => {
    const alias = ADMIN_TEXT_ALIASES[key];
    if (alias && !keys.includes(alias)) keys.push(alias);
  });
  return keys;
}

function findByName(items, name) {
  const keys = adminTextKeys(name);
  if (!keys.length) return null;
  const list = Array.isArray(items) ? items : [];
  const exact = list.find((item) => adminTextKeys(item.name)[0] === keys[0]);
  if (exact) return exact;
  return list.find((item) => {
    const itemKeys = adminTextKeys(item.name);
    return keys.some((key) => itemKeys.includes(key));
  }) || null;
}

function validateSelectedAdminUnit(payload) {
  const provinceName = String(payload.province || "").trim();
  const districtName = String(payload.district || "").trim();
  const wardName = String(payload.ward || "").trim();
  if (!provinceName && !districtName && !wardName) return "";
  const units = window.__toprunManageAdminUnits || [];
  if (!units.length) return "";
  const province = findByName(units, provinceName);
  if (!province) return "Vui lòng chọn Tỉnh/TP đúng trong danh sách.";
  const district = findByName(province.districts, districtName);
  if (!district) return "Vui lòng chọn Huyện/Quận đúng theo Tỉnh/TP đã chọn.";
  const ward = findByName(district.wards, wardName);
  if (!ward) return "Vui lòng chọn Xã/Phường đúng theo Huyện/Quận đã chọn.";
  return "";
}

function normalizeAdminText(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function formatMoney(value) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDate(value) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date.toLocaleString("vi-VN") : "";
}

function cssId(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "_");
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
