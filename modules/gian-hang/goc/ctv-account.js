const card = document.getElementById("ctv-account");
const message = document.getElementById("ctv-login-message");
loadAccount();

async function loadAccount() {
  try {
    const response = await fetch("/api/ctv/me", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) return location.replace("/ctv-login");
    const account = payload.data;
    document.getElementById("ctv-account-name").textContent = account.name;
    document.getElementById("ctv-account-code").textContent = account.code;
    document.getElementById("ctv-ref-link").value = `${location.origin}/?ref=${encodeURIComponent(account.code)}`;
    const refNote = document.getElementById("ctv-ref-note");
    if (refNote) refNote.textContent = `Mọi link sản phẩm bạn copy khi lướt web đều tự gắn mã ${account.code} · đơn bạn tự đặt hộ khách cũng tính hoa hồng cho bạn.`;
    renderCommissionData(account);
    card.hidden = false;
  } catch { location.replace("/ctv-login"); }
}

// Hoa hồng + đơn giới thiệu + lịch sử nhận tiền công (server chỉ trả dữ liệu của chính CTV này).
function renderCommissionData(account) {
  const summary = account.commissionSummary || {};
  const orders = Array.isArray(account.orders) ? account.orders : [];
  const payments = Array.isArray(account.payments) ? account.payments : [];
  const metrics = document.getElementById("ctv-metrics");
  if (metrics) metrics.hidden = false;
  setText("ctv-metric-pending", formatMoney(summary.pendingAmount));
  setText("ctv-metric-approved", formatMoney(Math.max(0, Number(summary.approvedAmount || 0) - Number(summary.paidAmount || 0))));
  setText("ctv-metric-approved-note", `Tổng đã duyệt ${formatMoney(summary.approvedAmount)}`);
  setText("ctv-metric-paid", formatMoney(summary.paidAmount));
  const latestPayment = [...payments].sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""))[0];
  setText("ctv-metric-paid-note", latestPayment ? `Gần nhất: ${formatMoney(latestPayment.amount)} · ${formatDate(latestPayment.createdAt)}` : "Chưa nhận lần nào");
  const now = new Date();
  const ordersThisMonth = orders.filter((item) => {
    const at = new Date(item.createdAt || "");
    return !Number.isNaN(at.getTime()) && at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
  }).length;
  setText("ctv-metric-orders", String(ordersThisMonth));
  setText("ctv-metric-orders-note", `Tổng ${Number(summary.orderCount || orders.length)} đơn ghi nhận`);

  const ordersBody = document.getElementById("ctv-orders-body");
  if (ordersBody) {
    const sorted = [...orders].sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
    // Tien cong tach 2 cot: "Tạm tính" khi đơn còn pending (chưa vào thu nhập),
    // "Chính thức" chỉ có số khi đơn giao thành công được duyệt; đơn hủy/hoàn = void.
    ordersBody.innerHTML = sorted.map((item) => `<tr>
      <td><strong>${escapeHTML(item.orderId || "")}</strong></td>
      <td>${escapeHTML(formatDate(item.createdAt))}</td>
      <td>${escapeHTML(item.customerName || "")}</td>
      <td>${formatMoney(item.orderTotal)}</td>
      <td>${escapeHTML(orderStatusLabel(item.orderStatus))}</td>
      <td>${commissionPendingCell(item)}</td>
      <td>${commissionOfficialCell(item)}</td>
    </tr>`).join("") || '<tr><td colspan="7">Chưa có đơn ghi nhận.</td></tr>';
  }

  const paymentsBody = document.getElementById("ctv-payments-body");
  if (paymentsBody) {
    const sorted = [...payments].sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
    paymentsBody.innerHTML = sorted.map((item) => `<tr>
      <td>${escapeHTML(formatDate(item.createdAt))}</td>
      <td>${formatMoney(item.amount)}</td>
      <td>${escapeHTML(item.note || "")}</td>
    </tr>`).join("") || '<tr><td colspan="3">Chưa có lần nhận tiền công nào.</td></tr>';
  }
}

function commissionPill(status) {
  const value = String(status || "pending");
  if (value === "approved") return '<span class="ctv-pill ok">Duyệt</span>';
  if (value === "void") return '<span class="ctv-pill void">0 · hủy công</span>';
  return '<span class="ctv-pill wait">Chờ</span>';
}

function commissionPendingCell(item) {
  const status = String(item.status || "pending");
  if (status === "approved") return "—";
  if (status === "void") return commissionPill("void");
  return `${formatMoney(item.commissionAmount)} ${commissionPill("pending")}`;
}

function commissionOfficialCell(item) {
  const status = String(item.status || "pending");
  if (status === "approved") return `${formatMoney(item.commissionAmount)} ${commissionPill("approved")}`;
  return "—";
}

function orderStatusLabel(status) {
  const labels = {
    pending: "Mới tạo",
    confirmed_by_customer: "Khách đã xác nhận",
    payment_pending: "Chờ chuyển khoản",
    payment_confirmed: "Đã xác nhận CK",
    waiting_partner_confirm: "Đang kiểm tra hàng",
    stock_confirmed: "Đã có hàng",
    partner_assigned: "Đang chuẩn bị hàng",
    processing: "Đang xử lý",
    shipping: "Đang giao",
    shipped: "Đang giao",
    delivered: "Đã giao",
    completed: "Hoàn tất",
    cancelled: "Đã hủy",
    canceled: "Đã hủy",
    refunded: "Đã hoàn tiền",
    returned: "Hoàn hàng",
    customer_recontact: "Chờ liên hệ lại"
  };
  return labels[String(status || "").toLowerCase()] || String(status || "Đang xử lý");
}

function setText(id, text) { const node = document.getElementById(id); if (node) node.textContent = text; }
function formatMoney(value) { return `${new Intl.NumberFormat("vi-VN").format(Math.max(0, Number(value || 0)))}đ`; }
function formatDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function escapeHTML(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

document.getElementById("ctv-copy-link")?.addEventListener("click", async () => {
  const link = document.getElementById("ctv-ref-link").value;
  try { await navigator.clipboard.writeText(link); showMessage("Da sao chep link gioi thieu."); }
  catch { document.getElementById("ctv-ref-link").select(); showMessage("Hay bam Sao chep tren trinh duyet."); }
});

document.getElementById("ctv-logout")?.addEventListener("click", async () => {
  await fetch("/api/ctv/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  // Xoa cache trang thai CTV de cac trang khac khong con hien badge/ref sau khi dang xuat.
  try { sessionStorage.removeItem("ctv_me_cache"); } catch {}
  location.replace("/ctv-login");
});

function showMessage(text) { message.hidden = false; message.textContent = text; }
