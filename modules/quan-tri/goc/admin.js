const state = {
  view: "dashboard",
  admin: null,
  overview: null,
  products: [],
  webOrders: [],
  orders: [],
  operations: null,
  partners: null,
  fanpage: null,
  ctv: { accounts: [], logs: [] },
  ctvDraft: { phone: "", email: "", password: "" },
  // Số liệu hoa hồng CTV do Sales Desk đẩy xuống (bản chiếu ctv-commissions.json)
  ctvCommissions: { affiliates: [], commissions: [], payments: [], syncedAt: "" },
  ctvDetailId: "",
  query: "",
  status: "all",
  loading: false,
  selectedConversationId: "",
  orderDisplayLevels: {},
  quickPaymentDrafts: {},
  orderEditorId: null,
  orderEditorDraft: null,
  // Tra kho + dat ho trong tab Fanpage
  catalog: null,
  catalogLoading: false,
  catalogQuery: "",
  catalogSize: "",
  catalogOnlyStock: true,
  productPickerOpen: false,
  fanpageCart: [],
  bubbleSuggest: null,
  // Noi dung landing (bank CK, % coc) + trang thai khoi "Don hang & CK" theo tung hoi thoai
  content: null,
  fanpageCk: {},
  // Mobile: fanpage hien 1 man mot luc (danh sach HOAC khung chat) — bam hoi thoai la sang khung chat.
  fanpageMobileDetail: false
};

const app = document.getElementById("app");
const message = document.getElementById("message");

// Desktop = bang don kieu Sales Desk; mobile = the don + tab 2x4 ghim. Doi breakpoint thi render lai.
const MOBILE_LAYOUT_QUERY = window.matchMedia("(max-width: 900px)");
function isMobileLayout() {
  return MOBILE_LAYOUT_QUERY.matches;
}
MOBILE_LAYOUT_QUERY.addEventListener?.("change", () => {
  if (!state.loading && !adminFormBusy()) render();
});

document.getElementById("refresh-button")?.addEventListener("click", () => loadAll({ force: true }));
document.getElementById("logout-button")?.addEventListener("click", logoutAdmin);
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view || "dashboard"));
});

init();

async function init() {
  renderLoading("Đang kiểm tra phiên đăng nhập...");
  try {
    const me = await api("/api/admin/me", { silent: true });
    if (!me?.ok) {
      location.replace("/admin-login");
      return;
    }
    state.admin = me.admin;
    await loadAll({ force: true });
    runFanpageWaitLoop();
  } catch {
    location.replace("/admin-login");
  }
}

async function loadAll() {
  state.loading = true;
  renderLoading("Đang tải dữ liệu quản trị...");
  try {
    const [overview, products, orders, partners, fanpage, operations, ctv, content, ctvCommissions] = await Promise.all([
      api("/api/admin/overview"),
      api("/api/admin/products"),
      api("/api/admin/orders"),
      api("/api/admin/partners"),
      api("/api/admin/fanpage"),
      api("/api/admin/operations"),
      api("/api/admin/ctv"),
      // Cau hinh bank CK + % coc dung chung voi trang thanh toan (public, tra ve map phang)
      api("/api/content").catch(() => ({})),
      // Hoa hong CTV (Sales Desk day xuong); loi thi de trong, tab CTV van dung duoc
      api("/api/admin/ctv/commissions", { silent: true }).catch(() => null)
    ]);
    state.overview = overview?.data || null;
    state.products = Array.isArray(products?.data) ? products.data : [];
    state.webOrders = Array.isArray(orders?.data) ? orders.data : [];
    state.operations = operations?.data || null;
    state.orders = combinedAdminOrders(state.webOrders, state.operations?.orders);
    state.partners = partners?.data || null;
    state.fanpage = fanpage?.data || null;
    state.ctv = ctv?.data || { accounts: [], logs: [] };
    state.ctvCommissions = ctvCommissions?.data || { affiliates: [], commissions: [], payments: [], syncedAt: "" };
    state.content = content && typeof content === "object" ? content : {};
    showMessage(`Đã tải dữ liệu admin: ${state.products.length} sản phẩm, ${state.orders.length} đơn hàng.`);
  } catch (error) {
    showMessage(error.message || "Không tải được dữ liệu admin.", true);
  } finally {
    state.loading = false;
    render();
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    if (response.status === 401 && !options.silent) location.replace("/admin-login");
    throw new Error(payload.message || payload.error || "Yêu cầu không thành công.");
  }
  return payload;
}

function setView(view) {
  state.view = view;
  state.query = "";
  state.status = view === "shipping" ? "ready" : view === "orders" ? "workflow_new" : "all";
  state.orderEditorId = null;
  state.orderEditorDraft = null;
  state.ctvDetailId = "";
  render();
}

function renderLoading(text) {
  app.innerHTML = `<section class="panel empty-state">${escapeHTML(text)}</section>`;
}

function render() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  if (state.loading) return;
  // Quy tac re-render form: giu gia tri dang go trong form Cau hinh thanh toan qua render().
  const payConfigSaved = capturePayConfigFormState();
  if (state.view === "products") app.innerHTML = productsView();
  else if (state.view === "orders") app.innerHTML = ordersView();
  else if (state.view === "partners") app.innerHTML = partnersView();
  else if (state.view === "shipping") app.innerHTML = shippingView();
  else if (state.view === "fanpage") app.innerHTML = fanpageView();
  else if (state.view === "ctv") app.innerHTML = ctvView();
  else app.innerHTML = isMobileLayout() ? mobileTaskMenuView() : dashboardView();
  bindViewEvents();
  restorePayConfigFormState(payConfigSaved);
}

// ===== Cau hinh thanh toan (mockup 7, anh duyet 2026-08-13 — khuon chung voi admin dasbui) =====
// Truoc day khong co cho nao trong admin de dien STK — landing-content.json chinh tay.
// Form ghi qua POST /api/content co san (khoa phien admin), kem "Xem thu QR" truoc khi luu.
const PAY_CONFIG_FIELDS = [
  ["payCfgBankCode", "bankCode", "Mã ngân hàng VietQR (VD: TCB)"],
  ["payCfgBankName", "bankName", "Tên ngân hàng (VD: Techcombank)"],
  ["payCfgBankAccountNumber", "bankAccountNumber", "Số tài khoản nhận tiền"],
  ["payCfgBankAccountName", "bankAccountName", "Chủ tài khoản (IN HOA không dấu)"],
  ["payCfgDepositPercent", "momoDepositPercent", "% cọc mặc định (VD: 20)"],
  ["payCfgZaloPhone", "zaloPhone", "Số Zalo shop (nút Nhắn Zalo)"],
  ["payCfgMessengerUrl", "messengerUrl", "Link Messenger (m.me/...)"]
];

function payConfigPanel() {
  const content = state.content || {};
  const hasBank = String(content.bankCode || "").trim() && String(content.bankAccountNumber || "").trim();
  return `
    <section class="panel">
      <details ${hasBank ? "" : "open"}>
        <summary><strong>Cấu hình thanh toán (TopRun)</strong> — STK nhận tiền, % cọc, Zalo cho QR checkout</summary>
        ${hasBank ? "" : `<p class="muted"><strong>Chưa có STK — khách đang không thấy QR/thanh toán trước trên web.</strong></p>`}
        <div class="form-grid">
          ${PAY_CONFIG_FIELDS.map(([id, key, placeholder]) => `<input id="${id}" placeholder="${escapeHTML(placeholder)}" value="${escapeHTML(String(content[key] ?? ""))}">`).join("")}
        </div>
        <div class="action-row">
          <button class="small primary" type="button" data-pay-config-save>Lưu cấu hình</button>
          <button class="small" type="button" data-pay-config-preview>Xem thử QR</button>
        </div>
        <div id="payCfgPreview" class="muted"></div>
      </details>
    </section>
  `;
}

function capturePayConfigFormState() {
  const values = {};
  let present = false;
  for (const [id] of PAY_CONFIG_FIELDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    present = true;
    values[id] = el.value;
  }
  if (!present) return null;
  const active = document.activeElement;
  const focused = active && PAY_CONFIG_FIELDS.some(([id]) => id === active.id);
  return {
    values,
    open: Boolean(document.getElementById(PAY_CONFIG_FIELDS[0][0])?.closest("details")?.open),
    focusId: focused ? active.id : "",
    selectionStart: focused && typeof active.selectionStart === "number" ? active.selectionStart : null
  };
}

function restorePayConfigFormState(saved) {
  if (!saved) return;
  for (const [id, value] of Object.entries(saved.values)) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }
  if (saved.open) {
    const panel = document.getElementById(PAY_CONFIG_FIELDS[0][0])?.closest("details");
    if (panel) panel.open = true;
  }
  if (saved.focusId) {
    const target = document.getElementById(saved.focusId);
    if (target) {
      target.focus({ preventScroll: true });
      if (typeof saved.selectionStart === "number" && typeof target.setSelectionRange === "function") {
        try { target.setSelectionRange(saved.selectionStart, saved.selectionStart); } catch {}
      }
    }
  }
}

function payConfigFormValues() {
  const values = {};
  for (const [id, key] of PAY_CONFIG_FIELDS) {
    values[key] = (document.getElementById(id)?.value || "").trim();
  }
  return values;
}

function previewPayConfigQr() {
  const values = payConfigFormValues();
  const box = document.getElementById("payCfgPreview");
  if (!box) return;
  if (!values.bankCode || !values.bankAccountNumber) {
    box.innerHTML = `<strong>Điền Mã ngân hàng + Số tài khoản trước rồi bấm Xem thử QR.</strong>`;
    return;
  }
  const params = new URLSearchParams({ amount: "100000", addInfo: "KIEMTRA", accountName: values.bankAccountName || "" });
  const url = `https://img.vietqr.io/image/${encodeURIComponent(values.bankCode)}-${encodeURIComponent(values.bankAccountNumber)}-compact2.png?${params.toString()}`;
  box.innerHTML = `<p>QR xem thử (100.000đ · nội dung KIEMTRA) — quét thử bằng app ngân hàng để chắc đúng STK trước khi lưu:</p><img src="${escapeHTML(url)}" alt="QR xem thử" style="width:180px;height:180px;background:#fff;border-radius:8px">`;
}

async function saveLandingPaymentConfig(button = null) {
  const values = payConfigFormValues();
  if ((values.bankCode || values.bankAccountNumber) && !(values.bankCode && values.bankAccountNumber)) {
    return showMessage("Cần đủ cả Mã ngân hàng và Số tài khoản (hoặc để trống cả hai).", true);
  }
  const percent = Number(values.momoDepositPercent || 0);
  if (values.momoDepositPercent && !(percent > 0 && percent <= 100)) {
    return showMessage("% cọc phải là số từ 1 đến 100.", true);
  }
  const restore = markButtonProcessing(button, "Đang lưu...");
  try {
    // POST /api/content ghi de toan file — PHAI merge tren content hien tai, khong gui moi 7 field.
    const merged = { ...(state.content || {}), ...values };
    const result = await api("/api/content", { method: "POST", body: merged });
    state.content = result?.content || merged;
    showMessage("Đã lưu cấu hình thanh toán. QR checkout và nút chat sẽ dùng thông tin mới ngay.");
    render();
  } catch (error) {
    showMessage(error.message || "Chưa lưu được cấu hình thanh toán.", true);
  } finally {
    restore();
  }
}

// Man chinh tren mobile: danh sach tac vu, bam vao tung nghiep vu de xu ly.
function mobileTaskMenuView() {
  const metrics = state.overview?.metrics || {};
  const activeOrders = pendingOrders();
  const shippingReady = operationalOrders().filter(shippingOrderEligible).filter((order) => !shippingOrderStarted(order));
  return `
    <section class="panel mobile-task-menu">
      <div class="panel-head"><div><h2>Tác vụ</h2><p>Chọn nghiệp vụ cần xử lý.</p></div><span class="pill">${escapeHTML(formatDateTime(state.overview?.generatedAt || ""))}</span></div>
      <div class="task-menu-list">
        ${taskMenuItem("orders", "Quản lý đơn hàng", `${activeOrders.length} đơn đang xử lý`)}
        ${taskMenuItem("shipping", "Vận đơn chờ ship", `${shippingReady.length} đơn chờ lên vận đơn`)}
        ${taskMenuItem("products", "Sản phẩm", `${state.products.length} mã đang quản lý`)}
        ${taskMenuItem("partners", "Đối tác & mua hàng", `${metrics.purchaseNeeds || 0} sản phẩm cần mua`)}
        ${taskMenuItem("fanpage", "Fanpage", `${conversations().length} hội thoại`)}
        ${taskMenuItem("ctv", "Cộng tác viên", `${Array.isArray(state.ctv?.accounts) ? state.ctv.accounts.length : 0} tài khoản`)}
      </div>
    </section>
  `;
}

function taskMenuItem(view, title, note) {
  return `<button class="task-menu-item" type="button" data-view="${escapeHTML(view)}"><span class="task-menu-text"><strong>${escapeHTML(title)}</strong><small>${escapeHTML(note)}</small></span><span class="task-menu-arrow" aria-hidden="true">›</span></button>`;
}

function facebookAttributionReport() {
  const rows = Array.isArray(state.overview?.analytics?.attribution) ? state.overview.analytics.attribution : [];
  if (!rows.length) return "";
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const body = rows.slice(0, 50).map((row) => {
    const matchedOrders = orders.filter((order) => String(order?.attribution?.contentId || "") === String(row.contentId || row.key || ""))
      .filter((order) => !order.cancelledAt && !/cancel|deleted|returned|refunded/i.test(String(order.status || "")));
    const revenue = matchedOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const visitors = Number(row.uniqueVisitors || 0);
    const carts = Number(row.add_to_cart || 0);
    const conversion = visitors ? `${Math.round((matchedOrders.length / visitors) * 1000) / 10}%` : "0%";
    const products = (row.products || []).sort((left, right) => Number(right.product_view || 0) - Number(left.product_view || 0)).slice(0, 3)
      .map((item) => `${escapeHTML(item.code)} (${Number(item.product_view || 0)} xem/${Number(item.add_to_cart || 0)} giỏ)`).join("<br>");
    return `<tr><td>${escapeHTML(row.pageId || "-")}<small>${escapeHTML(row.topicId || row.campaign || "")}</small></td><td>${escapeHTML(row.postId || "-")}<small>${escapeHTML(row.contentId || row.key || "")}</small></td><td>${Number(row.source_click || 0)}</td><td>${visitors}</td><td>${Number(row.product_view || 0)}</td><td>${carts}</td><td>${matchedOrders.length}</td><td>${formatMoney(revenue)}</td><td>${conversion}</td><td>${products || "-"}</td></tr>`;
  }).join("");
  return `<section class="panel"><div class="panel-head"><div><h2>Hiệu quả comment link Facebook</h2><p>Truy vết 30 ngày từ click đến xem sản phẩm, thêm giỏ và đơn hàng.</p></div></div><div class="table-wrap"><table><thead><tr><th>Fanpage/chủ đề</th><th>Bài/mã tracking</th><th>Click</th><th>Khách</th><th>Xem SP</th><th>Thêm giỏ</th><th>Đơn</th><th>Doanh thu</th><th>Chuyển đổi</th><th>Sản phẩm quan tâm</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function dashboardView() {
  const metrics = state.overview?.metrics || {};
  const totals = state.overview?.analytics?.totals || {};
  const activeOrders = pendingOrders();
  return `
    ${payConfigPanel()}
    <section class="metric-grid">
      ${metric("Sản phẩm", metrics.visibleProducts || 0, `${metrics.products || 0} tổng`)}
      ${metric("Đơn đang xử lý", metrics.activeOrders || activeOrders.length, `${metrics.orders || state.orders.length} tổng`)}
      ${metric("Đối tác", metrics.partners || partnerList().length, `${metrics.purchaseNeeds || 0} sản phẩm cần mua`)}
      ${metric("Hội thoại fanpage", metrics.conversations || conversations().length, "Dữ liệu đã đồng bộ")}
      ${metric("Người truy cập", totals.unique_visitors || totals.uniqueVisitors || totals.visitors || 0, "14 ngày")}
      ${metric("Đơn web", totals.order_success || 0, "Thành công")}
    </section>
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Việc cần xử lý online</h2>
          <p>Dữ liệu lấy trực tiếp từ landing: sản phẩm, đơn hàng, đối tác và fanpage.</p>
        </div>
        <span class="pill">${escapeHTML(formatDateTime(state.overview?.generatedAt || ""))}</span>
      </div>
      <div class="quick-grid">
        ${quickAction("Sản phẩm cần rà soát", productIssues().length, "products")}
        ${quickAction("Đơn mới/chờ xử lý", activeOrders.length, "orders")}
        ${quickAction("Hàng đối tác cần mua", metrics.purchaseNeeds || 0, "partners")}
        ${quickAction("Tin nhắn fanpage", conversations().length, "fanpage")}
      </div>
    </section>
    ${facebookAttributionReport()}
  `;
}

function ctvView() {
  if (state.ctvDetailId) return ctvDetailView();
  const accounts = Array.isArray(state.ctv?.accounts) ? state.ctv.accounts : [];
  const logs = Array.isArray(state.ctv?.logs) ? state.ctv.logs : [];
  const names = new Map(accounts.map((item) => [item.id, item.name]));
  return `
    <section class="panel">
      <div class="panel-head"><div><h2>Cộng tác viên</h2><p>CTV đăng nhập bằng <strong>số điện thoại hoặc email</strong> và <strong>mật khẩu ban đầu</strong>. Mã giới thiệu được tự tạo.</p></div><span class="pill">Hoa hồng sync ${escapeHTML(formatDateTime(state.ctvCommissions?.syncedAt || ""))}</span></div>
      <form id="ctv-create-form" class="ctv-create-form">
        <label><span>Số điện thoại đăng nhập</span><input name="phone" inputmode="tel" value="${escapeHTML(state.ctvDraft.phone)}" placeholder="Ví dụ: 0366552487"></label>
        <label><span>Email đăng nhập</span><input name="email" type="email" value="${escapeHTML(state.ctvDraft.email)}" placeholder="Ví dụ: ctv@gmail.com"></label>
        <label><span>Mật khẩu đăng nhập ban đầu</span><input id="ctv-initial-password" name="password" type="password" value="${escapeHTML(state.ctvDraft.password)}" placeholder="Ít nhất 8 ký tự" minlength="8" required><span style="display:flex;gap:8px;flex-wrap:wrap"><button id="ctv-toggle-password" type="button">Hiện</button><button id="ctv-generate-password" type="button">Tạo mật khẩu ngẫu nhiên</button></span></label>
        <p class="ctv-form-note">Nhập ít nhất số điện thoại hoặc email. Thiết bị mới phải được admin duyệt.</p>
        <span style="display:flex;gap:10px;flex-wrap:wrap"><button id="ctv-copy-login" type="button">Copy thông tin đăng nhập</button><button type="submit">Tạo tài khoản CTV</button></span>
      </form>
      <div class="table-wrap"><table><thead><tr><th>CTV</th><th>Dang nhap / ma ref</th><th>Đơn</th><th>Hoa hồng chờ</th><th>Còn nợ CTV</th><th>Trang thai</th><th>Anh sach</th><th>Thao tac</th></tr></thead><tbody>
        ${accounts.map((item) => { const stats = ctvCommissionStatsFor(item); return `<tr><td><button type="button" class="ctv-name-link" data-ctv-open="${escapeHTML(item.id)}" style="background:none;border:none;padding:0;color:inherit;font-weight:700;cursor:pointer;text-decoration:underline">${escapeHTML(item.name)}</button><small>${escapeHTML(item.phone || item.email || "")}</small></td><td>${escapeHTML(item.phone || item.email || item.username || "")}<small>Mã giới thiệu: ${escapeHTML(item.code || "")}</small></td><td>${stats.orderCount}</td><td>${formatMoney(stats.pending)}</td><td>${formatMoney(stats.debt)}</td><td>${item.active ? "Đang kích hoạt" : "Tạm dừng"}</td><td>${item.allowNoLogo ? "Được phép" : "Mặc định có logo"}</td><td><button type="button" data-ctv-open="${escapeHTML(item.id)}">Xem trang</button> <button type="button" data-ctv-active="${escapeHTML(item.id)}" data-next="${item.active ? "false" : "true"}">${item.active ? "Tạm dừng" : "Kích hoạt"}</button> <button type="button" data-ctv-logo="${escapeHTML(item.id)}" data-next="${item.allowNoLogo ? "false" : "true"}">${item.allowNoLogo ? "Tắt ảnh sạch" : "Bật ảnh sạch"}</button> <button type="button" data-ctv-delete="${escapeHTML(item.id)}" data-name="${escapeHTML(item.name || item.phone || item.email || "")}">Xóa</button></td></tr><tr><td colspan="8">${ctvDeviceList(item)}</td></tr>`; }).join("") || '<tr><td colspan="8">Chưa có tài khoản CTV.</td></tr>'}
      </tbody></table></div>
    </section>
    <section class="panel"><div class="panel-head"><div><h2>Log tai anh</h2><p>${logs.length} luot gan nhat.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Thoi gian</th><th>CTV</th><th>Ma</th><th>Anh</th></tr></thead><tbody>
        ${logs.slice(0, 500).map((item) => `<tr><td>${escapeHTML(formatDateTime(item.at))}</td><td>${escapeHTML(names.get(item.ctvId) || item.ctvId)}</td><td>${escapeHTML(item.productCode)}</td><td>${escapeHTML(item.imageIndex)}</td></tr>`).join("") || '<tr><td colspan="4">Chua co luot tai.</td></tr>'}
      </tbody></table></div>
    </section>`;
}

// Tra affiliateId goc tren Sales Desk cho 1 tai khoan CTV landing (uu tien ban sync tu Desk, khop theo ma ref).
function ctvDeskAffiliateIdFor(account = {}) {
  const code = String(account.code || "").trim().toUpperCase();
  const fromSync = (state.ctvCommissions?.affiliates || []).find((item) => String(item.code || "").trim().toUpperCase() === code);
  return String(fromSync?.id || account.affiliateId || "");
}

// Gom so lieu hoa hong cua 1 CTV tu state.ctvCommissions: chờ = pending, nợ = approved − paid.
function ctvCommissionStatsFor(account = {}) {
  const code = String(account.code || "").trim().toUpperCase();
  const affiliateId = ctvDeskAffiliateIdFor(account);
  const match = (item) => (code && String(item.affiliateCode || "").trim().toUpperCase() === code)
    || (affiliateId && String(item.affiliateId || "") === affiliateId);
  const commissions = (state.ctvCommissions?.commissions || []).filter(match);
  const payments = (state.ctvCommissions?.payments || []).filter(match);
  const sumBy = (list) => list.reduce((total, item) => total + Math.max(0, Number(item.commissionAmount || 0)), 0);
  const approved = sumBy(commissions.filter((item) => String(item.status || "") === "approved"));
  const pending = sumBy(commissions.filter((item) => !["approved", "void"].includes(String(item.status || "pending"))));
  const voided = sumBy(commissions.filter((item) => String(item.status || "") === "void"));
  const paid = payments.reduce((total, item) => total + Math.max(0, Number(item.amount || 0)), 0);
  return { commissions, payments, approved, pending, voided, paid, debt: Math.max(0, approved - paid), orderCount: commissions.length };
}

function ctvCommissionStatusPill(status) {
  const value = String(status || "pending");
  if (value === "approved") return '<span class="pill">Duyệt</span>';
  if (value === "void") return '<span class="pill">0 · hủy công</span>';
  return '<span class="pill">Chờ</span>';
}

// Trang chi tiết 1 CTV (view con trong tab CTV): 4 metric + bảng đơn + khối thanh toán tiền công.
function ctvDetailView() {
  const accounts = Array.isArray(state.ctv?.accounts) ? state.ctv.accounts : [];
  const account = accounts.find((item) => item.id === state.ctvDetailId);
  if (!account) return '<section class="panel"><div class="panel-head"><div><h2>Không tìm thấy CTV</h2></div><button type="button" id="ctv-back">← Về danh sách</button></div></section>';
  const stats = ctvCommissionStatsFor(account);
  const orders = [...stats.commissions].sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
  const payments = [...stats.payments].sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
  return `
    <section class="panel">
      <div class="panel-head"><div><h2>CTV: ${escapeHTML(account.name || account.code || "")}</h2><p>Mã ref <strong>${escapeHTML(account.code || "")}</strong> · ${escapeHTML(account.phone || account.email || account.username || "")}</p></div><button type="button" id="ctv-back">← Về danh sách</button></div>
      <div class="metric-grid">
        ${metric("Đơn liên quan", String(stats.orderCount), "Đơn có ghi nguồn CTV")}
        ${metric("Hoa hồng đã duyệt", formatMoney(stats.approved), "Đơn giao thành công")}
        ${metric("Hoa hồng chờ", formatMoney(stats.pending), stats.voided ? `Đã hủy công ${formatMoney(stats.voided)}` : "Chờ giao/đối soát")}
        ${metric("Còn nợ CTV", formatMoney(stats.debt), `Đã trả ${formatMoney(stats.paid)}`)}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Đơn của CTV</h2><p>Số liệu do Sales Desk đẩy xuống (sync ${escapeHTML(formatDateTime(state.ctvCommissions?.syncedAt || ""))}).</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Đơn</th><th>Ngày</th><th>Khách</th><th>Nguồn</th><th>Tổng đơn</th><th>Trạng thái</th><th>Hoa hồng</th></tr></thead><tbody>
        ${orders.map((item) => `<tr><td><strong>${escapeHTML(item.orderId || "")}</strong></td><td>${escapeHTML(formatDateTime(item.createdAt || ""))}</td><td>${escapeHTML(item.customerName || "")}</td><td>${String(item.attributionSource || "") === "affiliate_ctv_session" ? '<span class="pill">Tự đặt</span>' : '<span class="pill">Link giới thiệu</span>'}</td><td>${formatMoney(item.orderTotal || 0)}</td><td>${escapeHTML(statusLabel(item.orderStatus || ""))}</td><td>${formatMoney(item.commissionAmount || 0)} ${ctvCommissionStatusPill(item.status)}</td></tr>`).join("") || '<tr><td colspan="7">Chưa có đơn ghi nhận cho CTV này.</td></tr>'}
      </tbody></table></div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Thanh toán tiền công</h2><p>Lệnh được gửi về Sales Desk (nguồn sự thật); số dư cập nhật sau khi Desk xác nhận.</p></div></div>
      <form id="ctv-pay-form" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
        <label style="display:flex;flex-direction:column;gap:4px"><span>Số tiền (đ)</span><input name="amount" inputmode="numeric" placeholder="Ví dụ: 500000" required></label>
        <label style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:180px"><span>Ghi chú</span><input name="note" placeholder="Thanh toán tiền công CTV"></label>
        <button type="submit">Ghi thanh toán</button>
      </form>
      <div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Số tiền</th><th>Ghi chú</th></tr></thead><tbody>
        ${payments.map((item) => `<tr><td>${escapeHTML(formatDateTime(item.createdAt || ""))}</td><td>${formatMoney(item.amount || 0)}</td><td>${escapeHTML(item.note || "")}</td></tr>`).join("") || '<tr><td colspan="3">Chưa có lần thanh toán nào.</td></tr>'}
      </tbody></table></div>
    </section>`;
}

// Ghi thanh toán tiền công CTV: gửi op affiliate_payment.create_requested về Sales Desk qua sync-events.
async function submitCtvPayment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const account = (state.ctv?.accounts || []).find((item) => item.id === state.ctvDetailId);
  if (!account) return showMessage("Không tìm thấy CTV đang mở.", true);
  const amount = Number(String(form.amount?.value || "").replace(/[^\d]/g, ""));
  if (!(amount > 0)) return showMessage("Hãy nhập số tiền thanh toán lớn hơn 0.", true);
  const note = String(form.note?.value || "").trim();
  const affiliateId = ctvDeskAffiliateIdFor(account);
  const affiliateCode = String(account.code || "").trim().toUpperCase();
  const requestId = `ctvpay_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const button = form.querySelector("button[type='submit']");
  if (button) button.disabled = true;
  try {
    await submitRemoteOperation("affiliate_payment.create_requested", `ctv-pay-${affiliateId || affiliateCode}`, {
      requestId, affiliateId, affiliateCode, amount, note
    });
    showMessage(`Đã gửi lệnh ghi thanh toán ${formatMoney(amount)} cho ${account.name || affiliateCode} về Sales Desk.`);
    form.reset();
  } catch (error) {
    showMessage(error.message || "Chưa gửi được lệnh thanh toán CTV.", true);
  } finally {
    if (button && button.isConnected) button.disabled = false;
  }
}

