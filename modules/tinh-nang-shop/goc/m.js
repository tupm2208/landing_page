/*
 * m.js — trang điện thoại cho người bán (route /m), 17/09/2026.
 *
 * Dáng theo bản điện thoại của Sales Desk (mobile.html), nhưng chỉ ba tab:
 *   Đơn     — số đơn theo tab quy trình, danh sách + ô tìm, chạm một đơn mở sheet chi tiết;
 *   Tra tồn — tra theo mã/tên + size, sửa số tồn ở nguồn cho phép sửa;
 *   Kho     — lối sang trang quét tem và trang kho.
 * Không thư viện, không tài nguyên ngoài. Mọi chữ từ máy chủ đi vào DOM bằng textContent.
 * Quyền là phiên quản trị (cookie); 401 -> về trang đăng nhập.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const text = (v) => String(v == null ? "" : v).trim();
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const list = (v) => (Array.isArray(v) ? v : []);
  const enc = encodeURIComponent;

  const TABS = { don: "Đơn hàng", ton: "Tra tồn", kho: "Kho" };
  const state = {
    tab: "don",
    orderTabs: [],
    counts: {},
    nhom: "workflow_new",
    q: "",
    orders: [],
    loadingOrders: false,
    stockQuery: { q: "", size: "" },
    stock: null
  };

  // ---------------------------------------------------------------- helpers

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? "" : String(value));
      }
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const money = (v) => `${num(v).toLocaleString("vi-VN")}đ`;

  function when(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  }

  let toastTimer = 0;
  function toast(message, isError) {
    const node = $("m-toast");
    node.textContent = message;
    node.classList.toggle("err", Boolean(isError));
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
  }

  async function api(method, path, body) {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (response.status === 401) {
      location.replace("/admin-login");
      throw new Error("Phiên đăng nhập đã hết.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (payload && payload.ok === false)) {
      throw new Error(payload.message || payload.viSao || payload.error || `Máy chủ trả mã ${response.status}`);
    }
    return payload;
  }

  function setView(...nodes) {
    const view = $("m-view");
    view.textContent = "";
    view.append(...nodes);
  }

  function loading() {
    return el("div", { class: "empty" }, el("span", { class: "spinner" }), " Đang tải…");
  }

  function errorBox(message) {
    return el("div", { class: "err-box", text: message });
  }

  // ---------------------------------------------------------------- tabs

  function switchTab(tab) {
    state.tab = TABS[tab] ? tab : "don";
    if (location.hash !== `#${state.tab}`) history.replaceState(null, "", `#${state.tab}`);
    document.querySelectorAll(".m-tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
    $("m-title").textContent = TABS[state.tab];
    $("m-sub").textContent = "";
    closeSheet();
    if (state.tab === "don") renderOrdersTab(true);
    else if (state.tab === "ton") renderStockTab();
    else renderWarehouseTab();
  }

  // ---------------------------------------------------------------- Đơn

  async function loadCounts() {
    try {
      const payload = await api("GET", "/api/admin/orders/dem-quy-trinh");
      state.orderTabs = list(payload.nhom).map((t) => ({ ma: text(t.ma), ten: text(t.ten) })).filter((t) => t.ma);
      state.counts = payload.dem && typeof payload.dem === "object" ? payload.dem : {};
      const fresh = num(state.counts.workflow_new);
      $("m-dot-don").textContent = fresh > 0 ? String(fresh > 99 ? "99+" : fresh) : "";
      $("m-sub").textContent = state.tab === "don" ? `${num(payload.tongDangHoatDong)} đơn đang hoạt động` : "";
    } catch (error) {
      if (state.tab === "don") toast(error.message, true);
    }
  }

  async function loadOrders() {
    state.loadingOrders = true;
    const params = new URLSearchParams({ limit: "50" });
    if (state.nhom) params.set("nhom", state.nhom);
    if (state.q) params.set("q", state.q);
    try {
      const payload = await api("GET", `/api/orders?${params}`);
      state.orders = Array.isArray(payload) ? payload : list(payload.orders || payload.don);
      state.ordersError = "";
    } catch (error) {
      state.orders = [];
      state.ordersError = error.message;
    } finally {
      state.loadingOrders = false;
    }
  }

  function tabName(ma) {
    const found = state.orderTabs.find((t) => t.ma === ma);
    return found ? found.ten : ma;
  }

  function statusPill(order) {
    const tabs = list(order.trangThaiQuyTrinh);
    const ma = tabs[0] || text(order.status);
    const tone = ma === "cancelled" ? "red" : ma === "workflow_completed" ? "green" : ma === "workflow_attention" ? "red" : ma === "workflow_new" ? "blue" : "amber";
    return el("span", { class: `pill ${tone}`, text: tabName(ma) || "—" });
  }

  function orderCard(order) {
    const items = list(order.items);
    const summary = items.slice(0, 2).map((m) => `${text(m.productCode)} · ${text(m.size)} ×${num(m.quantity || m.qty) || 1}`).join(", ")
      + (items.length > 2 ? ` +${items.length - 2}` : "");
    return el("button", { class: "card order", type: "button", onclick: () => openOrder(text(order.id)) },
      el("div", { class: "row between" },
        el("span", { class: "id", text: text(order.id) }),
        statusPill(order)
      ),
      el("div", { class: "row between" },
        el("span", { class: "cust ellipsis grow", text: text(order.customerName) || "Khách lẻ" }),
        el("span", { class: "money", text: money(order.total) })
      ),
      el("div", { class: "small muted ellipsis", text: summary || "Chưa có dòng hàng" }),
      el("div", { class: "small muted", text: [when(order.createdAt), text(order.phone)].filter(Boolean).join(" · ") })
    );
  }

  let searchTimer = 0;
  async function renderOrdersTab(reload) {
    const chips = el("div", { class: "chips", role: "tablist" });
    const allTabs = [{ ma: "", ten: "Tất cả" }, ...state.orderTabs];
    for (const t of allTabs) {
      const count = t.ma ? state.counts[t.ma] : undefined;
      chips.append(el("button", {
        class: `chip${state.nhom === t.ma ? " on" : ""}`, type: "button", role: "tab",
        onclick: () => { state.nhom = t.ma; renderOrdersTab(true); }
      }, t.ten, count !== undefined ? el("b", { text: String(num(count)) }) : null));
    }
    const input = el("input", { type: "search", placeholder: "Tìm mã đơn, tên, SĐT, mã hàng", value: state.q, enterkeyhint: "search" });
    input.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.q = input.value.trim(); refreshOrderList(); }, 400);
    });
    const search = el("label", { class: "search" }, "🔍", input);
    const listBox = el("div", { class: "stack", id: "m-order-list" });
    setView(search, chips, listBox);
    if (reload) {
      listBox.append(loading());
      if (!state.orderTabs.length && !state.countsTried) {
        state.countsTried = true;
        await loadCounts();
        if (state.tab !== "don") return;
        return renderOrdersTab(true);
      }
      loadCounts().then(() => { if (state.tab === "don") updateChipCounts(chips, allTabs); });
      await refreshOrderList();
    } else {
      fillOrderList(listBox);
    }
  }

  function updateChipCounts(chips, allTabs) {
    [...chips.children].forEach((chip, i) => {
      const t = allTabs[i];
      const b = chip.querySelector("b");
      if (t && t.ma && b) b.textContent = String(num(state.counts[t.ma]));
    });
  }

  async function refreshOrderList() {
    const box = $("m-order-list");
    if (!box) return;
    box.textContent = "";
    box.append(loading());
    await loadOrders();
    const again = $("m-order-list");
    if (again && state.tab === "don") fillOrderList(again);
  }

  function fillOrderList(box) {
    box.textContent = "";
    if (state.ordersError) { box.append(errorBox(state.ordersError)); return; }
    if (!state.orders.length) { box.append(el("div", { class: "empty", text: state.q ? "Không có đơn khớp ô tìm." : "Tab này chưa có đơn." })); return; }
    box.append(...state.orders.map(orderCard));
  }

  function telHref(phone) {
    const clean = text(phone).replace(/[^\d+]/g, "");
    return clean ? `tel:${clean}` : null;
  }

  function addressOf(order) {
    const parts = [text(order.addressDetail), text(order.ward), text(order.district), text(order.province)].filter(Boolean);
    return text(order.address) || parts.join(", ");
  }

  async function openOrder(id) {
    const body = openSheet(el("h3", { text: `Đơn ${id}` }), loading());
    try {
      const order = await api("GET", `/api/orders/${enc(id)}`);
      body.textContent = "";
      const phone = text(order.phone);
      const tel = telHref(phone);
      body.append(
        el("div", { class: "row between" }, el("h3", { text: `Đơn ${text(order.id)}` }), statusPill(order)),
        el("div", { class: "small muted", text: when(order.createdAt) }),
        el("div", { class: "card stack" },
          el("span", { class: "label", text: "Khách hàng" }),
          el("b", { text: text(order.customerName) || "Khách lẻ" }),
          phone ? (tel ? el("a", { href: tel, text: `📞 ${phone}` }) : el("span", { text: phone })) : el("span", { class: "muted", text: "Chưa có số điện thoại" }),
          el("span", { text: addressOf(order) || "Chưa có địa chỉ" }),
          text(order.note) ? el("span", { class: "small muted", text: `Ghi chú: ${text(order.note)}` }) : null,
          text(order.trackingCode) ? el("span", { class: "small", text: `Vận đơn: ${text(order.trackingCode)}` }) : null
        ),
        el("div", { class: "card" },
          el("span", { class: "label", text: `Hàng (${list(order.items).length})` }),
          ...list(order.items).map((m) => el("div", { class: "line" },
            el("div", { class: "thumb" }, text(m.imageUrl) && /^(https?:\/\/|\/)/i.test(text(m.imageUrl)) ? el("img", { src: text(m.imageUrl), alt: "", loading: "lazy" }) : "ảnh"),
            el("div", { class: "grow stack" },
              el("b", { class: "ellipsis", text: text(m.productName) || text(m.productCode) }),
              el("span", { class: "small muted", text: `${text(m.productCode)} · size ${text(m.size) || "—"} · ×${num(m.quantity || m.qty) || 1}` }),
              text(m.warehouseName) ? el("span", { class: "small muted", text: `Kho: ${text(m.warehouseName)}` }) : null
            ),
            el("span", { class: "num", text: money(m.price) })
          ))
        ),
        el("div", { class: "card kv" },
          el("span", { class: "k", text: "Tiền hàng" }), el("span", { class: "v", text: money(order.subtotal) }),
          el("span", { class: "k", text: "Phí ship" }), el("span", { class: "v", text: money(order.shippingFee) }),
          el("span", { class: "k", text: "Tổng" }), el("span", { class: "v big", text: money(order.total) }),
          el("span", { class: "k", text: "Đã trả" }), el("span", { class: "v", text: money(order.paidAmount) }),
          el("span", { class: "k", text: "Còn thu" }), el("span", { class: `v${num(order.remainingAmount) > 0 ? " warn" : ""}`, text: money(order.remainingAmount) })
        ),
        el("button", { class: "btn", type: "button", onclick: closeSheet, text: "Đóng" })
      );
    } catch (error) {
      body.textContent = "";
      body.append(errorBox(error.message), el("button", { class: "btn", type: "button", onclick: closeSheet, text: "Đóng" }));
    }
  }

  // ---------------------------------------------------------------- sheet

  function openSheet(...nodes) {
    const host = $("m-sheet");
    host.textContent = "";
    const sheet = el("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, el("div", { class: "grab" }));
    const body = el("div", { class: "stack" }, ...nodes);
    sheet.append(body);
    host.append(el("div", { class: "sheet-bg", onclick: closeSheet }), sheet);
    return body;
  }

  function closeSheet() {
    $("m-sheet").textContent = "";
  }

  // ---------------------------------------------------------------- Tra tồn

  function renderStockTab() {
    const q = el("input", { id: "m-stock-q", placeholder: "Mã hoặc tên sản phẩm", value: state.stockQuery.q, enterkeyhint: "search", autocomplete: "off" });
    const size = el("input", { id: "m-stock-size", placeholder: "Size", value: state.stockQuery.size, enterkeyhint: "search", autocomplete: "off" });
    const go = el("button", { class: "btn primary", type: "submit", text: "Tra tồn" });
    const form = el("form", { class: "card stack" },
      el("div", { class: "field" }, el("label", { for: "m-stock-q", text: "Mã / tên" }), q),
      el("div", { class: "row" },
        el("div", { class: "field grow" }, el("label", { for: "m-stock-size", text: "Size" }), size),
        el("div", { class: "field grow" }, el("label", { text: " " }), go)
      )
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      state.stockQuery = { q: q.value.trim(), size: size.value.trim() };
      runStockLookup();
    });
    const out = el("div", { class: "stack", id: "m-stock-out" });
    setView(form, out);
    if (state.stock) fillStock(out, state.stock);
    else out.append(el("div", { class: "empty", text: "Nhập mã hoặc tên rồi bấm Tra tồn." }));
  }

  async function runStockLookup() {
    const out = $("m-stock-out");
    if (!out) return;
    out.textContent = "";
    if (!state.stockQuery.q) { out.append(el("div", { class: "empty", text: "Nhập mã hoặc tên sản phẩm." })); return; }
    out.append(loading());
    try {
      const payload = await api("POST", "/api/tinh-nang-shop/tra-ton", { q: state.stockQuery.q, size: state.stockQuery.size });
      state.stock = payload;
      const again = $("m-stock-out");
      if (again && state.tab === "ton") fillStock(again, payload);
    } catch (error) {
      const again = $("m-stock-out");
      if (again) { again.textContent = ""; again.append(errorBox(error.message)); }
    }
  }

  function fillStock(out, payload) {
    out.textContent = "";
    const checked = payload.checkedAt ? new Date(payload.checkedAt) : null;
    $("m-sub").textContent = checked && !Number.isNaN(checked.getTime()) ? `Cập nhật ${checked.toLocaleTimeString("vi-VN")}` : "";
    const products = list(payload.products);
    if (products.length) {
      const images = list(payload.imageAssets);
      out.append(el("div", { class: "card" },
        el("span", { class: "label", text: `Sản phẩm (${products.length})` }),
        ...products.slice(0, 20).map((p) => {
          const asset = images.find((a) => text(a.code).toLowerCase() === text(p.code).toLowerCase());
          const src = asset && /^(https?:\/\/|\/)/i.test(text(asset.url)) ? text(asset.url) : "";
          return el("div", { class: "line" },
            el("div", { class: "thumb" }, src ? el("img", { src, alt: "", loading: "lazy" }) : "ảnh"),
            el("div", { class: "grow stack" },
              el("b", { class: "ellipsis", text: text(p.name) || text(p.code) }),
              el("span", { class: "small muted", text: [text(p.code), text(p.sourceName)].filter(Boolean).join(" · ") })
            ),
            el("div", { class: "stack end" },
              el("span", { class: "num", text: num(p.price) ? money(p.price) : "—" }),
              num(p.listPrice) > num(p.price) ? el("span", { class: "small muted strike", text: money(p.listPrice) }) : null
            )
          );
        })
      ));
    }
    const sources = list(payload.sources);
    if (!sources.length && !products.length) { out.append(el("div", { class: "empty", text: "Không thấy sản phẩm phù hợp." })); return; }
    for (const source of sources) out.append(sourceCard(source));
  }

  function sourceCard(source) {
    const name = text(source.sourceName) || text(source.source);
    if (!source.ok) {
      return el("div", { class: "card warn stack" }, el("b", { text: name }), el("span", { class: "small", text: text(source.message) || "Không tra được nguồn này." }));
    }
    const variants = list(source.variants);
    const card = el("div", { class: "card" },
      el("div", { class: "row between" },
        el("b", { text: name }),
        el("span", { class: "small muted", text: `${variants.length} dòng${source.editable ? "" : " · chỉ xem"}` })
      )
    );
    if (!variants.length) { card.append(el("div", { class: "small muted", text: "Không có size phù hợp." })); return card; }
    for (const v of variants) {
      const available = num(v.available);
      const row = el("div", { class: "stock-row" },
        el("div", { class: "stack tight" },
          el("span", { class: "ellipsis", text: text(v.productName) || text(v.productCode) }),
          el("span", { class: "small muted", text: [text(v.productCode), `size ${text(v.size) || "—"}`, num(v.price) ? money(v.price) : "", text(v.warehouseId)].filter(Boolean).join(" · ") })
        ),
        el("span", { class: `pill ${available > 0 ? "green" : "red"}`, text: String(available) })
      );
      if (source.editable === true) {
        const input = el("input", { type: "number", min: "0", step: "1", inputmode: "numeric", value: String(num(v.onHand != null ? v.onHand : v.available)), "aria-label": "Số tồn" });
        const save = el("button", { class: "btn sm dark", type: "button", text: "Lưu" });
        save.addEventListener("click", () => saveStock(source, v, input, save));
        row.append(el("div", { class: "stock-edit" }, el("span", { class: "small muted", text: "Số tồn" }), input, save));
      }
      card.append(row);
    }
    return card;
  }

  async function saveStock(source, variant, input, button) {
    const soLuong = Number(input.value);
    if (!Number.isInteger(soLuong) || soLuong < 0) { toast("Số tồn không hợp lệ.", true); return; }
    button.disabled = true;
    button.textContent = "Đang lưu…";
    try {
      const payload = await api("POST", "/api/tinh-nang-shop/sua-ton", {
        nguon: text(source.source), ma: text(variant.productCode), size: text(variant.size), soLuong
      });
      button.textContent = "Đã lưu ✓";
      button.classList.add("done");
      toast(text(payload.message) || "Đã cập nhật tồn.");
      setTimeout(runStockLookup, 800);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Lưu";
      toast(error.message, true);
    }
  }

  // ---------------------------------------------------------------- Kho

  function renderWarehouseTab() {
    const item = (href, title, note) => el("a", { class: "menu-item", href }, el("b", { text: title }), el("span", { text: note }));
    setView(
      el("div", { class: "menu-grid" },
        item("/scan", "📷 Quét tem", "Nhập kho và kiểm kho bằng camera"),
        item("/warehouse", "📦 Trang kho", "Tồn theo size, phiếu nhập, chuyển kho"),
        item("/admin", "🛠 Quản trị", "Trang quản trị đầy đủ")
      )
    );
  }

  // ---------------------------------------------------------------- start

  document.querySelectorAll(".m-tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("m-reload").addEventListener("click", () => {
    if (state.tab === "don") renderOrdersTab(true);
    else if (state.tab === "ton") { if (state.stockQuery.q) runStockLookup(); }
    else renderWarehouseTab();
  });
  window.addEventListener("hashchange", () => {
    const tab = location.hash.replace("#", "");
    if (TABS[tab] && tab !== state.tab) switchTab(tab);
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSheet(); });

  const start = location.hash.replace("#", "");
  switchTab(TABS[start] ? start : "don");
})();
