let products = [];
let cart = [];
let landingContent = {};
let adminUnitsPromise = null;
const PRODUCTS_PER_PAGE = 24;
let visibleProductCount = PRODUCTS_PER_PAGE;
const filters = {
  query: "",
  size: "all",
  gender: "all",
  category: "all",
  division: "all",
  brand: "all",
  warehouse: "all",
  priceMin: 0,
  priceMax: 0,
  sale: "all",
  ban: "all",
  sort: "sale-desc-random"
};

const grid = document.getElementById("product-grid");
const sizeFilter = document.getElementById("size-filter");
const cartPanel = document.getElementById("cart-panel");
const advancedFilters = document.getElementById("advanced-filters");
const filterToggle = document.getElementById("filter-toggle");

init();

async function init() {
  landingContent = await loadLandingContent();
  products = await fetch("/api/products").then((res) => res.json()).catch(() => []);
  normalizeProducts();
  populateAdvancedFilters();
  applyFiltersFromURL();
  refreshSizeFilterOptions();
  bindEvents();
  render();
  renderCart();
}

async function loadLandingContent() {
  try {
    const response = await fetch("/api/content");
    if (!response.ok) throw new Error("Cannot load content");
    return await response.json();
  } catch {
    return {};
  }
}

function contentText(key, fallback = "") {
  return String(landingContent?.[key] || fallback || "");
}

function normalizeProducts() {
  products = products.map((item) => ({
    ...item,
    _sport: normalizeSport(item.category || item.sport || inferSport(item)),
    _type: normalizeType(item.division || item.type || inferType(item), item),
    _gender: normalizeGender(item.gender || inferGender(item)),
    _brand: normalizeTextValue(item.brand || item.sourceName || "Chưa rõ"),
    _saleRandomRank: Math.random()
  }));
}

function productRuntimeKey(item = {}) {
  return String(item.offerKey || item.code || "").trim();
}

function productByRuntimeKey(key = "") {
  const text = String(key || "").trim();
  return products.find((item) => productRuntimeKey(item) === text || String(item.code || "") === text);
}

function bindEvents() {
  document.getElementById("query-filter").addEventListener("input", (event) => {
    filters.query = event.target.value.trim().toLowerCase();
    visibleProductCount = PRODUCTS_PER_PAGE;
    refreshSizeFilterOptions();
    updateFilterSummary();
    render();
  });
  sizeFilter.addEventListener("change", (event) => {
    filters.size = event.target.value;
    visibleProductCount = PRODUCTS_PER_PAGE;
    updateFilterSummary();
    render();
  });
  ["gender", "category", "division", "brand", "warehouse"].forEach((name) => {
    document.getElementById(`${name}-filter`).addEventListener("change", (event) => {
      filters[name] = event.target.value;
      visibleProductCount = PRODUCTS_PER_PAGE;
      refreshSizeFilterOptions();
      updateFilterSummary();
      render();
    });
  });
  document.getElementById("sort-filter")?.addEventListener("change", (event) => {
    filters.sort = event.target.value;
    visibleProductCount = PRODUCTS_PER_PAGE;
    updateFilterSummary();
    render();
  });
  document.getElementById("share-filters")?.addEventListener("click", copyShareFilterLink);
  filterToggle.addEventListener("click", () => {
    const open = advancedFilters.hidden;
    advancedFilters.hidden = !open;
    filterToggle.classList.toggle("open", open);
    filterToggle.setAttribute("aria-expanded", String(open));
    document.getElementById("filter-toggle-label").textContent = open ? "\u1ea8n b\u1ed9 l\u1ecdc" : "Hi\u1ec7n b\u1ed9 l\u1ecdc";
  });
  document.querySelectorAll("[data-sale-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      filters.sale = button.dataset.saleFilter || "all";
      visibleProductCount = PRODUCTS_PER_PAGE;
      refreshSizeFilterOptions();
      updateFilterSummary();
      render();
    });
  });
  document.querySelectorAll("[data-ban-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      filters.ban = filters.ban === "san" ? "all" : "san";
      visibleProductCount = PRODUCTS_PER_PAGE;
      updateFilterSummary();
      render();
    });
  });
  document.getElementById("reset-filters").addEventListener("click", resetFilters);
  document.getElementById("cart-button").addEventListener("click", () => cartPanel.classList.add("open"));
  document.getElementById("cart-close").addEventListener("click", () => cartPanel.classList.remove("open"));
  cartPanel.addEventListener("click", (event) => {
    if (event.target === cartPanel) cartPanel.classList.remove("open");
  });
  document.getElementById("checkout-button").addEventListener("click", openCheckoutDialog);
}

function trackMobileEvent(eventName, payload = {}, options = {}) {
  window.toprunAnalytics?.track?.(eventName, payload, options);
}

function render() {
  const items = sortedProducts(filteredProducts());
  const visible = items.slice(0, visibleProductCount);
  document.getElementById("result-count").textContent = `${visible.length}/${items.length} s\u1ea3n ph\u1ea9m`;
  grid.innerHTML = visible.map(productCard).join("");
  renderLoadMoreButton(items.length);
  grid.querySelectorAll("[data-add-code]").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".product-card");
      const select = card?.querySelector("[data-size-code]");
      const size = select?.value || "";
      if (!size) {
        alert("Vui lòng chọn size trước.");
        select?.focus();
        return;
      }
      addToCart(button.dataset.addCode, size);
      cartPanel.classList.add("open");
    });
  });
  syncFiltersToURL();
}