function ctvDeviceList(account) {
  const devices = Array.isArray(account.devices) ? account.devices : [];
  return `<div class="ctv-device-list"><strong>Thiết bị đăng nhập</strong>${devices.map((device) => `<div class="ctv-device-row"><span><b>${escapeHTML(device.label || "Thiết bị")}</b><small>${escapeHTML(device.ip || "")} · ${escapeHTML(formatDateTime(device.requestedAt))}</small></span><em>${device.status === "approved" ? "Đã duyệt" : device.status === "rejected" ? "Đã từ chối" : device.status === "revoked" ? "Đã thu hồi" : "Chờ duyệt"}</em><span>${device.status === "pending" ? `<button type="button" data-ctv-device="${escapeHTML(device.id)}" data-account="${escapeHTML(account.id)}" data-action="approve">Duyệt</button> <button type="button" data-ctv-device="${escapeHTML(device.id)}" data-account="${escapeHTML(account.id)}" data-action="reject">Từ chối</button>` : device.status === "approved" ? `<button type="button" data-ctv-device="${escapeHTML(device.id)}" data-account="${escapeHTML(account.id)}" data-action="revoke">Thu hồi</button>` : ""}</span></div>`).join("") || "<small>Chưa có thiết bị gửi yêu cầu.</small>"}</div>`;
}

