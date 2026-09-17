const state = {
  token: initialPortalToken(),
  partner: null,
  needs: [],
  orders: [],
  packingOrders: [],
  purchases: [],
  payments: [],
  adjustments: [],
  summary: {}
};

const message = document.getElementById("message");
const pageMode = document.body?.dataset.page || (document.getElementById("partner-login-form") ? "login" : "portal");
document.getElementById("partner-login-form")?.addEventListener("submit", loginPortal);
document.getElementById("refresh-button")?.addEventListener("click", loadPortal);
document.getElementById("logout-button")?.addEventListener("click", logoutPortal);
document.querySelectorAll("[data-view-button]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.viewButton));
});
document.addEventListener("click", (event) => {
  const closeButton = event.target.closest?.("[data-close-buying]");
  if (closeButton) {
    closeBuyingSession();
    return;
  }
  const undoButton = event.target.closest?.("[data-undo-buying]");
  if (undoButton) undoPurchase(undoButton);
});
setInterval(() => {
  if (pageMode === "portal") renderBuyingLists();
}, 60000);

function setView(viewName) {
  document.querySelectorAll("[data-view-button]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewButton === viewName);
  });
  document.querySelectorAll("[data-view]").forEach((view) => {
    const isActive = view.dataset.view === viewName;
    view.classList.toggle("is-active", isActive);
    view.hidden = !isActive;
  });
  history.replaceState(null, "", `#${viewName}`);
}

function setMessage(text, isError = false) {
  if (!message) return;
  message.textContent = text || "";
  message.style.color = isError ? "#b91c1c" : "#23785b";
}

function initialPortalToken() {
  const match = location.pathname.match(/^\/partner\/([A-Za-z0-9_-]{8,})$/);
  return match ? match[1] : "";
}

function showLogin(messageText = "") {
  if (pageMode !== "login") {
    if (messageText) sessionStorage.setItem("partnerLoginMessage", messageText);
    location.replace("/partner-login");
    return;
  }
  if (messageText) setMessage(messageText, true);
}

function showPortal() {
  if (pageMode !== "portal") return;
  document.body?.classList.remove("auth-pending");
  const app = document.querySelector(".partner-app");
  if (app) app.hidden = false;
}

async function logoutPortal() {
  try {
    await fetch("/api/partner-portal/logout", { method: "POST", credentials: "same-origin" });
  } catch (_) {
    // Best effort: local redirect still clears the visible portal.
  }
  state.token = "";
  state.partner = null;
  sessionStorage.removeItem("partnerLoginMessage");
  location.replace("/partner-login");
}