function normalizeWarehouseId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.startsWith("wh_")) return text;
  return `wh_${text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

function warehouseShortLabel(id = "", name = "") {
  const key = normalizeWarehouseId(id) || normalizeWarehouseId(name);
  if (/^wh_toprun(_|$)/.test(key)) return "TR";
  const known = {
    wh_yen: "Y",
    wh_cau_dien: "CD",
    wh_phuong_thu: "PT",
    wh_toprun: "TR",
    wh_hang_td: "HTD"
  };
  if (known[key]) return known[key];
  const source = String(name || id || "").replace(/^wh_/i, "").replace(/_/g, " ").trim();
  const initials = source.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").split(/\s+/).map((part) => part[0]).join("").toUpperCase();
  return initials.slice(0, 3) || source.slice(0, 3).toUpperCase();
}

function warehouseRowValue(row = {}) {
  return String(row.warehouseId || normalizeWarehouseId(row.warehouse || row.warehouseName)).trim();
}

function warehouseChoices(items = products) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((product) => {
    productSizeRows(product).forEach((row) => {
      if (Number(row.qty || 0) <= 0) return;
      const value = warehouseRowValue(row);
      if (!value) return;
      const name = String(row.warehouse || row.warehouseName || value).trim();
      if (!map.has(value)) map.set(value, { value, label: warehouseShortLabel(value, name), name });
    });
  });
  return [...map.values()].sort((left, right) => left.label.localeCompare(right.label, "vi", { numeric: true }));
}

function productMatchesWarehouseFilter(item = {}) {
  if (filters.warehouse === "all") return true;
  const rows = productSizeRows(item).filter((row) => Number(row.qty || 0) > 0);
  const rowMatch = rows.some((row) => {
    if (warehouseRowValue(row) !== filters.warehouse) return false;
    return filters.size === "all" || filterSizeLabel(item, row.size) === filters.size;
  });
  if (rowMatch) return true;
  if (filters.size !== "all") return false;
  if (Object.entries(item.warehouseStockIds || {}).some(([id, qty]) =>
    Number(qty || 0) > 0 && String(id || "").trim() === filters.warehouse
  )) return true;
  return Object.entries(item.warehouseStocks || {}).some(([name, qty]) =>
    Number(qty || 0) > 0 && normalizeWarehouseId(name) === filters.warehouse
  );
}

function productSizeRows(item = {}) {
  return Array.isArray(item.sizes) ? item.sizes : [];
}

// Kho hàng sẵn 2026-08-11: dòng size stockMode="ready" là hàng sẵn giao ngay.
function productHasReadyRow(item = {}) {
  return productSizeRows(item)
    .some((row) => String(row?.stockMode || "").trim().toLowerCase() === "ready" && Number(row?.qty ?? row?.available ?? 0) > 0);
}

function filteredProducts(options = {}) {
  const ignore = options.ignore || "";
  return products.filter((item) => {
    if (item.status !== "orderable") return false;
    if (ignore !== "size" && filters.size !== "all" && !filterProductSizes(item).includes(filters.size)) return false;
    if (ignore !== "gender" && filters.gender !== "all" && String(item._gender || "") !== filters.gender) return false;
    if (ignore !== "category" && filters.category !== "all" && String(item._sport || "") !== filters.category) return false;
    if (ignore !== "division" && filters.division !== "all" && String(item._type || "") !== filters.division) return false;
    if (ignore !== "brand" && filters.brand !== "all" && String(item._brand || "") !== filters.brand) return false;
    if (ignore !== "warehouse" && !productMatchesWarehouseFilter(item)) return false;
    const price = sellingPrice(item);
    if (filters.priceMin && price < filters.priceMin) return false;
    if (filters.priceMax && price > filters.priceMax) return false;
    if (filters.ban === "san" && !productHasReadyRow(item)) return false;
    if (ignore !== "sale" && filters.sale !== "all" && discountPercent(item) < Number(filters.sale || 0)) return false;
    const text = `${item.code} ${item.name} ${item.sourceName} ${item._brand} ${item._sport} ${item._type} ${genderDisplay(item._gender)} ${orderProductSizes(item).join(" ")} ${filterProductSizes(item).join(" ")}`.toLowerCase();
    return !filters.query || text.includes(filters.query);
  });
}

function sortedProducts(items) {
  const sorted = [...items];
  if (filters.sort === "sale-desc-random") {
    sorted.sort((left, right) =>
      discountPercent(right) - discountPercent(left)
      || (left._saleRandomRank || 0) - (right._saleRandomRank || 0)
      || String(left.code || "").localeCompare(String(right.code || ""), "vi")
    );
  }
  if (filters.sort === "price-asc") sorted.sort((left, right) => sellingPrice(left) - sellingPrice(right));
  if (filters.sort === "price-desc") sorted.sort((left, right) => sellingPrice(right) - sellingPrice(left));
  return sorted;
}

function renderLoadMoreButton(total) {
  document.getElementById("load-more-products")?.remove();
  if (visibleProductCount >= total) return;
  const button = document.createElement("button");
  button.id = "load-more-products";
  button.className = "load-more-products";
  button.type = "button";
  button.textContent = `Xem th\u00eam ${Math.min(PRODUCTS_PER_PAGE, total - visibleProductCount)} s\u1ea3n ph\u1ea9m`;
  button.addEventListener("click", () => {
    visibleProductCount += PRODUCTS_PER_PAGE;
    render();
  });
  grid.insertAdjacentElement("afterend", button);
}

function productCard(item) {
  const sizes = orderProductSizes(item);
  const image = displayImage(item);
  const salePct = discountPercent(item);
  const bag = isBagProduct(item);
  const dimension = bagDimension(item);
  const detailUrl = productDetailUrl(item);
  return `
    <article class="product-card">
      <a class="product-image-wrap" href="${escapeHTML(detailUrl)}" aria-label="Xem chi tiết ${escapeHTML(item.code)}">
        ${image ? `<img src="${escapeHTML(image)}" alt="" loading="lazy">` : `<div class="placeholder">${escapeHTML(item.code)}</div>`}
        ${salePct > 0 ? `<span class="sale-badge">-${salePct}%</span>` : ""}
        ${productHasReadyRow(item) ? `<span class="ready-badge" title="Có hàng sẵn giao ngay">SẴN</span>` : ""}
      </a>
      <div class="quick">
        <div class="product-info">
          <a class="product-name" href="${escapeHTML(detailUrl)}">${escapeHTML(item.name || item.code || "")}</a>
          <span class="product-code">${escapeHTML(item.code)}</span>
          ${bag ? `<span class="product-dimension">K\u00edch th\u01b0\u1edbc: ${escapeHTML(dimension || "NS")}</span>` : ""}
        </div>
        ${mobilePriceBlock(item)}
        <select data-size-code="${escapeHTML(productRuntimeKey(item))}" aria-label="Chọn size">
          <option value="">${bag ? "K\u00edch th\u01b0\u1edbc" : "Size"}</option>
          ${sizes.map((size) => `<option value="${escapeHTML(size)}">${escapeHTML(size)}</option>`).join("")}
        </select>
        <button type="button" data-add-code="${escapeHTML(productRuntimeKey(item))}">Thêm vào giỏ</button>
      </div>
    </article>
  `;
}

function displayImage(item) {
  return firstUsableProductImage(item);
}

function firstUsableProductImage(item = {}) {
  return orderedProductImages(item).find((value) => value && !isInternalThumbnailImage(value)) || "";
}

function orderedProductImages(item = {}) {
  const galleryImages = Array.isArray(item.galleryImages) ? item.galleryImages : [];
  const mainImages = [item.highImage, item.image, item.thumbnailImage];
  const galleryFirst = mainImages.some((value) => isGeneratedLocalMainImage(item, value)) && galleryImages.length;
  const images = galleryFirst
    ? [...galleryImages, ...mainImages]
    : [item.highImage, item.image, ...galleryImages, item.thumbnailImage];
  return [...new Set(images.map((value) => String(value || "").trim()).filter(Boolean))];
}

function isGeneratedLocalMainImage(item = {}, value) {
  const code = String(item.code || "").trim().replace(/[^a-z0-9._-]/gi, "");
  const url = String(value || "").trim().replace(/^\/+/, "");
  if (!code || !url) return false;
  return new RegExp(`^assets/products/${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(?:jpe?g|png|webp)$`, "i").test(url);
}

function isInternalThumbnailImage(value) {
  const url = String(value || "").trim().toLowerCase();
  if (!url) return true;
  if (/\/assets\/thumbnails\//.test(url) || /^assets\/thumbnails\//.test(url)) return true;
  if (/(^|[_/-])(thumb|thumbnail|compare|source-thumb|original-thumb)([_.\/-]|$)/i.test(url)) return true;
  return false;
}

function productDetailUrl(item) {
  return `/product/${encodeURIComponent(productSlug(item))}`;
}

function productSlug(item) {
  const source = String(item.slug || `${item.code || ""}-${item.name || ""}`).trim();
  return source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || String(item.code || "").trim();
}

function addToCart(code, size) {
  if (!size) return;
  const product = productByRuntimeKey(code);
  if (!product) return;
  const selectedRow = bestSizeRowForSelection(product, size) || {};
  const warehouseId = String(selectedRow.warehouseId || "").trim();
  const warehouse = String(selectedRow.warehouse || selectedRow.warehouseName || "").trim();
  const warehouseLabel = warehouseShortLabel(warehouseId, warehouse);
  const variantId = String(selectedRow.variantId || selectedRow.variant_id || "").trim();
  const key = variantId || `${productRuntimeKey(product)}__${size}__${warehouseId || warehouse}`;
  const current = cart.find((item) => item.key === key);
  if (current) {
    current.qty += 1;
  } else {
    cart.push({
      key,
      productCode: product.code,
      productName: product.name,
      sourceName: product.sourceName,
      partnerCampaign: Boolean(product.partnerCampaign),
      partnerSource: product.partnerSource || "",
      campaignId: product.campaignId || "",
      campaignName: product.campaignName || "",
      partnerCampaignLineId: selectedRow.partnerCampaignLineId || "",
      partnerProductUrl: product.sourcePageUrl || product.productUrl || "",
      variantId,
      size,
      price: sizeRowPrice(selectedRow) || sellingPriceForSize(product, size),
      saleFilePrice: sizeRowCostPrice(selectedRow, product),
      originalSalePrice: sizeRowCostPrice(selectedRow, product),
      preMarkupSalePrice: sizeRowCostPrice(selectedRow, product),
      listPrice: sizeRowListPrice(selectedRow, product),
      warehouseId,
      warehouse: warehouseLabel,
      warehouseName: warehouseLabel,
      stockMode: String(selectedRow.stockMode || "").toLowerCase() === "ready" ? "ready" : "",
      qty: 1
    });
  }
  trackMobileEvent("add_to_cart", {
    productCode: product.code,
    productName: product.name,
    size,
    qty: 1
  });
  renderCart();
}

function renderCart() {
  const count = cart.reduce((sum, item) => sum + item.qty, 0);
  const total = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
  document.getElementById("cart-count").textContent = count;
  document.getElementById("cart-total").textContent = formatMoney(total);
  document.getElementById("checkout-button").disabled = cart.length === 0;
  document.getElementById("cart-items").innerHTML = cart.length
    ? cart.map((item) => `
      <div class="cart-item">
        <div>
          <strong>${escapeHTML(item.productCode)}</strong><br>
          <span>Size ${escapeHTML(item.size)} x${item.qty}</span><br>
          <span>${formatMoney(item.price)}</span>
        </div>
        <button type="button" data-remove="${escapeHTML(item.key)}">X</button>
      </div>
    `).join("")
    : `<p>Chưa có sản phẩm.</p>`;
  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      cart = cart.filter((item) => item.key !== button.dataset.remove);
      renderCart();
    });
  });
}

function openCheckoutDialog() {
  if (!cart.length) return;
  trackMobileEvent("checkout_open", {
    itemCount: cart.length,
    totalQty: cart.reduce((sum, item) => sum + item.qty, 0)
  });
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const overlay = document.createElement("div");
  overlay.className = "order-overlay";
  overlay.innerHTML = `
    <form class="order-modal checkout-info-modal" id="order-form">
      <div class="order-head">
        <div>
          <strong>Thông tin nhận hàng</strong>
          <span>${cart.reduce((sum, item) => sum + item.qty, 0)} sản phẩm - ${formatMoney(total)}</span>
        </div>
        <button type="button" id="order-close">X</button>
      </div>
      <label>Họ tên
        <input name="customerName" autocomplete="name" required placeholder="Nguyễn Văn A">
      </label>
      <label>Số điện thoại
        <input name="phone" autocomplete="tel" inputmode="tel" required pattern="^(0|\+84)(3|5|7|8|9)[0-9]{8}$" placeholder="09xxxxxxxx">
      </label>
      <label>Email
        <input name="email" type="email" autocomplete="email" placeholder="email@example.com">
      </label>
      <label>Tỉnh/TP
        <input name="province" autocomplete="address-level1" required placeholder="Tìm Tỉnh/TP">
      </label>
      <label>Huyện/Quận
        <input name="district" autocomplete="address-level2" required placeholder="Chọn Tỉnh/TP trước">
      </label>
      <label>Xã/Phường
        <input name="ward" autocomplete="address-level3" required placeholder="Chọn Huyện/Quận trước">
      </label>
      <label>Địa chỉ chi tiết
        <input name="addressDetail" autocomplete="street-address" required placeholder="Số nhà, tên đường">
      </label>
      <label>Ghi chú
        <input name="note" placeholder="Màu sắc, thời gian nhận hàng...">
      </label>
      <input type="hidden" name="paymentMethod" value="manual_confirm">
      <button type="submit" id="order-submit-button">Xác nhận đơn hàng</button>
      <p id="order-message"></p>
    </form>
  `;
  document.body.appendChild(overlay);
  document.getElementById("order-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.getElementById("order-form").addEventListener("submit", submitOrder);
  bindAddressSelectors(document.getElementById("order-form"));
}

async function submitOrder(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const submitButton = formElement.querySelector('[type="submit"]');
  if (formElement.dataset.submitting === "1") return;
  const message = document.getElementById("order-message");
  const form = new FormData(formElement);
  const payload = Object.fromEntries(form.entries());
  const validationError = validateCheckoutPayload(payload);
  if (validationError) {
    message.textContent = validationError;
    return;
  }
  formElement.dataset.submitting = "1";
  const originalButtonText = submitButton?.textContent || "";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Dang gui...";
  }
  payload.phone = normalizePhone(payload.phone);
  payload.marketingOptIn = true;
  payload.address = [payload.addressDetail, payload.ward, payload.district, payload.province]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
  payload.items = cart;
  payload.total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  payload.paymentMethod = payload.paymentMethod || "manual_confirm";
  payload.attribution = window.toprunAnalytics?.attribution?.() || {};
  let response = null;
  let result = {};
  try {
    response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    result = await response.json().catch(() => ({}));
  } catch (error) {
    result = { message: "Chua gui duoc don, vui long thu lai." };
  }
  if (response?.ok) {
    message.textContent = "Đã nhận đơn. TopRun sẽ liên hệ xác nhận.";
    trackMobileEvent("order_success", {
      itemCount: cart.length,
      total: payload.total
    });
    cart = [];
    renderCart();
    cartPanel.classList.remove("open");
    setTimeout(() => {
      document.querySelector(".order-overlay")?.remove();
      showPaymentChatPrompt(result?.order || payload);
    }, 900);
  } else {
    message.textContent = result.message || "Chưa gửi được đơn, vui lòng thử lại.";
    formElement.dataset.submitting = "";
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
    }
  }
}

function validateCheckoutPayload(payload) {
  const requiredFields = [
    ["customerName", "Vui lòng nhập họ tên."],
    ["phone", "Vui lòng nhập số điện thoại."],
    ["province", "Vui lòng nhập Tỉnh/TP theo đơn vị hành chính cũ."],
    ["district", "Vui lòng nhập Huyện/Quận theo đơn vị hành chính cũ."],
    ["ward", "Vui lòng nhập Xã/Phường theo đơn vị hành chính cũ."],
    ["addressDetail", "Vui lòng nhập địa chỉ chi tiết."]
  ];
  for (const [field, error] of requiredFields) {
    if (field === "district" && String(payload.addressScheme || "") === "two_tier") continue;
    if (!String(payload[field] || "").trim()) return error;
  }
  if (!isValidVietnamPhone(payload.phone)) {
    return "Số điện thoại chưa đúng định dạng. Vui lòng nhập số Việt Nam, ví dụ 09xxxxxxxx.";
  }
  if (String(payload.email || "").trim() && !isValidEmail(payload.email)) {
    return "Email chưa đúng định dạng. Nếu không dùng email, quý khách có thể để trống.";
  }
  const adminError = validateSelectedAdminUnit(payload);
  if (adminError) return adminError;
  return "";
}

function normalizePhone(value) {
  return String(value || "").replace(/[\s.-]/g, "");
}

function isValidVietnamPhone(value) {
  return /^(0|\+84)(3|5|7|8|9)\d{8}$/.test(normalizePhone(value));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function loadAdminUnits() {
  if (!adminUnitsPromise) {
    adminUnitsPromise = fetch("/assets/admin-units-v1.json?v=20260620")
      .then((response) => response.ok ? response.json() : [])
      .then((units) => {
        window.__toprunAdminUnits = units;
        return units;
      })
      .catch(() => []);
  }
  return adminUnitsPromise;
}

function loadAdminUnitsV2() {
  if (!window.__toprunAdminUnitsV2Promise) {
    window.__toprunAdminUnitsV2Promise = fetch("/assets/admin-units-v2.json?v=20260801")
      .then((response) => response.ok ? response.json() : [])
      .then((units) => {
        window.__toprunAdminUnitsV2 = units;
        return units;
      })
      .catch(() => []);
  }
  return window.__toprunAdminUnitsV2Promise;
}

async function bindAddressSelectors(form) {
  // Da don ve bo chung TopRunAddressKit (address-kit.js): search ten -> chon tu danh muc,
  // 2 he dia chi (truoc day mobile chi co 3 cap va bat buoc Huyen). Giu phan tiem clientOrderId.
  if (!form) return;
  if (form.elements && !form.elements.clientOrderId) {
    const clientOrderIdInput = document.createElement("input");
    clientOrderIdInput.type = "hidden";
    clientOrderIdInput.name = "clientOrderId";
    clientOrderIdInput.value = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `co_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    form.append(clientOrderIdInput);
  }
  await Promise.all([loadAdminUnits(), loadAdminUnitsV2()]);
  if (window.TopRunAddressKit) window.TopRunAddressKit.bindAddressSelectors(form);
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