function productsView() {
  const rows = filteredProducts();
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Quản lý sản phẩm</h2>
          <p>Sửa nhanh tên, giá web và trạng thái hiển thị. Giá sale-file là giá nguồn để đối chiếu.</p>
        </div>
        <span class="pill">${rows.length}/${state.products.length}</span>
      </div>
      ${toolbar("Tìm mã, tên, hãng", "product")}
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Mã / tên</th><th>Giá web</th><th>Giá sale-file</th><th>Size</th><th>Trạng thái</th><th></th></tr>
          </thead>
          <tbody>${rows.map(productRow).join("") || `<tr><td colspan="6">Không có sản phẩm.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function productRow(item) {
  const sizes = Array.isArray(item.sizes) ? item.sizes : [];
  const sizeText = sizes.map((size) => `${size.size || size.name || ""}${size.stock !== undefined ? `:${size.stock}` : ""}`).filter(Boolean).slice(0, 10).join(", ");
  const sourceSale = item.saleFilePrice || item.originalSalePrice || item.preMarkupSalePrice || item.sourceSalePrice || 0;
  return `
    <tr>
      <td>
        <strong>${escapeHTML(item.code || "")}</strong>
        <input class="cell-input name-input" data-product-field="name" data-code="${escapeHTML(item.code || "")}" value="${escapeHTML(item.name || "")}">
      </td>
      <td><input class="cell-input money-input" data-product-field="price" data-code="${escapeHTML(item.code || "")}" value="${escapeHTML(item.price || item.salePrice || item.suggestedPrice || 0)}" inputmode="numeric"></td>
      <td>${formatMoney(sourceSale)}</td>
      <td class="muted">${escapeHTML(sizeText || "-")}</td>
      <td>
        <select class="cell-input" data-product-field="status" data-code="${escapeHTML(item.code || "")}">
          <option value="orderable" ${item.status !== "hidden" ? "selected" : ""}>Đang bán</option>
          <option value="hidden" ${item.status === "hidden" ? "selected" : ""}>Ẩn</option>
        </select>
      </td>
      <td><button class="small" data-save-product="${escapeHTML(item.code || "")}">Lưu</button></td>
    </tr>
  `;
}

// Form tao don thu cong co "draft" trong state: moi lan render() (go o tim kiem,
// bam Hien/An don, refresh don...) chu dang go KHONG bi mat nua.
function emptyRemoteOrderItem() {
  return { search: "", productCode: "", productName: "", size: "", price: "", qty: "1" };
}

function remoteOrderDraft() {
  if (!state.remoteOrderDraft) {
    state.remoteOrderDraft = {
      open: false, customerName: "", phone: "",
      province: "", district: "", ward: "", addressDetail: "", addressScheme: "legacy",
      shippingFee: "", paidAmount: "", note: "", items: []
    };
  }
  if (!Array.isArray(state.remoteOrderDraft.items) || !state.remoteOrderDraft.items.length) {
    state.remoteOrderDraft.items = [emptyRemoteOrderItem()];
  }
  return state.remoteOrderDraft;
}

function resetRemoteOrderDraft(keepOpen = true) {
  state.remoteOrderDraft = {
    open: keepOpen,
    customerName: "", phone: "",
    province: "", district: "", ward: "", addressDetail: "", addressScheme: "legacy",
    shippingFee: "", paidAmount: "", note: "",
    items: [emptyRemoteOrderItem()]
  };
}

function remoteOrderCreateForm() {
  const draft = remoteOrderDraft();
  const twoTier = draft.addressScheme === "two_tier";
  return `
    <form id="remote-order-create-form" class="remote-order-form">
      <div class="form-grid">
        <input name="customerName" placeholder="Tên khách" value="${escapeHTML(draft.customerName)}" required>
        <input name="phone" placeholder="Số điện thoại" value="${escapeHTML(draft.phone)}" required>
      </div>
      <div class="remote-address-scheme">
        <span>Kiểu địa chỉ:</span>
        <label><input type="radio" name="remoteAddressScheme" value="legacy" ${!twoTier ? "checked" : ""}> 3 cấp (cũ)</label>
        <label><input type="radio" name="remoteAddressScheme" value="two_tier" ${twoTier ? "checked" : ""}> 2 cấp (mới)</label>
      </div>
      <div class="form-grid">
        ${remoteAddressField("province", twoTier ? "Tỉnh/TP (34 tỉnh mới)" : "Tỉnh/TP", draft.province)}
        ${twoTier ? "" : remoteAddressField("district", "Huyện/Quận", draft.district)}
        ${remoteAddressField("ward", "Xã/Phường", draft.ward)}
        <input name="addressDetail" placeholder="Số nhà, tên đường..." value="${escapeHTML(draft.addressDetail)}" required>
      </div>
      <div class="form-grid">
        <input name="shippingFee" placeholder="Phí ship" inputmode="numeric" value="${escapeHTML(draft.shippingFee)}">
        <input name="paidAmount" placeholder="Khách đã CK (nếu có)" inputmode="numeric" value="${escapeHTML(draft.paidAmount)}">
        <input name="note" placeholder="Ghi chú" value="${escapeHTML(draft.note)}">
      </div>
      <div id="remote-order-items" class="remote-order-items">${draft.items.map((item, index) => remoteOrderItemRow(index, item)).join("")}</div>
      <button class="small secondary" type="button" data-add-remote-order-item>Thêm sản phẩm</button>
      <button type="submit">Gửi tạo đơn về Sales Desk</button>
    </form>
  `;
}

// Hang san pham: o tim theo MA hoac TEN -> goi y kem gia/ton; chon xong tu dien
// ten + gia web, size chon tu dropdown theo ton kho that (het bang go tay nhu truoc).
function remoteOrderItemRow(index, item = {}) {
  const product = adminProductByCode(item.productCode);
  const sizeOptions = remoteProductSizeOptions(product);
  return `
    <div class="remote-order-item" data-remote-order-item>
      <span class="remote-order-item-number">${index + 1}</span>
      <div class="remote-product-search">
        <input name="search" placeholder="Tìm mã hoặc tên sản phẩm" value="${escapeHTML(item.search || "")}" autocomplete="off">
        ${item.productCode
          ? `<small class="remote-product-picked">✓ ${escapeHTML(item.productCode)} · ${escapeHTML(item.productName || "")}</small>`
          : `<small class="muted">Gõ để tìm và chọn từ gợi ý</small>`}
        <div class="remote-product-suggest" data-suggest-index="${index}"></div>
      </div>
      ${sizeOptions.length ? `
        <select name="size" required>
          <option value="">Chọn size</option>
          ${sizeOptions.map(([label, stock]) => `<option value="${escapeHTML(label)}" ${normalizeSizeText(label) === normalizeSizeText(item.size || "") ? "selected" : ""}>${escapeHTML(label)} (còn ${stock})</option>`).join("")}
        </select>
      ` : `<input name="size" placeholder="Size" value="${escapeHTML(item.size || "")}" required>`}
      <input name="price" placeholder="Giá bán" inputmode="numeric" value="${escapeHTML(item.price || "")}" required>
      <input name="qty" placeholder="SL" inputmode="numeric" value="${escapeHTML(item.qty || "1")}" required>
      <button class="small danger" type="button" data-remove-remote-order-item aria-label="Xóa sản phẩm">Xóa</button>
    </div>
  `;
}

function remoteProductSizeOptions(product) {
  const map = new Map();
  (Array.isArray(product?.sizes) ? product.sizes : []).forEach((row) => {
    const label = String(row.size || row.name || "").trim();
    if (!label) return;
    const stock = Number(row.qty ?? row.stock ?? row.available ?? row.stockQty ?? 0);
    map.set(label, (map.get(label) || 0) + (Number.isFinite(stock) ? stock : 0));
  });
  return [...map.entries()];
}

function searchRemoteProducts(query = "") {
  const q = normalize(query);
  if (q.length < 2) return [];
  const starts = [];
  const contains = [];
  for (const product of state.products) {
    const code = normalize(product.code);
    if (!code) continue;
    const name = normalize(product.name);
    if (code.startsWith(q)) starts.push(product);
    else if (code.includes(q) || name.includes(q)) contains.push(product);
    if (starts.length >= 8) break;
  }
  return [...starts, ...contains].slice(0, 8);
}

// Chi ve lai khung goi y cua DONG dang go, khong render() ca trang -> khong mat focus.
function renderRemoteProductSuggestions(index) {
  const container = app.querySelector(`[data-suggest-index="${index}"]`);
  if (!container) return;
  const item = remoteOrderDraft().items[index];
  if (item?.productCode) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = searchRemoteProducts(item?.search || "").map((product) => {
    const totalStock = remoteProductSizeOptions(product).reduce((sum, [, stock]) => sum + stock, 0);
    return `<button type="button" data-suggest-pick="${escapeHTML(product.code || "")}" data-item-index="${index}">
      <strong>${escapeHTML(product.code || "")}</strong> ${escapeHTML(product.name || "")}
      <span>${formatMoney(product.price || product.salePrice || 0)} · còn ${totalStock}</span>
    </button>`;
  }).join("");
}

function pickRemoteProduct(index, code) {
  const draft = remoteOrderDraft();
  const product = adminProductByCode(code);
  const item = draft.items[index];
  if (!item || !product) return;
  item.productCode = String(product.code || "");
  item.productName = String(product.name || product.code || "");
  item.search = `${product.code} · ${product.name || ""}`.trim();
  item.price = String(product.price || product.salePrice || product.suggestedPrice || "");
  item.size = "";
  renderRemoteOrderItems();
}

// ===== Dia chi hanh chinh cho form tao don thu cong =====
// Dung chung 2 dataset voi checkout (app.js): admin-units-v1 (3 cap cu) + admin-units-v2 (2 cap moi).

const REMOTE_ADMIN_TEXT_ALIASES = { "thua thien hue": "hue" };

function ensureAdminUnitsLoaded() {
  if (state.adminUnitsPromise) return state.adminUnitsPromise;
  state.adminUnitsPromise = Promise.all([
    fetch("/assets/admin-units-v1.json?v=20260620").then((response) => response.ok ? response.json() : []).catch(() => []),
    fetch("/assets/admin-units-v2.json?v=20260801").then((response) => response.ok ? response.json() : []).catch(() => [])
  ]).then(([legacy, v2]) => {
    state.adminUnits = {
      legacy: Array.isArray(legacy) ? legacy : [],
      v2: Array.isArray(v2) ? v2 : []
    };
    // Neu dang dung o o dia chi khi danh muc vua tai xong thi ve lai goi y ngay.
    const active = document.activeElement;
    if (active?.dataset?.addressInput) renderRemoteAddressSuggestions(active.dataset.addressInput);
    return state.adminUnits;
  });
  return state.adminUnitsPromise;
}

function adminUnitTextKeys(value) {
  const base = normalize(value)
    .replace(/đ/g, "d")
    .replace(/[-–—._/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return [];
  const keys = [base];
  const short = base.replace(/^(tinh|thanh pho|tp|quan|huyen|thi xa|phuong|xa|thi tran|dac khu)\s+/, "");
  if (short && short !== base) keys.push(short);
  keys.slice().forEach((key) => {
    const alias = REMOTE_ADMIN_TEXT_ALIASES[key];
    if (alias && !keys.includes(alias)) keys.push(alias);
  });
  return keys;
}

function findAdminUnit(items, name) {
  const keys = adminUnitTextKeys(name);
  if (!keys.length) return null;
  const list = Array.isArray(items) ? items : [];
  const exact = list.find((item) => adminUnitTextKeys(item.name)[0] === keys[0]);
  if (exact) return exact;
  return list.find((item) => {
    const itemKeys = adminUnitTextKeys(item.name);
    return keys.some((key) => itemKeys.includes(key));
  }) || null;
}

// Datalist goc cua trinh duyet gan nhu khong hien goi y tren dien thoai -> dung
// nut goi y tu ve (cung co che voi o tim san pham, da chay tot tren may anh).
function remoteAddressField(field, placeholder, value) {
  return `
    <div class="remote-address-field">
      <input name="${escapeHTML(field)}" data-address-input="${escapeHTML(field)}" placeholder="${escapeHTML(placeholder)}" value="${escapeHTML(value || "")}" autocomplete="off" required>
      <div class="remote-suggest" data-address-suggest="${escapeHTML(field)}"></div>
    </div>
  `;
}

function remoteAddressOptionValues(field) {
  const draft = remoteOrderDraft();
  const units = state.adminUnits || { legacy: [], v2: [] };
  const twoTier = draft.addressScheme === "two_tier";
  const source = twoTier ? units.v2 : units.legacy;
  if (field === "province") return source.map((item) => item.name);
  const province = findAdminUnit(source, draft.province);
  if (!province) return [];
  if (field === "district") return twoTier ? [] : (province.districts || []).map((item) => item.name);
  if (twoTier) return (province.wards || []).map((item) => item.name);
  const district = findAdminUnit(province.districts, draft.district);
  return district ? (district.wards || []).map((item) => item.name) : [];
}

function renderRemoteAddressSuggestions(field, options = {}) {
  const container = app.querySelector(`[data-address-suggest="${field}"]`);
  if (!container) return;
  if (options.hide) {
    container.innerHTML = "";
    return;
  }
  const draft = remoteOrderDraft();
  const query = normalize(draft[field] || "");
  const values = remoteAddressOptionValues(field);
  const matches = (query
    ? values.filter((name) => normalize(name).includes(query) || adminUnitTextKeys(name).some((key) => key.includes(query)))
    : values).slice(0, 15);
  if (!matches.length) {
    const hint = !state.adminUnits
      ? "Đang tải danh mục địa chỉ..."
      : field === "province" ? "Không thấy tên phù hợp trong danh mục" : "Chọn cấp trên trước";
    container.innerHTML = `<small class="muted">${escapeHTML(hint)}</small>`;
    return;
  }
  container.innerHTML = matches.map((name) =>
    `<button type="button" data-address-pick="${escapeHTML(field)}" data-address-value="${escapeHTML(name)}">${escapeHTML(name)}</button>`
  ).join("");
}

function pickRemoteAddress(field, value) {
  const draft = remoteOrderDraft();
  const form = document.getElementById("remote-order-create-form");
  draft[field] = value;
  if (form?.elements?.[field]) form.elements[field].value = value;
  if (field === "province") {
    draft.district = "";
    draft.ward = "";
    if (form?.elements?.district) form.elements.district.value = "";
    if (form?.elements?.ward) form.elements.ward.value = "";
    renderRemoteAddressSuggestions("district", { hide: true });
    renderRemoteAddressSuggestions("ward", { hide: true });
  }
  if (field === "district") {
    draft.ward = "";
    if (form?.elements?.ward) form.elements.ward.value = "";
    renderRemoteAddressSuggestions("ward", { hide: true });
  }
  renderRemoteAddressSuggestions(field, { hide: true });
  // Mo luon goi y cap tiep theo cho thao tac nhanh.
  const next = field === "province" ? (draft.addressScheme === "two_tier" ? "ward" : "district") : field === "district" ? "ward" : "";
  if (next) {
    form?.elements?.[next]?.focus?.();
    renderRemoteAddressSuggestions(next);
  }
}

// Doi chieu dia chi voi danh muc truoc khi gui; dataset chua tai duoc thi khong chan (server con validate lan nua).
function validateRemoteOrderAddress(draft) {
  if (!String(draft.province || "").trim() || !String(draft.ward || "").trim() || !String(draft.addressDetail || "").trim()) {
    return "Nhập đủ Tỉnh/TP, Xã/Phường và địa chỉ chi tiết.";
  }
  const units = state.adminUnits || {};
  if (draft.addressScheme === "two_tier") {
    if (!Array.isArray(units.v2) || !units.v2.length) return "";
    const province = findAdminUnit(units.v2, draft.province);
    if (!province) return "Chọn Tỉnh/TP (hệ 2 cấp) từ danh sách gợi ý.";
    const ward = findAdminUnit(province.wards, draft.ward);
    if (!ward) return "Chọn Xã/Phường đúng theo Tỉnh/TP đã chọn.";
    draft.province = province.name;
    draft.ward = ward.name;
    draft.district = "";
    return "";
  }
  if (!String(draft.district || "").trim()) return "Nhập Huyện/Quận (hệ 3 cấp cũ).";
  if (!Array.isArray(units.legacy) || !units.legacy.length) return "";
  const province = findAdminUnit(units.legacy, draft.province);
  if (!province) return "Chọn Tỉnh/TP từ danh sách gợi ý.";
  const district = findAdminUnit(province.districts, draft.district);
  if (!district) return "Chọn Huyện/Quận đúng theo Tỉnh/TP đã chọn.";
  const ward = findAdminUnit(district.wards, draft.ward);
  if (!ward) return "Chọn Xã/Phường đúng theo Huyện/Quận đã chọn.";
  draft.province = province.name;
  draft.district = district.name;
  draft.ward = ward.name;
  return "";
}

function renderRemoteOrderItems() {
  const container = document.getElementById("remote-order-items");
  if (!container) return;
  container.innerHTML = remoteOrderDraft().items.map((item, index) => remoteOrderItemRow(index, item)).join("");
  container.querySelectorAll("[data-remove-remote-order-item]").forEach((button) => {
    button.addEventListener("click", () => removeRemoteOrderItem(button));
  });
}

const ORDER_WORKFLOW_TABS = [
  ["workflow_new", "Đơn mới"], ["workflow_stock", "Chờ xác nhận hàng"],
  ["workflow_payment", "Chờ khách CK"], ["workflow_purchase", "Đang mua"],
  ["workflow_delivery", "Chờ giao"], ["workflow_completed", "Hoàn tất"],
  ["workflow_attention", "Cần xử lý"], ["cancelled", "Đã hủy"]
];

function orderWorkflowTabButtons() {
  return ORDER_WORKFLOW_TABS.map(([value, label]) => `<button class="order-status-tab ${state.status === value ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.status === value ? "true" : "false"}" data-order-status-tab="${value}">${label}<span>${state.orders.filter((order) => adminOperationalOrderStatus(order) === value).length}</span></button>`).join("");
}

function ordersView() {
  // Editor chi tiet don full-page (giong orderEditorTemplate cua Sales Desk) thay the danh sach khi dang mo.
  if (state.orderEditorId) {
    const editing = state.orders.find((order) => String(order.id || "") === String(state.orderEditorId));
    if (editing) return orderEditorView(editing);
    state.orderEditorId = null;
    state.orderEditorDraft = null;
  }
  const rows = filteredOrders();
  // Mobile: tab 2x4 + o tim kiem GHIM tren dau, duoi la the don rut gon (ten/ma/san pham).
  if (isMobileLayout()) {
    return `
      <section class="panel orders-panel-mobile">
        <div class="mobile-order-sticky">
          <div class="order-status-tabs order-status-grid" role="tablist" aria-label="Nhóm trạng thái đơn hàng">${orderWorkflowTabButtons()}</div>
          <input id="query-input" value="${escapeHTML(state.query)}" placeholder="Tìm tên khách, SĐT, mã đơn, sản phẩm">
        </div>
        <p><a class="button-link" href="/admin/desk#don-moi">+ Tạo đơn thủ công (màn Sales Desk)</a></p>
        <div class="card-list">${rows.map(orderCard).join("") || `<article class="card">Chưa có đơn hàng.</article>`}</div>
      </section>
    `;
  }
  // Desktop: bang don kieu Sales Desk (man "Landing page > Danh sach don hang").
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Quản lý đơn hàng</h2>
          <p>Xem đơn, đổi trạng thái, cập nhật vận đơn và ghi chú xử lý online.</p>
        </div>
        <div class="action-row">
          <button class="small" type="button" data-select-all-shipping>Chọn tất cả</button>
          <button class="small" type="button" data-export-spx>Xuất Excel SPX</button>
          <span class="pill">${rows.length}/${state.orders.length} đơn</span>
        </div>
      </div>
      <div class="order-status-tabs" role="tablist" aria-label="Nhóm trạng thái đơn hàng">${orderWorkflowTabButtons()}</div>
      ${toolbar("Tìm mã đơn, tên, SĐT, sản phẩm, size", "order")}
      <p><a class="button-link" href="/admin/desk#don-moi">+ Tạo đơn thủ công (màn Sales Desk)</a></p>
      <div class="table-wrap orders-table-wrap">
        <table class="orders-table">
          <thead>
            <tr>
              <th class="col-check"><input type="checkbox" data-toggle-all-orders title="Chọn tất cả đơn"></th>
              <th class="col-code">Mã đơn</th>
              <th class="col-source">Nguồn</th>
              <th class="col-time">Thời gian</th>
              <th class="col-customer">Khách hàng</th>
              <th class="col-products">Sản phẩm / kho mua</th>
              <th class="col-total">Tổng tiền</th>
              <th class="col-status">Trạng thái</th>
              <th class="col-tracking">Vận đơn</th>
              <th class="col-actions"></th>
            </tr>
          </thead>
          <tbody>${rows.map(orderTableRow).join("") || `<tr><td colspan="10" class="orders-table-empty">Chưa có đơn hàng.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function orderSourceLabel(order = {}) {
  const source = String(order.externalSource || "").toLowerCase();
  if (source.includes("remote_order") || String(order.channel || "") === "manual" || String(order.id || "").startsWith("MAN-")) return "Đơn thủ công";
  if (source.includes("toprun")) return "toprun.site";
  return order.externalSource || "toprun.site";
}

function orderTableRow(order) {
  const orderId = String(order.id || "");
  const items = orderItems(order);
  const cancelled = adminOrderIsCancelled(order);
  const expanded = state.orderDisplayLevels[orderId] === "full";
  const paid = adminPaidAmount(order);
  const suggestion = adminWarehouseSuggestion(order);
  const restoreStatus = String(order.statusBeforeQuickUpdate || "pending");
  const trackingCode = String(order.trackingCode || "").trim();
  return `
    <tr class="order-row ${cancelled ? "is-cancelled" : ""}">
      <td class="col-check"><input type="checkbox" data-admin-shipping-order="${escapeHTML(orderId)}"></td>
      <td class="col-code">
        <strong>${escapeHTML(orderId)}</strong>
        ${order.paymentReference ? `<small>CK: ${escapeHTML(order.paymentReference)}</small>` : ""}
        ${Number(order.priceDriftLines || 0) > 0 ? `<span class="pill price-drift-pill">⚠ Giá đổi</span>` : ""}
      </td>
      <td class="col-source">${escapeHTML(orderSourceLabel(order))}</td>
      <td class="col-time">${escapeHTML(formatDateTime(order.createdAt || ""))}</td>
      <td class="col-customer"><strong>${escapeHTML(order.customerName || order.customer?.name || "")}</strong><small>${escapeHTML(order.phone || order.customer?.phone || "")}</small></td>
      <td class="col-products">
        ${items.map((item, lineIndex) => orderTableLine(order, item, lineIndex, cancelled)).join("") || `<small class="muted">Không có dòng hàng.</small>`}
        ${suggestion ? `<p class="warehouse-suggestion ${suggestion.mode}">${escapeHTML(suggestion.label)}</p>` : ""}
        ${Number(order.priceDriftLines || 0) > 0 ? `<p class="price-drift-note">⚠ ${escapeHTML(order.priceDriftLines)} dòng hàng chờ mua bị đổi giá hệ thống sau khi chốt đơn.</p>` : ""}
      </td>
      <td class="col-total">
        <b>${formatMoney(order.total || 0)}</b>
        ${paid > 0 ? `<small class="paid-note">Đã TT ${formatMoney(paid)}</small>` : ""}
        ${cancelled ? "" : quickPaymentCell(order)}
      </td>
      <td class="col-status">
        <span class="pill">${escapeHTML(statusLabel(order.status || ""))}</span>
        ${orderActionsMenu(order)}
      </td>
      <td class="col-tracking">${escapeHTML(trackingCode || (order.fulfillmentStatus ? statusLabel(order.fulfillmentStatus) : "") || "Chưa có")}</td>
      <td class="col-actions">
        <button class="small primary" type="button" data-open-order-editor="${escapeHTML(orderId)}">Sửa đơn</button>
        <button class="small" type="button" data-order-display-id="${escapeHTML(orderId)}" data-order-display-level="${expanded ? "compact" : "full"}">${expanded ? "Đóng" : "Sửa nhanh"}</button>
        ${orderLifecycleButtons(order)}
      </td>
    </tr>
    ${expanded ? `<tr class="order-expand-row"><td colspan="10" class="order-expand-cell">${orderExpandEditor(order)}</td></tr>` : ""}
  `;
}

// O CK ngoai don (nam trong cot Tong tien): CHI CAN dien so tien + Luu, khong chon gi them.
// "Con lai" doc thang remainingAmount server da chuan hoa qua order-money-kit.
function quickPaymentCell(order = {}) {
  const orderId = String(order.id || "");
  const paid = adminPaidAmount(order);
  const remaining = Math.max(0, Number(order.remainingAmount ?? Math.max(0, Number(order.total || 0) - paid)));
  const draft = state.quickPaymentDrafts[orderId];
  const value = draft !== undefined ? draft : (paid > 0 ? paid : "");
  return `
    <div class="quick-payment-cell">
      <div class="quick-payment-inline">
        <input data-quick-payment-amount data-order-id="${escapeHTML(orderId)}" inputmode="numeric" placeholder="Khách đã CK" value="${escapeHTML(value)}" aria-label="Số tiền khách đã thanh toán">
        <button class="small primary" type="button" data-quick-confirm-payment="${escapeHTML(orderId)}">Lưu</button>
      </div>
      <small>${remaining > 0 ? `Còn lại ${formatMoney(remaining)}` : paid > 0 ? "Đã thu đủ" : Number(order.paymentAmount || 0) > 0 ? `Cọc yêu cầu ${formatMoney(order.paymentAmount)}` : ""}</small>
    </div>
  `;
}

// Cot Trang thai chi hien badge hien tai; moi nut thao tac tay gom vao menu bam moi xo
// (anh chot 2026-08-08: trang thai he thong tu nhay, khong bay het nut ra mat ban).
function orderActionsMenu(order = {}) {
  return `
    <details class="order-actions-menu">
      <summary>Thao tác ▾</summary>
      <div class="order-actions-pop">${orderQuickActions(order)}</div>
    </details>
  `;
}

// Cum nut nhanh doi trang thai giong landingOrderQuickActions cua Sales Desk:
// Hoan tac / Xac nhan / San sang giao / Cho ship bat buoc / Da giao ship / Hoan tat / Huy / Copy link theo doi.
function orderQuickActions(order = {}) {
  const orderId = String(order.id || "");
  const cancelled = adminOrderIsCancelled(order);
  const status = String(order.status || "");
  const buttons = [];
  if (cancelled) {
    buttons.push(orderButton(orderId, String(order.statusBeforeQuickUpdate || "pending"), "Khôi phục"));
  } else {
    if (order.statusBeforeQuickUpdate) buttons.push(orderButton(orderId, String(order.statusBeforeQuickUpdate), "Hoàn tác trạng thái"));
    if (!["confirmed_by_customer", "waiting_partner_confirm", "partner_assigned", "purchase_partial", "purchase_complete", "partner_confirmed", "ready_to_ship", "sent_to_sapo", "completed", "cancelled"].includes(status)) {
      buttons.push(orderButton(orderId, "confirmed_by_customer", "Xác nhận"));
    }
    if (adminOrderAllProductsReady(order) && !["ready_to_ship", "sent_to_sapo", "completed", "cancelled"].includes(status)) {
      buttons.push(orderButton(orderId, "ready_to_ship", "Sẵn sàng giao"));
    }
    if (!["ready_to_ship", "sent_to_sapo", "completed", "cancelled"].includes(status)) {
      buttons.push(`<button class="small" type="button" data-force-ready-to-ship="${escapeHTML(orderId)}">Chờ ship bắt buộc</button>`);
    }
    buttons.push(orderButton(orderId, "shipped", "Đã giao ship"));
    if (!["completed", "cancelled"].includes(status)) buttons.push(orderButton(orderId, "completed", "Hoàn tất"));
    buttons.push(orderButton(orderId, "cancelled", "Hủy"));
  }
  buttons.push(`<button class="small" type="button" data-copy-tracking-link="${escapeHTML(orderId)}">Copy link theo dõi</button>`);
  return buttons.join("");
}

// Nut vong doi giong Sales Desk: Xoa (mem) / Khoi phuc / Xoa vinh vien qua /api/admin/orders/delete.
function orderLifecycleButtons(order = {}) {
  const orderId = String(order.id || "");
  const softDeleted = Boolean(order.deletedAt && !order.purgedAt) || String(order.status || "") === "soft_deleted";
  if (softDeleted) {
    return `<button class="small" type="button" data-order-lifecycle="restore" data-order-id="${escapeHTML(orderId)}">Khôi phục đơn</button>
      <button class="small danger" type="button" data-order-lifecycle="purge" data-order-id="${escapeHTML(orderId)}">Xóa vĩnh viễn</button>`;
  }
  return `<button class="small danger" type="button" data-order-lifecycle="soft_delete" data-order-id="${escapeHTML(orderId)}">Xóa</button>`;
}

// Du dieu kien "San sang giao" giong Desk: moi dong da co kho/doi tac va da mua du.
function adminOrderAllProductsReady(order = {}) {
  const items = orderItems(order).filter((item) => item.productCode || item.sku);
  if (!items.length) return false;
  return items.every((item) => {
    const assigned = item.partnerId || item.partnerIds?.length || String(item.warehouseId || "").trim();
    const status = String(item.procurementStatus || "").toLowerCase();
    return assigned && ["purchased", "purchase_complete"].includes(status);
  });
}

function adminOrderTrackingUrl(order = {}) {
  const direct = String(order.publicLookupUrl || order.lookupUrl || "").trim();
  if (direct) return direct;
  const code = String(order.externalId || order.sourceOrderId || order.id || "").trim();
  return code ? `${location.origin}/order-status.html?order=${encodeURIComponent(code)}` : "";
}

// Ma bi mat luu dang chuan hoa (TRAB12CD34EF56); hien lai dang co gach cho khach de doc.
// Don MAN- va don luu tren MySQL chi con hash nen tra ve rong - khi do chi copy duoc link.
function adminOrderLookupSecret(order = {}) {
  const raw = String(order.lookupSecret || order.lookupToken || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^TR[0-9A-F]{12}$/.test(raw)) return "";
  return ["TR", ...(raw.slice(2).match(/.{1,4}/g) || [])].join("-");
}

// Noi dung copy gui khach: link theo doi + ma bi mat de khach tu tra cuu tren order-status.html.
function adminOrderTrackingMessage(order = {}) {
  const url = adminOrderTrackingUrl(order);
  if (!url) return "";
  const secret = adminOrderLookupSecret(order);
  return [
    `Đơn hàng ${String(order.id || "")}`,
    `Link theo dõi: ${url}`,
    secret ? `Mã bí mật: ${secret}` : ""
  ].filter(Boolean).join("\n");
}

function orderTableLine(order, item = {}, lineIndex = 0, cancelled = false) {
  const code = String(item.productCode || item.sku || "").trim();
  const size = String(item.size || "").trim();
  const qty = Number(item.qty || item.quantity || 1);
  const warehouseText = String(item.warehouseName || item.warehouse || "").trim();
  const locked = adminOrderLinePurchaseLocked(item);
  const assigned = Boolean(String(item.warehouseId || "").trim() && (item.partnerId || item.partnerIds?.length));
  const pushed = String(item.procurementStatus || "").toLowerCase() === "purchase_ready";
  const currentWarehouse = String(item.warehouseId || "");
  return `
    <div class="order-line-row">
      <span class="order-line-info"><strong>${escapeHTML(code)}</strong> · size ${escapeHTML(size || "-")} · x${escapeHTML(qty)}${warehouseText ? ` · <em>${escapeHTML(warehouseText)}</em>` : ""}${item.priceChanged ? ` <b class="price-drift-inline">⚠ ${formatMoney(item.snapshotUnitCost || 0)} → ${formatMoney(item.currentUnitCost || 0)}</b>` : ""}</span>
      ${cancelled ? "" : `
      <span class="order-line-picker">
        <select data-purchase-warehouse data-order-id="${escapeHTML(order.id || "")}" data-line-index="${lineIndex}" ${locked ? "disabled" : ""}>${warehouseOptionsForOrder(order, currentWarehouse)}</select>
        <button class="small" type="button" data-select-order-line-warehouse data-order-id="${escapeHTML(order.id || "")}" data-line-index="${lineIndex}" ${locked ? "disabled" : ""}>${assigned ? "Đổi kho" : "Chọn kho"}</button>
        <button class="small primary" type="button" data-push-order-line-purchase data-order-id="${escapeHTML(order.id || "")}" data-line-index="${lineIndex}" ${locked || !assigned ? "disabled" : ""}>${locked ? "Đã phát sinh mua" : pushed ? "Hủy đẩy mua" : "Đẩy mua"}</button>
      </span>`}
    </div>
  `;
}

function orderExpandEditor(order) {
  const orderId = String(order.id || "");
  const cancelled = adminOrderIsCancelled(order);
  const remoteOrder = isRemoteOperationsOrder(order);
  return `
    <div class="order-expand-editor">
      <p class="order-expand-address"><strong>Địa chỉ:</strong> ${escapeHTML(order.address || order.customer?.address || "Chưa có")}</p>
      ${orderEditGrid(order)}
      ${remoteOrder ? `<div class="remote-partner-action"><small>Hệ thống tự xác định đối tác theo kho đã chọn. ${escapeHTML(remoteCommandStatus(orderId))}</small></div>` : ""}
      ${customerContactPanel(order)}
    </div>
  `;
}

// ===== Editor chi tiet don full-page (clone bo cuc orderEditorTemplate cua Sales Desk) =====
// Cot trai: them san pham (tim SKU + san pham ngoai danh muc). Cot phai: khach hang/dia chi,
// bang san pham trong don, thanh toan, giao hang, ghi chu + trang thai + luu.

function openOrderEditor(orderId) {
  // 17/09/2026: chi tiết + sửa đơn dùng màn Sales Desk trên /admin/desk (bản web của OMI) — trình soạn
  // cũ ở đây làm rơi phí ship, chiết khấu, cách giao, nhãn khi lưu.
  if (orderId) { location.href = `/admin/desk#don=${encodeURIComponent(orderId)}`; return; }
  const order = state.orders.find((item) => String(item.id || "") === String(orderId || ""));
  if (!order) return showMessage("Không tìm thấy đơn để mở chi tiết.", true);
  ensureAdminUnitsLoaded();
  const carrier = String(order.carrier || order.shippingProvider || "").trim();
  state.orderEditorId = String(order.id || "");
  state.orderEditorDraft = {
    orderId: String(order.id || ""),
    customerName: order.customerName || order.customer?.name || "",
    phone: order.phone || order.customer?.phone || "",
    addressScheme: String(order.addressScheme || "") === "two_tier" ? "two_tier" : "legacy",
    province: order.province || "",
    district: order.district || "",
    ward: order.ward || "",
    addressDetail: order.addressDetail || "",
    note: order.note || "",
    status: order.status || "pending",
    paymentMethod: order.paymentMethod || "",
    paidAmount: adminPaidAmount(order) > 0 ? String(adminPaidAmount(order)) : "",
    shippingFee: Number(order.shippingFee || 0) > 0 ? String(order.shippingFee) : "",
    deliveryMethod: carrier === "external" ? "external" : carrier ? "carrier" : "later",
    carrier,
    shippingPayer: order.shippingPayer || "",
    trackingCode: order.trackingCode || "",
    fulfillmentStatus: order.fulfillmentStatus || "",
    items: orderItems(order).map((item) => ({ ...item })),
    skuSearch: "",
    manual: { code: "", name: "", size: "", qty: "1", price: "" }
  };
  render();
}

function closeOrderEditor() {
  state.orderEditorId = null;
  state.orderEditorDraft = null;
  render();
}

function orderEditorView(order) {
  const draft = state.orderEditorDraft || {};
  const remote = hasOperationalSnapshot(order);
  const twoTier = draft.addressScheme === "two_tier";
  const totals = orderEditorTotals(draft);
  const lockNote = remote ? "" : `<p class="editor-lock-note">Đơn chưa đồng bộ sang Sales Desk: chỉ sửa được trạng thái, thanh toán, vận đơn và ghi chú.</p>`;
  const disabled = remote ? "" : "disabled";
  return `
    <section class="panel order-editor-panel" id="order-editor-root">
      <div class="panel-head">
        <div>
          <h2>Chi tiết đơn ${escapeHTML(draft.orderId || "")}</h2>
          <p>${escapeHTML(orderSourceLabel(order))} · ${escapeHTML(formatDateTime(order.createdAt || ""))} · ${escapeHTML(remoteCommandStatus(draft.orderId))}</p>
        </div>
        <div class="action-row">
          <button class="small" type="button" data-close-order-editor>← Quay lại danh sách</button>
          <button class="small primary" type="button" data-save-order-editor>Lưu thay đổi</button>
        </div>
      </div>
      ${lockNote}
      <div class="order-editor-shell">
        <aside class="order-editor-aside">
          <div class="editor-block">
            <h3>Thêm sản phẩm</h3>
            <input data-editor-sku placeholder="Tìm mã hoặc tên sản phẩm" value="${escapeHTML(draft.skuSearch || "")}" autocomplete="off" ${disabled}>
            <div class="remote-product-suggest" data-editor-sku-suggest></div>
            <details class="editor-manual-product">
              <summary>Thêm sản phẩm ngoài danh mục</summary>
              <input data-editor-manual-field="code" placeholder="Mã sản phẩm" value="${escapeHTML(draft.manual?.code || "")}" ${disabled}>
              <input data-editor-manual-field="name" placeholder="Tên sản phẩm" value="${escapeHTML(draft.manual?.name || "")}" ${disabled}>
              <div class="form-grid">
                <input data-editor-manual-field="size" placeholder="Size" value="${escapeHTML(draft.manual?.size || "")}" ${disabled}>
                <input data-editor-manual-field="qty" placeholder="SL" inputmode="numeric" value="${escapeHTML(draft.manual?.qty || "1")}" ${disabled}>
                <input data-editor-manual-field="price" placeholder="Giá bán" inputmode="numeric" value="${escapeHTML(draft.manual?.price || "")}" ${disabled}>
              </div>
              <button class="small" type="button" data-add-editor-manual-item ${disabled}>Thêm vào đơn</button>
            </details>
          </div>
          ${customerContactPanel(order)}
        </aside>
        <main class="order-editor-main">
          <div class="editor-block">
            <h3>Khách hàng</h3>
            <div class="form-grid">
              <input data-editor-field="customerName" placeholder="Tên khách" value="${escapeHTML(draft.customerName || "")}" ${disabled}>
              <input data-editor-field="phone" placeholder="Số điện thoại" value="${escapeHTML(draft.phone || "")}" ${disabled}>
            </div>
            <div class="remote-address-scheme">
              <span>Kiểu địa chỉ:</span>
              <label><input type="radio" name="editorAddressScheme" value="legacy" ${!twoTier ? "checked" : ""} ${disabled}> 3 cấp (cũ)</label>
              <label><input type="radio" name="editorAddressScheme" value="two_tier" ${twoTier ? "checked" : ""} ${disabled}> 2 cấp (mới)</label>
            </div>
            <div class="form-grid">
              ${editorAddressField("province", twoTier ? "Tỉnh/TP (34 tỉnh mới)" : "Tỉnh/TP", draft.province, disabled)}
              ${twoTier ? "" : editorAddressField("district", "Huyện/Quận", draft.district, disabled)}
              ${editorAddressField("ward", "Xã/Phường", draft.ward, disabled)}
              <input data-editor-field="addressDetail" placeholder="Số nhà, tên đường..." value="${escapeHTML(draft.addressDetail || "")}" ${disabled}>
            </div>
          </div>
          <div class="editor-block">
            <h3>Sản phẩm trong đơn</h3>
            <div class="table-wrap">
              <table class="orders-table editor-cart-table">
                <thead><tr><th>Sản phẩm</th><th>Size</th><th>Kho mua</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th><th></th></tr></thead>
                <tbody>${(draft.items || []).map((item, index) => orderEditorCartRow(item, index, remote)).join("") || `<tr><td colspan="7" class="orders-table-empty">Chưa có sản phẩm.</td></tr>`}</tbody>
              </table>
            </div>
          </div>
          <div class="editor-block">
            <h3>Thanh toán</h3>
            <div class="form-grid">
              <input data-editor-field="shippingFee" placeholder="Phí ship" inputmode="numeric" value="${escapeHTML(draft.shippingFee || "")}">
              <input data-editor-field="paidAmount" placeholder="Khách đã thanh toán" inputmode="numeric" value="${escapeHTML(draft.paidAmount || "")}">
              <select data-editor-field="paymentMethod">${orderPaymentMethodOptions(draft.paymentMethod)}</select>
            </div>
            <div class="editor-total-summary">
              <span>Tổng tiền sản phẩm: <b>${formatMoney(totals.itemsTotal)}</b></span>
              <span>Phí ship: <b>${formatMoney(totals.shippingFee)}</b></span>
              <span>Khách phải trả: <b>${formatMoney(totals.total)}</b></span>
              <span>Khách đã trả: <b>${formatMoney(totals.paidAmount)}</b></span>
              <span>Còn phải trả: <b>${formatMoney(totals.remaining)}</b></span>
            </div>
          </div>
          <div class="editor-block">
            <h3>Giao hàng</h3>
            <div class="editor-delivery-methods">
              ${[["carrier", "Đẩy qua hãng VC"], ["external", "Ship ngoài (shipper tự do)"], ["pickup", "Nhận tại cửa hàng"], ["later", "Giao hàng sau"]].map(([value, label]) => `
                <label class="editor-delivery-card ${draft.deliveryMethod === value ? "is-active" : ""}"><input type="radio" name="editorDeliveryMethod" value="${value}" ${draft.deliveryMethod === value ? "checked" : ""}> ${label}</label>
              `).join("")}
            </div>
            ${["carrier", "external"].includes(draft.deliveryMethod) ? `
            <div class="form-grid">
              <select data-editor-field="carrier">${adminCarrierOptions(draft.deliveryMethod === "external" ? "external" : draft.carrier)}</select>
              <select data-editor-field="shippingPayer">
                <option value="">Người trả phí ship</option>
                <option value="shop" ${draft.shippingPayer === "shop" ? "selected" : ""}>Shop trả</option>
                <option value="customer" ${draft.shippingPayer === "customer" ? "selected" : ""}>Khách trả</option>
              </select>
              <input data-editor-field="trackingCode" placeholder="Mã vận đơn" value="${escapeHTML(draft.trackingCode || "")}">
              <select data-editor-field="fulfillmentStatus">${adminFulfillmentStatusOptions(draft.fulfillmentStatus)}</select>
            </div>` : ""}
            <p class="muted">Địa chỉ giao: ${escapeHTML(orderEditorFullAddress(draft) || order.address || "Chưa có")}</p>
          </div>
          <div class="editor-block">
            <h3>Ghi chú & trạng thái</h3>
            <div class="form-grid">
              <select data-editor-field="status">${orderStatusOptions(draft.status)}</select>
              <input data-editor-field="note" placeholder="Ghi chú đơn" value="${escapeHTML(draft.note || "")}">
            </div>
            <div class="action-row">
              <button class="small primary" type="button" data-save-order-editor>Lưu thay đổi</button>
              <button class="small" type="button" data-close-order-editor>Hủy</button>
            </div>
          </div>
        </main>
      </div>
    </section>
  `;
}

function orderEditorCartRow(item = {}, index = 0, remote = true) {
  const locked = adminOrderLinePurchaseLocked(item);
  const disabled = !remote || locked ? "disabled" : "";
  const qty = Number(item.quantity || item.qty || 1);
  const price = Number(item.price || 0);
  const warehouseText = String(item.warehouseName || item.warehouse || "").trim();
  return `
    <tr>
      <td><strong>${escapeHTML(item.productCode || item.sku || "")}</strong><small>${escapeHTML(item.productName || "")}</small>${locked ? `<small class="paid-note">Đã phát sinh mua · khóa dòng</small>` : ""}</td>
      <td><input data-editor-item-field="size" data-item-index="${index}" value="${escapeHTML(item.size || "")}" ${disabled}></td>
      <td>${escapeHTML(warehouseText || "Chưa gán")}</td>
      <td><input data-editor-item-field="quantity" data-item-index="${index}" inputmode="numeric" value="${escapeHTML(qty)}" ${disabled}></td>
      <td><input data-editor-item-field="price" data-item-index="${index}" inputmode="numeric" value="${escapeHTML(price)}" ${disabled}></td>
      <td><b>${formatMoney(qty * price)}</b></td>
      <td><button class="small danger" type="button" data-remove-editor-item="${index}" ${disabled}>Xóa</button></td>
    </tr>
  `;
}

function editorAddressField(field, placeholder, value, disabled = "") {
  return `
    <div class="remote-address-field">
      <input data-editor-address="${escapeHTML(field)}" placeholder="${escapeHTML(placeholder)}" value="${escapeHTML(value || "")}" autocomplete="off" ${disabled}>
      <div class="remote-suggest" data-editor-address-suggest="${escapeHTML(field)}"></div>
    </div>
  `;
}

function orderPaymentMethodOptions(current = "") {
  const options = [["", "Phương thức thanh toán"], ["cod", "COD khi nhận hàng"], ["cash", "Tiền mặt"], ["bank_transfer", "Chuyển khoản"], ["card", "Quẹt thẻ"], ["e_wallet", "Ví điện tử"], ["other", "Khác"]];
  return options.map(([value, label]) => `<option value="${value}" ${String(current || "") === value ? "selected" : ""}>${label}</option>`).join("");
}

function adminCarrierOptions(current = "") {
  const options = [["", "Chọn hãng vận chuyển"], ["ghtk", "Giao Hàng Tiết Kiệm"], ["ghn", "Giao Hàng Nhanh"], ["viettel_post", "Viettel Post"], ["spx", "SPX (Shopee Express)"], ["external", "Ship ngoài (shipper tự do)"], ["vnpost", "VNPost"], ["ahamove", "Ahamove"], ["grab", "Grab Express"], ["other", "Hãng khác"]];
  return options.map(([value, label]) => `<option value="${value}" ${String(current || "") === value ? "selected" : ""}>${label}</option>`).join("");
}

function adminFulfillmentStatusOptions(current = "") {
  const options = [["", "Trạng thái giao hàng"], ["draft", "Chưa xử lý"], ["ready_to_ship", "Sẵn sàng giao"], ["requested", "Đã yêu cầu hãng VC"], ["handed_over", "Đã bàn giao ĐVVC"], ["shipping", "Đang giao"], ["delivered", "Đã giao"], ["failed", "Giao thất bại"]];
  return options.map(([value, label]) => `<option value="${value}" ${String(current || "") === value ? "selected" : ""}>${label}</option>`).join("");
}

function orderEditorTotals(draft = {}) {
  const itemsTotal = (Array.isArray(draft.items) ? draft.items : [])
    .reduce((sum, item) => sum + Math.max(0, Number(item.price || 0)) * Math.max(1, Number(item.quantity || item.qty || 1)), 0);
  const shippingFee = Math.max(0, moneyNumber(draft.shippingFee));
  const paidAmount = Math.max(0, moneyNumber(draft.paidAmount));
  const total = itemsTotal + shippingFee;
  return { itemsTotal, shippingFee, paidAmount, total, remaining: Math.max(0, total - paidAmount) };
}

function orderEditorFullAddress(draft = {}) {
  return [draft.addressDetail, draft.ward, draft.addressScheme === "two_tier" ? "" : draft.district, draft.province]
    .map((part) => String(part || "").trim()).filter(Boolean).join(", ");
}

function editorAddressOptionValues(field) {
  const draft = state.orderEditorDraft || {};
  const units = state.adminUnits || { legacy: [], v2: [] };
  const twoTier = draft.addressScheme === "two_tier";
  const source = twoTier ? units.v2 : units.legacy;
  if (field === "province") return source.map((item) => item.name);
  const province = findAdminUnit(source, draft.province);
  if (!province) return [];
  if (field === "district") return twoTier ? [] : (province.districts || []).map((item) => item.name);
  if (twoTier) return (province.wards || []).map((item) => item.name);
  const district = findAdminUnit(province.districts, draft.district);
  return district ? (district.wards || []).map((item) => item.name) : [];
}

function renderEditorAddressSuggestions(field, options = {}) {
  const container = app.querySelector(`[data-editor-address-suggest="${field}"]`);
  if (!container) return;
  if (options.hide) {
    container.innerHTML = "";
    return;
  }
  const draft = state.orderEditorDraft || {};
  const query = normalize(draft[field] || "");
  const values = editorAddressOptionValues(field);
  const matches = (query
    ? values.filter((name) => normalize(name).includes(query) || adminUnitTextKeys(name).some((key) => key.includes(query)))
    : values).slice(0, 15);
  if (!matches.length) {
    const hint = !state.adminUnits
      ? "Đang tải danh mục địa chỉ..."
      : field === "province" ? "Không thấy tên phù hợp trong danh mục" : "Chọn cấp trên trước";
    container.innerHTML = `<small class="muted">${escapeHTML(hint)}</small>`;
    return;
  }
  container.innerHTML = matches.map((name) =>
    `<button type="button" data-editor-address-pick="${escapeHTML(field)}" data-address-value="${escapeHTML(name)}">${escapeHTML(name)}</button>`
  ).join("");
}

function renderEditorSkuSuggestions() {
  const container = app.querySelector("[data-editor-sku-suggest]");
  if (!container) return;
  const draft = state.orderEditorDraft || {};
  container.innerHTML = searchRemoteProducts(draft.skuSearch || "").map((product) => {
    const totalStock = remoteProductSizeOptions(product).reduce((sum, [, stock]) => sum + stock, 0);
    return `<button type="button" data-editor-sku-pick="${escapeHTML(product.code || "")}">
      <strong>${escapeHTML(product.code || "")}</strong> ${escapeHTML(product.name || "")}
      <span>${formatMoney(product.price || product.salePrice || 0)} · còn ${totalStock}</span>
    </button>`;
  }).join("");
}

async function saveOrderEditor(button = null) {
  const draft = state.orderEditorDraft;
  if (!draft) return;
  const order = state.orders.find((item) => String(item.id || "") === String(draft.orderId || ""));
  if (!order) return showMessage("Không tìm thấy đơn để lưu.", true);
  const remote = hasOperationalSnapshot(order);
  const totals = orderEditorTotals(draft);
  if (remote) {
    if (!String(draft.customerName || "").trim() || !String(draft.phone || "").trim()) {
      return showMessage("Điền tên khách và số điện thoại.", true);
    }
    if (!(Array.isArray(draft.items) && draft.items.length)) {
      return showMessage("Đơn phải có ít nhất một sản phẩm.", true);
    }
  }
  if (totals.paidAmount <= 0 && (draft.items || []).some((item) => adminOrderLinePurchaseLocked(item))) {
    return showMessage("Đơn đã phát sinh mua hàng nên không thể hủy xác nhận CK trực tiếp.", true);
  }
  if (draft.status === "cancelled" && !adminOrderIsCancelled(order) && !confirmAdminOrderCancellation(order)) return;
  const twoTier = draft.addressScheme === "two_tier";
  const carrier = draft.deliveryMethod === "external" ? "external" : ["pickup", "later"].includes(draft.deliveryMethod) ? "" : String(draft.carrier || "").trim();
  const paymentStatus = totals.paidAmount >= totals.total && totals.total > 0 ? "paid" : totals.paidAmount > 0 ? "partially_paid" : "unpaid";
  const items = (draft.items || []).map((item) => ({
    ...item,
    size: String(item.size || "").trim(),
    quantity: Math.max(1, Number(item.quantity || item.qty || 1)),
    qty: Math.max(1, Number(item.quantity || item.qty || 1)),
    price: Math.max(0, Number(item.price || 0))
  }));
  const body = remote
    ? {
        orderId: draft.orderId,
        customerName: draft.customerName,
        phone: draft.phone,
        address: orderEditorFullAddress(draft),
        province: draft.province,
        district: twoTier ? "" : draft.district,
        ward: draft.ward,
        addressDetail: draft.addressDetail,
        addressScheme: twoTier ? "two_tier" : "",
        note: draft.note,
        status: draft.status,
        paymentStatus,
        paymentMethod: draft.paymentMethod,
        fulfillmentStatus: draft.fulfillmentStatus,
        carrier,
        shippingProvider: carrier,
        trackingCode: draft.trackingCode,
        shippingPayer: draft.shippingPayer,
        shippingFee: totals.shippingFee,
        paymentAmount: totals.paidAmount,
        items,
        total: totals.total
      }
    : {
        orderId: draft.orderId,
        status: draft.status,
        paymentStatus: totals.paidAmount > 0 ? "payment_confirmed" : order.paymentStatus,
        paymentAmount: totals.paidAmount,
        fulfillmentStatus: draft.fulfillmentStatus || undefined,
        shippingProvider: carrier,
        trackingCode: draft.trackingCode,
        note: draft.note
      };
  const restore = markButtonProcessing(button, "Đang lưu...");
  try {
    await submitOrderUpdate(body);
    closeOrderEditor();
  } finally {
    restore();
  }
}

// Delegation tren goc editor: giu chu dang go trong draft, chi re-render khi thao tac chon/bam.
function bindOrderEditorEvents(root) {
  const draft = state.orderEditorDraft;
  if (!draft) return;
  root.addEventListener("input", (event) => {
    const target = event.target;
    if (target.dataset.editorField !== undefined) {
      draft[target.dataset.editorField] = target.value;
      return;
    }
    if (target.dataset.editorAddress !== undefined) {
      const field = target.dataset.editorAddress;
      draft[field] = target.value;
      if (field === "province") { draft.district = ""; draft.ward = ""; }
      if (field === "district") draft.ward = "";
      renderEditorAddressSuggestions(field);
      return;
    }
    if (target.dataset.editorItemField !== undefined) {
      const item = draft.items[Number(target.dataset.itemIndex)];
      if (!item) return;
      if (target.dataset.editorItemField === "quantity") {
        item.quantity = target.value;
        item.qty = target.value;
      } else item[target.dataset.editorItemField] = target.value;
      return;
    }
    if (target.dataset.editorManualField !== undefined) {
      draft.manual[target.dataset.editorManualField] = target.value;
      return;
    }
    if (target.dataset.editorSku !== undefined) {
      draft.skuSearch = target.value;
      renderEditorSkuSuggestions();
    }
  });
  root.addEventListener("change", (event) => {
    const target = event.target;
    if (target.name === "editorAddressScheme") {
      draft.addressScheme = target.value === "two_tier" ? "two_tier" : "legacy";
      draft.province = "";
      draft.district = "";
      draft.ward = "";
      render();
      return;
    }
    if (target.name === "editorDeliveryMethod") {
      draft.deliveryMethod = target.value;
      if (target.value === "external") draft.carrier = "external";
      render();
      return;
    }
    // Doi so luong/gia/phi ship/da tra: render lai de cap nhat thanh tien + tong ket (change chi ban khi roi o).
    if (["quantity", "price"].includes(target.dataset.editorItemField || "") || ["shippingFee", "paidAmount"].includes(target.dataset.editorField || "")) {
      render();
    }
  });
  root.addEventListener("click", (event) => {
    const addressPick = event.target.closest("[data-editor-address-pick]");
    if (addressPick) {
      event.preventDefault();
      const field = addressPick.dataset.editorAddressPick || "";
      draft[field] = addressPick.dataset.addressValue || "";
      if (field === "province") { draft.district = ""; draft.ward = ""; }
      if (field === "district") draft.ward = "";
      render();
      return;
    }
    const skuPick = event.target.closest("[data-editor-sku-pick]");
    if (skuPick) {
      event.preventDefault();
      const product = adminProductByCode(skuPick.dataset.editorSkuPick || "");
      if (!product) return;
      draft.items.push({
        productCode: String(product.code || ""),
        productName: String(product.name || product.code || ""),
        size: "",
        quantity: 1,
        qty: 1,
        price: Number(product.price || product.salePrice || 0)
      });
      draft.skuSearch = "";
      render();
      return;
    }
    const removeItem = event.target.closest("[data-remove-editor-item]");
    if (removeItem) {
      event.preventDefault();
      const index = Number(removeItem.dataset.removeEditorItem);
      const item = draft.items[index];
      if (item && adminOrderLinePurchaseLocked(item)) return showMessage("Dòng đã phát sinh mua hàng, không thể xóa.", true);
      draft.items.splice(index, 1);
      render();
      return;
    }
    const manualAdd = event.target.closest("[data-add-editor-manual-item]");
    if (manualAdd) {
      event.preventDefault();
      const manual = draft.manual || {};
      if (!String(manual.code || "").trim() && !String(manual.name || "").trim()) {
        return showMessage("Điền mã hoặc tên sản phẩm ngoài danh mục.", true);
      }
      draft.items.push({
        productCode: String(manual.code || manual.name || "").trim(),
        productName: String(manual.name || manual.code || "").trim(),
        size: String(manual.size || "").trim(),
        quantity: Math.max(1, Number(manual.qty || 1)),
        qty: Math.max(1, Number(manual.qty || 1)),
        price: Math.max(0, moneyNumber(manual.price)),
        manualProduct: true
      });
      draft.manual = { code: "", name: "", size: "", qty: "1", price: "" };
      render();
    }
  });
  root.querySelectorAll("[data-editor-address]").forEach((input) => {
    input.addEventListener("focus", () => renderEditorAddressSuggestions(input.dataset.editorAddress || ""));
  });
}

function shippingView() {
  const eligible = operationalOrders().filter(shippingOrderEligible);
  const rows = state.status === "all"
    ? eligible
    : state.status === "shipped"
      ? eligible.filter((order) => shippingOrderStarted(order))
      : eligible.filter((order) => !shippingOrderStarted(order));
  return `
    <section class="panel">
      <div class="panel-head">
        <div><h2>Vận đơn chờ ship</h2><p>Theo dõi đơn đã có hàng, nhập tracking và cập nhật từ xa qua Sales Desk.</p></div>
        <div class="action-row"><button class="small" type="button" data-select-all-shipping>Chọn tất cả</button><button class="small" type="button" data-export-spx>Xuất Excel SPX</button><button class="small primary" type="button" data-mark-selected-shipped>Đánh dấu đã ship</button><span class="pill">Sync ${escapeHTML(formatDateTime(state.operations?.syncedAt || ""))}</span></div>
      </div>
      <div class="toolbar"><select id="status-input"><option value="ready">Chờ ship</option><option value="all" ${state.status === "all" ? "selected" : ""}>Tất cả</option><option value="shipped" ${state.status === "shipped" ? "selected" : ""}>Đã ship/có tracking</option></select></div>
      ${isMobileLayout()
        ? `<div class="card-list">${rows.map(orderCard).join("") || `<article class="card">Chưa có đơn phù hợp.</article>`}</div>`
        : `<div class="table-wrap orders-table-wrap">
        <table class="orders-table">
          <thead>
            <tr>
              <th class="col-check"><input type="checkbox" data-toggle-all-orders title="Chọn tất cả đơn"></th>
              <th class="col-code">Mã đơn</th>
              <th class="col-source">Nguồn</th>
              <th class="col-time">Thời gian</th>
              <th class="col-customer">Khách hàng</th>
              <th class="col-products">Sản phẩm / kho mua</th>
              <th class="col-total">Tổng tiền</th>
              <th class="col-status">Trạng thái</th>
              <th class="col-tracking">Vận đơn</th>
              <th class="col-actions"></th>
            </tr>
          </thead>
          <tbody>${rows.map(orderTableRow).join("") || `<tr><td colspan="10" class="orders-table-empty">Chưa có đơn phù hợp.</td></tr>`}</tbody>
        </table>
      </div>`}
    </section>
  `;
}

// Quy tac "truong chung mot goc" 2026-08-08: server da chuan hoa paidAmount/remainingAmount
// tren MOI don qua order-money-kit (annotateOrderMoneyFields o /api/admin/orders + /api/admin/operations).
// Client CHI DOC field — cam suy dien lai tu paymentStatus o day.
function adminPaidAmount(order = {}) {
  return Math.max(0, Number(order.paidAmount || 0));
}

// Cum o sua don (status/kho/da thanh toan/ship/tracking/ghi chu) dung chung cho the mobile va hang mo rong cua bang.
function orderEditGrid(order) {
  const orderId = String(order.id || "");
  const warehouseSuggestion = adminWarehouseSuggestion(order);
  const selectedWarehouse = order.warehouseId || adminReservedWarehouseForOrder(order)?.id || warehouseSuggestion?.warehouseId || "";
  return `<div class="order-edit-grid"><select data-order-field="status" data-order-id="${escapeHTML(orderId)}">${orderStatusOptions(order.status)}</select><select data-order-field="warehouseId" data-order-id="${escapeHTML(orderId)}">${warehouseOptionsForOrder(order, selectedWarehouse)}</select><input data-order-field="paymentAmount" data-order-id="${escapeHTML(orderId)}" value="${escapeHTML(adminPaidAmount(order) > 0 ? adminPaidAmount(order) : "")}" placeholder="Đã thanh toán" inputmode="numeric"><input data-order-field="shippingProvider" data-order-id="${escapeHTML(orderId)}" value="${escapeHTML(order.shippingProvider || "")}" placeholder="Đơn vị ship"><input data-order-field="trackingCode" data-order-id="${escapeHTML(orderId)}" value="${escapeHTML(order.trackingCode || "")}" placeholder="Mã vận đơn"><input data-order-field="note" data-order-id="${escapeHTML(orderId)}" value="${escapeHTML(order.note || "")}" placeholder="Ghi chú"><button class="small" data-save-order="${escapeHTML(orderId)}">Lưu đơn</button></div>`;
}

function orderCard(order) {
  const items = orderItems(order);
  const orderId = order.id || "";
  const warehouseSuggestion = adminWarehouseSuggestion(order);
  const selectedWarehouse = order.warehouseId || adminReservedWarehouseForOrder(order)?.id || warehouseSuggestion?.warehouseId || "";
  const remoteOrder = isRemoteOperationsOrder(order);
  const level = state.orderDisplayLevels[orderId] || "compact";
  const trackingCode = String(order.trackingCode || "").trim() || "Chưa có vận đơn";
  const cancelled = adminOrderIsCancelled(order);
  const restoreStatus = String(order.statusBeforeQuickUpdate || "pending");
  const customerName = order.customerName || order.customer?.name || "Khách hàng";
  return `
    <article class="card order-card order-card-${escapeHTML(level)}">
      <div class="order-compact-head">
        <div>${state.view === "shipping" ? `<label class="shipping-order-check"><input type="checkbox" data-admin-shipping-order="${escapeHTML(orderId)}"> Chọn</label>` : ""}<strong>${escapeHTML(customerName)}</strong><span class="order-code">${escapeHTML(orderId)}</span>${Number(order.priceDriftLines || 0) > 0 ? `<span class="pill price-drift-pill">⚠ Giá đổi</span>` : ""}</div>
        <b>${formatMoney(order.total || 0)}</b>
        <button class="small" type="button" data-order-display-id="${escapeHTML(orderId)}" data-order-display-level="${level === "compact" ? "quick" : "compact"}">${level === "compact" ? "Mở" : "Thu gọn"}</button>
      </div>
      ${level === "compact" ? `<div class="order-compact-items">${items.slice(0, 3).map((item) => `<span>${escapeHTML(item.productCode || "")} · size ${escapeHTML(item.size || "-")} · x${escapeHTML(item.qty || item.quantity || 1)}</span>`).join("")}${items.length > 3 ? `<small>+${items.length - 3} sản phẩm</small>` : ""}</div>` : ""}
      ${level !== "compact" ? `
        <div class="order-quick-body">
          <div><strong>${escapeHTML(customerName)}</strong><span>${escapeHTML(order.phone || order.customer?.phone || "")}</span><span>${escapeHTML(trackingCode)}</span></div>
          <div class="order-quick-items">${items.slice(0, 2).map((item) => `<span>${escapeHTML(item.productCode || "")} · size ${escapeHTML(item.size || "-")} · x${escapeHTML(item.qty || item.quantity || 1)}${item.priceChanged ? ` <b class="price-drift-inline">⚠ ${formatMoney(item.snapshotUnitCost || 0)} → ${formatMoney(item.currentUnitCost || 0)}</b>` : ""}</span>`).join("")}${items.length > 2 ? `<small>+${items.length - 2} sản phẩm</small>` : ""}</div>
          ${Number(order.priceDriftLines || 0) > 0 ? `<p class="price-drift-note">⚠ ${escapeHTML(order.priceDriftLines)} dòng hàng chờ mua bị đổi giá hệ thống sau khi chốt đơn.</p>` : ""}
          <span class="pill">${escapeHTML(statusLabel(order.status || ""))}</span>
          ${cancelled ? "" : quickPaymentPanel(order)}
          <div class="action-row">${orderActionsMenu(order)}</div>
          <div class="action-row"><button class="small primary" type="button" data-open-order-editor="${escapeHTML(orderId)}">Sửa đơn chi tiết</button>${orderLifecycleButtons(order)}</div>
          ${level === "quick" && !cancelled ? `
            ${warehouseSuggestion ? `<p class="warehouse-suggestion ${warehouseSuggestion.mode}">${escapeHTML(warehouseSuggestion.label)}</p>` : ""}
            ${orderWarehousePanel(order, selectedWarehouse)}
          ` : ""}
          ${remoteOrder ? `<div class="remote-partner-action"><small>Hệ thống tự xác định đối tác theo kho đã chọn. ${escapeHTML(remoteCommandStatus(orderId))}</small></div>` : ""}
          ${customerContactPanel(order)}
          ${level === "quick" ? `<button class="small" type="button" data-order-display-id="${escapeHTML(orderId)}" data-order-display-level="full">Chi tiết</button>` : ""}
        </div>
      ` : ""}
      ${level === "full" ? `<div class="order-full-body"><p>${escapeHTML(order.address || order.customer?.address || "")}</p>${warehouseSuggestion ? `<p class="warehouse-suggestion ${warehouseSuggestion.mode}">${escapeHTML(warehouseSuggestion.label)}</p>` : ""}${orderWarehousePanel(order, selectedWarehouse)}${orderEditGrid(order)}<div class="action-row"><button class="small" type="button" data-order-display-id="${escapeHTML(orderId)}" data-order-display-level="quick">Ẩn bớt</button><button class="small" type="button" data-order-display-id="${escapeHTML(orderId)}" data-order-display-level="compact">Thu gọn hoàn toàn</button></div></div>` : ""}
    </article>
  `;
}

function partnersView() {
  const partners = partnerList();
  const purchases = Array.isArray(state.partners?.purchases) ? state.partners.purchases : [];
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Quản lý đối tác</h2>
          <p>Theo dõi sản phẩm cần mua, phiên mua và công nợ đã đồng bộ từ Sales Desk.</p>
        </div>
        <span class="pill">Sync: ${escapeHTML(formatDateTime(state.partners?.syncedAt || ""))}</span>
      </div>
      <div class="partner-grid">${partners.map(partnerCard).join("") || `<article class="card">Chưa có dữ liệu đối tác.</article>`}</div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Phiên mua gần đây</h2>
          <p>Mỗi phiên chỉ hiện mã phiên; mở chi tiết để xem hàng trong phiên.</p>
        </div>
        <span class="pill">${purchases.length} phiên</span>
      </div>
      <div class="session-list">${purchases.slice(0, 30).map(purchaseRow).join("") || `<p class="muted">Chưa có phiên mua.</p>`}</div>
    </section>
  `;
}

function partnerCard(partner) {
  return `
    <article class="card partner-card">
      <div class="partner-head">
        <div>
          <strong>${escapeHTML(partner.name || partner.id || "")}</strong>
          <span>${escapeHTML(partner.login || "")}</span>
        </div>
        <span class="pill">${escapeHTML(statusLabel(partner.status || "active"))}</span>
      </div>
      <div class="mini-metrics">
        ${mini("Cần mua", partner.missingQty || 0)}
        ${mini("Phiên", partner.purchaseCount || 0)}
        ${mini("Công nợ", formatMoney(partner.debtAmount || 0))}
      </div>
      <details>
        <summary>Sản phẩm cần mua</summary>
        ${(partner.needs || []).slice(0, 20).map((item) => `
          <div class="need-line">
            <span>${escapeHTML(item.productCode || "")} · ${escapeHTML(item.productName || "")} · size ${escapeHTML(item.size || "-")}${item.priceChanged ? `<b class="price-drift-inline">⚠ Giá đổi ${formatMoney(item.unitCost || 0)} → ${formatMoney(item.currentUnitCost || 0)}</b>` : ""}</span>
            <b>Còn ${escapeHTML(item.missingQty || 0)}</b>
          </div>
        `).join("") || `<p class="muted">Không có sản phẩm cần mua.</p>`}
      </details>
      ${partner.portalPath ? `<a class="button-link" href="${escapeHTML(partner.portalPath)}" target="_blank" rel="noreferrer">Mở portal</a>` : ""}
    </article>
  `;
}

function purchaseRow(session) {
  return `
    <details class="session-row">
      <summary>
        <strong>${escapeHTML(session.id || "Phiên mua")}</strong>
        <span>${escapeHTML(partnerName(session.partnerId))}</span>
        <b>${formatMoney(session.totalCost || session.feeAmount || 0)}</b>
      </summary>
      <div class="need-line">
        <span>${escapeHTML(session.productCode || "")} · size ${escapeHTML(session.size || "-")}</span>
        <b>x${escapeHTML(session.quantity || 0)}</b>
      </div>
      ${(session.allocations || []).map((item) => `
        <div class="need-line">
          <span>Đơn ${escapeHTML(item.orderId || "")}</span>
          <b>x${escapeHTML(item.quantity || item.qty || 0)}</b>
        </div>
      `).join("")}
    </details>
  `;
}

function fanpageView() {
  const list = conversations();
  const selected = list.find((item) => item.id === state.selectedConversationId) || list[0] || null;
  if (selected && !state.selectedConversationId) state.selectedConversationId = selected.id;
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Fanpage</h2>
          <p>Đọc tin nhắn đã đồng bộ từ Sales Desk và tạo đơn khi cần.</p>
        </div>
        <span class="pill">${escapeHTML(state.fanpage?.source === "none" ? "Chưa có sync Facebook" : `Sync ${formatDateTime(state.fanpage?.syncedAt || "")}`)}</span>
      </div>
      <div class="fanpage-layout">
        ${isMobileLayout() && state.fanpageMobileDetail && selected ? "" : `
        <div class="conversation-list">
          ${list.map((item) => `
            <button class="${item.id === state.selectedConversationId ? "active" : ""}" data-conversation-id="${escapeHTML(item.id)}">
              <strong>${escapeHTML(item.customerName || "Khách hàng")}</strong>
              <span>${escapeHTML(item.lastMessage || "")}</span>
            </button>
          `).join("") || `<p class="muted">Chưa có hội thoại. Hãy đồng bộ fanpage từ TopRun Sales Desk.</p>`}
        </div>`}
        ${isMobileLayout() && !(state.fanpageMobileDetail && selected) ? "" : `
        <div class="conversation-detail">
          ${isMobileLayout() ? `<button class="small fanpage-back-button" type="button" data-fanpage-back>← Danh sách hội thoại</button>` : ""}
          ${selected ? conversationDetail(selected) : `<p class="muted">Chọn hội thoại để xem chi tiết.</p>`}
        </div>`}
      </div>
      ${productPickerTemplate()}
      ${bubbleSuggestTemplate()}
    </section>
  `;
}

function conversationDetail(item) {
  const messages = Array.isArray(item.messages) ? item.messages : [];
  return `
    <div class="conversation-head">
      <div>
        <strong>${escapeHTML(item.customerName || "Khách hàng")}</strong>
        <span>${escapeHTML(item.pageName || "Fanpage")}</span>
      </div>
      <span>${escapeHTML(formatDateTime(item.updatedAt || ""))}</span>
    </div>
    <div class="message-list">
      ${messages.map((entry) => `
        <div class="chat-bubble ${entry.fromAdmin || entry.direction === "out" ? "out" : "in"}">
          ${escapeHTML(entry.text || entry.message || "")}
        </div>
      `).join("") || `<p class="muted">${escapeHTML(item.lastMessage || "Chưa có nội dung tin nhắn.")}</p>`}
      ${(state.fanpage?.pendingReplies || []).filter((pending) => pending.conversationId === item.id).map((pending) => `
        <div class="chat-bubble out pending">
          ${pending.imageUrl ? `<img class="pending-image" src="${escapeHTML(pending.imageUrl)}" alt="Ảnh gửi khách" loading="lazy">` : ""}
          ${escapeHTML(pending.text || (pending.imageUrl ? "🖼 Ảnh gửi khách" : ""))}
          <span class="pending-tag">${pending.status === "pending" ? "⏳ chờ Sales Desk gửi" : `❌ ${escapeHTML(pending.error || "không gửi được")}`}</span>
        </div>
      `).join("")}
    </div>
    <form class="fanpage-reply-form" data-fanpage-reply="${escapeHTML(item.id)}" data-page-id="${escapeHTML(item.pageId || "")}" data-customer-id="${escapeHTML(item.customerId || "")}">
      <textarea name="replyText" rows="2" ${item.pageId && item.customerId ? "" : "disabled"} placeholder="${item.pageId && item.customerId ? "Nhập tin trả lời khách... (Enter để gửi)" : "Hội thoại chưa đủ thông tin gửi — chờ Sales Desk đồng bộ bản mới."}"></textarea>
      <button type="submit" ${item.pageId && item.customerId ? "" : "disabled"}>Gửi</button>
    </form>
    <p class="muted fanpage-reply-hint">Giữ bong bóng chat ~1 giây để lấy 📞/📍 lưu hồ sơ. Tin gửi qua Sales Desk; hội thoại do Sapo kiểm soát sẽ bị từ chối.</p>
    ${fanpageCartTemplate(item)}
    ${fanpageOrderCkTemplate(item)}
  `;
}

// ===== Fanpage: tra kho (🔍), day san pham vao chat (📤), gio dat ho (🛒), goi y lien he (📞📍) =====
function extractVietnamPhone(text = "") {
  const match = String(text || "").match(/(?:\+?84|0)(?:[\s.\-]?\d){8,10}/);
  return match ? match[0].replace(/[^\d+]/g, "").replace(/^\+?84/, "0") : "";
}

function looksLikeAddress(text = "") {
  const value = String(text || "").trim();
  if (value.length < 10) return false;
  return /(địa\s*chỉ|dia\s*chi|đc|giao\s*hàng|nhận\s*hàng|xóm|thôn|ấp|đường|số\s*nhà|phường|xã|thị\s*trấn|quận|huyện|thị\s*xã|thành\s*phố|tỉnh|tp\.?)/i.test(value);
}

async function ensureCatalogLoaded() {
  if (Array.isArray(state.catalog) || state.catalogLoading) return;
  state.catalogLoading = true;
  refreshPickerResults();
  try {
    const response = await fetch("/api/products", { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => []);
    state.catalog = Array.isArray(payload) ? payload : (Array.isArray(payload?.products) ? payload.products : []);
  } catch {
    state.catalog = [];
  } finally {
    state.catalogLoading = false;
    refreshPickerResults();
  }
}

function catalogMatches() {
  const query = normalize(state.catalogQuery || "");
  const size = String(state.catalogSize || "");
  const list = Array.isArray(state.catalog) ? state.catalog : [];
  const results = [];
  for (const product of list) {
    if (String(product.status || "orderable") !== "orderable") continue;
    const sizes = Array.isArray(product.sizes) ? product.sizes : [];
    const stockTotal = sizes.reduce((sum, entry) => sum + Math.max(0, Number(entry.qty || 0)), 0);
    if (state.catalogOnlyStock && stockTotal <= 0) continue;
    if (size && !sizes.some((entry) => String(entry.size) === size && (!state.catalogOnlyStock || Number(entry.qty || 0) > 0))) continue;
    if (query && !normalize(`${product.name || ""} ${product.code || ""}`).includes(query)) continue;
    results.push(product);
    if (results.length >= 30) break;
  }
  return results;
}

function productPageLink(product = {}) {
  const raw = String(product.productUrl || product.detailUrl || "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const pathPart = raw.startsWith("/") ? raw : `/product/${encodeURIComponent(product.slug || product.code || "")}`;
  return `${location.origin}${pathPart}`;
}

function productChatText(product = {}) {
  const price = Number(product.salePrice || product.price || 0);
  return `${product.name || "Sản phẩm"} (${product.code || ""}) — ${price.toLocaleString("vi-VN")}đ\n${productPageLink(product)}`;
}

function productPickerTemplate() {
  if (!state.productPickerOpen) return "";
  const results = state.catalogLoading || !Array.isArray(state.catalog) ? [] : catalogMatches();
  const sizeOptions = [...new Set(results.flatMap((product) => (product.sizes || []).map((entry) => String(entry.size))))].slice(0, 40);
  return `
    <div class="picker-overlay" data-picker-overlay>
      <div class="picker-panel">
        <div class="picker-head">
          <strong>🔍 Tra kho (${Array.isArray(state.catalog) ? state.catalog.length : "..."} SP)</strong>
          <button type="button" data-picker-close title="Đóng">✖</button>
        </div>
        <div class="picker-filters">
          <input id="picker-query" placeholder="Tên hoặc mã sản phẩm..." value="${escapeHTML(state.catalogQuery)}">
          <select id="picker-size">
            <option value="">Mọi size</option>
            ${sizeOptions.map((size) => `<option value="${escapeHTML(size)}" ${state.catalogSize === size ? "selected" : ""}>${escapeHTML(size)}</option>`).join("")}
          </select>
          <label class="picker-stock"><input type="checkbox" id="picker-stock" ${state.catalogOnlyStock ? "checked" : ""}> Còn hàng</label>
        </div>
        <div class="picker-results" data-picker-results>
          ${pickerResultsTemplate(results)}
        </div>
      </div>
    </div>
  `;
}

function pickerResultsTemplate(results) {
  if (state.catalogLoading || !Array.isArray(state.catalog)) return `<p class="muted">Đang tải kho sản phẩm...</p>`;
  if (!results.length) return `<p class="muted">Không có sản phẩm khớp bộ lọc.</p>`;
  return results.map((product) => {
    const sizes = (product.sizes || []).filter((entry) => !state.catalogOnlyStock || Number(entry.qty || 0) > 0);
    const stockTotal = (product.sizes || []).reduce((sum, entry) => sum + Math.max(0, Number(entry.qty || 0)), 0);
    const price = Number(product.salePrice || product.price || 0);
    return `
      <div class="picker-row" data-picker-code="${escapeHTML(product.code || "")}">
        ${product.thumbnailImage ? `<img src="${escapeHTML(product.thumbnailImage)}" alt="" loading="lazy">` : `<span class="picker-noimg">🏷️</span>`}
        <div class="picker-info">
          <strong>${escapeHTML(product.name || "")}</strong>
          <span>${escapeHTML(product.code || "")} · ${price.toLocaleString("vi-VN")}đ · tồn ${stockTotal}</span>
        </div>
        <select class="picker-size-choice" title="Chọn size">
          ${sizes.map((entry) => `<option value="${escapeHTML(String(entry.size))}" data-price="${Number(entry.salePrice || entry.price || price)}">${escapeHTML(String(entry.size))} (${Number(entry.qty || 0)})</option>`).join("") || `<option value="">-</option>`}
        </select>
        <div class="picker-actions">
          <a href="${escapeHTML(productPageLink(product))}" target="_blank" rel="noreferrer" title="Mở trang sản phẩm">🔗</a>
          <button type="button" data-picker-copy title="Copy link">📋</button>
          <button type="button" data-picker-push title="Đẩy vào hội thoại">📤</button>
          <button type="button" data-picker-add title="Thêm vào giỏ đặt hộ">➕</button>
        </div>
      </div>
    `;
  }).join("");
}

function refreshPickerResults() {
  const container = app.querySelector("[data-picker-results]");
  if (!container) return;
  container.innerHTML = pickerResultsTemplate(state.catalogLoading || !Array.isArray(state.catalog) ? [] : catalogMatches());
  bindPickerRowEvents();
}

function catalogProductByCode(code) {
  return (Array.isArray(state.catalog) ? state.catalog : []).find((product) => String(product.code || "") === String(code || "")) || null;
}

function bindPickerRowEvents() {
  app.querySelectorAll("[data-picker-code]").forEach((row) => {
    const product = catalogProductByCode(row.dataset.pickerCode);
    if (!product) return;
    row.querySelector("[data-picker-copy]")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(productPageLink(product));
        showMessage(`Đã copy link ${product.code}.`);
      } catch {
        showMessage("Trình duyệt chặn copy — bấm 🔗 mở rồi copy trên thanh địa chỉ.", true);
      }
    });
    row.querySelector("[data-picker-push]")?.addEventListener("click", () => {
      const selected = selectedFanpageConversation();
      if (!selected?.pageId || !selected?.customerId) {
        showMessage("Hội thoại chưa đủ thông tin gửi (thiếu pageId/customerId).", true);
        return;
      }
      queueFanpageReply(selected, productChatText(product));
      state.productPickerOpen = false;
      render();
    });
    row.querySelector("[data-picker-add]")?.addEventListener("click", () => {
      const sizeChoice = row.querySelector(".picker-size-choice");
      const size = String(sizeChoice?.value || "");
      const price = Number(sizeChoice?.selectedOptions?.[0]?.dataset.price || product.salePrice || product.price || 0);
      if (!size) {
        showMessage("Sản phẩm này không còn size để chọn.", true);
        return;
      }
      const existing = state.fanpageCart.find((item) => item.code === product.code && item.size === size);
      if (existing) existing.qty += 1;
      else state.fanpageCart.push({ code: product.code, name: product.name || product.code, size, price, qty: 1 });
      showMessage(`Đã thêm ${product.code} size ${size} vào giỏ.`);
      const cartCount = app.querySelector("[data-cart-count]");
      if (cartCount) cartCount.textContent = String(state.fanpageCart.reduce((sum, item) => sum + item.qty, 0));
    });
  });
}

function selectedFanpageConversation() {
  return conversations().find((item) => item.id === state.selectedConversationId) || null;
}

// Gui tin qua duong operation (dung chung cho composer, 📤 san pham, ✉️ xin thong tin, 🧾 hoa don/QR).
// extra.imageUrl: URL https public (anh hoa don / ma QR) — Desk chuyen cho Meta tu tai.
async function queueFanpageReply(conversation, text, extra = {}) {
  const requestId = `fbreply_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const imageUrl = String(extra.imageUrl || "").trim();
  if (state.fanpage) {
    state.fanpage.pendingReplies = [...(state.fanpage.pendingReplies || []), {
      requestId,
      conversationId: conversation.id,
      text,
      imageUrl,
      createdAt: new Date().toISOString(),
      status: "pending",
      error: ""
    }];
  }
  try {
    await api("/api/admin/operations", {
      method: "POST",
      body: {
        type: "fanpage.reply_requested",
        entityId: conversation.id,
        requestId,
        payload: {
          requestId,
          conversationId: conversation.id,
          pageId: conversation.pageId,
          customerId: conversation.customerId,
          text,
          ...(imageUrl ? { imageUrl } : {})
        }
      }
    });
    showMessage("Đã xếp tin vào hàng gửi qua Sales Desk.");
  } catch (error) {
    showMessage(error.message || "Chưa gửi được tin.", true);
  }
  renderFanpagePreservingComposer();
}

// ===== Giu bong bong 0.8s -> goi y SDT/dia chi -> sua -> luu =====
function bubbleSuggestTemplate() {
  const suggest = state.bubbleSuggest;
  if (!suggest) return "";
  return `
    <div class="picker-overlay" data-suggest-overlay>
      <div class="picker-panel suggest-panel">
        <div class="picker-head">
          <strong>📞📍 Lưu thông tin khách</strong>
          <button type="button" data-suggest-close title="Đóng">✖</button>
        </div>
        <p class="muted suggest-source">“${escapeHTML(String(suggest.text || "").slice(0, 160))}”</p>
        <label>📞 Số điện thoại
          <input id="suggest-phone" inputmode="tel" value="${escapeHTML(suggest.phone || "")}" placeholder="Chưa nhận ra SĐT — gõ tay nếu có">
        </label>
        <label>📍 Địa chỉ
          <textarea id="suggest-address" rows="3" placeholder="Chưa nhận ra địa chỉ — gõ tay nếu có">${escapeHTML(suggest.address || "")}</textarea>
        </label>
        <button type="button" class="suggest-save" data-suggest-save>💾 Lưu vào hồ sơ khách</button>
      </div>
    </div>
  `;
}

async function saveBubbleSuggest() {
  const suggest = state.bubbleSuggest;
  const conversation = conversations().find((item) => item.id === suggest?.conversationId);
  if (!suggest || !conversation) return;
  const phone = String(app.querySelector("#suggest-phone")?.value || "").trim();
  const address = String(app.querySelector("#suggest-address")?.value || "").trim();
  if (!phone && !address) {
    showMessage("Chưa có gì để lưu.", true);
    return;
  }
  try {
    await api("/api/admin/fanpage/contact", {
      method: "POST",
      body: { conversationId: conversation.id, phone, address }
    });
    if (phone) conversation.phone = phone;
    if (address) conversation.address = address;
    state.bubbleSuggest = null;
    showMessage("Đã lưu thông tin khách (Sales Desk sẽ nhận khi online).");
    render();
  } catch (error) {
    showMessage(error.message || "Chưa lưu được thông tin khách.", true);
  }
}

function bindBubbleSuggestEvents() {
  let pressTimer = null;
  const clearPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  };
  app.querySelectorAll(".message-list .chat-bubble").forEach((bubble) => {
    const startPress = () => {
      clearPress();
      // 0.8s theo chuan long-press; du cham de khong dinh khi cuon trang.
      pressTimer = setTimeout(() => {
        const text = bubble.textContent.trim();
        state.bubbleSuggest = {
          conversationId: state.selectedConversationId,
          text,
          phone: extractVietnamPhone(text),
          address: looksLikeAddress(text) ? text : ""
        };
        render();
      }, 800);
    };
    bubble.addEventListener("pointerdown", startPress);
    bubble.addEventListener("pointerup", clearPress);
    bubble.addEventListener("pointerleave", clearPress);
    bubble.addEventListener("pointercancel", clearPress);
    bubble.addEventListener("contextmenu", (event) => event.preventDefault());
  });
}

// ===== Gio dat ho (🛒) =====
function fanpageCartTemplate(item) {
  const cart = state.fanpageCart;
  const total = cart.reduce((sum, entry) => sum + entry.price * entry.qty, 0);
  return `
    <div class="fanpage-cart">
      <div class="fanpage-cart-head">
        <h3>🛒 Đặt hàng cho khách <span class="cart-badge" data-cart-count>${cart.reduce((sum, entry) => sum + entry.qty, 0)}</span></h3>
        <div>
          <button type="button" data-open-picker title="Tra kho / thêm sản phẩm">🔍</button>
          <button type="button" data-ask-contact title="Nhắn xin SĐT + địa chỉ">✉️</button>
        </div>
      </div>
      ${cart.length ? `
        <div class="cart-rows">
          ${cart.map((entry, index) => `
            <div class="cart-row">
              <span class="cart-name">${escapeHTML(entry.code)} · size ${escapeHTML(entry.size)}</span>
              <span>${entry.price.toLocaleString("vi-VN")}đ</span>
              <input type="number" min="1" value="${entry.qty}" data-cart-qty="${index}">
              <button type="button" data-cart-remove="${index}" title="Bỏ khỏi giỏ">🗑️</button>
            </div>
          `).join("")}
          <div class="cart-total">Tổng: <strong>${total.toLocaleString("vi-VN")}đ</strong></div>
        </div>
      ` : `<p class="muted">Giỏ trống — bấm 🔍 để chọn sản phẩm từ kho.</p>`}
      <form class="fanpage-order-form" data-fanpage-cart-order="${escapeHTML(item.id)}">
        <div class="form-grid">
          <input name="customerName" placeholder="Tên khách" value="${escapeHTML(item.customerName || "")}" required>
          <input name="phone" placeholder="Số điện thoại" value="${escapeHTML(item.phone || "")}" required>
          <input name="address" placeholder="Địa chỉ" value="${escapeHTML(item.address || "")}" required>
        </div>
        <button type="submit" ${cart.length ? "" : "disabled"}>🛒 Tạo đơn (${cart.length} dòng)</button>
      </form>
    </div>
  `;
}

async function createFanpageCartOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  if (!state.fanpageCart.length) return;
  const body = {
    conversationId: form.dataset.fanpageCartOrder || "",
    customerName: data.customerName,
    phone: data.phone,
    address: data.address,
    items: state.fanpageCart.map((entry) => ({
      productCode: entry.code,
      productName: entry.name,
      size: entry.size,
      price: entry.price,
      qty: Math.max(1, Number(entry.qty || 1))
    }))
  };
  try {
    const result = await api("/api/admin/fanpage/orders", { method: "POST", body });
    state.fanpageCart = [];
    showMessage(result.message || "Đã tạo đơn cho khách.");
    await refreshOrders();
    state.view = "orders";
    render();
  } catch (error) {
    showMessage(error.message || "Chưa tạo được đơn.", true);
  }
}

// ===== Fanpage: khoi "Don hang & chuyen khoan" (🧾) =====
// Khach da chot don (moi trang thai) -> chon so tien CK theo % hoac tu dien -> QR VietQR nhu trang
// thanh toan -> gui hoa don chu / anh don hang / ma QR. Khi gui luon keo don moi nhat (realtime).

function adminContent(key, fallback = "") {
  const value = state.content && typeof state.content === "object" ? state.content[key] : "";
  return String(value || fallback || "");
}

function fanpageCkDepositPercent() {
  const percent = Number(adminContent("momoDepositPercent", "20"));
  return Math.max(1, Math.min(100, percent || 20));
}

function fanpageCkState(item = {}) {
  const key = String(item.id || "");
  if (!state.fanpageCk[key]) {
    state.fanpageCk[key] = { orderId: "", mode: "percent", percent: fanpageCkDepositPercent(), custom: "" };
  }
  return state.fanpageCk[key];
}

function ordersForFanpageConversation(item = {}) {
  return state.orders
    .filter((order) => fanpageConversationForOrder(order)?.id === item.id)
    .sort((left, right) => Date.parse(right.createdAt || right.updatedAt || "") - Date.parse(left.createdAt || left.updatedAt || ""));
}

// Khop cach server lam tron coc: ve hang chuc nghin, toi thieu 10.000d, khong vuot tong don.
function fanpageCkRoundedAmount(total = 0, percent = 20) {
  const orderTotal = Number(total || 0);
  if (orderTotal <= 0) return 0;
  const rounded = Math.max(10000, Math.round(orderTotal * percent / 100 / 10000) * 10000);
  return Math.min(Math.ceil(orderTotal), rounded);
}

function fanpageShipFeeDefault() {
  const fee = Number(adminContent("shippingFeeDefault", "30000"));
  return Number.isFinite(fee) && fee >= 0 ? Math.round(fee) : 30000;
}

// Tien hoa don tinh tu GIA tung san pham + phi ship (don chua co ship thi ap mac dinh 30K cua landing).
// paid CHI DOC field paidAmount server annotate (quy tac money-kit), khong tu suy dien.
function fanpageInvoiceMoney(order = {}) {
  const itemsTotal = orderItems(order).reduce(
    (sum, entry) => sum + Number(entry.price || 0) * Math.max(1, Number(entry.qty || entry.quantity || 1)), 0);
  const shipFee = Number(order.shippingFee || 0) > 0 ? Math.round(Number(order.shippingFee)) : fanpageShipFeeDefault();
  const grandTotal = itemsTotal + shipFee;
  const paid = adminPaidAmount(order);
  return { itemsTotal, shipFee, grandTotal, paid };
}

function fanpageCkAmount(order = {}, ck = {}) {
  if (ck.mode === "custom") return Math.max(0, Math.round(Number(ck.custom || 0)));
  // % tinh tren TONG HOA DON (tien hang + ship) de khach CK du ca phi ship khi chon 100%.
  return fanpageCkRoundedAmount(fanpageInvoiceMoney(order).grandTotal, Math.max(1, Math.min(100, Number(ck.percent || 0) || fanpageCkDepositPercent())));
}

// Cung nguon voi bankQrImageUrl cua trang thanh toan: STK + addInfo = ma CK de doi soat khop.
function fanpageCkQrUrl(order = {}, amount = 0) {
  const bank = adminContent("bankCode");
  const account = adminContent("bankAccountNumber");
  if (!bank || !account) return "";
  const params = new URLSearchParams({
    amount: String(Math.round(Number(amount || 0)) || 0),
    addInfo: String(order.paymentReference || order.id || "").replace(/[^A-Za-z0-9\-]/g, ""),
    accountName: adminContent("bankAccountName", "")
  });
  return `https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(account)}-compact2.png?${params.toString()}`;
}

function fanpageOrderCkTemplate(item) {
  const orders = ordersForFanpageConversation(item);
  const ck = fanpageCkState(item);
  if (orders.length && !orders.some((order) => String(order.id || "") === ck.orderId)) ck.orderId = String(orders[0].id || "");
  const order = orders.find((entry) => String(entry.id || "") === ck.orderId) || null;
  const amount = order ? fanpageCkAmount(order, ck) : 0;
  const qrUrl = order && amount > 0 ? fanpageCkQrUrl(order, amount) : "";
  const money = order ? fanpageInvoiceMoney(order) : { itemsTotal: 0, shipFee: 0, grandTotal: 0, paid: 0 };
  const remainOnDelivery = Math.max(0, money.grandTotal - money.paid - amount);
  const canSend = Boolean(item.pageId && item.customerId && order);
  return `
    <div class="fanpage-cart fanpage-ck" data-fanpage-ck="${escapeHTML(item.id)}">
      <div class="fanpage-cart-head"><strong>🧾 Đơn hàng & chuyển khoản</strong></div>
      ${!orders.length ? `<p class="muted">Chưa thấy đơn nào khớp hội thoại này (khớp theo mã hội thoại, SĐT hoặc tên khách).</p>` : `
        <select data-ck-order>
          ${orders.map((entry) => `<option value="${escapeHTML(String(entry.id || ""))}" ${String(entry.id || "") === ck.orderId ? "selected" : ""}>${escapeHTML(`${entry.id} · ${formatMoney(entry.total || 0)} · ${statusLabel(entry.status || "pending")} · ${formatDateTime(entry.createdAt || "")}`)}</option>`).join("")}
        </select>
        <div class="ck-percent-row">
          ${[20, 50, 100].map((percent) => `<button type="button" class="small ${ck.mode === "percent" && Number(ck.percent) === percent ? "active" : ""}" data-ck-percent="${percent}">${percent}%</button>`).join("")}
          <label>% khác
            <input type="number" min="1" max="100" data-ck-percent-input value="${ck.mode === "percent" ? escapeHTML(String(ck.percent)) : ""}" placeholder="vd 30">
          </label>
          <label>Số tiền tự điền
            <input type="number" min="0" step="1000" data-ck-custom value="${ck.mode === "custom" ? escapeHTML(String(ck.custom)) : ""}" placeholder="vd 150000">
          </label>
        </div>
        <p class="ck-amount-line">Tiền hàng ${escapeHTML(formatMoney(money.itemsTotal))} + Ship ${escapeHTML(formatMoney(money.shipFee))} = <b>${escapeHTML(formatMoney(money.grandTotal))}</b>${money.paid > 0 ? ` · Đã trả ${escapeHTML(formatMoney(money.paid))}` : ""}</p>
        <p class="ck-amount-line">Cần CK: <strong data-ck-amount-label>${escapeHTML(formatMoney(amount))}</strong> · Còn lại khi nhận hàng: <b data-ck-remain-label>${escapeHTML(formatMoney(remainOnDelivery))}</b></p>
        ${qrUrl
          ? `<img class="ck-qr" data-ck-qr src="${escapeHTML(qrUrl)}" alt="QR chuyển khoản" loading="lazy">`
          : `<p class="muted">Chưa cấu hình STK ngân hàng trong nội dung landing — không sinh được QR.</p>`}
        <div class="ck-actions">
          <button type="button" class="small" data-ck-send="invoice" ${canSend ? "" : "disabled"}>📄 Gửi hóa đơn (chữ)</button>
          <button type="button" class="small" data-ck-send="image" ${canSend ? "" : "disabled"}>🖼 Gửi đơn dạng ảnh</button>
          <button type="button" class="small" data-ck-send="qr" ${canSend && qrUrl ? "" : "disabled"}>💳 Gửi mã CK</button>
        </div>
        <p class="muted">Khi bấm gửi, hệ thống kéo dữ liệu đơn mới nhất và lưu số tiền CK vào đơn để nút xác nhận CK trên Telegram khớp số.</p>
      `}
    </div>
  `;
}

// Cap nhat nhanh so tien + QR khi dang go (khong render lai de khong mat caret).
function updateFanpageCkPreview(item) {
  const ck = fanpageCkState(item);
  const order = ordersForFanpageConversation(item).find((entry) => String(entry.id || "") === ck.orderId) || null;
  const amount = order ? fanpageCkAmount(order, ck) : 0;
  const label = app.querySelector("[data-ck-amount-label]");
  if (label) label.textContent = formatMoney(amount);
  const remainLabel = app.querySelector("[data-ck-remain-label]");
  if (remainLabel && order) {
    const money = fanpageInvoiceMoney(order);
    remainLabel.textContent = formatMoney(Math.max(0, money.grandTotal - money.paid - amount));
  }
  const qr = app.querySelector("[data-ck-qr]");
  if (qr && order && amount > 0) qr.src = fanpageCkQrUrl(order, amount);
}

function fanpageInvoiceText(order = {}, amount = 0) {
  const items = orderItems(order);
  const lines = items.map((entry, index) => {
    const qty = Math.max(1, Number(entry.qty || 1));
    return `${index + 1}. ${entry.productName || entry.productCode || "Sản phẩm"}${entry.size ? ` — Size ${entry.size}` : ""} × ${qty} = ${formatMoney(Number(entry.price || 0) * qty)}`;
  });
  const money = fanpageInvoiceMoney(order);
  const remainOnDelivery = Math.max(0, money.grandTotal - money.paid - amount);
  const bankLine = adminContent("bankAccountNumber")
    ? `Ngân hàng: ${adminContent("bankName", adminContent("bankCode"))} — STK ${adminContent("bankAccountNumber")} (${adminContent("bankAccountName")})`
    : "";
  return [
    `🧾 HÓA ĐƠN ${order.id || ""}`,
    ...lines,
    `Tổng tiền hàng: ${formatMoney(money.itemsTotal)}`,
    `Phí vận chuyển: ${formatMoney(money.shipFee)}`,
    `TỔNG HÓA ĐƠN: ${formatMoney(money.grandTotal)}`,
    money.paid > 0 ? `Đã thanh toán: ${formatMoney(money.paid)}` : "",
    `Cần CK thanh toán: ${formatMoney(amount)}`,
    `Còn lại khi nhận hàng: ${formatMoney(remainOnDelivery)}`,
    bankLine,
    `Nội dung CK: ${order.paymentReference || order.id || ""}`,
    "Anh/chị chuyển khoản giúp shop theo đúng nội dung để hệ thống tự đối soát nhé ạ 🙏"
  ].filter(Boolean).join("\n").slice(0, 2000);
}

// Anh dai dien cua san pham trong don (thumbnailImage tu catalog landing, cung origin nen canvas khong bi taint).
function fanpageItemImageUrl(entry = {}) {
  const direct = String(entry.imageUrl || entry.image || "").trim();
  if (direct) return direct;
  const code = String(entry.productCode || entry.code || "").trim().toLowerCase();
  if (!code) return "";
  const product = state.products.find((candidate) => String(candidate.code || "").trim().toLowerCase() === code);
  const image = String(product?.thumbnailImage || product?.highImage || "").trim();
  if (!image) return "";
  return /^https?:/i.test(image) ? image : `/${image.replace(/^\/+/, "")}`;
}

// Tai anh cho canvas: cung origin thi ok, khac origin thi can CORS — loi/qua 4s thi bo qua (ve khung xam).
function loadInvoiceImage(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const image = new Image();
    if (!/^\//.test(url) && !url.startsWith(location.origin)) image.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 4000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); resolve(null); };
    image.src = url;
  });
}

// Ve thumbnail vao o vuong (cover, cat giua) — khong meo anh.
function drawInvoiceThumb(ctx, image, x, y, size) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  if (image && image.width > 0 && image.height > 0) {
    const scale = Math.max(size / image.width, size / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    ctx.drawImage(image, x + (size - drawW) / 2, y + (size - drawH) / 2, drawW, drawH);
  } else {
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "#9ca3af";
    ctx.font = "22px Arial";
    ctx.textAlign = "center";
    ctx.fillText("👟", x + size / 2, y + size / 2 + 8);
    ctx.textAlign = "left";
  }
  ctx.restore();
  ctx.strokeStyle = "#e5e7eb";
  ctx.strokeRect(x, y, size, size);
}

// Ve hoa don thanh anh JPEG (the trang chu den, khong kem chu khi gui) cho khach doc de.
// Co ANH SAN PHAM tung dong (thumbnail catalog) — async vi phai tai anh truoc khi ve.
async function renderFanpageInvoiceImage(order = {}, amount = 0) {
  const items = orderItems(order);
  const images = await Promise.all(items.map((entry) => loadInvoiceImage(fanpageItemImageUrl(entry))));
  const width = 720;
  const margin = 28;
  const rowHeight = 96;
  const thumbSize = 76;
  const money = fanpageInvoiceMoney(order);
  const remainOnDelivery = Math.max(0, money.grandTotal - money.paid - amount);
  const moneyLineCount = 5 + (money.paid > 0 ? 1 : 0);
  const height = 196 + items.length * rowHeight + 42 + moneyLineCount * 40 + 70;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, width, 110);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 30px Arial";
  ctx.fillText("TopRun — toprun.site", margin, 48);
  ctx.font = "18px Arial";
  ctx.fillStyle = "#e5e7eb";
  ctx.fillText(`Đơn hàng ${order.id || ""} · ${formatDateTime(order.createdAt || "")}`, margin, 82);
  let y = 146;
  const customerLine = [order.customerName, order.phone].filter(Boolean).join(" · ");
  if (customerLine) {
    ctx.fillStyle = "#374151";
    ctx.font = "16px Arial";
    ctx.fillText(`Khách: ${customerLine}`.slice(0, 62), margin, y);
  }
  y += 24;
  ctx.strokeStyle = "#e5e7eb";
  ctx.beginPath(); ctx.moveTo(margin, y); ctx.lineTo(width - margin, y); ctx.stroke();
  y += 12;
  const textX = margin + thumbSize + 16;
  items.forEach((entry, index) => {
    const qty = Math.max(1, Number(entry.qty || 1));
    drawInvoiceThumb(ctx, images[index], margin, y + 8, thumbSize);
    ctx.fillStyle = "#111827";
    ctx.font = "bold 18px Arial";
    ctx.fillText(`${index + 1}. ${String(entry.productName || entry.productCode || "Sản phẩm").slice(0, 36)}`, textX, y + 30);
    ctx.font = "16px Arial";
    ctx.fillStyle = "#6b7280";
    ctx.fillText(`${entry.size ? `Size ${entry.size} · ` : ""}SL ${qty} · ${formatMoney(Number(entry.price || 0))}/đôi`, textX, y + 56);
    ctx.textAlign = "right";
    ctx.fillStyle = "#111827";
    ctx.font = "bold 17px Arial";
    ctx.fillText(formatMoney(Number(entry.price || 0) * qty), width - margin, y + 56);
    ctx.textAlign = "left";
    y += rowHeight;
  });
  y += 10;
  ctx.strokeStyle = "#e5e7eb";
  ctx.beginPath(); ctx.moveTo(margin, y); ctx.lineTo(width - margin, y); ctx.stroke();
  y += 32;
  const moneyLine = (label, value, bold = false, color = "#111827") => {
    ctx.font = `${bold ? "bold " : ""}19px Arial`;
    ctx.fillStyle = color;
    ctx.fillText(label, margin, y);
    ctx.textAlign = "right";
    ctx.fillText(value, width - margin, y);
    ctx.textAlign = "left";
    y += 40;
  };
  moneyLine("Tổng tiền hàng", formatMoney(money.itemsTotal));
  moneyLine("Phí vận chuyển", formatMoney(money.shipFee));
  moneyLine("TỔNG HÓA ĐƠN", formatMoney(money.grandTotal), true);
  if (money.paid > 0) moneyLine("Đã thanh toán", formatMoney(money.paid));
  moneyLine("Cần CK thanh toán", formatMoney(amount), true, "#b91c1c");
  moneyLine("Còn lại khi nhận hàng", formatMoney(remainOnDelivery), true);
  if (adminContent("bankAccountNumber")) {
    ctx.font = "16px Arial";
    ctx.fillStyle = "#374151";
    ctx.fillText(`${adminContent("bankName", adminContent("bankCode"))} · ${adminContent("bankAccountNumber")} · ${adminContent("bankAccountName")} · Nội dung CK: ${String(order.paymentReference || order.id || "")}`.slice(0, 76), margin, y);
  }
  return canvas.toDataURL("image/jpeg", 0.92);
}

async function sendFanpageCkAction(item, kind) {
  if (!item.pageId || !item.customerId) {
    showMessage("Hội thoại chưa đủ thông tin gửi.", true);
    return;
  }
  const ck = fanpageCkState(item);
  // "Gui la gui thong tin realtime": keo don moi nhat truoc khi soan noi dung.
  try { await refreshOrders(); } catch {}
  const orders = ordersForFanpageConversation(item);
  const order = orders.find((entry) => String(entry.id || "") === ck.orderId) || orders[0] || null;
  if (!order) {
    showMessage("Không tìm thấy đơn của khách này.", true);
    return;
  }
  const amount = fanpageCkAmount(order, ck);
  if (amount <= 0) {
    showMessage("Số tiền CK chưa hợp lệ.", true);
    return;
  }
  // Luu so tien CK vao don (1 goc) de Telegram/trang thanh toan hien cung con so;
  // don chi co ben Desk (chua ve kho web) thi bao canh bao nhung van gui tin.
  try {
    await api("/api/admin/orders", { method: "POST", body: { orderId: String(order.id || ""), paymentAmount: amount } });
    order.paymentAmount = amount;
  } catch (error) {
    showMessage(`Lưu số tiền CK vào đơn chưa được (${error.message || "lỗi"}) — vẫn gửi tin cho khách.`, true);
  }
  if (kind === "invoice") {
    await queueFanpageReply(item, fanpageInvoiceText(order, amount));
    return;
  }
  if (kind === "qr") {
    const qrUrl = fanpageCkQrUrl(order, amount);
    if (!qrUrl) {
      showMessage("Chưa cấu hình STK ngân hàng nên không có mã QR.", true);
      return;
    }
    await queueFanpageReply(item, "", { imageUrl: qrUrl });
    return;
  }
  if (kind === "image") {
    try {
      showMessage("Đang dựng ảnh đơn hàng...");
      const dataUrl = await renderFanpageInvoiceImage(order, amount);
      const saved = await api("/api/admin/fanpage/media", { method: "POST", body: { imageData: dataUrl } });
      const imageUrl = /^https?:/i.test(String(saved.url || "")) ? String(saved.url) : `${location.origin}${saved.url || ""}`;
      await queueFanpageReply(item, "", { imageUrl });
    } catch (error) {
      showMessage(error.message || "Chưa dựng/gửi được ảnh đơn hàng.", true);
    }
  }
}

function bindFanpageCkEvents() {
  app.querySelector("[data-ck-order]")?.addEventListener("change", (event) => {
    const selected = selectedFanpageConversation();
    if (!selected) return;
    fanpageCkState(selected).orderId = event.target.value;
    renderFanpagePreservingComposer();
  });
  app.querySelectorAll("[data-ck-percent]").forEach((button) => button.addEventListener("click", () => {
    const selected = selectedFanpageConversation();
    if (!selected) return;
    const ck = fanpageCkState(selected);
    ck.mode = "percent";
    ck.percent = Number(button.dataset.ckPercent) || fanpageCkDepositPercent();
    ck.custom = "";
    renderFanpagePreservingComposer();
  }));
  app.querySelector("[data-ck-percent-input]")?.addEventListener("input", (event) => {
    const selected = selectedFanpageConversation();
    if (!selected) return;
    const ck = fanpageCkState(selected);
    ck.mode = "percent";
    ck.percent = Math.max(1, Math.min(100, Number(event.target.value || 0) || fanpageCkDepositPercent()));
    updateFanpageCkPreview(selected);
  });
  app.querySelector("[data-ck-custom]")?.addEventListener("input", (event) => {
    const selected = selectedFanpageConversation();
    if (!selected) return;
    const ck = fanpageCkState(selected);
    ck.mode = "custom";
    ck.custom = event.target.value;
    updateFanpageCkPreview(selected);
  });
  app.querySelectorAll("[data-ck-send]").forEach((button) => button.addEventListener("click", () => {
    const selected = selectedFanpageConversation();
    if (!selected) return;
    sendFanpageCkAction(selected, button.dataset.ckSend);
  }));
}

function bindFanpageSuiteEvents() {
  bindFanpageCkEvents();
  app.querySelectorAll("[data-open-picker]").forEach((button) => button.addEventListener("click", () => {
    state.productPickerOpen = true;
    render();
    ensureCatalogLoaded();
  }));
  app.querySelector("[data-picker-close]")?.addEventListener("click", () => {
    state.productPickerOpen = false;
    render();
  });
  app.querySelector("[data-picker-overlay]")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      state.productPickerOpen = false;
      render();
    }
  });
  const pickerQuery = app.querySelector("#picker-query");
  if (pickerQuery) {
    pickerQuery.addEventListener("input", (event) => {
      state.catalogQuery = event.target.value;
      refreshPickerResults();
    });
  }
  app.querySelector("#picker-size")?.addEventListener("change", (event) => {
    state.catalogSize = event.target.value;
    refreshPickerResults();
  });
  app.querySelector("#picker-stock")?.addEventListener("change", (event) => {
    state.catalogOnlyStock = event.target.checked;
    refreshPickerResults();
  });
  bindPickerRowEvents();
  app.querySelector("[data-suggest-close]")?.addEventListener("click", () => {
    state.bubbleSuggest = null;
    render();
  });
  app.querySelector("[data-suggest-overlay]")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      state.bubbleSuggest = null;
      render();
    }
  });
  app.querySelector("[data-suggest-save]")?.addEventListener("click", saveBubbleSuggest);
  app.querySelector("[data-ask-contact]")?.addEventListener("click", () => {
    const selected = selectedFanpageConversation();
    if (!selected?.pageId || !selected?.customerId) {
      showMessage("Hội thoại chưa đủ thông tin gửi.", true);
      return;
    }
    queueFanpageReply(selected, "Anh/chị cho shop xin SĐT và địa chỉ nhận hàng (kèm xã/phường, tỉnh/thành) để shop lên đơn giúp mình nhé ạ 🙏");
  });
  app.querySelectorAll("[data-cart-qty]").forEach((input) => input.addEventListener("change", (event) => {
    const index = Number(event.target.dataset.cartQty);
    if (state.fanpageCart[index]) state.fanpageCart[index].qty = Math.max(1, Number(event.target.value || 1));
  }));
  app.querySelectorAll("[data-cart-remove]").forEach((button) => button.addEventListener("click", () => {
    state.fanpageCart.splice(Number(button.dataset.cartRemove), 1);
    render();
  }));
  app.querySelectorAll("[data-fanpage-cart-order]").forEach((form) => form.addEventListener("submit", createFanpageCartOrder));
  bindBubbleSuggestEvents();
}

function toolbar(placeholder, kind) {
  return `
    <div class="toolbar">
      <input id="query-input" value="${escapeHTML(state.query)}" placeholder="${escapeHTML(placeholder)}">
      ${kind === "order" ? `
        <select id="status-input">
          <option value="all">Tất cả</option>
          <option value="workflow_new" ${state.status === "workflow_new" ? "selected" : ""}>Đơn mới</option>
          <option value="workflow_stock" ${state.status === "workflow_stock" ? "selected" : ""}>Chờ xác nhận hàng</option>
          <option value="workflow_payment" ${state.status === "workflow_payment" ? "selected" : ""}>Chờ khách CK</option>
          <option value="workflow_purchase" ${state.status === "workflow_purchase" ? "selected" : ""}>Đang mua</option>
          <option value="workflow_delivery" ${state.status === "workflow_delivery" ? "selected" : ""}>Chờ giao</option>
          <option value="workflow_completed" ${state.status === "workflow_completed" ? "selected" : ""}>Hoàn tất</option>
          <option value="workflow_attention" ${state.status === "workflow_attention" ? "selected" : ""}>Cần xử lý</option>
          <option value="active" ${state.status === "active" ? "selected" : ""}>Đang xử lý</option>
          <option value="unassigned" ${state.status === "unassigned" ? "selected" : ""}>Chưa gán kho</option>
          <option value="pending" ${state.status === "pending" ? "selected" : ""}>Mới tạo</option>
          <option value="confirmed_by_customer" ${state.status === "confirmed_by_customer" ? "selected" : ""}>Khách đã xác nhận</option>
          <option value="payment_pending" ${state.status === "payment_pending" ? "selected" : ""}>Chờ CK</option>
          <option value="partner_assigned" ${state.status === "partner_assigned" ? "selected" : ""}>Đã giao đối tác</option>
          <option value="assigned_to_warehouse" ${state.status === "assigned_to_warehouse" ? "selected" : ""}>Đã đẩy kho</option>
          <option value="ready_to_ship" ${state.status === "ready_to_ship" ? "selected" : ""}>Sẵn sàng giao</option>
          <option value="shipped" ${state.status === "shipped" ? "selected" : ""}>Đã ship</option>
          <option value="partner_out_of_stock" ${state.status === "partner_out_of_stock" ? "selected" : ""}>Đối tác hết hàng</option>
          <option value="cancelled" ${state.status === "cancelled" ? "selected" : ""}>Đã hủy</option>
        </select>
      ` : ""}
    </div>
  `;
}

function bindViewEvents() {
  document.querySelector("[data-pay-config-save]")?.addEventListener("click", (event) => saveLandingPaymentConfig(event.currentTarget));
  document.querySelector("[data-pay-config-preview]")?.addEventListener("click", previewPayConfigQr);
  const ctvForm = document.getElementById("ctv-create-form");
  ctvForm?.addEventListener("input", (event) => {
    if (event.target.name in state.ctvDraft) state.ctvDraft[event.target.name] = event.target.value;
  });
  ctvForm?.addEventListener("submit", createCtvAccount);
  document.getElementById("ctv-toggle-password")?.addEventListener("click", toggleCtvInitialPassword);
  document.getElementById("ctv-generate-password")?.addEventListener("click", generateCtvPasswordIntoForm);
  document.getElementById("ctv-copy-login")?.addEventListener("click", copyCtvLoginInfo);
  app.querySelectorAll("[data-ctv-active]").forEach((button) => button.addEventListener("click", () => updateCtvAccount(button.dataset.ctvActive, { active: button.dataset.next === "true" }, button)));
  app.querySelectorAll("[data-ctv-logo]").forEach((button) => button.addEventListener("click", () => updateCtvAccount(button.dataset.ctvLogo, { allowNoLogo: button.dataset.next === "true" }, button)));
  app.querySelectorAll("[data-ctv-device]").forEach((button) => button.addEventListener("click", () => updateCtvDevice(button)));
  app.querySelectorAll("[data-ctv-delete]").forEach((button) => button.addEventListener("click", () => deleteCtvAccount(button)));
  app.querySelectorAll("[data-ctv-open]").forEach((button) => button.addEventListener("click", () => { state.ctvDetailId = button.dataset.ctvOpen || ""; render(); }));
  document.getElementById("ctv-back")?.addEventListener("click", () => { state.ctvDetailId = ""; render(); });
  document.getElementById("ctv-pay-form")?.addEventListener("submit", submitCtvPayment);
  app.querySelector("[data-select-all-shipping]")?.addEventListener("click", () => {
    const inputs = [...app.querySelectorAll("[data-admin-shipping-order]")];
    const shouldCheck = inputs.some((input) => !input.checked);
    inputs.forEach((input) => { input.checked = shouldCheck; });
  });
  app.querySelector("[data-export-spx]")?.addEventListener("click", exportAdminSpxFile);
  app.querySelector("[data-toggle-all-orders]")?.addEventListener("change", (event) => {
    app.querySelectorAll("[data-admin-shipping-order]").forEach((input) => { input.checked = event.target.checked; });
  });
  app.querySelectorAll("[data-order-status-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.status = button.dataset.orderStatusTab || "active";
      render();
    });
  });
  app.querySelectorAll("[data-order-display-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.orderDisplayLevels[button.dataset.orderDisplayId || ""] = button.dataset.orderDisplayLevel || "compact";
      render();
    });
  });
  app.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view || "dashboard"));
  });
  // O tim kiem: debounce 400ms + khong render khi dang go o form khac (Render/Typing Safety).
  document.getElementById("query-input")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    const cursor = event.target.selectionStart || 0;
    clearTimeout(renderPreservingQuery.timer);
    renderPreservingQuery.timer = setTimeout(() => {
      if (adminFormBusy()) {
        clearTimeout(renderPreservingQuery.timer);
        renderPreservingQuery.timer = setTimeout(() => renderPreservingQuery(cursor), 800);
        return;
      }
      renderPreservingQuery(cursor);
    }, 400);
  });
  document.getElementById("status-input")?.addEventListener("change", (event) => {
    state.status = event.target.value || "all";
    render();
  });
  app.querySelectorAll("[data-order-status]").forEach((button) => {
    button.addEventListener("click", () => quickUpdateOrder(button.dataset.orderId, button.dataset.orderStatus, button));
  });
  app.querySelectorAll("[data-quick-payment-amount]").forEach((input) => {
    input.addEventListener("input", () => {
      state.quickPaymentDrafts[input.dataset.orderId || ""] = input.value;
    });
  });
  app.querySelectorAll("[data-quick-confirm-payment]").forEach((button) => {
    button.addEventListener("click", () => quickConfirmPayment(button.dataset.quickConfirmPayment, button));
  });
  app.querySelectorAll("[data-save-order]").forEach((button) => {
    button.addEventListener("click", () => saveOrder(button.dataset.saveOrder, button));
  });
  app.querySelectorAll("[data-open-order-editor]").forEach((button) => {
    button.addEventListener("click", () => openOrderEditor(button.dataset.openOrderEditor));
  });
  app.querySelectorAll("[data-close-order-editor]").forEach((button) => {
    button.addEventListener("click", closeOrderEditor);
  });
  app.querySelectorAll("[data-save-order-editor]").forEach((button) => {
    button.addEventListener("click", () => saveOrderEditor(button));
  });
  app.querySelectorAll("[data-force-ready-to-ship]").forEach((button) => {
    button.addEventListener("click", () => forceOrderReadyToShip(button.dataset.forceReadyToShip, button));
  });
  app.querySelectorAll("[data-copy-tracking-link]").forEach((button) => {
    button.addEventListener("click", () => copyOrderTrackingLink(button.dataset.copyTrackingLink));
  });
  app.querySelectorAll("[data-order-lifecycle]").forEach((button) => {
    button.addEventListener("click", () => adminOrderLifecycle(button.dataset.orderId, button.dataset.orderLifecycle, button));
  });
  app.querySelector("[data-mark-selected-shipped]")?.addEventListener("click", (event) => markSelectedOrdersShipped(event.currentTarget));
  const editorRoot = document.getElementById("order-editor-root");
  if (editorRoot) bindOrderEditorEvents(editorRoot);
  const remoteForm = document.getElementById("remote-order-create-form");
  remoteForm?.addEventListener("submit", createRemoteOrder);
  // Ghi nguoc moi ky tu vao draft de render() khong xoa mat chu dang go.
  const remoteFormFieldSync = (event) => {
    const draft = remoteOrderDraft();
    const field = event.target.name;
    if (!field) return;
    const row = event.target.closest("[data-remote-order-item]");
    if (row && row.parentElement) {
      const index = [...row.parentElement.children].indexOf(row);
      const item = draft.items[index];
      if (!item) return;
      if (field === "search") {
        item.search = event.target.value;
        // Sua lai o tim sau khi da chon -> bo lien ket san pham cu de khong gui nham ma.
        if (item.productCode && !normalize(item.search).includes(normalize(item.productCode))) {
          item.productCode = "";
          item.productName = "";
        }
        renderRemoteProductSuggestions(index);
        return;
      }
      if (field in item) item[field] = event.target.value;
      return;
    }
    if (["customerName", "phone", "province", "district", "ward", "addressDetail", "shippingFee", "paidAmount", "note"].includes(field)) {
      draft[field] = event.target.value;
      // Sua tay cap tren thi cap duoi cu khong con dung nua.
      if (field === "province") {
        draft.district = "";
        draft.ward = "";
        if (remoteForm.elements.district) remoteForm.elements.district.value = "";
        if (remoteForm.elements.ward) remoteForm.elements.ward.value = "";
      }
      if (field === "district") {
        draft.ward = "";
        if (remoteForm.elements.ward) remoteForm.elements.ward.value = "";
      }
      if (["province", "district", "ward"].includes(field)) renderRemoteAddressSuggestions(field);
    }
  };
  remoteForm?.addEventListener("input", remoteFormFieldSync);
  remoteForm?.addEventListener("change", remoteFormFieldSync);
  // Chon san pham / dia chi tu goi y (delegation tren form nen song sot qua re-render).
  remoteForm?.addEventListener("click", (event) => {
    const addressPick = event.target.closest("[data-address-pick]");
    if (addressPick) {
      event.preventDefault();
      pickRemoteAddress(addressPick.dataset.addressPick || "", addressPick.dataset.addressValue || "");
      return;
    }
    const pick = event.target.closest("[data-suggest-pick]");
    if (!pick) return;
    event.preventDefault();
    pickRemoteProduct(Number(pick.dataset.itemIndex), pick.dataset.suggestPick || "");
  });
  // Cham vao o dia chi la hien danh sach goi y ngay (khong cho go).
  remoteForm?.querySelectorAll("[data-address-input]").forEach((input) => {
    input.addEventListener("focus", () => renderRemoteAddressSuggestions(input.dataset.addressInput || ""));
  });
  // Doi he dia chi: xoa gia tri cu + render lai form (nguoi dung vua bam radio, khong dang go).
  remoteForm?.querySelectorAll('input[name="remoteAddressScheme"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const draft = remoteOrderDraft();
      draft.addressScheme = radio.value === "two_tier" ? "two_tier" : "legacy";
      draft.province = "";
      draft.district = "";
      draft.ward = "";
      render();
    });
  });
  if (remoteForm) ensureAdminUnitsLoaded();
  app.querySelector(".remote-order-create")?.addEventListener("toggle", (event) => {
    remoteOrderDraft().open = event.currentTarget.open;
  });
  app.querySelector("[data-add-remote-order-item]")?.addEventListener("click", addRemoteOrderItem);
  app.querySelectorAll("[data-remove-remote-order-item]").forEach((button) => {
    button.addEventListener("click", () => removeRemoteOrderItem(button));
  });
  app.querySelectorAll("[data-assign-remote-partner]").forEach((button) => {
    button.addEventListener("click", () => assignRemotePartner(button.dataset.assignRemotePartner, button));
  });
  app.querySelectorAll("[data-select-order-line-warehouse]").forEach((button) => {
    button.addEventListener("click", () => selectOrderLineWarehouse(button));
  });
  app.querySelectorAll("[data-push-order-line-purchase]").forEach((button) => {
    button.addEventListener("click", () => pushOrderLinePurchase(button));
  });
  app.querySelectorAll("[data-copy-customer-message]").forEach((button) => {
    button.addEventListener("click", () => copyCustomerPaymentMessage(button.dataset.orderId));
  });
  app.querySelectorAll("[data-open-fanpage-conversation]").forEach((button) => {
    button.addEventListener("click", () => openOrderFanpageConversation(button.dataset.conversationId));
  });
  app.querySelectorAll("[data-save-product]").forEach((button) => {
    button.addEventListener("click", () => saveProduct(button.dataset.saveProduct));
  });
  app.querySelectorAll("[data-conversation-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedConversationId = button.dataset.conversationId || "";
      // Mobile: bam hoi thoai la chuyen han sang khung chat (danh sach dai che mat o tra loi).
      state.fanpageMobileDetail = true;
      render();
    });
  });
  app.querySelector("[data-fanpage-back]")?.addEventListener("click", () => {
    state.fanpageMobileDetail = false;
    render();
  });
  app.querySelectorAll("[data-fanpage-order]").forEach((form) => {
    form.addEventListener("submit", createFanpageOrder);
  });
  app.querySelectorAll("[data-fanpage-reply]").forEach((form) => {
    form.addEventListener("submit", sendFanpageReply);
    form.querySelector("textarea[name='replyText']")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      form.requestSubmit();
    });
  });
  if (state.view === "fanpage") bindFanpageSuiteEvents();
}

async function createCtvAccount(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    if (!state.ctvDraft.phone.trim() && !state.ctvDraft.email.trim()) throw new Error("Hãy nhập số điện thoại hoặc email để CTV đăng nhập.");
    const created = await api("/api/admin/ctv", { method: "POST", body: state.ctvDraft });
    state.ctvDraft = { phone: "", email: "", password: "" };
    // Báo Sales Desk tạo affiliate gốc (fire-and-forget): Desk sync ngược affiliateId,
    // landing adopt theo mã ref nên không nhân đôi tài khoản.
    const account = created?.data;
    if (account?.code) {
      submitRemoteOperation("ctv_account.create_requested", `ctv-create-${account.id}`, {
        requestId: `ctvcreate_${account.id}`,
        name: account.name || "",
        phone: account.phone || "",
        email: account.email || "",
        username: account.username || "",
        code: account.code || "",
        site: "toprun"
      }).catch(() => null);
    }
    await reloadCtv();
    showMessage("Da tao tai khoan CTV. CTV co the doi lai mat khau qua email.");
  } catch (error) {
    showMessage(error.message || "Khong tao duoc tai khoan CTV.", true);
  } finally {
    button.disabled = false;
  }
}

function toggleCtvInitialPassword() {
  const input = document.getElementById("ctv-initial-password");
  const button = document.getElementById("ctv-toggle-password");
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
  if (button) button.textContent = input.type === "password" ? "Hiện" : "Ẩn";
}

function generateCtvPasswordIntoForm() {
  const input = document.getElementById("ctv-initial-password");
  if (!input) return;
  const password = generateCtvInitialPassword();
  input.value = password;
  input.type = "text";
  state.ctvDraft.password = password;
  const button = document.getElementById("ctv-toggle-password");
  if (button) button.textContent = "Ẩn";
}

async function copyCtvLoginInfo() {
  const login = String(state.ctvDraft.phone || state.ctvDraft.email || "").trim();
  const password = String(document.getElementById("ctv-initial-password")?.value || "");
  if (!login || !password) return showMessage("Hãy nhập số điện thoại/email và mật khẩu trước khi copy.", true);
  const text = ["THÔNG TIN ĐĂNG NHẬP CTV TOPRUN", "", "Địa chỉ: https://toprun.site/ctv-login", `Tên đăng nhập: ${login}`, `Mật khẩu ban đầu: ${password}`, "", "Sau khi đăng nhập, hãy xem mục Hướng dẫn sử dụng trong trang CTV."].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    showMessage("Đã copy thông tin đăng nhập CTV TopRun.");
  } catch {
    window.prompt("Copy thông tin đăng nhập CTV:", text);
  }
}

function generateCtvInitialPassword(length = 14) {
  const groups = ["abcdefghjkmnpqrstuvwxyz", "ABCDEFGHJKMNPQRSTUVWXYZ", "23456789", "@#%+-_"];
  const all = groups.join("");
  const values = new Uint32Array(length);
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(values);
  else values.forEach((_, index) => { values[index] = Math.floor(Math.random() * 0xFFFFFFFF); });
  const chars = groups.map((group, index) => group[values[index] % group.length]);
  for (let index = chars.length; index < length; index += 1) chars.push(all[values[index] % all.length]);
  for (let index = chars.length - 1; index > 0; index -= 1) { const target = values[index] % (index + 1); [chars[index], chars[target]] = [chars[target], chars[index]]; }
  return chars.join("");
}

async function updateCtvDevice(button) {
  button.disabled = true;
  try { await api("/api/admin/ctv/device", { method: "POST", body: { accountId: button.dataset.account, deviceId: button.dataset.ctvDevice, action: button.dataset.action } }); await reloadCtv(); showMessage("Đã cập nhật quyền thiết bị CTV."); }
  catch (error) { showMessage(error.message || "Không cập nhật được thiết bị CTV.", true); }
  finally { button.disabled = false; }
}

async function updateCtvAccount(id, fields, button) {
  button.disabled = true;
  try {
    await api("/api/admin/ctv/update", { method: "POST", body: { id, ...fields } });
    await reloadCtv();
  } catch (error) {
    showMessage(error.message || "Khong cap nhat duoc CTV.", true);
  } finally {
    button.disabled = false;
  }
}

async function deleteCtvAccount(button) {
  const name = button.dataset.name || button.dataset.ctvDelete;
  if (!window.confirm(`Xóa hẳn tài khoản CTV "${name}"? CTV sẽ bị đăng xuất và không đăng nhập lại được.`)) return;
  button.disabled = true;
  try {
    await api("/api/admin/ctv/delete", { method: "POST", body: { id: button.dataset.ctvDelete } });
    await reloadCtv();
    showMessage("Đã xóa tài khoản CTV.");
  } catch (error) {
    showMessage(error.message || "Không xóa được tài khoản CTV.", true);
  } finally {
    button.disabled = false;
  }
}

async function reloadCtv() {
  const result = await api("/api/admin/ctv");
  state.ctv = result?.data || { accounts: [], logs: [] };
  const commissions = await api("/api/admin/ctv/commissions", { silent: true }).catch(() => null);
  if (commissions?.data) state.ctvCommissions = commissions.data;
  render();
}

async function exportAdminSpxFile() {
  const selectedIds = [...app.querySelectorAll("[data-admin-shipping-order]:checked")].map((input) => input.dataset.adminShippingOrder);
  if (!selectedIds.length) {
    showMessage("Hãy chọn ít nhất một đơn để xuất Excel SPX.", true);
    return;
  }
  const orders = state.orders.filter((order) => selectedIds.includes(String(order.id || "")));
  try {
    const response = await fetch("/api/admin/shipping/export-spx", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || "Không xuất được Excel SPX.");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const fileName = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] || "") || "SPX_toprun_admin.xlsx";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showMessage(`Đã xuất ${orders.length} đơn sang Excel SPX.`);
  } catch (error) {
    showMessage(error.message || "Không xuất được Excel SPX.", true);
  }
}

function adminFormBusy() {
  const active = document.activeElement;
  if (!active || active.id === "query-input") return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
}

function renderPreservingQuery(cursor = 0) {
  // Chi tra focus ve o tim kiem neu no DANG duoc focus - khong cuop focus tu o khac.
  const wasFocused = Boolean(document.activeElement && document.activeElement.id === "query-input");
  render();
  if (!wasFocused) return;
  const input = document.getElementById("query-input");
  if (!input) return;
  input.focus({ preventScroll: true });
  if (typeof input.setSelectionRange === "function") input.setSelectionRange(cursor, cursor);
}

async function quickUpdateOrder(orderId, status, button = null) {
  if (status === "cancelled") {
    const order = state.orders.find((item) => String(item.id || "") === String(orderId || ""));
    if (!confirmAdminOrderCancellation(order)) return;
  }
  const body = { orderId, status };
  if (status === "payment_confirmed") body.paymentStatus = "payment_confirmed";
  if (status === "assigned_to_warehouse") {
    body.fulfillmentStatus = "assigned_to_warehouse";
    const order = state.orders.find((item) => item.id === orderId);
    const selectedWarehouse = readOrderField(orderId, "warehouseId");
    const suggestion = adminWarehouseSuggestion(order);
    if (suggestion?.mode === "single") {
      body.warehouseId = suggestion.warehouseId || "";
      body.warehouseName = suggestion.warehouseName || "";
      body.statusNote = `Gợi ý kho: ${suggestion.warehouseName || suggestion.warehouseId}`;
    }
    if (selectedWarehouse) {
      const warehouse = adminWarehouseChoiceById(order, selectedWarehouse);
      body.warehouseId = warehouse?.id || selectedWarehouse;
      body.statusNote = `Day ve kho: ${warehouse?.name || selectedWarehouse}`;
    }
  }
  if (status === "shipped") body.fulfillmentStatus = "shipped";
  if (status === "ready_to_ship") body.fulfillmentStatus = "ready_to_ship";
  if (status === "completed") body.fulfillmentStatus = "completed";
  const restore = markButtonProcessing(button, "Đang cập nhật...");
  try {
    await submitOrderUpdate(body);
  } finally {
    restore();
  }
}

// "Cho ship bat buoc" giong force-ready-to-ship cua Desk: ep don sang cho giao du chua mua du.
async function forceOrderReadyToShip(orderId, button = null) {
  const order = state.orders.find((item) => String(item.id || "") === String(orderId || ""));
  if (!order) return;
  if (!confirm(`Đơn ${orderId} chưa đủ điều kiện giao (chưa mua đủ/chưa gán kho).\nVẫn ép chuyển sang "Sẵn sàng giao" để lên vận đơn?`)) return;
  const restore = markButtonProcessing(button, "Đang cập nhật...");
  try {
    await submitOrderUpdate({ orderId, status: "ready_to_ship", fulfillmentStatus: "ready_to_ship", statusNote: "Chờ ship bắt buộc từ Admin online" });
  } finally {
    restore();
  }
}

async function copyOrderTrackingLink(orderId) {
  const order = state.orders.find((item) => String(item.id || "") === String(orderId || ""));
  const copyText = adminOrderTrackingMessage(order || {});
  if (!copyText) return showMessage("Đơn chưa có link theo dõi.", true);
  const secret = adminOrderLookupSecret(order || {});
  const doneMessage = secret
    ? "Đã copy link theo dõi + mã bí mật cho khách."
    : "Đã copy link theo dõi đơn cho khách (đơn này không còn mã bí mật dạng chữ).";
  try {
    await navigator.clipboard.writeText(copyText);
    showMessage(doneMessage);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = copyText;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showMessage(doneMessage);
  }
}

// Xoa mem / khoi phuc / xoa vinh vien giong Sales Desk (endpoint co san /api/admin/orders/delete).
async function adminOrderLifecycle(orderId, operation, button = null) {
  const labels = { soft_delete: "Xóa đơn (có thể khôi phục)", restore: "Khôi phục đơn", purge: "XÓA VĨNH VIỄN đơn (không thể hoàn tác)" };
  if (operation !== "restore" && !confirm(`${labels[operation] || operation} ${orderId}?`)) return;
  const restore = markButtonProcessing(button, "Đang xử lý...");
  try {
    const result = await api("/api/admin/orders/delete", { method: "POST", body: { orderId, operation } });
    showMessage(result.message || (operation === "restore" ? "Đã khôi phục đơn." : operation === "purge" ? "Đã xóa vĩnh viễn đơn." : "Đã xóa đơn (có thể khôi phục trong tab Đã hủy)."));
    await refreshOrders();
  } catch (error) {
    showMessage(error.message || "Không thực hiện được thao tác xóa/khôi phục.", true);
  } finally {
    restore();
  }
}

// Danh dau da ship hang loat cho cac don da tick (tuong duong mark-shipping-orders-shipped cua Desk).
async function markSelectedOrdersShipped(button = null) {
  const ids = [...app.querySelectorAll("[data-admin-shipping-order]:checked")].map((input) => input.dataset.adminShippingOrder).filter(Boolean);
  if (!ids.length) return showMessage("Tick chọn đơn cần đánh dấu đã ship trước.", true);
  if (!confirm(`Đánh dấu ${ids.length} đơn đã bàn giao cho đơn vị vận chuyển?`)) return;
  const restore = markButtonProcessing(button, "Đang cập nhật...");
  let ok = 0;
  const failed = [];
  try {
    for (const orderId of ids) {
      try {
        const order = state.orders.find((item) => String(item.id || "") === String(orderId));
        const body = { orderId, status: "shipped", fulfillmentStatus: "shipped" };
        if (hasOperationalSnapshot(order)) {
          await submitRemoteOperation("admin_order.update_requested", orderId, {
            ...body,
            baseUpdatedAt: order.updatedAt || "",
            baseVersion: Number(order.canonicalVersion ?? order.onlineOrderVersion ?? 0)
          });
        } else {
          await api("/api/admin/orders", { method: "POST", body });
        }
        ok += 1;
      } catch (error) {
        failed.push(`${orderId}: ${error.message || "lỗi"}`);
      }
    }
    showMessage(`Đã gửi đánh dấu ship ${ok}/${ids.length} đơn.${failed.length ? ` Lỗi: ${failed.join("; ")}` : ""}`, failed.length > 0);
    await refreshOrders();
  } finally {
    restore();
  }
}

function confirmAdminOrderCancellation(order = {}) {
  const orderId = String(order.id || "");
  const paidAmount = adminPaidAmount(order);
  const warning = [
    `Hủy đơn ${orderId}?`,
    paidAmount > 0 ? `Khách đã thanh toán ${formatMoney(paidAmount)}.` : "",
    "Đơn đã mua hàng vẫn được phép hủy, nhưng lịch sử mua và thanh toán sẽ được giữ lại."
  ].filter(Boolean).join("\n");
  return confirm(`${warning}\n\nBạn có chắc chắn muốn hủy đơn này không?`);
}

async function saveOrder(orderId, button = null) {
  const read = (field) => readOrderField(orderId, field);
  const status = read("status");
  if (status === "cancelled") {
    const order = state.orders.find((item) => String(item.id || "") === String(orderId || ""));
    if (!adminOrderIsCancelled(order) && !confirmAdminOrderCancellation(order)) return;
  }
  const warehouseId = read("warehouseId");
  const warehouse = adminWarehouseChoiceById(state.orders.find((item) => item.id === orderId), warehouseId);
  const paymentAmount = moneyNumber(read("paymentAmount"));
  const body = {
    orderId,
    status,
    warehouseId,
    shippingProvider: read("shippingProvider"),
    trackingCode: read("trackingCode"),
    note: read("note"),
    paymentAmount
  };
  body.paymentStatus = paymentAmount > 0 ? "payment_confirmed" : "payment_pending";
  if (warehouseId) body.statusNote = `Chon kho xu ly: ${warehouse?.name || warehouseId}`;
  if (status === "assigned_to_warehouse") body.fulfillmentStatus = "assigned_to_warehouse";
  if (status === "shipped") body.fulfillmentStatus = "shipped";
  if (status === "completed") body.fulfillmentStatus = "completed";
  const restore = markButtonProcessing(button, "Đang lưu...");
  try {
    await submitOrderUpdate(body);
  } finally {
    restore();
  }
}

function markButtonProcessing(button, label = "Đang xử lý...") {
  if (!button) return () => {};
  const original = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = label;
  return () => {
    if (!button.isConnected) return;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = original;
  };
}

function readOrderField(orderId, field) {
  return app.querySelector(`[data-order-field="${field}"][data-order-id="${CSS.escape(orderId)}"]`)?.value || "";
}

async function copyCustomerPaymentMessage(orderId) {
  const order = state.orders.find((item) => String(item.id || "") === String(orderId || ""));
  if (!order) {
    showMessage("Khong tim thay don de copy tin nhan.", true);
    return;
  }
  const text = customerPaymentMessage(order);
  try {
    await navigator.clipboard.writeText(text);
    showMessage("Da copy tin nhan chuyen khoan cho khach.");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showMessage("Da copy tin nhan chuyen khoan cho khach.");
  }
}

function openOrderFanpageConversation(conversationId = "") {
  if (!conversationId) return;
  state.view = "fanpage";
  state.selectedConversationId = conversationId;
  state.fanpageMobileDetail = true;
  render();
}

async function submitOrderUpdate(body) {
  try {
    const order = state.orders.find((item) => String(item.id || "") === String(body.orderId || ""));
    const result = hasOperationalSnapshot(order)
      ? await submitRemoteOperation("admin_order.update_requested", body.orderId, {
          ...body,
          paidAmount: body.paymentAmount,
          baseUpdatedAt: order.updatedAt || "",
          baseVersion: Number(order.canonicalVersion ?? order.onlineOrderVersion ?? 0)
        })
      : await api("/api/admin/orders", { method: "POST", body });
    // Lenh sang Sales Desk chi moi vao hang doi — dung bao "da cap nhat" khi chua ap dung.
    showMessage(result.message || (hasOperationalSnapshot(order)
      ? "Đã gửi sang Sales Desk, chờ áp dụng (xem trạng thái lệnh trên thẻ đơn)."
      : "Đã cập nhật đơn hàng."));
    await refreshOrders();
  } catch (error) {
    showMessage(error.message || "Chưa cập nhật được đơn hàng.", true);
  }
}

async function refreshOrders() {
  const [payload, operations] = await Promise.all([api("/api/admin/orders"), api("/api/admin/operations")]);
  state.webOrders = Array.isArray(payload.data) ? payload.data : [];
  state.operations = operations?.data || null;
  state.orders = combinedAdminOrders(state.webOrders, state.operations?.orders);
  render();
}

async function createRemoteOrder(event) {
  event.preventDefault();
  const draft = remoteOrderDraft();
  const items = draft.items.map((item) => {
    // Chua bam goi y nhung go dung ma san pham thi van nhan (khop chinh xac theo ma).
    const product = adminProductByCode(item.productCode) || adminProductByCode(item.search);
    const productCode = String(item.productCode || product?.code || "").trim();
    return {
      productCode,
      productName: String(item.productName || product?.name || productCode).trim(),
      size: String(item.size || "").trim(),
      price: moneyNumber(item.price),
      quantity: Math.max(1, Number(item.qty || 1))
    };
  }).filter((item) => item.productCode && item.size);
  if (!items.length) return showMessage("Cần ít nhất một sản phẩm hợp lệ: chọn từ gợi ý và chọn size.", true);
  if (items.some((item) => !(item.price > 0))) return showMessage("Sản phẩm cần có giá bán lớn hơn 0.", true);
  const addressError = validateRemoteOrderAddress(draft);
  if (addressError) return showMessage(addressError, true);
  const twoTier = draft.addressScheme === "two_tier";
  const shippingFee = moneyNumber(draft.shippingFee);
  const paidAmount = moneyNumber(draft.paidAmount);
  const address = [draft.addressDetail, draft.ward, twoTier ? "" : draft.district, draft.province].filter(Boolean).join(", ");
  const requestId = `remote_${Date.now()}`;
  try {
    await api("/api/admin/operations", {
      method: "POST",
      body: {
        type: "admin_order.create_requested",
        requestId,
        entityId: requestId,
        payload: {
          requestId,
          customerName: draft.customerName,
          phone: draft.phone,
          address,
          province: draft.province,
          district: twoTier ? "" : draft.district,
          ward: draft.ward,
          addressDetail: draft.addressDetail,
          addressScheme: twoTier ? "two_tier" : "",
          note: draft.note || "",
          shippingFee,
          paidAmount,
          paymentAmount: paidAmount,
          paymentStatus: paidAmount > 0 ? "payment_confirmed" : "unpaid",
          items,
          total: items.reduce((sum, item) => sum + item.price * item.quantity, 0) + shippingFee
        }
      }
    });
    showMessage("Đã gửi yêu cầu tạo đơn. Đơn sẽ xuất hiện sau khi Sales Desk đồng bộ.");
    resetRemoteOrderDraft(true);
    await refreshOrders();
  } catch (error) {
    showMessage(error.message || "Chưa gửi được yêu cầu tạo đơn.", true);
  }
}

function addRemoteOrderItem() {
  remoteOrderDraft().items.push(emptyRemoteOrderItem());
  renderRemoteOrderItems();
}

function removeRemoteOrderItem(button) {
  const draft = remoteOrderDraft();
  if (draft.items.length <= 1) return showMessage("Đơn cần ít nhất một sản phẩm.", true);
  const row = button.closest("[data-remote-order-item]");
  const index = row && row.parentElement ? [...row.parentElement.children].indexOf(row) : -1;
  if (index >= 0) draft.items.splice(index, 1);
  renderRemoteOrderItems();
}

async function assignRemotePartner(orderId, button = null) {
  const order = state.orders.find((item) => String(item.id || "") === String(orderId || ""));
  const partnerId = app.querySelector(`[data-remote-partner-for="${CSS.escape(orderId)}"]`)?.value || "";
  if (!order || !partnerId) return showMessage("Vui lòng chọn đối tác.", true);
  const restore = markButtonProcessing(button, "Đang giao đối tác...");
  try {
    await submitRemoteOperation("admin_order.assign_partner_requested", orderId, {
      orderId,
      partnerId,
      baseUpdatedAt: order.updatedAt || ""
    });
    showMessage("Đã gửi yêu cầu giao đối tác về Sales Desk.");
    await refreshOrders();
  } catch (error) {
    showMessage(error.message || "Chưa giao được đối tác.", true);
  } finally {
    restore();
  }
}

async function selectOrderLineWarehouse(button) {
  const orderId = String(button.dataset.orderId || "");
  const lineIndex = Number(button.dataset.lineIndex);
  const order = state.orders.find((item) => String(item.id || "") === orderId);
  const item = orderItems(order)[lineIndex];
  const select = app.querySelector(`[data-purchase-warehouse][data-order-id="${CSS.escape(orderId)}"][data-line-index="${lineIndex}"]`);
  const warehouseId = String(select?.value || "");
  if (!order || !item || !warehouseId) return showMessage("Vui long chon kho xu ly cho san pham.", true);
  const warehouse = adminWarehouseChoiceById(order, warehouseId);
  const operationId = `admin_warehouse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Dang chon kho...";
  try {
    const result = await api("/api/admin/operations", {
      method: "POST",
      body: {
        type: "admin_order.warehouse_selected",
        requestId: operationId,
        entityId: orderId,
        payload: {
          operationId,
          orderId,
          lineIndex,
          productCode: item.productCode || item.sku || "",
          size: item.size || "",
          variantId: item.variantId || "",
          warehouseId,
          warehouseName: warehouse?.name || warehouseId,
          baseUpdatedAt: order.updatedAt || "",
          baseVersion: Number(order.onlineOrderVersion || 0)
        }
      }
    });
    showMessage(result.message || "Da chon kho xu ly online.");
    await refreshOrders();
  } catch (error) {
    showMessage(error.message || "Chua chon duoc kho xu ly.", true);
    button.disabled = false;
    button.textContent = "Chon kho";
  } finally {
    if (button.isConnected) button.removeAttribute("aria-busy");
  }
}