function applyPortalPayload(payload = {}) {
  state.partner = payload.partner;
  state.token = payload.token || state.token;
  state.needs = Array.isArray(payload.needs) ? payload.needs : [];
  state.orders = Array.isArray(payload.orders) ? payload.orders : [];
  state.packingOrders = Array.isArray(payload.packingOrders) ? payload.packingOrders : [];
  state.purchases = Array.isArray(payload.purchases) ? payload.purchases : [];
  state.payments = Array.isArray(payload.payments) ? payload.payments : [];
  state.adjustments = Array.isArray(payload.adjustments) ? payload.adjustments : [];
  state.summary = payload.summary || {};
  state.shipments = Array.isArray(payload.shipments) ? payload.shipments : [];
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const DISPLAY_TEXT_FIXES = new Map([
  ["partner_yen", "Yến"],
  ["wh_yen", "Yến"],
  ["yen131", "Yến"],
  ["y?n", "Yến"],
  ["partner_phuong-thu", "Phương Thư"],
  ["wh_phuong_thu", "Phương Thư"],
  ["phuong-thu", "Phương Thư"],
  ["phuong thu", "Phương Thư"],
  ["partner_cau-dien", "Cầu Diễn"],
  ["wh_cau_dien", "Cầu Diễn"],
  ["cau-dien", "Cầu Diễn"],
  ["c?u di?n", "Cầu Diễn"],
  ["partner_wh_hang_td", "Hằng-TD"],
  ["wh_hang_td", "Hằng-TD"],
  ["hang-td", "Hằng-TD"],
  ["h?ng-td", "Hằng-TD"]
]);

function normalizeDisplayKey(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function fixedDisplayText(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  return DISPLAY_TEXT_FIXES.get(text.toLowerCase()) || DISPLAY_TEXT_FIXES.get(normalizeDisplayKey(text)) || text;
}

function partnerDisplayName(partner = {}) {
  // fixedDisplayText hands back its input when there is no fix, so the id always "won" and a partner
  // missing from the list (Khanh HD, MaxxSport...) showed "partner_wh_khanh_hd". Known fixes first,
  // then the real name.
  const known = (value) => {
    const text = String(value || "").trim();
    return text ? fixedDisplayText(text) !== text ? fixedDisplayText(text) : "" : "";
  };
  return known(partner.id)
    || known(partner.login)
    || fixedDisplayText(partner.name)
    || String(partner.login || partner.id || "").trim()
    || "Đối tác mua hàng";
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatMoney(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function parseMoneyValue(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const normalized = text.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function render() {
  const summary = state.summary || {};
  const missingQty = state.needs.reduce((sum, item) => sum + Number(item.missingQty || 0), 0);
  const newMissingQty = state.needs.reduce((sum, item) => sum + Number(item.newQty || 0), 0);
  const backlogMissingQty = state.needs.reduce((sum, item) => sum + Number(item.backlogQty || 0), 0);
  const orderCount = new Set(state.orders.map((item) => item.orderId)).size;
  document.getElementById("partner-name").textContent = partnerDisplayName(state.partner);
  document.getElementById("need-count").textContent = state.needs.length;
  setText("new-missing-count", newMissingQty);
  setText("backlog-missing-count", backlogMissingQty);
  setText("order-count", orderCount);
  document.getElementById("missing-count").textContent = missingQty;
  setText("bought-count", summary.purchasedQty || 0);
  setText("fee-total", formatMoney(summary.feeAmount || 0));
  setText("debt-total", formatMoney(summary.debtAmount || 0));
  document.getElementById("fee-total-2").textContent = formatMoney(summary.feeAmount || 0);
  setText("adjustment-total", formatMoney(summary.adjustmentAmount || 0));
  document.getElementById("paid-total").textContent = formatMoney(summary.paidAmount || 0);
  document.getElementById("debt-total-2").textContent = formatMoney(summary.debtAmount || 0);
  setHTML("quick-need-list", needListHTML(state.needs.slice(0, 5), missingQty));
  setHTML("overview-need-list", needListHTML(state.needs, missingQty));
  renderBuyingLists();
  setHTML("overview-order-list", packingRowsHTML(packingSummaryRow) || emptyText("Chưa có đơn hàng cần đóng."));
  document.getElementById("need-list").innerHTML = needListHTML(state.needs, missingQty);
  document.getElementById("order-list").innerHTML = packingRowsHTML(packingOrderRow) || emptyText("Chưa có đơn hàng cần đóng.");
  document.getElementById("product-history-list").innerHTML = productHistoryRows().join("") || emptyText("Chưa có lịch sử sản phẩm được giao.");
  document.getElementById("purchase-list").innerHTML = state.purchases.map(purchaseRow).join("") || emptyText("Chưa có phiên mua nào.");
  document.getElementById("payment-list").innerHTML = state.payments.map(paymentRow).join("") || emptyText("Chưa có lịch sử thanh toán.");
  setHTML("adjustment-list", (state.adjustments || []).map(adjustmentRow).join("") || emptyText("Chưa có chi phí phát sinh."));
  setHTML("shipment-list", packingToolbarHTML() + ((state.shipments || []).map(shipmentRow).join("") || emptyText("Chưa có đơn nào đủ điều kiện tạo vận đơn.")));
  document.getElementById("copy-packing-list")?.addEventListener("click", copyPackingList);
  document.getElementById("export-packing-list")?.addEventListener("click", exportPackingListFile);
  document.querySelectorAll("[data-confirm-purchase]").forEach((button) => {
    button.addEventListener("click", () => confirmPurchase(button));
  });
  document.querySelectorAll("[data-toggle-packing]").forEach((button) => {
    button.addEventListener("click", () => updateOrderPacking(button.dataset.orderId, button.dataset.nextStatus));
  });
  document.querySelectorAll("[data-undo-purchase]").forEach((button) => {
    button.addEventListener("click", () => undoPurchase(button));
  });
  document.querySelectorAll("[data-request-shipment]").forEach((button) => {
    button.addEventListener("click", () => requestShipment(button.dataset.orderId, button.dataset.lineRef));
  });
}

// Trạng thái theo nguyên tắc 7 bậc: mua đủ → Chờ vận đơn → Đang tạo... → (lỗi kèm lý do | có mã)
// → Chờ đóng hàng → Đã đóng hàng (xác nhận hoặc tự động khi bàn giao ĐVVC).
function shipmentStatusLabel(item = {}, trackingCode = "") {
  if (trackingCode) {
    const shipping = String(item.shippingStatus || "");
    if (shipping === "delivered" || shipping.includes("Đã giao")) return "Đã giao";
    if (shipping.includes("ship") || shipping.includes("vận chuyển")) return "Đang giao/đã tạo";
    return "Đã có vận đơn";
  }
  if (item.externalShip) return "Ship ngoài";
  if (item.requestPending) return "Đang tạo vận đơn...";
  if (item.requestError) return "Tạo vận đơn thất bại";
  if (item.canRequest) return "Chờ vận đơn";
  return "Chưa mua đủ";
}

function shipmentErrorHTML(item = {}) {
  if (item.requestError) {
    return `<div class="subtle" style="color:#b91c1c;max-width:280px">${escapeHTML(item.requestError)}</div>`;
  }
  if (item.requestStale) {
    return `<div class="subtle" style="color:#92400e;max-width:280px">Yêu cầu trước chưa được xử lý (hệ thống bận). Bấm tạo lại, không lo bị trùng đơn.</div>`;
  }
  return "";
}

function shipmentRow(item = {}) {
  const trackingCode = String(item.trackingCode || "").trim();
  const carrierLabel = item.carrier === "viettel_post" ? "Viettel Post" : "SPX";
  const statusLabel = shipmentStatusLabel(item, trackingCode);
  const badgeClass = trackingCode || item.externalShip
    ? "done"
    : item.requestError ? "missing" : item.canRequest || item.requestPending ? "neutral" : "missing";
  return `
    <article class="list-row order-row">
      <div>
        <strong>${escapeHTML(item.orderId)}</strong>
        ${item.lineRef && item.lineRef !== item.orderId ? `<div class="subtle">Kiện ${escapeHTML(item.lineRef)}</div>` : ""}
        <div class="subtle">${formatTime(item.createdAt)}</div>
      </div>
      <div>
        ${(item.products || []).map((text) => `<div>${escapeHTML(text)}</div>`).join("") || `<div class="subtle">Không có sản phẩm</div>`}
      </div>
      <div class="status-stack">
        <span class="badge ${badgeClass}">${escapeHTML(statusLabel)}</span>
        ${trackingCode
          ? `<strong>${item.trackingUrl ? `<a href="${escapeHTML(item.trackingUrl)}" target="_blank" rel="noopener">${escapeHTML(trackingCode)}</a>` : escapeHTML(trackingCode)}</strong>`
          : item.canRequest
            ? `<button class="small-button" data-request-shipment data-order-id="${escapeHTML(item.orderId)}" data-line-ref="${escapeHTML(item.lineRef || item.orderId)}" type="button">${item.requestError || item.requestStale ? "Thử tạo lại vận đơn" : `Tạo vận đơn ${carrierLabel}`}</button>`
            : ""}
        ${shipmentErrorHTML(item)}
      </div>
    </article>
  `;
}

// Danh sach dong hang: don DA CO ma van don — nguoi dong hang (co khi duoc nho ho)
// chi can 2 thong tin: ma van don + san pham. Copy dan Zalo hoac tai file CSV.
function packingListRows() {
  return (state.shipments || []).filter((item) => String(item.trackingCode || "").trim());
}

function packingListText() {
  return packingListRows()
    .map((item) => `${item.trackingCode} — ${(item.products || []).join(" ; ") || item.orderId}`)
    .join("\n");
}

function packingToolbarHTML() {
  const count = packingListRows().length;
  if (!count) return "";
  return `
    <div class="list-row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <strong>${count} đơn có vận đơn cần đóng</strong>
      <button class="small-button" id="copy-packing-list" type="button">Copy danh sách đóng hàng</button>
      <button class="small-button" id="export-packing-list" type="button">Tải file danh sách</button>
    </div>
  `;
}

async function copyPackingList() {
  const text = packingListText();
  if (!text) return setMessage("Chưa có đơn nào có mã vận đơn để đóng.", true);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  setMessage("Đã copy danh sách đóng hàng — dán vào Zalo để gửi người đóng hộ.");
}

function exportPackingListFile() {
  const rows = packingListRows();
  if (!rows.length) return setMessage("Chưa có đơn nào có mã vận đơn để đóng.", true);
  const header = ["Ma van don", "San pham"];
  const csv = "﻿" + [header, ...rows.map((item) => [item.trackingCode, (item.products || []).join(" ; ")])]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `danh-sach-dong-hang-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  setMessage(`Đã tải danh sách đóng hàng (${rows.length} đơn).`);
}

async function requestShipment(orderId, lineRef) {
  const shipment = (state.shipments || []).find((item) => String(item.lineRef || item.orderId) === String(lineRef || orderId));
  const carrierLabel = shipment?.carrier === "viettel_post" ? "Viettel Post" : "SPX";
  const button = document.querySelector(`[data-request-shipment][data-line-ref="${CSS.escape(lineRef || orderId)}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "Đang tạo vận đơn...";
  }
  try {
    const response = await fetch("/api/partner-portal/shipment-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        token: state.token,
        orderId,
        lineRef: lineRef || orderId
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Không tạo được vận đơn.");
    setMessage(payload.message || (payload.trackingCode
      ? `Đã tạo vận đơn ${carrierLabel} ${payload.trackingCode}.`
      : "Đã gửi yêu cầu tạo vận đơn. Mã vận đơn sẽ hiện tại đây khi xử lý xong."));
  } catch (error) {
    setMessage(error.message || "Không tạo được vận đơn.", true);
  }
  // Tải lại cả khi lỗi: dòng lỗi đỏ + nút "Thử tạo lại" render theo dữ liệu server.
  await loadPortal();
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setHTML(id, value) {
  const element = document.getElementById(id);
  if (element) element.innerHTML = value;
}

function emptyText(text) {
  return `<p class="subtle empty">${escapeHTML(text)}</p>`;
}

function needListHTML(items = [], total = 0) {
  if (!items.length) return emptyText("Chưa có sản phẩm cần mua.");
  return `
    <div class="purchase-session-meta need-total-row">
      <span><small>Tổng số lượng cần mua</small><strong>${escapeHTML(total)}</strong></span>
    </div>
    ${items.map(needRow).join("")}
  `;
}

function packingRowsHTML(renderer) {
  return (state.packingOrders || []).map(renderer).join("");
}

function packingShipmentCellHTML(item) {
  const trackingCode = String(item.trackingCode || "").trim();
  if (trackingCode) {
    const label = item.trackingUrl
      ? `<a href="${escapeHTML(item.trackingUrl)}" target="_blank" rel="noopener">${escapeHTML(trackingCode)}</a>`
      : escapeHTML(trackingCode);
    return `<div class="subtle">Vận đơn: <strong>${label}</strong></div>`;
  }
  if (item.externalShip) return `<div class="subtle">Ship ngoài (không cần vận đơn SPX)</div>`;
  if (item.requestPending) return `<div class="subtle">Vận đơn: đang tạo...</div>`;
  if (item.requestError) return `<div class="subtle" style="color:#b91c1c">Tạo vận đơn thất bại: ${escapeHTML(item.requestError)}</div>`;
  return `<div class="subtle">Chưa có vận đơn</div>`;
}

// Nút "Đã đóng hàng" chỉ mở khi kiện đã có vận đơn hoặc đi ship ngoài (nguyên tắc 7 bậc);
// trước đó kiện hiện "Chờ vận đơn" và thao tác nằm ở tab Vận đơn.
function packingToggleHTML(item) {
  if (item.canPack === false) {
    return `
      <span class="badge missing">Chờ vận đơn</span>
      ${packingShipmentCellHTML(item)}
    `;
  }
  const isPacked = item.packingStatus === "packed";
  return `
    <span class="badge ${isPacked ? "done" : "neutral"}">${isPacked ? "Đã đóng hàng" : "Chưa đóng hàng"}</span>
    ${packingShipmentCellHTML(item)}
    <button class="small-button" data-toggle-packing data-order-id="${escapeHTML(item.orderId)}" data-next-status="${isPacked ? "pending" : "packed"}" type="button" ${item.packingLocked ? "disabled" : ""}>
      ${isPacked ? "Bỏ xác nhận" : "Đã đóng hàng"}
    </button>
  `;
}

function packingSummaryRow(item) {
  return `
    <article class="list-row order-summary-row">
      <strong>${escapeHTML(item.orderId)}${item.lineRef && item.lineRef !== item.orderId ? `<span class="subtle"> · Kiện ${escapeHTML(item.lineRef)}</span>` : ""}</strong>
      <span>${escapeHTML(item.customerName || "-")}</span>
      <div class="product-stack">
        ${(item.products || []).map((text) => `<span>${escapeHTML(text)}</span>`).join("") || `<span class="subtle">Không có sản phẩm</span>`}
      </div>
      <div class="status-stack">${packingToggleHTML(item)}</div>
    </article>
  `;
}

function packingOrderRow(item) {
  return `
    <article class="list-row order-row">
      <div>
        <strong>${escapeHTML(item.orderId)}</strong>
        ${item.lineRef && item.lineRef !== item.orderId ? `<div class="subtle">Kiện ${escapeHTML(item.lineRef)}</div>` : ""}
        <div class="subtle">${formatTime(item.createdAt)}</div>
      </div>
      <div>
        ${(item.products || []).map((text) => `<div>${escapeHTML(text)}</div>`).join("") || `<div class="subtle">Không có sản phẩm</div>`}
      </div>
      <div class="status-stack">${packingToggleHTML(item)}</div>
    </article>
  `;
}

const BUYING_SESSION_IDLE_MS = 15 * 60 * 1000;

function buyingClosedAtKey() {
  return `toprunBuyingClosedAt:${state.token || ""}`;
}

function closeBuyingSession() {
  try { localStorage.setItem(buyingClosedAtKey(), String(Date.now())); } catch (error) {}
  renderBuyingLists();
  setMessage("Đã đóng phiên mua. Các dòng đã mua vẫn xem được ở tab Phiên mua.");
}

function buyingActiveAllocations() {
  let closedAt = 0;
  try { closedAt = Number(localStorage.getItem(buyingClosedAtKey()) || 0); } catch (error) {}
  const rows = [];
  let latest = 0;
  (state.purchases || []).forEach((session) => {
    (Array.isArray(session.allocations) ? session.allocations : []).forEach((entry) => {
      if (entry.undoneAt) return;
      const quantity = Number(entry.quantity || 0);
      if (quantity <= 0) return;
      const stamp = new Date(entry.respondedAt || session.createdAt || 0).getTime();
      if (!Number.isFinite(stamp) || stamp <= closedAt) return;
      if (stamp > latest) latest = stamp;
      const unitCost = Number(entry.unitCost || 0);
      const actualCost = Number(entry.actualCostPrice || entry.unitCost || 0);
      rows.push({
        sessionId: session.id || "",
        orderId: entry.orderId || "",
        lineIndex: Number(entry.lineIndex || 0),
        productCode: entry.productCode || session.productCode || "",
        size: entry.size || session.size || "",
        quantity,
        unitCost,
        actualCost,
        lineTotal: actualCost * quantity,
        systemTotal: unitCost * quantity,
        stamp
      });
    });
  });
  if (!rows.length) return [];
  if (Date.now() - latest > BUYING_SESSION_IDLE_MS) return [];
  return rows.sort((a, b) => b.stamp - a.stamp);
}

function buyingListHTML() {
  const rows = buyingActiveAllocations();
  if (!rows.length) return "";
  const actualTotal = rows.reduce((sum, row) => sum + row.lineTotal, 0);
  const systemTotal = rows.reduce((sum, row) => sum + row.systemTotal, 0);
  const diffTotal = actualTotal - systemTotal;
  return `
    <div class="purchase-session-meta need-total-row">
      <span><small>Tiền mua thực tế</small><strong>${formatMoney(actualTotal)}</strong></span>
      <span><small>Giá trị hệ thống</small><strong>${formatMoney(systemTotal)}</strong></span>
      <span><small>Chênh lệch</small><strong>${diffTotal === 0 ? formatMoney(0) : `${diffTotal > 0 ? "+" : "−"}${formatMoney(Math.abs(diffTotal))}`}</strong></span>
      <button class="small-button" data-close-buying type="button">✓ Mua xong — đóng phiên</button>
    </div>
    ${rows.map((row) => {
      const diff = row.actualCost - row.unitCost;
      return `
        <article class="list-row payment-row">
          <div>
            <strong>${escapeHTML(row.productCode)} · size ${escapeHTML(row.size || "-")}</strong>
            <div class="subtle">${escapeHTML(row.orderId)} · SL ${escapeHTML(row.quantity)} × ${formatMoney(row.actualCost)} = ${formatMoney(row.lineTotal)}</div>
          </div>
          <div class="status-stack">
            <span class="badge ${diff === 0 ? "done" : "missing"}">${diff === 0 ? "Khớp giá" : `Lệch ${diff > 0 ? "+" : "−"}${formatMoney(Math.abs(diff))}`}</span>
            <button class="small-button" data-undo-buying data-session-id="${escapeHTML(row.sessionId)}" data-order-id="${escapeHTML(row.orderId)}" data-line-index="${escapeHTML(row.lineIndex)}" type="button">Hoàn tác</button>
          </div>
        </article>
      `;
    }).join("")}
  `;
}

function renderBuyingLists() {
  const html = buyingListHTML();
  ["overview-buying-panel", "need-buying-panel"].forEach((id) => {
    const panel = document.getElementById(id);
    if (panel) panel.hidden = !html;
  });
  setHTML("overview-buying-list", html);
  setHTML("need-buying-list", html);
}

function needRow(item) {
  const key = btoa(unescape(encodeURIComponent([item.productCode, item.size].join("|"))));
  const orderText = (item.orders || []).slice(0, 4).map((order) => `${escapeHTML(order.orderId)} còn ${order.remainingQty}`).join(", ");
  const done = Number(item.missingQty || 0) <= 0;
  const partial = Number(item.purchasedQty || 0) > 0 && !done;
  const backlogQty = Number(item.backlogQty || 0);
  const newQty = Number(item.newQty || 0);
  const statusLabel = done ? "Đã mua đủ" : backlogQty > 0 ? "Mua bù" : partial ? "Đã mua một phần" : "Cần mua";
  const statusClass = done ? "done" : partial ? "neutral" : "missing";
  const systemUnitCost = Number(item.unitCost || 0);
  const missingSystemPrice = systemUnitCost <= 0;
  const inputDisabled = done || missingSystemPrice;
  const currentUnitCost = Number(item.currentUnitCost || 0);
  const priceDelta = Number(item.priceDelta || 0);
  const priceChanged = Boolean(item.priceChanged) && systemUnitCost > 0 && currentUnitCost > 0 && priceDelta !== 0;
  const priceDriftHTML = priceChanged
    ? `<div class="price-drift ${priceDelta > 0 ? "drift-up" : "drift-down"}">⚠ Giá đổi: ${formatMoney(systemUnitCost)} → ${formatMoney(currentUnitCost)} (${priceDelta > 0 ? "+" : "-"}${formatMoney(Math.abs(priceDelta))})</div>`
    : "";
  return `
    <article class="list-row need-row ${done ? "is-done" : ""}">
      <div class="need-product-cell">
        <strong>${escapeHTML(item.productCode)} · size ${escapeHTML(item.size || "-")}</strong>
        <div class="subtle need-product-name">${escapeHTML(item.productName || "")}</div>
        <div class="need-breakdown">
          <span>Đơn mới ${escapeHTML(newQty)}</span>
          <span>Mua bù ${escapeHTML(backlogQty)}</span>
        </div>
        <div class="subtle need-orders">${orderText || "Đã đủ cho các đơn hiện tại"}</div>
      </div>
      <div class="number-cell">
        <span>Cần mua</span>
        <strong>${escapeHTML(item.missingQty || 0)}</strong>
      </div>
      <span class="badge need-status ${statusClass}">${escapeHTML(statusLabel)}</span>
      <div class="actual-cell price-cell readonly-price">
        <label>Giá hệ thống</label>
        <strong>${systemUnitCost > 0 ? formatMoney(systemUnitCost) : "Thiếu giá từ Image Tool"}</strong>
        ${priceDriftHTML}
      </div>
      <div class="actual-cell price-cell">
        <label for="actual-cost-${key}">Giá thực tế</label>
        <input id="actual-cost-${key}" type="text" inputmode="numeric" value="${escapeHTML(systemUnitCost || "")}" placeholder="Giá mua thật" ${inputDisabled ? "disabled" : ""}>
      </div>
      <div class="actual-cell">
        <label for="qty-${key}">Mua thực tế</label>
        <input id="qty-${key}" type="number" min="0" max="${Math.max(0, item.missingQty || 0)}" value="${Math.max(0, item.missingQty || 0)}" ${inputDisabled ? "disabled" : ""}>
      </div>
      <input id="note-${key}" class="note-input" type="text" placeholder="Ghi chú" ${inputDisabled ? "disabled" : ""}>
      <button class="confirm-purchase-button" data-confirm-purchase data-key="${key}" data-product-code="${escapeHTML(item.productCode)}" data-size="${escapeHTML(item.size || "")}" type="button" ${inputDisabled ? "disabled" : ""}>${missingSystemPrice ? "Thiếu giá" : "Xác nhận"}</button>
    </article>
  `;
}
function productHistoryRows() {
  const rows = new Map();
  state.orders.forEach((item) => {
    const key = [item.productCode, item.size].join("|");
    if (!rows.has(key)) {
      rows.set(key, {
        productCode: item.productCode,
        productName: item.productName,
        size: item.size,
        assignedQty: 0,
        purchasedQty: 0,
        missingQty: 0,
        orderCount: new Set()
      });
    }
    const row = rows.get(key);
    row.assignedQty += Number(item.quantity || 0);
    row.purchasedQty += Number(item.purchasedQty || 0);
    row.missingQty += Number(item.missingQty || 0);
    row.orderCount.add(item.orderId);
  });
  return Array.from(rows.values()).map((item) => `
    <article class="list-row history-row">
      <div>
        <strong>${escapeHTML(item.productCode)} · size ${escapeHTML(item.size || "-")}</strong>
        <div class="subtle">${escapeHTML(item.productName || "")}</div>
      </div>
      <div class="qty-pills">
        <span>Đã giao ${item.assignedQty}</span>
        <span>Đã mua ${item.purchasedQty}</span>
        <span>Còn ${item.missingQty}</span>
        <span>${item.orderCount.size} mã đơn</span>
      </div>
    </article>
  `);
}

function purchaseRow(item) {
  const allocations = Array.isArray(item.allocations) ? item.allocations : [];
  const lines = purchaseLines(item);
  const purchaseTotal = lines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0);
  const detailId = `purchase-${escapeHTML(item.id || `${item.productCode}-${item.createdAt}`)}`;
  const sessionCode = item.id || item.sessionCode || item.code || "Phiên mua";
  return `
    <details class="purchase-session" id="${detailId}" open>
      <summary>
        <strong>${escapeHTML(sessionCode)}</strong>
      </summary>
      <div class="purchase-detail-list">
        <div class="purchase-session-meta">
          <span><small>Thời gian</small><strong>${formatTime(item.createdAt)}</strong></span>
          <span><small>Số lượng</small><strong>${escapeHTML(item.quantity || 0)}</strong></span>
          <span><small>Tiền mua thực tế</small><strong>${formatMoney(purchaseTotal)}</strong></span>
          <span><small>Công mua hộ</small><strong>${formatMoney(item.feeAmount || 0)}</strong></span>
        </div>
        ${lines.map((line) => `
          <div class="purchase-detail-row">
            <div>
              <strong>${escapeHTML(line.productCode)} · size ${escapeHTML(line.size || "-")}</strong>
              <div class="subtle">${escapeHTML(line.productName || "")}</div>
              <div class="subtle">Hệ thống ${formatMoney(line.unitCost || 0)} · Thực tế ${formatMoney(line.actualCostPrice || line.unitCost || 0)}</div>
              ${purchaseLineUndoButtonsHTML(item, line)}
            </div>
            <span>SL ${escapeHTML(line.quantity || 0)}</span>
            <strong>${formatMoney(line.lineTotal || 0)}</strong>
          </div>
        `).join("")}
        <div class="subtle purchase-allocation">
          Phân bổ:
          ${allocations.map((entry) => purchaseAllocationHTML(item, entry)).join("") || "chưa phân bổ"}
        </div>
      </div>
    </details>
  `;
}

function purchaseAllocationHTML(session, entry = {}) {
  const undone = Boolean(entry.undoneAt);
  return `
    <span class="purchase-allocation-item">
      ${escapeHTML(entry.orderId)} (${escapeHTML(entry.quantity || 0)})${undone ? " · đã hoàn tác" : ""}
      ${undone ? "" : purchaseUndoButtonHTML(session, entry)}
    </span>
  `;
}

function purchaseLineUndoButtonsHTML(session, line = {}) {
  const allocations = (Array.isArray(session.allocations) ? session.allocations : []).filter((entry) => {
    if (entry.undoneAt) return false;
    const sameCode = String(entry.productCode || session.productCode || "").trim().toLowerCase() === String(line.productCode || "").trim().toLowerCase();
    const sameSize = String(entry.size || session.size || "").trim().toLowerCase() === String(line.size || "").trim().toLowerCase();
    return sameCode && sameSize;
  });
  if (!allocations.length) return "";
  return `<div class="split-actions compact-actions">${allocations.map((entry) => purchaseUndoButtonHTML(session, entry)).join("")}</div>`;
}

function purchaseUndoButtonHTML(session, entry = {}) {
  return `<button class="small-button" data-undo-purchase data-session-id="${escapeHTML(session.id || "")}" data-order-id="${escapeHTML(entry.orderId || "")}" data-line-index="${escapeHTML(entry.lineIndex || 0)}" type="button">Hoàn tác</button>`;
}

function purchaseLines(item) {
  const lines = Array.isArray(item.lines) && item.lines.length ? item.lines : [{
    productCode: item.productCode || "",
    productName: item.productName || "",
    size: item.size || "",
    quantity: item.quantity || 0,
    unitCost: item.unitCost || 0,
    actualCostPrice: item.actualCostPrice || item.unitCost || 0,
    lineTotal: Number(item.actualCostPrice || item.unitCost || 0) * Number(item.quantity || 0)
  }];
  return lines.map((line) => ({
    ...line,
    unitCost: Number(line.unitCost || 0),
    actualCostPrice: Number(line.actualCostPrice || line.unitCost || 0),
    quantity: Number(line.quantity || 0),
    lineTotal: Number(line.actualCostPrice || line.unitCost || 0) * Number(line.quantity || 0)
  }));
}

function paymentRow(item) {
  return `
    <article class="list-row payment-row">
      <div>
        <strong>${formatMoney(item.amount || 0)}</strong>
        <div class="subtle">${formatTime(item.createdAt || item.paidAt)}</div>
      </div>
      <div class="subtle">${escapeHTML(item.note || (item.method === "bank_transfer" ? "CK thanh toán" : item.method) || "Admin đã xác nhận thanh toán")}</div>
    </article>
  `;
}

function adjustmentRow(item) {
  return `
    <article class="list-row payment-row">
      <div>
        <strong>${formatMoney(item.amount || 0)}</strong>
        <div class="subtle">${formatTime(item.createdAt)}</div>
      </div>
      <div class="subtle">${escapeHTML(item.note || "Chi phí phát sinh")}</div>
    </article>
  `;
}

async function undoPurchase(button) {
  const sessionId = button.dataset.sessionId || "";
  const orderId = button.dataset.orderId || "";
  const lineIndex = Number(button.dataset.lineIndex || 0);
  if (!sessionId || !orderId) return setMessage("Thiếu thông tin dòng mua cần hoàn tác.", true);
  if (!window.confirm("Hoàn tác dòng mua này và đưa sản phẩm về trạng thái chưa mua?")) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Đang hoàn tác...";
  try {
    const response = await fetch("/api/partner-portal/purchases/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token: state.token, sessionId, orderId, lineIndex })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Không hoàn tác được dòng mua.");
    state.needs = payload.needs || [];
    state.orders = payload.orders || state.orders;
    state.packingOrders = Array.isArray(payload.packingOrders) ? payload.packingOrders : state.packingOrders;
    state.payments = payload.payments || state.payments;
    state.adjustments = payload.adjustments || state.adjustments;
    state.summary = payload.summary || state.summary;
    state.purchases = mergePurchaseSession(state.purchases, payload.session);
    setMessage(payload.message || "Đã hoàn tác dòng mua.");
    render();
  } catch (error) {
    setMessage(error.message || "Không hoàn tác được dòng mua.", true);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.isConnected) button.textContent = "Hoàn tác";
  }
}

async function confirmPurchase(button) {
  // Doc gia tri tu DUNG hang chua nut vua bam (needRow render o 3 danh sach nen id input bi trung,
  // getElementById se lay nham ban an o view khac lam gia/so luong/ghi chu go vao bi bo qua).
  if (!button || !button.dataset) return;
  const row = button.closest("article");
  const quantity = Number(row?.querySelector('input[id^="qty-"]')?.value ?? 0);
  const actualUnitCost = parseMoneyValue(row?.querySelector('input[id^="actual-cost-"]')?.value ?? 0);
  if (!Number.isFinite(quantity) || quantity < 0) return setMessage("Vui lòng nhập số lượng thực tế mua được.", true);
  if (quantity === 0 && !window.confirm("Xác nhận kho này hết hàng? Hệ thống sẽ tự chuyển sản phẩm sang kho còn hàng tiếp theo.")) return;
  const commandId = button.dataset.commandId || `partner_purchase_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  button.dataset.commandId = commandId;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = quantity === 0 ? "Đang chuyển kho..." : "Đang ghi nhận...";
  try {
    const response = await fetch("/api/partner-portal/purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        token: state.token,
        productCode: button.dataset.productCode,
        size: button.dataset.size,
        quantity,
        actualUnitCost,
        commandId,
        note: row?.querySelector('input[id^="note-"]')?.value || ""
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Không ghi nhận được phiên mua.");
    state.needs = payload.needs || [];
    state.orders = payload.orders || state.orders;
    state.packingOrders = Array.isArray(payload.packingOrders) ? payload.packingOrders : state.packingOrders;
    state.payments = payload.payments || state.payments;
    state.adjustments = payload.adjustments || state.adjustments;
    state.summary = payload.summary || state.summary;
    state.purchases = mergePurchaseSession(state.purchases, payload.session);
    delete button.dataset.commandId;
    setMessage(payload.message || "Đã ghi nhận số lượng mua được.");
    render();
  } catch (error) {
    setMessage(error.message || "Không ghi nhận được phiên mua.", true);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.isConnected) button.textContent = "Xác nhận";
  }
}

function mergePurchaseSession(items = [], session = null) {
  if (!session || !session.id) return items;
  const next = Array.isArray(items) ? [...items] : [];
  const index = next.findIndex((item) => item && item.id === session.id);
  if (index >= 0) next[index] = session;
  else next.unshift(session);
  return next.filter(Boolean).slice(0, 50);
}


async function updateOrderPacking(orderId, nextStatus) {
  const button = document.querySelector(`[data-toggle-packing][data-order-id="${CSS.escape(orderId)}"]`);
  if (button) button.disabled = true;
  if (button) {
    button.setAttribute("aria-busy", "true");
    button.textContent = "Đang cập nhật...";
  }
  try {
    const response = await fetch("/api/partner-portal/order-packing", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        token: state.token,
        orderId,
        status: nextStatus
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Không cập nhật được trạng thái đóng hàng.");
    state.orders = Array.isArray(payload.orders) ? payload.orders : state.orders;
    state.packingOrders = Array.isArray(payload.packingOrders) ? payload.packingOrders : state.packingOrders;
    setMessage(payload.message || "Đã cập nhật trạng thái đóng hàng.");
    render();
  } catch (error) {
    setMessage(error.message || "Không cập nhật được trạng thái đóng hàng.", true);
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
}

async function loadPortal() {
  if (pageMode !== "portal") return;
  if (!state.token) {
    showLogin("Vui lòng đăng nhập để vào trang quản lý đối tác.");
    return;
  }
  setMessage("Đang tải dữ liệu...");
  try {
    const response = await fetch(`/api/partner-portal?token=${encodeURIComponent(state.token)}`, {
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Link đối tác không hợp lệ.");
    applyPortalPayload(payload);
    setMessage("");
    showPortal();
    render();
    const initialView = location.hash.replace("#", "") || "overview";
    setView(document.querySelector(`[data-view="${CSS.escape(initialView)}"]`) ? initialView : "overview");
  } catch (error) {
    showLogin(error.message || "Không tải được trang đối tác.");
  }
}

async function loginPortal(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type='submit']");
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/partner-portal/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        login: document.getElementById("partner-login-id")?.value || "",
        password: document.getElementById("partner-login-password")?.value || ""
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Không đăng nhập được.");
    applyPortalPayload(payload);
    sessionStorage.removeItem("partnerLoginMessage");
    location.replace(`/partner/${state.token}`);
  } catch (error) {
    setMessage(error.message || "Không đăng nhập được.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

if (pageMode === "login") {
  const loginMessage = sessionStorage.getItem("partnerLoginMessage") || "";
  sessionStorage.removeItem("partnerLoginMessage");
  if (loginMessage) setMessage(loginMessage, true);
} else {
  loadPortal();
}