function setSelectOptions(select, values, placeholder = "Chọn") {
  select.innerHTML = [
    `<option value="">${escapeHTML(placeholder)}</option>`,
    ...values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
  ].join("");
}

function bindSelectSearch(searchInput, select, valuesProvider, placeholder) {
  if (!searchInput || !select) return;
  searchInput.addEventListener("input", () => {
    const query = normalizeAdminText(searchInput.value);
    const current = select.value;
    const values = valuesProvider();
    const filtered = query
      ? values.filter((value) => normalizeAdminText(value).includes(query))
      : values;
    setSelectOptions(select, filtered, placeholder);
    if (current && filtered.some((value) => normalizeAdminText(value) === normalizeAdminText(current))) {
      select.value = current;
    }
  });
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
  const list = items || [];
  const exact = list.find((item) => adminTextKeys(item.name)[0] === keys[0]);
  if (exact) return exact;
  return list.find((item) => {
    const itemKeys = adminTextKeys(item.name);
    return keys.some((key) => itemKeys.includes(key));
  }) || null;
}

function validateSelectedAdminUnit(payload) {
  if (String(payload.addressScheme || "") === "two_tier") {
    const unitsV2 = window.__toprunAdminUnitsV2 || [];
    if (!unitsV2.length) return "";
    const provinceV2 = findByName(unitsV2, payload.province);
    if (!provinceV2) return "Vui lòng chọn Tỉnh/TP (hệ 2 cấp) từ danh sách gợi ý.";
    const wardV2 = findByName(provinceV2.wards, payload.ward);
    if (!wardV2) return "Vui lòng chọn Xã/Phường đúng theo Tỉnh/TP đã chọn.";
    payload.province = provinceV2.name;
    payload.ward = wardV2.name;
    payload.district = "";
    return "";
  }
  const units = window.__toprunAdminUnits || [];
  if (!units.length) return "";
  const province = findByName(units, payload.province);
  if (!province) return "Vui lòng chọn Tỉnh/TP từ danh sách gợi ý.";
  const district = findByName(province.districts, payload.district);
  if (!district) return "Vui lòng chọn Huyện/Quận đúng theo Tỉnh/TP đã chọn.";
  const ward = findByName(district.wards, payload.ward);
  if (!ward) return "Vui lòng chọn Xã/Phường đúng theo Huyện/Quận đã chọn.";
  return "";
}