async function pushOrderLinePurchase(button) {
  const orderId = String(button.dataset.orderId || "");
  const lineIndex = Number(button.dataset.lineIndex);
  const order = state.orders.find((item) => String(item.id || "") === orderId);
  const item = orderItems(order)[lineIndex];
  if (!order || !item || !String(item.warehouseId || "").trim() || !(item.partnerId || item.partnerIds?.length)) {
    return showMessage("Can chon kho truoc khi day mua.", true);
  }
  const undo = String(item.procurementStatus || "").toLowerCase() === "purchase_ready";
  const operationId = `admin_purchase_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Dang day mua...";
  try {
    const result = await api("/api/admin/operations", {
      method: "POST",
      body: {
        type: "admin_order.purchase_requested",
        requestId: operationId,
        entityId: orderId,
        payload: {
          operationId,
          orderId,
          lineIndex,
          productCode: item.productCode || item.sku || "",
          size: item.size || "",
          variantId: item.variantId || "",
          action: undo ? "undo" : "push",
          baseUpdatedAt: order.updatedAt || "",
          baseVersion: Number(order.onlineOrderVersion || 0)
        }
      }
    });
    showMessage(result.message || (undo ? "Da huy day mua online." : "Da day mua online."));
    await refreshOrders();
  } catch (error) {
    showMessage(error.message || "Chua day mua duoc san pham.", true);
    button.disabled = false;
    button.textContent = undo ? "Huy day mua" : "Day mua";
  } finally {
    if (button.isConnected) button.removeAttribute("aria-busy");
  }
}

function submitRemoteOperation(type, entityId, payload = {}) {
  return api("/api/admin/operations", { method: "POST", body: { type, entityId, payload } });
}

async function sendFanpageReply(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const textarea = form.querySelector("textarea[name='replyText']");
  const text = String(textarea?.value || "").trim();
  const conversationId = form.dataset.fanpageReply || "";
  const pageId = form.dataset.pageId || "";
  const customerId = form.dataset.customerId || "";
  if (!text || !conversationId || !pageId || !customerId) return;
  const requestId = `fbreply_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  // Hien bong bong "cho gui" ngay (nguon that la pendingReplies tu server, ban local nay chi de khoi cho vong poll).
  if (state.fanpage) {
    state.fanpage.pendingReplies = [...(state.fanpage.pendingReplies || []), {
      requestId,
      conversationId,
      text,
      createdAt: new Date().toISOString(),
      status: "pending",
      error: ""
    }];
  }
  if (textarea) textarea.value = "";
  renderFanpagePreservingComposer();
  try {
    await api("/api/admin/operations", {
      method: "POST",
      body: {
        type: "fanpage.reply_requested",
        entityId: conversationId,
        requestId,
        payload: { requestId, conversationId, pageId, customerId, text }
      }
    });
    showMessage("Đã gửi tin trả lời qua Sales Desk.");
  } catch (error) {
    showMessage(error.message || "Chưa gửi được tin trả lời.", true);
    const retryArea = app.querySelector(`[data-fanpage-reply="${CSS.escape(conversationId)}"] textarea[name='replyText']`);
    if (retryArea && !retryArea.value) retryArea.value = text;
  }
}

// Long-poll hom fanpage: Desk push snapshot moi la admin thay ngay, khong can bam "Tai lai".
let fanpageWaitRunning = false;
async function runFanpageWaitLoop() {
  if (fanpageWaitRunning) return;
  fanpageWaitRunning = true;
  for (;;) {
    try {
      const since = String(state.fanpage?.syncedAt || "");
      const payload = await api(`/api/admin/fanpage/wait?since=${encodeURIComponent(since)}&timeoutMs=25000`);
      const data = payload?.data;
      if (data && data.syncedAt && data.syncedAt !== since) {
        state.fanpage = data;
        if (state.view === "fanpage") renderFanpagePreservingComposer();
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

// Quy tac capture/restore: render lai man fanpage khi dang go khong duoc mat chu/caret/scroll.
function renderFanpagePreservingComposer() {
  if (state.view !== "fanpage") {
    render();
    return;
  }
  const active = document.activeElement;
  const isComposer = Boolean(active && active.matches && active.matches("textarea[name='replyText']"));
  const captured = isComposer
    ? {
        conversationId: active.closest("[data-fanpage-reply]")?.dataset.fanpageReply || "",
        value: active.value,
        selectionStart: active.selectionStart,
        selectionEnd: active.selectionEnd
      }
    : null;
  // Dang go form khac (vd form tao don): hoan render, du lieu da nam trong state nen khong mat gi.
  if (!captured && adminFormBusy()) {
    setTimeout(() => {
      if (state.view === "fanpage") renderFanpagePreservingComposer();
    }, 1500);
    return;
  }
  const messageList = app.querySelector(".message-list");
  const previousScrollTop = messageList ? messageList.scrollTop : null;
  const pinned = messageList
    ? messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 60
    : true;
  render();
  if (captured) {
    const textarea = app.querySelector(`[data-fanpage-reply="${CSS.escape(captured.conversationId)}"] textarea[name='replyText']`);
    if (textarea) {
      textarea.value = captured.value;
      textarea.focus({ preventScroll: true });
      try {
        textarea.setSelectionRange(captured.selectionStart, captured.selectionEnd);
      } catch {}
    }
  }
  const nextList = app.querySelector(".message-list");
  if (nextList) nextList.scrollTop = pinned ? nextList.scrollHeight : (previousScrollTop ?? nextList.scrollHeight);
}

async function saveProduct(code) {
  const name = app.querySelector(`[data-product-field="name"][data-code="${CSS.escape(code)}"]`)?.value || "";
  const price = app.querySelector(`[data-product-field="price"][data-code="${CSS.escape(code)}"]`)?.value || 0;
  const status = app.querySelector(`[data-product-field="status"][data-code="${CSS.escape(code)}"]`)?.value || "orderable";
  try {
    await api("/api/admin/products", { method: "POST", body: { code, name, price: moneyNumber(price), status } });
    showMessage("Đã lưu sản phẩm.");
    const payload = await api("/api/admin/products");
    state.products = Array.isArray(payload.data) ? payload.data : [];
    render();
  } catch (error) {
    showMessage(error.message || "Chưa lưu được sản phẩm.", true);
  }
}

async function createFanpageOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const body = {
    conversationId: form.dataset.fanpageOrder || "",
    customerName: data.customerName,
    phone: data.phone,
    address: data.address,
    items: [{
      productCode: data.productCode,
      productName: data.productName || productNameByCode(data.productCode) || data.productCode,
      size: data.size,
      price: moneyNumber(data.price),
      qty: Math.max(1, Number(data.qty || 1))
    }]
  };
  try {
    const result = await api("/api/admin/fanpage/orders", { method: "POST", body });
    showMessage(result.message || "Đã tạo đơn từ fanpage.");
    await refreshOrders();
    state.view = "orders";
    render();
  } catch (error) {
    showMessage(error.message || "Chưa tạo được đơn từ fanpage.", true);
  }
}

async function logoutAdmin() {
  await api("/api/admin/logout", { method: "POST", silent: true }).catch(() => null);
  location.replace("/admin-login");
}

function operationalOrders() {
  return Array.isArray(state.operations?.orders) ? state.operations.orders : [];
}

function unifiedOrderId(value = "") {
  const id = String(value || "").trim();
  return /^LAND-ORD-/i.test(id) ? id.replace(/^LAND-/i, "") : id;
}

function isRemoteOperationsOrder(order = {}) {
  return Boolean(order && (order.remoteAdminEventId
    || String(order.externalSource || "").includes("sales_desk")
    || String(order.channel || "").toLowerCase() === "manual"));
}

function hasOperationalSnapshot(order = {}) {
  if (isRemoteOperationsOrder(order)) return true;
  const orderId = unifiedOrderId(order.id || order.externalId || order.sourceOrderId);
  return Boolean(orderId) && operationalOrders().some((candidate) => unifiedOrderId(candidate.id || candidate.externalId || candidate.sourceOrderId) === orderId);
}

function combinedAdminOrders(webOrders = [], operationsOrders = []) {
  const result = (Array.isArray(webOrders) ? webOrders : []).map((order) => ({ ...order, id: unifiedOrderId(order.id) }));
  const indexByKey = new Map();
  result.forEach((order, index) => {
    const key = unifiedOrderId(order.id || order.externalId || order.sourceOrderId);
    if (key) indexByKey.set(key, index);
  });
  (Array.isArray(operationsOrders) ? operationsOrders : [])
    .forEach((order) => {
      const id = unifiedOrderId(order.id || order.externalId || order.sourceOrderId);
      if (!id) return;
      if (indexByKey.has(id)) {
        const index = indexByKey.get(id);
        const current = result[index];
        const merged = {
          ...current,
          ...order,
          id,
          externalId: id,
          sourceOrderId: id,
          customer: { ...(current.customer || {}), ...(order.customer || {}) },
          items: Array.isArray(order.items) && order.items.length ? order.items : current.items
        };
        // Đơn khách đã hủy trên web phải giữ trạng thái hủy, không để snapshot vận hành cũ ghi đè về đơn mới.
        if (adminOrderIsCancelled(current) && !adminOrderIsCancelled(order)) {
          merged.status = current.status;
          merged.cancelledAt = current.cancelledAt || merged.cancelledAt || null;
        }
        result[index] = merged;
        return;
      }
      indexByKey.set(id, result.length);
      result.push({ ...order, id, externalId: id, sourceOrderId: id });
    });
  return result.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function remotePartnerOptions(selected = "") {
  const partners = Array.isArray(state.operations?.procurementPartners) ? state.operations.procurementPartners : partnerList();
  return `<option value="">Chọn đối tác xử lý</option>${partners
    .filter((partner) => partner.status !== "inactive")
    .map((partner) => `<option value="${escapeHTML(partner.id || "")}" ${String(partner.id || "") === String(selected || "") ? "selected" : ""}>${escapeHTML(partner.name || partner.id || "")}</option>`)
    .join("")}`;
}

function remoteCommandStatus(orderId = "") {
  const command = (Array.isArray(state.operations?.commands) ? state.operations.commands : [])
    .find((item) => String(item.entityId || item.payload?.orderId || "") === String(orderId || ""));
  if (!command) return "Đã đồng bộ từ Sales Desk";
  const labels = { pending: command.payload?.onlineOrderVersion ? "Đã xử lý online · chờ Sales Desk" : "Chờ Sales Desk", applied: "Đã đồng bộ hai chiều", rejected: "Bị từ chối", conflict: "Có xung đột" };
  return labels[command.status] || "Chờ đồng bộ";
}

function shippingOrderEligible(order = {}) {
  const values = [order.status, order.fulfillmentStatus, order.shippingStatus].map((value) => String(value || ""));
  const blocked = [order.status, order.fulfillmentStatus, order.shippingStatus, order.sourceOrderStatus]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => ["cancelled", "canceled", "soft_deleted", "partner_out_of_stock"].includes(value));
  return !order.deletedAt && !order.purgedAt && !blocked
    && values.some((value) => ["purchase_complete", "partner_confirmed", "assigned_to_warehouse", "ready_to_ship", "sent_to_sapo", "shipping_requested", "shipping_created", "shipped", "completed"].includes(value));
}

function shippingOrderStarted(order = {}) {
  return Boolean(String(order.trackingCode || "").trim())
    || [order.status, order.fulfillmentStatus, order.shippingStatus]
      .map((value) => String(value || ""))
      .some((value) => ["shipping_requested", "shipping_created", "shipped", "completed"].includes(value));
}

function filteredProducts() {
  const q = normalize(state.query);
  return state.products.filter((item) => {
    const haystack = normalize(`${item.code} ${item.name} ${item.brand} ${item.productKind}`);
    return !q || haystack.includes(q);
  }).slice(0, 250);
}

function filteredOrders() {
  const q = normalize(state.query);
  return state.orders.filter((order) => {
    const items = orderItems(order).map((item) => `${item.productCode} ${item.productName} ${item.size}`).join(" ");
    const haystack = normalize(`${order.id} ${order.customerName} ${order.customer?.name} ${order.phone} ${order.address} ${items}`);
    const statusText = normalize(`${order.status} ${order.paymentStatus} ${order.fulfillmentStatus}`);
    const cancelled = adminOrderIsCancelled(order);
    const workflowStatus = adminOperationalOrderStatus(order);
    const statusMatches = state.status === "all"
      || (state.status.startsWith("workflow_") && workflowStatus === state.status)
      || (state.status === "active" && !cancelled)
      || (state.status === "cancelled" && cancelled)
      || (state.status === "unassigned" && !cancelled && !orderItems(order).some((item) => item.partnerId || item.partnerIds?.length || String(item.warehouseId || "").trim()))
      || statusText.includes(state.status);
    return (!q || haystack.includes(q)) && statusMatches;
  }).slice(0, 250);
}

function adminOperationalOrderStatus(order = {}) {
  if (adminOrderIsCancelled(order)) return "cancelled";
  const values = [order.status, order.fulfillmentStatus, order.shippingStatus].map((value) => String(value || "").toLowerCase());
  // Can xu ly chi co 2 cua vao: khong mua duoc (dong het hang chua giai quyet) hoac khong giao duoc (van don su co).
  // Hoan tat luon thang co; customer_recontact la ghi chu lien he tay, khong keo don vao tab nay.
  if (values.some((value) => ["completed", "delivered", "fulfilled"].includes(value))) return "workflow_completed";
  const purchaseBlocked = orderItems(order).some((item) => String(item.procurementStatus || "").toLowerCase() === "partner_out_of_stock");
  if (purchaseBlocked || values.some((value) => ["partner_out_of_stock", "failed", "delivery_failed", "shipping_issue", "returning", "returned", "return_requested"].includes(value))) return "workflow_attention";
  if (values.some((value) => ["purchase_complete", "partner_confirmed", "assigned_to_warehouse", "ready_to_ship", "sent_to_sapo", "shipping_requested", "shipping_created", "shipping", "shipped", "packed"].includes(value)) || String(order.trackingCode || "").trim()) return "workflow_delivery";
  const paid = adminPaidAmount(order) > 0
    || ["paid", "partially_paid", "payment_confirmed", "deposit_received"].includes(String(order.paymentStatus || "").toLowerCase());
  if (values.some((value) => ["partner_assigned", "purchase_partial", "waiting_purchase", "deposit_received"].includes(value))
    && (paid || orderItems(order).some((item) => String(item.procurementStatus || "").toLowerCase() === "purchase_ready"))) return "workflow_purchase";
  const items = orderItems(order).filter((item) => item.partnerId || item.partnerIds?.length || item.warehouseId || item.warehouse);
  if (values.includes("stock_confirmed") || (items.length && items.every((item) => ["stock_confirmed", "confirmed_in_stock", "available", "purchase_ready"].includes(String(item.procurementStatus || "").toLowerCase())))) return "workflow_payment";
  if (items.length || values.some((value) => ["waiting_partner_confirm", "stock_reserved"].includes(value))) return "workflow_stock";
  return "workflow_new";
}

function adminOrderIsCancelled(order = {}) {
  if (order.deletedAt && !order.purgedAt) return true;
  return [order.status, order.fulfillmentStatus, order.shippingStatus, order.sourceOrderStatus]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => ["cancelled", "canceled", "soft_deleted"].includes(value));
}

function pendingOrders() {
  return state.orders.filter((order) => !["completed", "cancelled", "shipped", "soft_deleted"].includes(String(order.status || "").toLowerCase()));
}

function productIssues() {
  return state.products.filter((item) => !item.price || !Array.isArray(item.sizes) || !item.sizes.length || !(item.thumbnailImage || item.highImage || item.image));
}

function partnerList() {
  return Array.isArray(state.partners?.partners) ? state.partners.partners : [];
}

function conversations() {
  return Array.isArray(state.fanpage?.conversations) ? state.fanpage.conversations : [];
}

function orderItems(order) {
  return Array.isArray(order.items) ? order.items : [];
}

function partnerName(partnerId) {
  const partner = partnerList().find((item) => String(item.id || "") === String(partnerId || ""));
  return partner?.name || partnerId || "";
}

function productNameByCode(code) {
  const product = state.products.find((item) => normalize(item.code) === normalize(code));
  return product?.name || "";
}

function orderWarehousePanel(order = {}, selectedWarehouse = "") {
  const warehouses = adminWarehousesForOrder(order);
  const rows = orderItems(order).filter((item) => item.productCode || item.sku);
  if (!rows.length) {
    return `<div class="warehouse-panel"><span class="muted">Chua co san pham de kiem ton kho.</span></div>`;
  }
  return `
    <div class="warehouse-panel">
      <div class="warehouse-panel-head">
        <strong>Ton kho theo san pham</strong>
        <span>${escapeHTML(selectedWarehouse ? `Dang chon: ${adminWarehouseChoiceById(order, selectedWarehouse)?.name || selectedWarehouse}` : "Chua chon kho")}</span>
      </div>
      <div class="warehouse-stock-list">
        ${rows.map((item, lineIndex) => orderWarehouseStockRow(order, item, lineIndex, warehouses, selectedWarehouse)).join("")}
      </div>
    </div>
  `;
}

function orderWarehouseStockRow(order = {}, item = {}, lineIndex = 0, warehouses = [], selectedWarehouse = "") {
  const code = String(item.productCode || item.sku || "").trim();
  const product = adminProductByCode(code);
  const size = String(item.size || "").trim();
  const needed = Math.max(1, Number(item.quantity || item.qty || 1));
  const currentWarehouse = String(item.warehouseId || item.warehouse || item.warehouseName || selectedWarehouse || "");
  const locked = adminOrderLinePurchaseLocked(item);
  const assigned = Boolean(String(item.warehouseId || "").trim() && (item.partnerId || item.partnerIds?.length));
  const pushed = String(item.procurementStatus || "").toLowerCase() === "purchase_ready";
  const chips = warehouses.map((warehouse) => {
    const stock = adminWarehouseStock(product, warehouse.id || warehouse.name, size);
    const reserved = adminOrderItemUsesWarehouse(item, warehouse.id || warehouse.name) ? needed : 0;
    const enough = reserved > 0 || stock >= needed;
    const selected = adminOrderItemUsesWarehouse(item, warehouse.id || warehouse.name) || String(warehouse.id || "") === currentWarehouse;
    return `<span class="warehouse-stock-chip ${enough ? "enough" : "short"} ${selected ? "selected" : ""}">
      ${escapeHTML(warehouse.name || warehouse.id)}: <b>${reserved ? `đã giữ ${reserved} · còn ${stock}` : stock}</b>
    </span>`;
  }).join("");
  return `
    <div class="warehouse-stock-row">
      <div>
        <strong>${escapeHTML(code)} · size ${escapeHTML(size || "-")}</strong>
        <small>${escapeHTML(item.productName || product?.name || "")}</small>
      </div>
      <span class="need-pill">Can ${escapeHTML(needed)}</span>
      <div class="warehouse-stock-chips">${chips || `<span class="warehouse-stock-chip short">Chua co ton kho</span>`}</div>
      <div class="warehouse-purchase-action">
        <select data-purchase-warehouse data-order-id="${escapeHTML(order.id || "")}" data-line-index="${lineIndex}" ${locked ? "disabled" : ""}>
          ${warehouseOptionsForOrderLine(order, product, size, currentWarehouse)}
        </select>
        <small class="muted">${(() => { const price = adminLineWarehousePurchasePrice(product, size, currentWarehouse); return price > 0 ? `Giá nhập: <b>${formatMoney(price)}</b>` : "Chọn kho để hiện giá nhập"; })()}</small>
        <button class="small" type="button" data-select-order-line-warehouse data-order-id="${escapeHTML(order.id || "")}" data-line-index="${lineIndex}" ${locked ? "disabled" : ""}>${assigned ? "Doi kho" : "Chon kho"}</button>
        <button class="small primary" type="button" data-push-order-line-purchase data-order-id="${escapeHTML(order.id || "")}" data-line-index="${lineIndex}" ${locked || !assigned ? "disabled" : ""}>${locked ? "Da phat sinh mua" : pushed ? "Huy day mua" : "Day mua"}</button>
      </div>
    </div>
  `;
}

function adminOrderLinePurchaseLocked(item = {}) {
  const status = String(item.procurementStatus || "").toLowerCase();
  const purchased = (Array.isArray(item.procurement) ? item.procurement : []).some((entry) => Number(entry.quantity || 0) > 0);
  return purchased || ["purchased", "purchase_complete", "packed", "ready_to_ship"].includes(status);
}

function warehouseOptionsForOrder(order = {}, selectedWarehouse = "") {
  const warehouses = adminWarehousesForOrder(order);
  return [
    `<option value="">Chon kho xu ly</option>`,
    ...warehouses.map((warehouse) => {
      const label = `${warehouse.name || warehouse.id}${warehouse.enoughAll ? " - du hang" : " - can kiem"}`;
      return `<option value="${escapeHTML(warehouse.id || "")}" ${String(selectedWarehouse || "") === String(warehouse.id || "") ? "selected" : ""}>${escapeHTML(label)}</option>`;
    })
  ].join("");
}

// 2026-08-13 (mockup 8, dung chung 2 admin): gia nhap = saleFilePrice theo ma+size+kho —
// hien ngay trong danh sach chon kho cua TUNG DONG va ben canh o chon.
function adminLineWarehousePurchasePrice(product = null, size = "", warehouseId = "") {
  if (!product || !Array.isArray(product.sizes) || !warehouseId) return 0;
  const sizeKey = String(size || "").trim().toLowerCase();
  const target = String(warehouseId || "").trim();
  const row = product.sizes.find((entry) => {
    if (String(entry?.size || "").trim().toLowerCase() !== sizeKey) return false;
    const rowId = String(entry.warehouseId || "").trim() || adminWarehouseIdFromName(entry.warehouse || entry.warehouseName || "");
    return rowId === target;
  });
  return Number(row?.saleFilePrice || 0);
}

function warehouseOptionsForOrderLine(order = {}, product = null, size = "", selectedWarehouse = "") {
  const warehouses = adminWarehousesForOrder(order);
  return [
    `<option value="">Chon kho xu ly</option>`,
    ...warehouses.map((warehouse) => {
      const price = adminLineWarehousePurchasePrice(product, size, warehouse.id);
      const label = `${warehouse.name || warehouse.id}${price > 0 ? ` · nhap ${formatMoney(price)}` : ""}${warehouse.enoughAll ? " - du hang" : " - can kiem"}`;
      return `<option value="${escapeHTML(warehouse.id || "")}" ${String(selectedWarehouse || "") === String(warehouse.id || "") ? "selected" : ""}>${escapeHTML(label)}</option>`;
    })
  ].join("");
}

function adminWarehousesForOrder(order = {}) {
  const items = orderItems(order).map((item) => ({
    source: item,
    code: String(item.productCode || item.sku || "").trim(),
    size: String(item.size || "").trim(),
    quantity: Math.max(1, Number(item.quantity || item.qty || 1))
  })).filter((item) => item.code);
  const map = new Map();
  const addWarehouse = (product, value) => {
    const raw = String(value || "").trim();
    if (!raw || normalize(raw) === "toprun") return;
    const id = raw.startsWith("wh_") ? raw : adminWarehouseIdFromName(raw);
    if (!map.has(id)) map.set(id, { id, name: adminWarehouseDisplayName(product, raw) || raw, enoughAll: false });
  };
  items.forEach((item) => {
    const product = adminProductByCode(item.code);
    (Array.isArray(product?.warehousePriorityIds) ? product.warehousePriorityIds : []).forEach((value) => addWarehouse(product, value));
    (Array.isArray(product?.warehousePriority) ? product.warehousePriority : []).forEach((value) => addWarehouse(product, value));
    Object.keys(product?.warehouseStockIds || {}).forEach((value) => addWarehouse(product, value));
    Object.keys(product?.warehouseStocks || {}).forEach((value) => addWarehouse(product, value));
    (Array.isArray(product?.warehouseMeta) ? product.warehouseMeta : []).forEach((value) => addWarehouse(product, value?.id || value?.name));
    (Array.isArray(product?.sizes) ? product.sizes : []).forEach((row) => addWarehouse(product, row.warehouseId || row.warehouse || row.warehouseName));
  });
  const warehouses = Array.from(map.values());
  warehouses.forEach((warehouse) => {
    warehouse.enoughAll = items.every((item) => adminOrderItemUsesWarehouse(item.source, warehouse.id)
      || adminWarehouseStock(adminProductByCode(item.code), warehouse.id, item.size) >= item.quantity);
  });
  return warehouses.sort((left, right) => Number(right.enoughAll) - Number(left.enoughAll) || left.name.localeCompare(right.name, "vi"));
}

function adminWarehouseChoiceById(order = {}, warehouseId = "") {
  if (!warehouseId) return null;
  return adminWarehousesForOrder(order).find((warehouse) => String(warehouse.id || "") === String(warehouseId || "")) || { id: warehouseId, name: warehouseId };
}

function adminProductByCode(code = "") {
  return state.products.find((product) => String(product.code || "").trim().toLowerCase() === String(code || "").trim().toLowerCase()) || null;
}

function adminWarehouseSuggestion(order = {}) {
  const items = orderItems(order).map((item) => ({
    code: String(item.productCode || item.sku || "").trim(),
    size: String(item.size || "").trim(),
    quantity: Math.max(1, Number(item.quantity || item.qty || 1))
  })).filter((item) => item.code);
  if (!items.length || !state.products.length) return null;
  const reservedWarehouse = adminReservedWarehouseForOrder(order);
  if (reservedWarehouse) {
    return {
      mode: "single",
      label: `Kho đã giữ: ${reservedWarehouse.name}`,
      warehouseId: reservedWarehouse.id,
      warehouseName: reservedWarehouse.name
    };
  }
  const productsByCode = new Map(state.products.map((product) => [String(product.code || "").trim().toLowerCase(), product]));
  const priority = [];
  const addWarehouse = (value) => {
    const name = String(value || "").trim();
    if (!name || normalize(name) === "toprun" || priority.includes(name)) return;
    priority.push(name);
  };
  items.forEach((item) => {
    const product = productsByCode.get(item.code.toLowerCase());
    (Array.isArray(product?.warehousePriorityIds) ? product.warehousePriorityIds : []).forEach(addWarehouse);
    (Array.isArray(product?.warehousePriority) ? product.warehousePriority : []).forEach(addWarehouse);
  });
  items.forEach((item) => {
    const product = productsByCode.get(item.code.toLowerCase());
    Object.keys(product?.warehouseStockIds || {}).forEach(addWarehouse);
    Object.keys(product?.warehouseStocks || {}).forEach(addWarehouse);
  });
  if (!priority.length) return null;
  for (const warehouse of priority) {
    const enoughAll = items.every((item) => {
      const product = productsByCode.get(item.code.toLowerCase());
      return adminWarehouseStock(product, warehouse, item.size) >= item.quantity;
    });
    if (enoughAll) {
      const warehouseName = adminWarehouseDisplayName(productsByCode.get(items[0].code.toLowerCase()), warehouse);
      return {
        mode: "single",
        label: `Gợi ý kho: ${warehouseName}`,
        warehouseId: warehouse.startsWith("wh_") ? warehouse : adminWarehouseIdFromName(warehouse),
        warehouseName
      };
    }
  }
  const split = items.map((item) => {
    const product = productsByCode.get(item.code.toLowerCase());
    const warehouse = priority.find((name) => adminWarehouseStock(product, name, item.size) >= item.quantity);
    return warehouse ? `${item.code} -> ${adminWarehouseDisplayName(product, warehouse)}` : `${item.code} thiếu`;
  });
  return { mode: "split", label: `Cần tách/kiểm kho: ${split.join("; ")}` };
}

function adminOrderItemUsesWarehouse(item = {}, warehouse = "") {
  const itemValue = String(item.warehouseId || item.warehouse || item.warehouseName || "").trim();
  const target = String(warehouse || "").trim();
  if (!itemValue || !target) return false;
  return itemValue === target
    || (itemValue.startsWith("wh_") ? itemValue : adminWarehouseIdFromName(itemValue)) === (target.startsWith("wh_") ? target : adminWarehouseIdFromName(target))
    || normalize(itemValue) === normalize(target);
}

function adminReservedWarehouseForOrder(order = {}) {
  const items = orderItems(order).filter((item) => item.productCode || item.sku);
  if (!items.length) return null;
  const values = items.map((item) => String(item.warehouseId || item.warehouse || item.warehouseName || "").trim()).filter(Boolean);
  if (values.length !== items.length) return null;
  const ids = [...new Set(values.map((value) => value.startsWith("wh_") ? value : adminWarehouseIdFromName(value)))];
  if (ids.length !== 1) return null;
  const id = ids[0];
  const source = items.find((item) => adminOrderItemUsesWarehouse(item, id)) || {};
  return { id, name: String(source.warehouseName || source.warehouse || adminWarehouseDisplayName(adminProductByCode(source.productCode || source.sku), id) || id) };
}

function adminWarehouseStock(product = {}, warehouse = "", requestedSize = "") {
  if (!product || !warehouse) return 0;
  const key = String(warehouse || "").trim();
  const id = key.startsWith("wh_") ? key : adminWarehouseIdFromName(key);
  const rows = (Array.isArray(product.sizes) ? product.sizes : []).filter((row) => adminSizeMatches(row.size || row.name, requestedSize));
  const rowsWithWarehouse = rows.filter((row) => row.warehouse || row.warehouseId || row.warehouseName);
  if (rowsWithWarehouse.length) {
    return rowsWithWarehouse
      .filter((row) => {
        const value = String(row.warehouseId || row.warehouse || row.warehouseName || "").trim();
        return value === key || value === id || adminWarehouseIdFromName(value) === id || normalize(value) === normalize(key);
      })
      .reduce((sum, row) => sum + Number(row.qty ?? row.available ?? row.stockQty ?? 0), 0);
  }
  if (rows.length) {
    const totalSize = rows.reduce((sum, row) => sum + Number(row.qty ?? row.available ?? row.stockQty ?? 0), 0);
    const warehouseTotal = Number(product.warehouseStockIds?.[id] || product.warehouseStocks?.[key] || product.warehouseStocks?.[adminWarehouseDisplayName(product, key)] || 0);
    return Math.min(totalSize, warehouseTotal || totalSize);
  }
  return Number(product.warehouseStockIds?.[id] || product.warehouseStocks?.[key] || product.warehouseStocks?.[adminWarehouseDisplayName(product, key)] || 0);
}

function adminWarehouseDisplayName(product = {}, warehouse = "") {
  const key = String(warehouse || "").trim();
  const meta = Array.isArray(product?.warehouseMeta)
    ? product.warehouseMeta.find((item) => item && (item.id === key || normalize(item.name) === normalize(key)))
    : null;
  return meta?.name || key;
}

function adminWarehouseIdFromName(name = "") {
  return `wh_${normalize(name).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown"}`;
}

function adminSizeMatches(stockSize = "", requestedSize = "") {
  return normalizeSizeText(stockSize) === normalizeSizeText(requestedSize);
}

function normalizeSizeText(value = "") {
  return normalize(value)
    .replace(/\b(size|sz|eu|us|uk)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productCodeDatalist() {
  return `
    <datalist id="admin-product-codes">
      ${state.products.slice(0, 500).map((item) => `<option value="${escapeHTML(item.code || "")}">${escapeHTML(item.name || "")}</option>`).join("")}
    </datalist>
  `;
}

function orderStatusOptions(current) {
  const statuses = [
    ["pending", "Mới tạo"],
    ["confirmed_by_customer", "Khách đã xác nhận"],
    ["payment_pending", "Chờ chuyển khoản"],
    ["payment_confirmed", "Đã xác nhận CK"],
    ["partner_assigned", "Đã giao đối tác"],
    ["waiting_partner_confirm", "Chờ đối tác"],
    ["purchase_partial", "Mua còn thiếu"],
    ["purchase_complete", "Đã mua đủ"],
    ["partner_confirmed", "Đối tác đã xác nhận"],
    ["assigned_to_warehouse", "Đã đẩy về kho"],
    ["ready_to_ship", "Sẵn sàng giao"],
    ["shipped", "Đã giao ship"],
    ["completed", "Hoàn tất"],
    ["cancelled", "Đã hủy"]
  ];
  return statuses.map(([value, label]) => `<option value="${value}" ${String(current || "") === value ? "selected" : ""}>${label}</option>`).join("");
}

function orderButton(orderId, status, label) {
  return `<button class="small" data-order-id="${escapeHTML(orderId)}" data-order-status="${escapeHTML(status)}">${escapeHTML(label)}</button>`;
}

// O "Da thanh toan": chi ghi SO TIEN khach da tra + paymentStatus, KHONG ep status don
// (truoc day gui status=payment_confirmed de len trang thai van hanh that; Desk se tu
// chuyen buoc theo applyOrderWorkflowAfterPaymentSave). So dang go luu draft de song sot render().
function quickPaymentPanel(order = {}) {
  const orderId = String(order.id || "");
  const paid = adminPaidAmount(order);
  const draft = state.quickPaymentDrafts[orderId];
  const value = draft !== undefined ? draft : (paid > 0 ? paid : "");
  return `
    <div class="quick-payment-row">
      <label class="quick-payment-label" for="quick-payment-${escapeHTML(orderId)}">Đã thanh toán:</label>
      <input id="quick-payment-${escapeHTML(orderId)}" data-quick-payment-amount data-order-id="${escapeHTML(orderId)}" inputmode="numeric" placeholder="Điền số tiền" value="${escapeHTML(value)}">
      <button class="small primary" type="button" data-quick-confirm-payment="${escapeHTML(orderId)}">Lưu</button>
      <small>${paid > 0 ? `Đã ghi nhận ${formatMoney(paid)}` : `Cọc yêu cầu: ${formatMoney(order.paymentAmount || 0)}`} · Tổng: ${formatMoney(order.total || 0)}</small>
    </div>
  `;
}

async function quickConfirmPayment(orderId, button = null) {
  const input = app.querySelector(`[data-quick-payment-amount][data-order-id="${CSS.escape(orderId)}"]`);
  const amount = moneyNumber(input?.value || 0);
  if (!(amount > 0)) return showMessage("Điền số tiền khách đã thanh toán trước khi lưu.", true);
  delete state.quickPaymentDrafts[orderId];
  const restore = markButtonProcessing(button, "Đang lưu...");
  try {
    await submitOrderUpdate({
      orderId,
      paymentStatus: "payment_confirmed",
      paymentAmount: amount
    });
  } finally {
    restore();
  }
}

function customerContactPanel(order = {}) {
  const orderId = String(order.id || "").trim();
  const phone = order.phone || order.customer?.phone || "";
  const zaloUrl = zaloPhoneUrl(phone);
  const messengerUrl = messengerUrlForOrder(order);
  const conversation = fanpageConversationForOrder(order);
  return `
    <div class="customer-contact-panel">
      <span>Nhắn khách</span>
      <div class="customer-contact-actions">
        <button class="small" type="button" data-copy-customer-message data-order-id="${escapeHTML(orderId)}">Copy tin CK</button>
        ${zaloUrl ? `<a class="small button-link" href="${escapeHTML(zaloUrl)}" target="_blank" rel="noreferrer">Zalo</a>` : ""}
        ${messengerUrl ? `<a class="small button-link" href="${escapeHTML(messengerUrl)}" target="_blank" rel="noreferrer">Messenger</a>` : ""}
        ${conversation ? `<button class="small" type="button" data-open-fanpage-conversation data-conversation-id="${escapeHTML(conversation.id || "")}">Fanpage</button>` : ""}
        ${phone ? `<a class="small button-link" href="tel:${escapeHTML(phone)}">Gọi</a>` : ""}
      </div>
    </div>
  `;
}

function customerPaymentMessage(order = {}) {
  const items = orderItems(order).map((item) =>
    `- ${item.productCode || ""} ${item.productName || ""} size ${item.size || "-"} x${item.qty || item.quantity || 1}`
  ).join("\n");
  const amount = Number(order.paymentAmount || 0) > 0 ? Number(order.paymentAmount || 0) : Number(order.total || 0);
  const paymentReference = order.paymentReference || order.id || "";
  return [
    `TopRun xác nhận đơn ${order.id || ""} của anh/chị còn hàng.`,
    "",
    items || "- Sản phẩm trong đơn hàng",
    "",
    `Tổng đơn: ${formatMoney(order.total || 0)}`,
    `Số tiền cần chuyển/đặt cọc: ${formatMoney(amount)}`,
    `Nội dung CK: ${paymentReference}`,
    "",
    "Shop giữ hàng trong 1 giờ kể từ khi gửi tin nhắn này. Anh/chị chuyển khoản xong vui lòng báo lại TopRun để xác nhận đơn."
  ].join("\n");
}

function zaloPhoneUrl(phone = "") {
  let digits = String(phone || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `84${digits.slice(1)}`;
  return `https://zalo.me/${digits}`;
}

function messengerUrlForOrder(order = {}) {
  return String(
    order.messengerUrl
    || order.facebookMessengerUrl
    || order.facebookThreadUrl
    || order.conversationUrl
    || order.customer?.messengerUrl
    || order.customer?.facebookMessengerUrl
    || ""
  ).trim();
}

function fanpageConversationForOrder(order = {}) {
  const externalId = String(order.externalId || order.conversationId || order.fanpageConversationId || "").trim();
  const phone = normalize(order.phone || order.customer?.phone || "");
  const name = normalize(order.customerName || order.customer?.name || "");
  return conversations().find((item) => {
    if (externalId && String(item.id || "") === externalId) return true;
    const itemPhone = normalize(item.phone || "");
    if (phone && itemPhone && phone === itemPhone) return true;
    return name && normalize(item.customerName || "") === name;
  }) || null;
}

function quickAction(label, value, view) {
  return `<button class="quick-card" data-view="${escapeHTML(view)}"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></button>`;
}

function metric(label, value, note) {
  return `<article class="metric-card"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong><small>${escapeHTML(note || "")}</small></article>`;
}

function mini(label, value) {
  return `<div><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`;
}

function showMessage(text, isError = false) {
  message.textContent = text || "";
  message.classList.toggle("error", isError);
  message.hidden = !text;
  if (text) setTimeout(() => { message.hidden = true; }, 4500);
}

function statusLabel(value) {
  const labels = {
    active: "Hoạt động",
    inactive: "Đã khóa",
    pending: "Mới tạo",
    confirmed_by_customer: "Khách đã xác nhận",
    payment_pending: "Chờ chuyển khoản",
    payment_confirmed: "Đã xác nhận CK",
    stock_confirmed: "Đã xác nhận có hàng",
    customer_recontact: "Cần liên hệ lại",
    partner_assigned: "Đã giao đối tác",
    waiting_partner_confirm: "Chờ đối tác",
    purchase_partial: "Mua còn thiếu",
    purchase_complete: "Đã mua đủ",
    partner_confirmed: "Đối tác đã xác nhận",
    assigned_to_warehouse: "Đã đẩy về kho",
    ready_to_ship: "Sẵn sàng giao",
    shipped: "Đã giao ship",
    completed: "Hoàn tất",
    cancelled: "Đã hủy",
    not_assigned: "Chưa phân bổ"
  };
  return labels[String(value || "")] || value || "-";
}

function moneyNumber(value) {
  // VND khong co phan thap phan: dau "." va "," trong o tien la phan cach nghin
  // ("140.000" phai ra 140000, truoc day Number("140.000") ra 140 - sai tien nghiem trong).
  return Number(String(value || "0").replace(/[^\d-]/g, "")) || 0;
}

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function formatMoney(value) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value || "");
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(date);
}