function normalizeAdminText(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

// Popup thanh toán sau đặt đơn + khối QR/tài khoản đã chuyển sang bản dùng chung checkout-shared.js
// (mobile.html nạp checkout-shared.js trước file này — không khai báo lại để tránh ghi đè hàm).

function showAccountPrompt(order, accountPrompt) {
  if (accountPrompt?.enabled === false) return;
  const phone = order?.phone || "";
  const overlay = document.createElement("div");
  overlay.className = "order-overlay";
  overlay.innerHTML = `
    <div class="order-modal account-prompt">
      <div class="order-head">
        <div>
          <strong>Tạo tài khoản theo dõi đơn</strong>
          <span>Quản lý lịch sử mua hàng và nhận thông báo sale.</span>
        </div>
        <button type="button" id="account-prompt-close">X</button>
      </div>
      <p>Bạn có muốn tạo tài khoản nhanh để theo dõi đơn hàng này không? Số điện thoại và địa chỉ chỉ lưu theo đơn khi bạn đặt hàng.</p>
      <button type="button" id="account-google-start">Tạo tài khoản</button>
      <button type="button" id="account-later" class="secondary-action">Để sau</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  document.getElementById("account-prompt-close").addEventListener("click", close);
  document.getElementById("account-later").addEventListener("click", close);
  document.getElementById("account-google-start").addEventListener("click", () => {
    window.location.href = `/account.html?phone=${encodeURIComponent(phone)}`;
  });
}

function refreshSizeFilterOptions() {
  const previousSize = filters.size;
  const sizes = availableSizesForCurrentType(filteredProducts({ ignore: "size" }));
  sizeFilter.innerHTML = `<option value="all">Size / kích thước</option>`;
  sizes.forEach((size) => {
    const option = document.createElement("option");
    option.value = size;
    option.textContent = size;
    sizeFilter.appendChild(option);
  });
  if (previousSize !== "all" && sizes.includes(previousSize)) {
    filters.size = previousSize;
    sizeFilter.value = previousSize;
  } else {
    filters.size = "all";
    sizeFilter.value = "all";
  }
}

function populateAdvancedFilters() {
  populateSelect("gender-filter", products.map((item) => item._gender), genderDisplay);
  populateSelect("category-filter", products.map((item) => item._sport));
  populateSelect("division-filter", ["Gi\u00e0y", "Qu\u1ea7n \u00e1o", "Balo", "T\u00fai x\u00e1ch", "M\u0169", "T\u1ea5t", "Ph\u1ee5 ki\u1ec7n"]);
  populateSelect("brand-filter", products.map((item) => item._brand));
  populateSelect("warehouse-filter", warehouseChoices().map((item) => item.value), (value) => {
    const choice = warehouseChoices().find((item) => item.value === value);
    return choice ? `Kho ${choice.label}` : warehouseShortLabel(value);
  });
  updateFilterSummary();
}

function populateSelect(id, values, display = (value) => value) {
  const select = document.getElementById(id);
  uniqueValues(values).forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = display(value);
    select.appendChild(option);
  });
}

function resetFilters() {
  visibleProductCount = PRODUCTS_PER_PAGE;
  Object.assign(filters, {
    query: "",
    size: "all",
    gender: "all",
    category: "all",
    division: "all",
    brand: "all",
    warehouse: "all",
    priceMin: 0,
    priceMax: 0,
    sale: "all",
    ban: "all",
    sort: "sale-desc-random"
  });
  ["size", "gender", "category", "division", "brand", "warehouse"].forEach((name) => {
    document.getElementById(`${name}-filter`).value = "all";
  });
  const sortSelect = document.getElementById("sort-filter");
  if (sortSelect) sortSelect.value = "sale-desc-random";
  refreshSizeFilterOptions();
  document.querySelectorAll("[data-sale-filter]").forEach((button) => {
    button.classList.toggle("active", (button.dataset.saleFilter || "all") === "all");
  });
  document.getElementById("query-filter").value = "";
  updateFilterSummary();
  render();
}

function applyFiltersFromURL() {
  const params = new URLSearchParams(window.location.search);
  filters.query = String(params.get("q") || params.get("query") || "").trim().toLowerCase();
  filters.size = params.get("size") || "all";
  filters.gender = params.get("gender") || "all";
  filters.category = params.get("sport") || params.get("category") || "all";
  filters.division = params.get("type") || params.get("division") || "all";
  filters.brand = params.get("brand") || "all";
  filters.warehouse = params.get("warehouse") || "all";
  filters.priceMin = filterPriceFromURL(params.get("price_min"));
  filters.priceMax = filterPriceFromURL(params.get("price_max"));
  filters.sale = params.get("sale") || "all";
  filters.ban = params.get("ban") || "all";
  filters.sort = params.get("sort") || "sale-desc-random";

  document.getElementById("query-filter").value = filters.query;
  ["gender", "category", "division", "brand", "warehouse", "sort"].forEach((name) => {
    const select = document.getElementById(`${name}-filter`);
    if (select) select.value = filters[name];
  });
  updateFilterSummary();
}

function syncFiltersToURL() {
  const url = new URL(window.location.href);
  ["q", "query", "size", "gender", "sport", "category", "type", "division", "brand", "warehouse", "price_min", "price_max", "sale", "ban", "sort"].forEach((key) => url.searchParams.delete(key));
  if (filters.query) url.searchParams.set("q", filters.query);
  if (filters.size !== "all") url.searchParams.set("size", filters.size);
  if (filters.gender !== "all") url.searchParams.set("gender", filters.gender);
  if (filters.category !== "all") url.searchParams.set("sport", filters.category);
  if (filters.division !== "all") url.searchParams.set("type", filters.division);
  if (filters.brand !== "all") url.searchParams.set("brand", filters.brand);
  if (filters.warehouse !== "all") url.searchParams.set("warehouse", filters.warehouse);
  if (filters.priceMin) url.searchParams.set("price_min", String(filters.priceMin));
  if (filters.priceMax) url.searchParams.set("price_max", String(filters.priceMax));
  if (filters.sale !== "all") url.searchParams.set("sale", filters.sale);
  if (filters.ban === "san") url.searchParams.set("ban", "san");
  if (filters.sort !== "sale-desc-random") url.searchParams.set("sort", filters.sort);
  const next = url.href;
  if (next !== window.location.href) {
    window.history.replaceState(window.history.state, document.title, next);
  }
}

function filterShareQuery() {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.size !== "all") params.set("size", filters.size);
  if (filters.gender !== "all") params.set("gender", filters.gender);
  if (filters.category !== "all") params.set("sport", filters.category);
  if (filters.division !== "all") params.set("type", filters.division);
  if (filters.brand !== "all") params.set("brand", filters.brand);
  if (filters.warehouse !== "all") params.set("warehouse", filters.warehouse);
  if (filters.priceMin) params.set("price_min", String(filters.priceMin));
  if (filters.priceMax) params.set("price_max", String(filters.priceMax));
  if (filters.sale !== "all") params.set("sale", filters.sale);
  if (filters.ban === "san") params.set("ban", "san");
  if (filters.sort !== "sale-desc-random") params.set("sort", filters.sort);
  return params.toString();
}

// Link chia se phai thuan ASCII: Facebook/Messenger cat link tai khoang trang / ky tu co dau,
// nen goi bo loc vao token base64url; server route /l/<token> se 302 ve link loc day du.
function shareFilterUrl() {
  const params = new URLSearchParams(filterShareQuery());
  const ref = ctvRefCode();
  if (ref) params.set("ref", ref);
  const query = params.toString();
  if (!query) return `${window.location.origin}/`;
  const token = btoa(query).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${window.location.origin}/l/${token}`;
}

// Ma gioi thieu cua CTV dang dang nhap (window.__ctvRefCode do ctvAffiliateModeInit gan,
// fallback ?ref tren URL) - moi nut copy link phai gan ref nay de don duoc tinh hoa hong.
function ctvRefCode() {
  try {
    return window.__ctvRefCode || new URLSearchParams(window.location.search).get("ref") || "";
  } catch {
    return "";
  }
}

async function copyShareFilterLink(event) {
  const button = event?.currentTarget || document.getElementById("share-filters");
  const link = shareFilterUrl();
  let copied = false;
  try {
    await navigator.clipboard.writeText(link);
    copied = true;
  } catch {
    copied = false;
  }
  if (!copied) {
    window.prompt("Copy link chia sẻ bộ lọc:", link);
    return;
  }
  if (button) {
    const original = button.textContent;
    button.textContent = "Đã copy link ✓";
    setTimeout(() => { button.textContent = original; }, 2000);
  }
}

function filterPriceFromURL(value) {
  const number = Number(String(value || "").replace(/[^\d]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function updateFilterSummary() {
  const count = ["size", "gender", "category", "division", "brand", "warehouse", "sale", "ban"]
    .filter((name) => filters[name] !== "all").length + (filters.priceMin ? 1 : 0) + (filters.priceMax ? 1 : 0)
    + (filters.sort !== "sale-desc-random" ? 1 : 0);
  document.getElementById("filter-count").textContent = count;
  filterToggle.classList.toggle("active", count > 0);
  document.querySelectorAll("[data-sale-filter]").forEach((button) => {
    button.classList.toggle("active", (button.dataset.saleFilter || "all") === filters.sale);
  });
  document.querySelectorAll("[data-ban-filter]").forEach((button) => {
    button.classList.toggle("active", filters.ban === "san");
  });
}

function isBagProduct(item) {
  const text = `${item.name || ""} ${item.productUrl || ""} ${item.detailUrl || ""} ${item.division || ""}`.toLowerCase();
  return /(backpack|balo|ba-lo|ba lo|bag|tui|duffel|tote|waistbag|x-body)/i.test(text)
    || rawAvailableProductSizes(item).some((size) => /^kt\s*:/i.test(size));
}

function bagDimension(item) {
  const dimension = rawAvailableProductSizes(item).find((size) => /^kt\s*:/i.test(size));
  return dimension ? dimension.replace(/^kt\s*:\s*/i, "") : rawAvailableProductSizes(item)[0] || "";
}

function availableSizes(items = products) {
  return [...new Set(items.flatMap((item) => filterProductSizes(item)))]
    .sort((a, b) => sizeSortValue(a) - sizeSortValue(b) || a.localeCompare(b, "vi"));
}

function availableSizesForCurrentType(items = products) {
  const selectedTypes = filters.division === "all" ? uniqueValues(items.map((item) => item._type)) : [filters.division];
  const allowedFamilies = new Set();
  if (selectedTypes.includes("Giày")) allowedFamilies.add("shoe");
  if (selectedTypes.includes("Quần áo")) allowedFamilies.add("apparel");
  if (selectedTypes.some((type) => ["Phụ kiện", "Balo", "Túi xách", "Mũ", "Tất"].includes(type))) allowedFamilies.add("accessory");
  return availableSizes(items).filter((size) => {
    const family = sizeFamily(size);
    return !allowedFamilies.size || allowedFamilies.has(family);
  });
}

function sizeFamily(size) {
  const text = String(size || "").trim();
  if (!text) return "accessory";
  if (normalizeApparelSize(text)) return "apparel";
  if (/^U[SK]\s*\d/i.test(text)) return "shoe";
  if (/^(OS|OSF[MW]?|ONE SIZE|ONESIZE|FREE|F|TU|NS)$/i.test(text)) return "accessory";
  if (/^KT\s*:/i.test(text)) return "accessory";
  if (/^\d{2,3}\s+(?:1\/3|2\/3)$/.test(text)) return "shoe";
  if (/^\d{2,3}(?:[.,]5)?$/.test(text)) return Number(text.replace(",", ".")) >= 20 ? "shoe" : "accessory";
  if (/^\d+(?:[.,]\d+)?\s*(CM|MM|ML|L)$/i.test(text)) return "accessory";
  return "accessory";
}

function normalizeApparelSize(size) {
  let text = String(size || "").trim().toUpperCase().replace(/\\/g, "/").replace(/\s+/g, "").replace(/^A-/, "A/");
  text = text.replace(/^A(?=(?:2?XS|XXS|S|M|L|XL|XXL|XXXL|[2-5]XL|\d{2})(?:\d|["”']|IN|INCH|AB|S)?$)/i, "A/");
  const match = text.match(/^A\/?(2XS|XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)(?:\d*(?:"|”|'|IN|INCH)?|AB|\/?S)?$/i);
  if (match) return `A/${match[1].toUpperCase()}`;
  const numericWaist = text.match(/^A\/?(\d{2,3})$/i);
  if (numericWaist) return `A/${numericWaist[1]}`;
  const alpha = text.match(/^(2XS|XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)(?:\d+(?:"|”|'|IN|INCH)?)?$/i);
  if (alpha) return alpha[1].toUpperCase();
  if (/^\d{2}\s*(?:"|”|'|IN|INCH)$/i.test(String(size || "").trim())) return text;
  if (/^\d{2,3}[A-Z]$/i.test(text)) return text;
  if (/^\d{2,3}$/.test(text) && Number(text) >= 70 && Number(text) <= 176) return text;
  if (/^\d{4}$/.test(text)) {
    const waist = Number(text.slice(0, 2));
    const length = Number(text.slice(2));
    if (waist >= 24 && waist <= 44 && length >= 24 && length <= 38) return text;
  }
  return "";
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "vi", { numeric: true }));
}

function genderDisplay(value) {
  return {
    ME: "Nam",
    WO: "N\u1eef",
    UN: "Unisex",
    KI: "Tr\u1ebb em",
    GI: "B\u00e9 g\u00e1i"
  }[String(value || "").trim().toUpperCase()] || String(value || "");
}

function normalizeGender(value) {
  const text = String(value || "").trim();
  if (!text) return "UN";
  const upper = text.toUpperCase();
  return {
    ME: "ME",
    MEN: "ME",
    MAN: "ME",
    WO: "WO",
    WOMEN: "WO",
    WOMAN: "WO",
    UN: "UN",
    KI: "KI",
    KIDS: "KI",
    GI: "GI"
  }[upper] || text;
}

function inferGender(item) {
  const text = productText(item);
  if (/(women|woman|nữ|nu |womens|girl|bé gái)/i.test(text)) return "WO";
  if (/(kids|kid|junior|youth|trẻ em|tre em|boys|girls)/i.test(text)) return "KI";
  if (/(men|man|nam|mens)/i.test(text)) return "ME";
  return "UN";
}

function inferSport(item) {
  const text = productText(item);
  if (/golf/i.test(text)) return "Golf";
  if (/tennis/i.test(text)) return "Tennis";
  if (/football|soccer/i.test(text)) return "Bóng đá";
  if (/basketball/i.test(text)) return "Bóng rổ";
  if (/yoga|training|gym/i.test(text)) return "Training";
  if (/run|runner|running|adizero|ultraboost|supernova/i.test(text)) return "Running";
  return "Lifestyle";
}

function inferType(item) {
  const text = productText(item);
  if (/(kt:|backpack|balo|ba lo|bpk|\bbp\b)/i.test(text)) return "Balo";
  if (/(bag|túi|tui|duffel|duffle|tote|pouch|waistbag|x-body|x body)/i.test(text)) return "Túi xách";
  if (/(lace|laces|dây giày|day giay)/i.test(text)) return "Phụ kiện";
  if (/(tee|shirt|t-shirt|áo|ao |short|shorts|quần|quan |pant|pants|tight|jacket|hoodie|jersey|bra|skirt|dress)/i.test(text)) return "Quần áo";
  if (hasApparelSizes(item)) return "Quần áo";
  if (/(shoe|shoes|giày|giay|sandal|sneaker|boot|footwear)/i.test(text)) return "Giày";
  if (/(cap|hat|mũ|mu |sock|socks|tất|tat |bottle|bình|binh|glove|arm band|headband|lace|dây giày|day giay)/i.test(text)) return "Phụ kiện";
  return "Phụ kiện";
}

function productText(item) {
  return `${item.name || ""} ${item.code || ""} ${item.category || ""} ${item.division || ""} ${orderProductSizes(item).join(" ")} ${filterProductSizes(item).join(" ")}`;
}

function normalizeLookupText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSport(value) {
  const text = normalizeLookupText(value);
  if (!text) return "Lifestyle";
  if (/\brunning\b|\brun\b|runner|adizero|ultraboost|supernova/.test(text)) return "Running";
  if (/\btraining\b|gym|yoga/.test(text)) return "Training";
  if (/\bgolf\b/.test(text)) return "Golf";
  if (/\btennis\b/.test(text)) return "Tennis";
  if (/\bfootball\b|soccer|bong da/.test(text)) return "Bóng đá";
  if (/\bbasketball\b|bong ro/.test(text)) return "Bóng rổ";
  if (/\blifestyle\b|casual|originals/.test(text)) return "Lifestyle";
  return String(value || "").trim() || "Lifestyle";
}

function typeFromText(value) {
  const text = normalizeLookupText(value);
  if (!text) return "";
  if (/\b(footwear|foot wear|shoe|shoes|sneaker|sneakers|trainer|trainers|sandal|sandals|boot|boots|giay)\b/.test(text)) return "Gi\u00e0y";
  if (/\b(apparel|clothing|clothes|garment|garments|tee|tees|shirt|shirts|t shirt|t shirts|short|shorts|pant|pants|tight|tights|jacket|jackets|hoodie|hoodies|jersey|jerseys|bra|bras|skirt|skirts|dress|dresses|ao|quan)\b/.test(text)) return "Qu\u1ea7n \u00e1o";
  if (/\b(backpack|backpacks|balo|ba lo|bpk|bp)\b/.test(text)) return "Balo";
  if (/\b(bag|bags|tui|duffel|duffle|tote|pouch|waist|x body)\b/.test(text)) return "T\u00fai x\u00e1ch";
  if (/\b(cap|caps|hat|hats|mu|non|beanie)\b/.test(text)) return "M\u0169";
  if (/\b(sock|socks|tat|vo)\b/.test(text)) return "T\u1ea5t";
  if (/\b(hardware|accessory|accessories|equipment|gear|bottle|bottles|binh|glove|gloves|headband|headbands|lace|laces|day giay|phu kien)\b/.test(text)) return "Ph\u1ee5 ki\u1ec7n";
  return "";
}

function normalizeType(value, item = {}) {
  if (item.productKind === "shoe") return "Gi\u00e0y";
  if (item.productKind === "apparel") return "Qu\u1ea7n \u00e1o";
  if (item.accessoryType) return typeFromText(item.accessoryType) || item.accessoryType;
  const inferredType = typeFromText([
    item.name,
    item.productUrl,
    item.sourcePageUrl,
    item.detailUrl,
    item.category
  ].filter(Boolean).join(" "));
  if (inferredType) return inferredType;

  if (hasApparelSizes(item)) return "Qu\u1ea7n \u00e1o";

  const directType = typeFromText(value) || typeFromText(item.division) || typeFromText(item.type);
  if (directType) return directType;
  return "Ph\u1ee5 ki\u1ec7n";
}

function hasApparelSizes(item) {
  return filterProductSizes(item).some((size) => Boolean(normalizeApparelSize(size)));
}

function normalizeTextValue(value) {
  return String(value || "").trim() || "Khác";
}

function availableProductSizes(item) {
  return filterProductSizes(item);
}

function filterProductSizes(item) {
  const rawSizes = rawAvailableProductSizes(item);
  if (isBagProduct(item) && rawSizes.length) return ["NS"];
  return uniqueValues(rawSizes.map((size) => filterSizeLabel(item, size)));
}

// Size hien trong BO LOC: nhan US/UK cua hang campaign (HOKA, Mizuno...) quy ve EU
// theo bang tung hang trong size-chart-kit.js. Chi doi o tang loc - size goc tren
// san pham/don hang giu nguyen (quy tac 2026-08-13).
function filterSizeLabel(item, rawSize) {
  const raw = String(rawSize || "").trim();
  const kit = window.SizeChartKit;
  const eu = kit ? kit.euFilterSize(item?.brand || item?._brand, raw, kit.inferShoeGender(item)) : "";
  if (eu) return eu;
  return normalizeApparelSize(raw) || raw;
}

function orderProductSizes(item) {
  const rawSizes = rawAvailableProductSizes(item)
    .map((size) => String(size || "").trim())
    .filter(Boolean);
  if (isBagProduct(item) && rawSizes.length) return ["NS"];
  return uniqueValues(rawSizes);
}

function rawAvailableProductSizes(item) {
  return (Array.isArray(item?.sizes) ? item.sizes : [])
    .filter((size) => Number(size.qty || 0) > 0)
    .map((size) => String(size.size));
}

function mobilePriceBlock(item) {
  const priceRange = priceRangeForProduct(item);
  const hasPriceRange = Boolean(priceRange && priceRange.min > 0 && priceRange.max > priceRange.min);
  return `
    <div class="mobile-price-stack">
      <strong>${hasPriceRange ? formatCompactPriceRange(priceRange) : formatMoney(sellingPrice(item))}</strong>
      ${hasPriceRange ? `<span class="price-size-note">Giá thay đổi theo size</span>` : ""}
    </div>
  `;
}

function priceRangeForProduct(item) {
  const rows = (Array.isArray(item?.sizes) ? item.sizes : []).filter((size) =>
    filters.warehouse === "all" || warehouseRowValue(size) === filters.warehouse
  );
  const sourceRows = rows.length ? rows : (Array.isArray(item?.sizes) ? item.sizes : []);
  const prices = uniqueNumbers(sourceRows.map((size) => sizeRowPrice(size)).filter((price) => price > 0));
  if (prices.length < 2) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function sellingPrice(item) {
  const rows = (Array.isArray(item?.sizes) ? item.sizes : []).filter((size) =>
    filters.warehouse === "all" || warehouseRowValue(size) === filters.warehouse
  );
  const sourceRows = rows.length ? rows : (Array.isArray(item?.sizes) ? item.sizes : []);
  const sizePrices = sourceRows
    .map((size) => firstPositiveNumber(size.suggestedPrice, size.salePrice, size.sellPrice, size.price))
    .filter((price) => price > 0);
  return sizePrices.length ? Math.min(...sizePrices) : firstPositiveNumber(item.suggestedPrice, item.salePrice, item.sellPrice, item.price);
}

function sellingPriceForSize(item, selectedSize) {
  const match = bestSizeRowForSelection(item, selectedSize);
  return firstPositiveNumber(match?.suggestedPrice, match?.salePrice, match?.sellPrice, match?.price) || sellingPrice(item);
}

function sizeRowPrice(row = {}) {
  return firstPositiveNumber(row.suggestedPrice, row.salePrice, row.sellPrice, row.price);
}

function sizeRowCostPrice(row = {}, item = {}) {
  return firstPositiveNumber(row.saleFilePrice, row.originalSalePrice, row.preMarkupSalePrice, item.saleFilePrice, item.originalSalePrice, item.preMarkupSalePrice);
}

function sizeRowListPrice(row = {}, item = {}) {
  return firstPositiveNumber(row.listPrice, row.originalPrice, item.listPrice, item.originalPrice);
}

function warehousePriorityIndex(item = {}, row = {}) {
  const publicRank = Number(row.selectionRank);
  if (Number.isFinite(publicRank)) return publicRank;
  const rowId = warehouseRowValue(row);
  const rowName = String(row.warehouse || row.warehouseName || "").trim();
  const keys = [];
  (Array.isArray(item.warehousePriorityIds) ? item.warehousePriorityIds : []).forEach((value) => keys.push(String(value || "").trim()));
  (Array.isArray(item.warehousePriority) ? item.warehousePriority : []).forEach((value) => keys.push(normalizeWarehouseId(value)));
  (Array.isArray(item.warehouseMeta) ? item.warehouseMeta : []).forEach((meta) => {
    keys.push(String(meta?.id || "").trim());
    keys.push(normalizeWarehouseId(meta?.name));
  });
  const normalizedKeys = keys.filter(Boolean);
  const candidates = [rowId, normalizeWarehouseId(rowName)].filter(Boolean);
  const index = normalizedKeys.findIndex((key) => candidates.includes(key));
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function compareSizeRowsForSelection(item = {}) {
  return (left, right) => {
    const leftPrice = sizeRowPrice(left) || Number.MAX_SAFE_INTEGER;
    const rightPrice = sizeRowPrice(right) || Number.MAX_SAFE_INTEGER;
    if (leftPrice !== rightPrice) return leftPrice - rightPrice;
    const leftPriority = warehousePriorityIndex(item, left);
    const rightPriority = warehousePriorityIndex(item, right);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return warehouseRowValue(left).localeCompare(warehouseRowValue(right), "vi", { numeric: true });
  };
}

function bestSizeRowForSelection(item, selectedSize) {
  const normalized = String(selectedSize || "").trim().toLowerCase();
  const rows = (Array.isArray(item?.sizes) ? item.sizes : []).filter((size) => String(size.size || "").trim().toLowerCase() === normalized);
  const warehouseRows = filters.warehouse !== "all"
    ? rows.filter((size) => warehouseRowValue(size) === filters.warehouse)
    : rows;
  const candidates = (warehouseRows.length ? warehouseRows : rows).filter((row) => Number(row.qty ?? row.available ?? row.stockQty ?? 0) > 0);
  const sourceRows = candidates.length ? candidates : (warehouseRows.length ? warehouseRows : rows);
  return sourceRows
    .slice()
    .sort(compareSizeRowsForSelection(item))[0] || null;
}

function listedPrice(item) {
  return firstPositiveNumber(item.listPrice, item.originalPrice, item.retailPrice, item.marketPrice, item.msrp);
}

function originalSalePrice(item) {
  return firstPositiveNumber(item.preMarkupSalePrice, item.originalSalePrice, item.saleFilePrice, item.baseSalePrice, item.rawSalePrice);
}

function discountPercent(item) {
  const explicit = firstPositiveNumber(item.discountPercent, item.discount_percent);
  if (explicit > 0) return Math.round(explicit);
  const ratio = Number(item.saleRatio || item.sale_ratio || 0);
  if (ratio > 0) return Math.round((ratio <= 1 ? ratio * 100 : ratio));
  const listPrice = listedPrice(item);
  const salePrice = originalSalePrice(item) || sellingPrice(item);
  if (!listPrice || !salePrice || salePrice >= listPrice) return 0;
  return Math.round((1 - salePrice / listPrice) * 100);
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value || 0);
    if (number > 0) return number;
  }
  return 0;
}

function sizeSortValue(value) {
  const match = String(value).match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : 9999;
}

function formatMoney(value) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value || 0);
}

function formatCompactPriceRange(range) {
  return `${formatCompactK(range.min)}-${formatCompactK(range.max)}`;
}

function formatCompactK(value) {
  return `${Math.round(Number(value || 0) / 1000)}K`;
}

function uniqueNumbers(values) {
  return [...new Set(values.map((value) => Number(value || 0)).filter((value) => value > 0))];
}

function escapeHTML(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ===== Che do CTV khi dang nhap (dot 2026-08-16, dong bo voi app.js/product.js) =====
// Server chuyen dien thoai tu "/" sang "/mobile" nen ban mobile cung phai co: URL tu gan
// ?ref=CODE (khong reload) + badge goc man hinh, de link CTV copy/chia se mang ma gioi thieu.
(function ctvAffiliateModeInit() {
  const CACHE_KEY = "ctv_me_cache";
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const apply = (account) => {
    const code = String(account?.code || "").trim().toUpperCase();
    if (!code) return;
    window.__ctvRefCode = code;
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.get("ref")) {
        url.searchParams.set("ref", code);
        window.history.replaceState(window.history.state, "", url.toString());
      }
    } catch {}
    if (document.getElementById("ctv-affiliate-badge")) return;
    const badge = document.createElement("div");
    badge.id = "ctv-affiliate-badge";
    badge.textContent = `CTV ${code} · link đã gắn ref`;
    badge.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:9999;background:rgba(17,24,39,.85);color:#fff;font:600 11px/1.4 system-ui,sans-serif;padding:5px 10px;border-radius:999px;pointer-events:none;max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const attach = () => document.body?.appendChild(badge);
    if (document.body) attach(); else document.addEventListener("DOMContentLoaded", attach, { once: true });
  };
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (cached && Date.now() - Number(cached.at || 0) < CACHE_TTL_MS) {
      if (cached.account) apply(cached.account);
      return;
    }
  } catch {}
  fetch("/api/ctv/me", { credentials: "same-origin", cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      const account = payload && payload.ok ? payload.data : null;
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), account: account ? { code: account.code, name: account.name } : null })); } catch {}
      if (account) apply(account);
    })
    .catch(() => {});
})();
