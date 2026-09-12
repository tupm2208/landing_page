let products = [];
let cart = [];
let landingContent = {};
let adminUnitsPromise = null;
const PRODUCTS_PER_PAGE = 24;
let visibleProductCount = PRODUCTS_PER_PAGE;

const filters = {
  query: "",
  sport: [],
  type: [],
  size: [],
  gender: [],
  brand: [],
  warehouse: [],
  priceMin: 0,
  priceMax: 0,
  status: "orderable",
  sale: "all",
  ban: "all",
  sort: "sale-desc-random"
};

const multiFilterKeys = ["sport", "type", "size", "gender", "brand", "warehouse"];

const grid = document.getElementById("product-grid");
const resultCount = document.getElementById("result-count");
const featuredProduct = document.getElementById("featured-product");
const activeFilterRow = document.getElementById("active-filter-row");

const genderLabels = {
  ME: "Nam",
  MEN: "Nam",
  MAN: "Nam",
  WO: "Nữ",
  WOMEN: "Nữ",
  WOMAN: "Nữ",
  UN: "Unisex",
  KI: "Trẻ em",
  KIDS: "Trẻ em",
  GI: "Bé gái"
};

const typeChoices = [
  { value: "all", label: "T\u1ea5t c\u1ea3" },
  { value: "Gi\u00e0y", label: "Gi\u00e0y" },
  { value: "Qu\u1ea7n \u00e1o", label: "Qu\u1ea7n \u00e1o" },
  { value: "Balo", label: "Balo" },
  { value: "T\u00fai x\u00e1ch", label: "T\u00fai x\u00e1ch" },
  { value: "M\u0169", label: "M\u0169" },
  { value: "T\u1ea5t", label: "T\u1ea5t" },
  { value: "Ph\u1ee5 ki\u1ec7n", label: "Ph\u1ee5 ki\u1ec7n" }
];

const orderInfoHTML = `
  <p>Hàng order thanh toán trước 20%, đặt hàng thông thường từ 3-7 ngày.</p>
  <p>Xin liên hệ fanpage toprunvn hoặc Zalo 0968411655 để xác nhận đơn hàng và chuyển khoản.</p>
`;

async function init() {
  refreshHeaderAccountLink();
  landingContent = await loadLandingContent();
  products = await loadProducts();
  normalizeProducts();
  applyLandingContent();
  simplifyFilterPanel();
  cart = loadStoredCart();
  ensureCartUI();
  populateFilterOptions();
  applyFiltersFromURL();
  bindFilters();
  renderStats();
  render();
  renderCart();
}

async function refreshHeaderAccountLink() {
  const link = document.getElementById("header-account-link");
  if (!link) return;
  try {
    const response = await fetch("/api/account/me", { credentials: "same-origin" });
    const result = await response.json().catch(() => null);
    if (response.ok && result?.customer) {
      link.textContent = "Xem thông tin tài khoản của bạn";
      link.href = "/account-manage.html";
      return;
    }
  } catch {}
  link.textContent = "Đăng nhập / Đăng ký";
  link.href = "/account.html";
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

function applyLandingContent() {
  const heroEyebrow = document.querySelector(".hero .eyebrow");
  const heroTitle = document.querySelector(".hero h1");
  const heroDescription = document.querySelector(".hero-copy > p:not(.eyebrow)");
  const primaryButton = document.querySelector(".hero-actions .primary-button");
  const secondaryButton = document.getElementById("show-orderable-button");
  const productTitle = document.querySelector(".section-heading h2");
  if (heroEyebrow) heroEyebrow.textContent = contentText("heroEyebrow", heroEyebrow.textContent);
  if (heroTitle) heroTitle.textContent = contentText("heroTitle", heroTitle.textContent);
  if (heroDescription) heroDescription.textContent = contentText("heroDescription", heroDescription.textContent);
  if (primaryButton) primaryButton.textContent = contentText("primaryButtonText", primaryButton.textContent);
  if (secondaryButton) secondaryButton.textContent = contentText("secondaryButtonText", secondaryButton.textContent);
  if (productTitle) productTitle.textContent = contentText("productSectionTitle", productTitle.textContent);
}

async function loadProducts() {
  try {
    const response = await fetch("/api/products");
    if (!response.ok) throw new Error("Cannot load products");
    return await response.json();
  } catch {
    return [];
  }
}

function normalizeProducts() {
  products = products.map((item) => ({
    ...item,
    status: productHasInvalidPrice(item) ? "hidden" : item.status,
    _saleRandomRank: Math.random(),
    _sport: normalizeSport(item.category || item.sport || inferSport(item)),
    _type: normalizeType(item.division || item.type || item.productKind || inferType(item), item),
    _gender: normalizeGender(item.gender || inferGender(item)),
    _brand: normalizeTextValue(item.brand || item.sourceName || "Chưa rõ")
  }));
}

function productDisplayName(item = {}) {
  return String(item.name || item.productName || item.code || item.productCode || "").trim();
}

function productRuntimeKey(item = {}) {
  return String(item.offerKey || item.code || "").trim();
}

function productByRuntimeKey(key = "") {
  const text = String(key || "").trim();
  return products.find((item) => productRuntimeKey(item) === text || String(item.code || "") === text);
}

function productHasInvalidPrice(item = {}) {
  const listPrice = listedPrice(item);
  const salePrice = sellingPrice(item);
  return listPrice > 0 && salePrice > listPrice;
}

function simplifyFilterPanel() {
  document.getElementById("source-filter")?.closest("label")?.remove();
  document.getElementById("status-filter")?.closest("label")?.remove();
  const warehousePrevious = document.querySelector(".warehouse-filter-card")?.previousElementSibling;
  if (warehousePrevious?.tagName === "LABEL" && !warehousePrevious.querySelector("input, select, button")) warehousePrevious.remove();
  const sortSelect = document.getElementById("sort-filter");
  if (sortSelect) {
    sortSelect.innerHTML = `
      <option value="price-asc">Giá thấp trước</option>
      <option value="price-desc">Giá cao trước</option>
    `;
    sortSelect.insertAdjacentHTML("afterbegin", `<option value="sale-desc-random">Sale nhiều nhất</option>`);
    sortSelect.value = filters.sort;
    const sortLabel = sortSelect.closest("label");
    const saleBox = document.querySelector(".sale-filter-box");
    if (sortLabel && saleBox) saleBox.insertAdjacentElement("afterend", sortLabel);
  }
}

function bindFilters() {
  window.addEventListener("resize", () => {
    clearTimeout(window.__toprunResizeTimer);
    window.__toprunResizeTimer = setTimeout(render, 120);
  });

  document.getElementById("query-filter").addEventListener("input", (event) => {
    filters.query = event.target.value.trim().toLowerCase();
    visibleProductCount = PRODUCTS_PER_PAGE;
    render();
  });

  document.querySelectorAll("[data-sale-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      filters.sale = button.dataset.saleFilter || "all";
      visibleProductCount = PRODUCTS_PER_PAGE;
      updateSaleFilterButtons();
      render();
    });
  });

  document.querySelectorAll("[data-ban-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      filters.ban = filters.ban === "san" ? "all" : "san";
      visibleProductCount = PRODUCTS_PER_PAGE;
      updateSaleFilterButtons();
      render();
    });
  });

  ["sort"].forEach((name) => {
    document.getElementById(`${name}-filter`)?.addEventListener("change", (event) => {
      filters[name] = event.target.value;
      visibleProductCount = PRODUCTS_PER_PAGE;
      render();
    });
  });

  document.getElementById("share-filters")?.addEventListener("click", copyShareFilterLink);

  document.getElementById("reset-filters").addEventListener("click", resetFilters);
  document.getElementById("show-orderable-button").addEventListener("click", () => {
    filters.status = "orderable";
    document.getElementById("products").scrollIntoView({ behavior: "smooth", block: "start" });
    render();
  });
}

function populateFilterOptions() {
  fillSelect("sport-filter", uniqueValues(products.map((item) => item._sport)));
  fillSelect("type-filter", typeChoices.filter((item) => item.value !== "all").map((item) => item.value));
  fillSelect("size-filter", availableSizes());
  fillSelect("gender-filter", uniqueValues(products.map((item) => item._gender)), genderDisplay);
  fillSelect("brand-filter", uniqueValues(products.map((item) => item._brand)));
  renderStaticFilterChoices();
  refreshDynamicFilterChoices();
}

function fillSelect(id, values, labelFn = (value) => value) {
  const select = document.getElementById(id);
  const first = select.querySelector("option")?.outerHTML || `<option value="all">-- Tất cả --</option>`;
  select.innerHTML = first;
  values.forEach((value) => {
    if (!value) return;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelFn(value);
    select.appendChild(option);
  });
}

function renderTypeChoices() {
  const panel = document.getElementById("type-choice-panel");
  if (!panel) return;
  renderChoicePanel("type", typeChoices, panel, (value) => value);
}

function renderStaticFilterChoices() {
  renderTypeChoices();
  renderChoicePanel(
    "sport",
    uniqueValues(products.map((item) => item._sport)).map((value) => ({ value, label: value })),
    choicePanelFor("sport")
  );
  renderChoicePanel(
    "gender",
    uniqueValues(products.map((item) => item._gender)).map((value) => ({ value, label: genderDisplay(value) })),
    choicePanelFor("gender")
  );
  renderChoicePanel(
    "brand",
    uniqueValues(products.map((item) => item._brand)).map((value) => ({ value, label: value })),
    choicePanelFor("brand")
  );
  renderChoicePanel(
    "warehouse",
    warehouseChoices(),
    choicePanelFor("warehouse", "compact")
  );
}

function refreshDynamicFilterChoices() {
  const sizeBase = filteredProducts({ ignore: "size" });
  const sizes = availableSizesForCurrentType(sizeBase);
  filters.size = filters.size.filter((size) => sizes.includes(size));
  renderChoicePanel(
    "size",
    sizes.map((value) => ({ value, label: value })),
    choicePanelFor("size", "compact")
  );
}

function choicePanelFor(key, extraClass = "") {
  const existing = document.getElementById(`${key}-choice-panel`);
  if (existing) return existing;
  const select = document.getElementById(`${key}-filter`);
  if (!select) return null;
  const panel = document.createElement("div");
  panel.id = `${key}-choice-panel`;
  panel.className = `filter-choice-panel ${extraClass}`.trim();
  select.insertAdjacentElement("afterend", panel);
  return panel;
}

function renderChoicePanel(key, choices, panel) {
  if (!panel) return;
  const items = [{ value: "all", label: "T\u1ea5t c\u1ea3" }, ...choices.filter((item) => item.value)];
  panel.innerHTML = items.map((item) => `
    <button class="filter-choice-button ${key === "type" ? "type-choice-button" : ""}" type="button" data-filter-key="${escapeHTML(key)}" data-filter-choice="${escapeHTML(item.value)}">
      ${escapeHTML(item.label)}
    </button>
  `).join("");
  panel.querySelectorAll("[data-filter-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleMultiFilter(key, button.dataset.filterChoice || "all");
      visibleProductCount = PRODUCTS_PER_PAGE;
      render();
    });
  });
  updateChoiceButtons(key);
}

function toggleMultiFilter(key, value) {
  if (!multiFilterKeys.includes(key)) return;
  if (value === "all") {
    filters[key] = [];
  } else if (filters[key].includes(value)) {
    filters[key] = filters[key].filter((item) => item !== value);
  } else {
    filters[key] = [...filters[key], value];
  }
  const select = document.getElementById(`${key}-filter`);
  if (select) select.value = filters[key][0] || "all";
}

function multiFilterMatches(key, value) {
  return !filters[key]?.length || filters[key].includes(value);
}

function renderStats() {
  document.getElementById("stat-orderable").textContent = products.filter((item) => item.status === "orderable").length;
  document.getElementById("stat-own").textContent = products.filter((item) => item.source === "own" && item.status === "orderable").length;
  document.getElementById("stat-partner").textContent = products.filter((item) => item.source === "partner" && item.status === "orderable").length;
}

function render() {
  refreshDynamicFilterChoices();
  const filtered = sortedProducts(filteredProducts());
  const visible = filtered.slice(0, visibleProductCount);
  resultCount.textContent = `${visible.length}/${filtered.length} sản phẩm`;
  activeFilterRow.innerHTML = activeFilterBadges();
  updateSaleFilterButtons();
  updateAllChoiceButtons();
  grid.innerHTML = visible.map(productCard).join("") || `<div class="empty-state">Không có sản phẩm phù hợp bộ lọc.</div>`;
  renderLoadMoreButton(filtered.length);
  featuredProduct.innerHTML = productCard(filtered[0] || products.find((item) => item.status === "orderable") || products[0], true);
  bindProductActions();
  syncFiltersToURL();
}

function renderLoadMoreButton(total) {
  document.getElementById("load-more-products")?.remove();
  if (visibleProductCount >= total) return;
  const button = document.createElement("button");
  button.id = "load-more-products";
  button.className = "secondary-button load-more-products";
  button.type = "button";
  button.textContent = `Xem thêm ${Math.min(PRODUCTS_PER_PAGE, total - visibleProductCount)} sản phẩm`;
  button.addEventListener("click", () => {
    visibleProductCount += PRODUCTS_PER_PAGE;
    render();
  });
  grid.insertAdjacentElement("afterend", button);
}

function bindProductActions() {
  document.querySelectorAll("[data-product-code]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (!isCompactMobileView()) return;
      if (event.target.closest("button, a, select, input, label")) return;
      const product = productByRuntimeKey(card.dataset.productCode);
      if (product) openProductDetail(product, selectedSizeInScope(card, card.dataset.productCode));
    });
  });

  document.querySelectorAll("[data-add-code]").forEach((button) => {
    button.addEventListener("click", () => addToCart(button.dataset.addCode, button.closest(".product-card"), true));
  });

  document.querySelectorAll("[data-size-code]").forEach((select) => {
    select.addEventListener("change", () => {
      const scope = select.closest(".product-card") || select.closest(".product-detail-overlay") || document;
      syncSizeSelects(select, scope);
      updateScopedPriceForSize(select.dataset.sizeCode, select.value, scope);
    });
  });
}

function trackLandingEvent(eventName, payload = {}, options = {}) {
  window.toprunAnalytics?.track?.(eventName, payload, options);
}

function sizeSelectsInScope(scope, code) {
  return Array.from(scope?.querySelectorAll?.(`[data-size-code="${cssEscape(code)}"]`) || []);
}

// Mỗi card có thể chứa 2 ô size (bản mobile + bản desktop, CSS ẩn một ô);
// luôn đọc ô đang hiển thị để không lấy nhầm giá trị mặc định của ô bị ẩn.
function selectedSizeInScope(scope, code) {
  const selects = sizeSelectsInScope(scope, code);
  if (!selects.length) return "";
  const visible = selects.find((select) => select.getClientRects().length > 0);
  return (visible || selects[0]).value;
}

function syncSizeSelects(changed, scope) {
  sizeSelectsInScope(scope, changed.dataset.sizeCode).forEach((select) => {
    if (select !== changed) select.value = changed.value;
  });
}

function updateScopedPriceForSize(code, size, scope = document) {
  const product = productByRuntimeKey(code);
  const target = scope?.querySelector?.(`[data-price-block="${cssEscape(code)}"]`);
  if (!product || !target) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = productPriceBlockForSize(product, size).trim();
  const next = wrapper.firstElementChild;
  if (next) target.replaceWith(next);
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
    productSizes(product).forEach((row) => {
      if (Number(row.qty || 0) <= 0) return;
      const value = warehouseRowValue(row);
      if (!value) return;
      const name = String(row.warehouse || row.warehouseName || value).trim();
      if (!map.has(value)) map.set(value, { value, label: warehouseShortLabel(value, name), name });
    });
  });
  return [...map.values()].sort((left, right) => left.label.localeCompare(right.label, "vi", { numeric: true }));
}

// Kho hàng sẵn 2026-08-11: dòng size stockMode="ready" là hàng sẵn giao ngay.
function productHasReadyRow(item = {}) {
  return (Array.isArray(item?.sizes) ? item.sizes : [])
    .some((row) => String(row?.stockMode || "").trim().toLowerCase() === "ready" && Number(row?.qty ?? row?.available ?? 0) > 0);
}

function productMatchesWarehouseFilter(item = {}) {
  if (!filters.warehouse.length) return true;
  const rows = productSizes(item).filter((row) => Number(row.qty || 0) > 0);
  const selectedSizes = filters.size || [];
  const rowMatch = rows.some((row) => {
    const warehouse = warehouseRowValue(row);
    if (!filters.warehouse.includes(warehouse)) return false;
    if (!selectedSizes.length) return true;
    return selectedSizes.includes(filterSizeLabel(item, row.size));
  });
  if (rowMatch) return true;
  if (selectedSizes.length) return false;
  if (Object.entries(item.warehouseStockIds || {}).some(([id, qty]) =>
    Number(qty || 0) > 0 && filters.warehouse.includes(String(id || "").trim())
  )) return true;
  return Object.entries(item.warehouseStocks || {}).some(([name, qty]) =>
    Number(qty || 0) > 0 && filters.warehouse.includes(normalizeWarehouseId(name))
  );
}

function filteredProducts(options = {}) {
  const ignore = options.ignore || "";
  return products.filter((item) => {
    const statusMatch = filters.status === "all" || item.status === filters.status;
    const sizeMatch = ignore === "size" || !filters.size.length || filterProductSizes(item).some((size) => filters.size.includes(size));
    const sportMatch = ignore === "sport" || multiFilterMatches("sport", item._sport);
    const typeMatch = ignore === "type" || multiFilterMatches("type", item._type);
    const genderMatch = ignore === "gender" || multiFilterMatches("gender", item._gender);
    const brandMatch = ignore === "brand" || multiFilterMatches("brand", item._brand);
    const warehouseMatch = ignore === "warehouse" || productMatchesWarehouseFilter(item);
    const price = sellingPrice(item);
    const priceMatch = (!filters.priceMin || price >= filters.priceMin) && (!filters.priceMax || price <= filters.priceMax);
    const banMatch = filters.ban !== "san" || productHasReadyRow(item);
    const saleMatch = filters.sale === "all" || discountPercent(item) >= Number(filters.sale || 0);
    const text = `${item.code} ${item.name} ${item.sourceName} ${item._sport} ${item._type} ${genderDisplay(item._gender)} ${sizeText(item)} ${filterProductSizes(item).join(" ")}`.toLowerCase();
    return statusMatch && sizeMatch && sportMatch && typeMatch && genderMatch && brandMatch && warehouseMatch && priceMatch && banMatch && saleMatch && (!filters.query || text.includes(filters.query));
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

function activeFilterBadges() {
  const badges = [];
  const labelMap = {
    sport: "Môn TT",
    type: "Loại",
    size: "Size",
    gender: "Giới tính",
    brand: "Hãng",
    status: "Trạng thái",
    sort: "Sắp xếp"
  };
  labelMap.warehouse = "Kho";
  labelMap.sale = "Sale";
  labelMap.priceMin = "Gi\u00e1 t\u1eeb";
  labelMap.priceMax = "Gi\u00e1 \u0111\u1ebfn";
  Object.entries(filters).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (!value.length) return;
      const shown = value.map((item) => key === "gender" ? genderDisplay(item) : filterValueDisplay(key, item)).join(", ");
      badges.push(`<span>${labelMap[key]}: ${escapeHTML(shown)}</span>`);
      return;
    }
    if (!value || value === "all" || (key === "status" && value === "orderable") || (key === "sort" && value === "sale-desc-random")) return;
    const shown = filterValueDisplay(key, value);
    badges.push(`<span>${labelMap[key]}: ${escapeHTML(shown)}</span>`);
  });
  if (filters.query) badges.unshift(`<span>Tìm: ${escapeHTML(filters.query)}</span>`);
  return badges.join("");
}

function availableSizesForCurrentType(items = products) {
  const selectedTypes = filters.type.length ? filters.type : uniqueValues(items.map((item) => item._type));
  const allowedFamilies = new Set();
  if (selectedTypes.includes("Giày")) allowedFamilies.add("shoe");
  if (selectedTypes.includes("Quần áo")) allowedFamilies.add("apparel");
  if (selectedTypes.some((type) => ["Phụ kiện", "Balo", "Túi xách", "Mũ", "Tất"].includes(type))) allowedFamilies.add("accessory");
  return availableSizes(items).filter((size) => {
    const family = sizeFamily(size);
    return !allowedFamilies.size || allowedFamilies.has(family);
  });
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

function filterValueDisplay(key, value) {
  if (key === "warehouse") {
    const choice = warehouseChoices().find((item) => item.value === value);
    return choice?.label || warehouseShortLabel(value);
  }
  if (key === "status") return value === "hidden" ? "Tạm ẩn" : "Đang bán";
  if (key === "sale") return `Sale ${value}%+`;
  if (key === "sort") {
    if (value === "sale-desc-random") return "Sale nhiều nhất";
    return {
      "price-asc": "Giá thấp trước",
      "price-desc": "Giá cao trước"
    }[value] || value;
  }
  return value;
}

function resetFilters() {
  visibleProductCount = PRODUCTS_PER_PAGE;
  Object.assign(filters, {
    query: "",
    sport: [],
    type: [],
    size: [],
    gender: [],
    brand: [],
    warehouse: [],
    priceMin: 0,
    priceMax: 0,
    status: "orderable",
    sale: "all",
    sort: "sale-desc-random"
  });
  Object.entries(filters).forEach(([key, value]) => {
    const input = document.getElementById(`${key}-filter`);
    if (input) input.value = Array.isArray(value) ? "all" : value;
  });
  document.getElementById("query-filter").value = "";
  updateSaleFilterButtons();
  render();
}

function applyFiltersFromURL() {
  const params = new URLSearchParams(window.location.search);
  const readList = (name) => params.getAll(name)
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  filters.query = String(params.get("q") || params.get("query") || "").trim().toLowerCase();
  multiFilterKeys.forEach((key) => {
    const values = readList(key);
    if (values.length) filters[key] = values;
  });
  ["sale", "sort", "ban"].forEach((key) => {
    const value = params.get(key);
    if (value) filters[key] = value;
  });
  filters.priceMin = filterPriceFromURL(params.get("price_min"));
  filters.priceMax = filterPriceFromURL(params.get("price_max"));

  document.getElementById("query-filter").value = filters.query;
  Object.entries(filters).forEach(([key, value]) => {
    const input = document.getElementById(`${key}-filter`);
    if (input) input.value = Array.isArray(value) ? (value[0] || "all") : value;
  });
  updateSaleFilterButtons();
}

function syncFiltersToURL() {
  const url = new URL(window.location.href);
  ["q", "query", "source", "status", ...multiFilterKeys, "price_min", "price_max", "sale", "sort", "ban"].forEach((key) => url.searchParams.delete(key));
  if (filters.query) url.searchParams.set("q", filters.query);
  multiFilterKeys.forEach((key) => {
    if (filters[key]?.length) url.searchParams.set(key, filters[key].join(","));
  });
  if (filters.priceMin) url.searchParams.set("price_min", String(filters.priceMin));
  if (filters.priceMax) url.searchParams.set("price_max", String(filters.priceMax));
  if (filters.sale !== "all") url.searchParams.set("sale", filters.sale);
  if (filters.ban === "san") url.searchParams.set("ban", "san");
  if (filters.sort !== "sale-desc-random") url.searchParams.set("sort", filters.sort);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(null, "", next);
}

function filterShareQuery() {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  multiFilterKeys.forEach((key) => {
    if (filters[key]?.length) params.set(key, filters[key].join(","));
  });
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
    button.textContent = "Đã copy ✓";
    setTimeout(() => { button.textContent = original; }, 2000);
  }
}

function filterPriceFromURL(value) {
  const number = Number(String(value || "").replace(/[^\d]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function updateSaleFilterButtons() {
  document.querySelectorAll("[data-sale-filter]").forEach((button) => {
    button.classList.toggle("active", (button.dataset.saleFilter || "all") === filters.sale);
  });
  document.querySelectorAll("[data-ban-filter]").forEach((button) => {
    button.classList.toggle("active", filters.ban === "san");
  });
}

function updateTypeChoiceButtons() {
  updateChoiceButtons("type");
}

function updateAllChoiceButtons() {
  multiFilterKeys.forEach(updateChoiceButtons);
}

function updateChoiceButtons(key) {
  document.querySelectorAll(`[data-filter-key="${key}"]`).forEach((button) => {
    const value = button.dataset.filterChoice || "all";
    const active = value === "all" ? !filters[key].length : filters[key].includes(value);
    button.classList.toggle("active", active);
  });
}

function productCard(item, featured = false) {
  if (!item) return "";
  const sizes = orderProductSizes(item);
  const disabled = item.status !== "orderable" || sizes.length === 0;

  if (!featured && isCompactMobileView()) {
    return compactProductCard(item, sizes, disabled);
  }

  return `
    <article class="product-card ${featured ? "featured" : ""}" data-product-code="${escapeHTML(productRuntimeKey(item))}">
      ${productImage(item)}
      ${mobileQuickBlock(item, sizes, disabled)}
      <div class="product-body">
        <h3>${escapeHTML(productDisplayName(item))}</h3>
        <p class="product-card-code">${escapeHTML(item.code)}</p>
        ${productPriceBlock(item)}
        <label class="card-size-control">
          <span>Size</span>
          <select data-size-code="${escapeHTML(productRuntimeKey(item))}" ${disabled ? "disabled" : ""}>
            ${sizes.map((size) => `<option value="${escapeHTML(size)}">${escapeHTML(size)}</option>`).join("")}
          </select>
        </label>
        <div class="card-actions">
          <button class="primary-button add-cart-button" data-add-code="${escapeHTML(productRuntimeKey(item))}" ${disabled ? "disabled" : ""}>Thêm vào giỏ</button>
        </div>
      </div>
    </article>
  `;
}

function compactProductCard(item, sizes, disabled) {
  return `
    <article class="product-card compact-card" data-product-code="${escapeHTML(productRuntimeKey(item))}">
      ${productImage(item)}
      ${mobileQuickBlock(item, sizes, disabled)}
    </article>
  `;
}

function mobileQuickBlock(item, sizes, disabled) {
  return `
    <div class="mobile-quick">
      ${mobilePriceBlock(item)}
      <select data-size-code="${escapeHTML(productRuntimeKey(item))}" ${disabled ? "disabled" : ""} aria-label="Chọn size ${escapeHTML(item.code)}">
        ${sizes.map((size) => `<option value="${escapeHTML(size)}">${escapeHTML(size)}</option>`).join("")}
      </select>
    </div>
  `;
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

function isCompactMobileView() {
  return window.matchMedia("(max-width: 1024px)").matches || window.matchMedia("(pointer: coarse)").matches;
}

function openProductDetail(item, preferredSize = "") {
  trackLandingEvent("product_view", {
    productCode: item.code,
    productName: productDisplayName(item)
  }, { onceKey: `modal:${item.code}` });
  const sizes = orderProductSizes(item);
  const disabled = item.status !== "orderable" || sizes.length === 0;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay product-detail-overlay";
  overlay.innerHTML = `
    <section class="product-detail-modal">
      <div class="modal-header">
        <div>
          <p class="eyebrow">${escapeHTML(item._brand)}</p>
          <h2>${escapeHTML(productDisplayName(item))}</h2>
          <p>${escapeHTML(item.code)} · ${escapeHTML(item._sport)} · ${escapeHTML(item._type)} · ${escapeHTML(genderDisplay(item._gender))}</p>
        </div>
        <button type="button" class="icon-button" data-close-detail>X</button>
      </div>
      ${productImage(item)}
      ${productPriceBlock(item)}
      <div class="meta detail-meta">
        <span>Size: ${escapeHTML(sizeText(item))}</span>
      </div>
      <label class="card-size-control">
        <span>Chọn size trước khi đặt</span>
        <select data-size-code="${escapeHTML(productRuntimeKey(item))}" ${disabled ? "disabled" : ""}>
          ${sizes.map((size) => `<option value="${escapeHTML(size)}">${escapeHTML(size)}</option>`).join("")}
        </select>
      </label>
      <p class="detail-policy">${escapeHTML(item.policy)}</p>
      <div class="cart-notes">
        <p>${escapeHTML(contentText("cartNote", "Hàng order thanh toán trước 20%, đặt hàng thông thường từ 3-7 ngày."))}</p>
        <p>${escapeHTML(shippingNoteText())}</p>
      </div>
      <div class="card-actions">
        <a class="secondary-button" href="${escapeHTML(googleDetailUrl(item))}" target="_blank" rel="noopener noreferrer">Xem Google</a>
        <button class="primary-button add-cart-button" data-detail-add-code="${escapeHTML(productRuntimeKey(item))}" ${disabled ? "disabled" : ""}>Thêm vào giỏ</button>
      </div>
    </section>
  `;
  document.body.appendChild(overlay);
  const detailSizeSelect = overlay.querySelector("[data-size-code]");
  if (detailSizeSelect && preferredSize && sizes.includes(preferredSize)) {
    detailSizeSelect.value = preferredSize;
    updateScopedPriceForSize(productRuntimeKey(item), preferredSize, overlay);
  }
  overlay.querySelector("[data-close-detail]").addEventListener("click", () => overlay.remove());
  overlay.querySelector("[data-size-code]")?.addEventListener("change", (event) => updateScopedPriceForSize(productRuntimeKey(item), event.currentTarget.value, overlay));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.querySelector("[data-detail-add-code]")?.addEventListener("click", (event) => {
    if (addToCart(event.currentTarget.dataset.detailAddCode, overlay, true)) {
      overlay.remove();
    }
  });
}

function productImage(item) {
  const image = displayImage(item);
  const detailUrl = productDetailUrl(item);
  const detailLink = `
    <a class="detail-button" href="${escapeHTML(detailUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Xem chi tiết ${escapeHTML(item.code)}">
      Xem chi tiết
    </a>
  `;
  const readyBadge = productHasReadyRow(item) ? `<span class="ready-badge" title="Có hàng sẵn giao ngay">SẴN</span>` : "";
  if (image) {
    return `
      <div class="product-image-wrap">
        <img class="product-image" src="${escapeHTML(image)}" alt="${escapeHTML(item.name)}" loading="lazy">
        ${readyBadge}
        ${detailLink}
      </div>
    `;
  }
  return `
    <div class="product-image-wrap">
      <div class="product-image placeholder"><span>${escapeHTML(item.code)}</span></div>
      ${readyBadge}
      ${detailLink}
    </div>
  `;
}

function googleDetailUrl(item) {
  const terms = [item.code, item.sourceName, item.name].filter(Boolean).join(" ");
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(terms)}`;
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

function productPriceBlock(item) {
  return productPriceBlockForSize(item, "");
}

function productPriceBlockForSize(item, size) {
  const listPrice = listedPrice(item);
  const salePrice = size ? sellingPriceForSize(item, size) : sellingPrice(item);
  const priceRange = size ? null : priceRangeForProduct(item);
  const hasPriceRange = Boolean(priceRange && priceRange.min > 0 && priceRange.max > priceRange.min);
  const displayPrice = hasPriceRange ? formatCompactPriceRange(priceRange) : formatMoney(salePrice);
  const showListPrice = listPrice > 0 && (hasPriceRange ? listPrice > priceRange.min : listPrice !== salePrice);
  return `
    <div class="price-stack" data-price-block="${escapeHTML(item.code || "")}">
      ${showListPrice ? `<div class="price-row list-price"><span>Giá niêm yết</span><strong>${formatMoney(listPrice)}</strong></div>` : ""}
      <div class="price-row sale-price${hasPriceRange ? " price-range" : ""}"><span>Giá sale</span><strong>${displayPrice}</strong></div>
      ${hasPriceRange ? `<div class="price-size-note">Giá thay đổi theo size</div>` : ""}
    </div>
  `;
}

function priceRangeForProduct(item) {
  const rows = productSizes(item).filter((size) =>
    !filters.warehouse.length || filters.warehouse.includes(warehouseRowValue(size))
  );
  const sourceRows = rows.length ? rows : productSizes(item);
  const prices = uniqueNumbers(sourceRows.map((size) => sizeRowPrice(size)).filter((price) => price > 0));
  if (prices.length < 2) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function sellingPrice(item) {
  const rows = productSizes(item).filter((size) =>
    !filters.warehouse.length || filters.warehouse.includes(warehouseRowValue(size))
  );
  const sourceRows = rows.length ? rows : productSizes(item);
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
  const rows = productSizes(item).filter((size) => String(size.size || "").trim().toLowerCase() === normalized);
  const warehouseRows = filters.warehouse.length
    ? rows.filter((size) => filters.warehouse.includes(warehouseRowValue(size)))
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

function addToCart(code, scope = document, openCart = true) {
  const product = productByRuntimeKey(code);
  if (!product) return false;
  const size = selectedSizeInScope(scope, code) || selectedSizeInScope(document, code) || orderProductSizes(product)[0];
  if (!size) return false;
  const selectedRow = bestSizeRowForSelection(product, size) || {};
  const warehouseId = String(selectedRow.warehouseId || "").trim();
  const warehouse = String(selectedRow.warehouse || selectedRow.warehouseName || "").trim();
  const warehouseLabel = warehouseShortLabel(warehouseId, warehouse);

  const runtimeKey = productRuntimeKey(product);
  const variantId = String(selectedRow.variantId || selectedRow.variant_id || "").trim();
  const key = variantId || `${runtimeKey}__${size}__${warehouseId || warehouse}`;
  const current = cart.find((item) => item.key === key);
  if (current) {
    current.qty += 1;
  } else {
    cart.push({
      key,
      productCode: product.code,
      productName: product.name,
      brand: product.brand || "",
      productKind: product.productKind || product.division || "",
      imageUrl: displayImage(product),
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
  trackLandingEvent("add_to_cart", {
    productCode: product.code,
    productName: productDisplayName(product),
    size,
    qty: 1
  });
  saveStoredCart(cart);
  renderCart();
  if (openCart) openCartPanel();
  return true;
}

function ensureCartUI() {
  const cartRoot = document.createElement("aside");
  cartRoot.className = "cart-panel";
  cartRoot.innerHTML = `
    <button class="cart-toggle" id="cart-toggle" type="button">
      Giỏ <span id="cart-count">0</span>
    </button>
    <div class="cart-box" id="cart-box">
      <div class="cart-header">
        <strong>Giỏ hàng</strong>
        <button class="icon-button" id="cart-close" type="button">X</button>
      </div>
      <div id="cart-items"></div>
      <div class="cart-notes">
        <p>${escapeHTML(contentText("cartNote", "Hàng order thanh toán trước 20%, đặt hàng thông thường từ 3-7 ngày."))}</p>
        <p>${escapeHTML(shippingNoteText())}</p>
        <p>${escapeHTML(contentText("contactNote", "Lien he fanpage toprunvn hoac Zalo de xac nhan don hang."))}</p>
      </div>
      <div class="cart-total">
        <span>Tạm tính</span>
        <strong id="cart-total">0đ</strong>
      </div>
      <button class="primary-button" id="checkout-button" type="button">Xác nhận đơn</button>
    </div>
  `;
  document.body.appendChild(cartRoot);

  document.getElementById("cart-toggle").addEventListener("click", () => cartRoot.classList.toggle("open"));
  document.getElementById("cart-close").addEventListener("click", () => cartRoot.classList.remove("open"));
  document.getElementById("checkout-button").addEventListener("click", openCheckoutDialog);
}

function openCartPanel() {
  document.querySelector(".cart-panel")?.classList.add("open");
}

function renderCart() {
  const count = cart.reduce((sum, item) => sum + item.qty, 0);
  const total = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
  document.getElementById("cart-count").textContent = count;
  document.getElementById("cart-total").textContent = formatMoney(total);
  document.getElementById("checkout-button").disabled = cart.length === 0;

  const items = document.getElementById("cart-items");
  items.innerHTML = cart.length
    ? cart.map((item) => `
      <div class="cart-item">
        ${item.imageUrl ? `<img class="cart-item-thumb" src="${escapeHTML(item.imageUrl)}" alt="">` : ""}
        <div>
          <strong>${escapeHTML(productDisplayName(item))}</strong>
          <span>${escapeHTML(item.productCode)} - Size ${escapeHTML(item.size)}</span>
          <span>${formatMoney(item.price)}</span>
        </div>
        <div class="qty-control">
          <button type="button" data-qty-key="${escapeHTML(item.key)}" data-qty-delta="-1">-</button>
          <span>${item.qty}</span>
          <button type="button" data-qty-key="${escapeHTML(item.key)}" data-qty-delta="1">+</button>
        </div>
      </div>
    `).join("")
    : `<p class="empty-cart">Chưa có sản phẩm trong giỏ.</p>`;

  document.querySelectorAll("[data-qty-key]").forEach((button) => {
    button.addEventListener("click", () => changeQty(button.dataset.qtyKey, Number(button.dataset.qtyDelta || 0)));
  });
}

function changeQty(key, delta) {
  const item = cart.find((entry) => entry.key === key);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter((entry) => entry.key !== key);
  saveStoredCart(cart);
  renderCart();
}

function openCheckoutDialog() {
  if (!cart.length) return;
  trackLandingEvent("checkout_open", {
    itemCount: cart.length,
    totalQty: cart.reduce((sum, item) => sum + item.qty, 0)
  });
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <form class="order-modal checkout-info-modal" id="order-form">
      <div class="modal-header">
        <div>
          <p class="eyebrow">Xác nhận đơn</p>
          <h2>Thông tin nhận hàng</h2>
          <p>${cart.reduce((sum, item) => sum + item.qty, 0)} sản phẩm - ${formatMoney(cart.reduce((sum, item) => sum + item.qty * item.price, 0))}</p>
        </div>
        <button type="button" class="icon-button" id="close-order">X</button>
      </div>
      <div class="checkout-notes">
        <p>${escapeHTML(contentText("cartNote", "Hàng order thanh toán trước 20%, đặt hàng thông thường từ 3-7 ngày."))}</p>
        <p>${escapeHTML(shippingNoteText())}</p>
      </div>
      <input type="hidden" name="paymentMethod" value="manual_confirm">
      <label>Họ tên
        <input name="customerName" autocomplete="name" required placeholder="Nguyễn Văn A">
      </label>
      <label>Số điện thoại
        <input name="phone" autocomplete="tel" inputmode="tel" required pattern="^(0|\+84)(3|5|7|8|9)[0-9]{8}$" placeholder="09xxxxxxxx">
      </label>
      <label>Email
        <input name="email" type="email" autocomplete="email" placeholder="email@example.com">
      </label>
      <label>Tỉnh/TP theo đơn vị hành chính cũ
        <input name="province" autocomplete="address-level1" required placeholder="Tìm Tỉnh/TP">
      </label>
      <label>Huyện/Quận theo đơn vị hành chính cũ
        <input name="district" autocomplete="address-level2" required placeholder="Chọn Tỉnh/TP trước">
      </label>
      <label>Xã/Phường theo đơn vị hành chính cũ
        <input name="ward" autocomplete="address-level3" required placeholder="Chọn Huyện/Quận trước">
      </label>
      <label>Địa chỉ chi tiết
        <input name="addressDetail" autocomplete="street-address" required placeholder="Số nhà, tên đường">
      </label>
      <label>Ghi chú
        <input name="note" placeholder="Màu sắc, thời gian nhận hàng...">
      </label>
      <button class="primary-button" type="submit" id="order-submit-button">Xác nhận đơn hàng</button>
      <p class="form-message" id="order-message"></p>
    </form>
  `;
  document.body.appendChild(overlay);
  document.getElementById("close-order").addEventListener("click", () => overlay.remove());
  bindAddressSelectors(document.getElementById("order-form"));
  document.getElementById("order-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const submitButton = formElement.querySelector('[type="submit"]');
    if (formElement.dataset.submitting === "1") return;
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());
    const message = document.getElementById("order-message");
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
    payload.items = cart.map(({ key, ...item }) => item);
    payload.total = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
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
    message.textContent = response?.ok ? "Đã nhận đơn. TopRun sẽ liên hệ xác nhận." : (result.message || "Chưa gửi được đơn, vui lòng thử lại.");
    if (response?.ok) {
      trackLandingEvent("order_success", {
        itemCount: cart.length,
        total: payload.total
      });
      cart = [];
      saveStoredCart(cart);
      renderCart();
      setTimeout(() => {
        overlay.remove();
        showPaymentChatPrompt(result?.order || payload);
      }, 900);
    } else {
      formElement.dataset.submitting = "";
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
      }
    }
  });
}

function showAccountPrompt(order, accountPrompt) {
  if (accountPrompt?.enabled === false) return;
  const phone = order?.phone || "";
  const overlay = document.createElement("div");
  overlay.className = "order-overlay";
  overlay.innerHTML = `
    <div class="order-modal account-prompt">
      <div class="order-header">
        <div>
          <strong>Tạo tài khoản theo dõi đơn</strong>
          <span>Quản lý lịch sử mua hàng và nhận thông báo sale.</span>
        </div>
        <button type="button" class="icon-button" id="account-prompt-close">X</button>
      </div>
      <p>Bạn có muốn tạo tài khoản nhanh để theo dõi đơn hàng này không? Số điện thoại và địa chỉ chỉ lưu theo đơn khi bạn đặt hàng.</p>
      <button class="primary-button" type="button" id="account-google-start">Tạo tài khoản</button>
      <button class="secondary-button" type="button" id="account-later">Để sau</button>
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
  // Bo chon dia chi da don ve 1 bo chung TopRunAddressKit (address-kit.js):
  // search ten -> chon tu danh muc, ho tro 2 he, tu khoa gia tri ngoai danh muc.
  // File nay chi con giu phan tiem clientOrderId (dac thu landing checkout).
  if (!form) return;
  await Promise.all([loadAdminUnits(), loadAdminUnitsV2()]);
  if (form.elements && !form.elements.clientOrderId) {
    const clientOrderIdInput = document.createElement("input");
    clientOrderIdInput.type = "hidden";
    clientOrderIdInput.name = "clientOrderId";
    clientOrderIdInput.value = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `co_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    form.append(clientOrderIdInput);
  }
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
    const province = findByName(unitsV2, payload.province);
    if (!province) return "Vui lòng chọn Tỉnh/TP (hệ 2 cấp) từ danh sách gợi ý.";
    const ward = findByName(province.wards, payload.ward);
    if (!ward) return "Vui lòng chọn Xã/Phường đúng theo Tỉnh/TP đã chọn.";
    payload.province = province.name;
    payload.ward = ward.name;
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
  payload.province = province.name;
  payload.district = district.name;
  payload.ward = ward.name;
  return "";
}

function normalizeAdminText(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}

function availableSizes(items = products) {
  return uniqueValues(items.flatMap((item) => filterProductSizes(item)))
    .sort((a, b) => sizeSortValue(a) - sizeSortValue(b) || a.localeCompare(b, "vi"));
}

function availableProductSizes(item) {
  return filterProductSizes(item);
}

function filterProductSizes(item) {
  const rawSizes = productSizes(item).filter((size) => Number(size.qty || 0) > 0);
  if (isBagProduct(item) && rawSizes.length) return ["NS"];
  return uniqueValues(rawSizes.map((size) => filterSizeLabel(item, size.size)));
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
  const rawSizes = productSizes(item)
    .filter((size) => Number(size.qty || 0) > 0)
    .map((size) => String(size.size || "").trim())
    .filter(Boolean);
  if (isBagProduct(item) && rawSizes.length) return ["NS"];
  return uniqueValues(rawSizes);
}

function productSizes(item) {
  return Array.isArray(item?.sizes) ? item.sizes : [];
}

function isBagProduct(item) {
  const text = `${item.name || ""} ${item.productUrl || ""} ${item.detailUrl || ""} ${item.sourcePageUrl || ""} ${item.division || ""} ${item.category || ""}`.toLowerCase();
  return /(backpack|balo|ba-lo|ba lo|bag|tui|túi|duffel|duffle|tote|waistbag|x-body|pouch)/i.test(text)
    || productSizes(item).some((size) => /^kt\s*:/i.test(String(size.size || "")));
}

function sizeText(item) {
  const available = orderProductSizes(item);
  return available.length ? available.join(", ") : "Hết size";
}

function inferSport(item) {
  const text = productText(item);
  if (/(golf|tennis|football|soccer|basketball|yoga|training|gym|run|runner|running|adizero|ultraboost|supernova)/i.test(text)) {
    if (/golf/i.test(text)) return "Golf";
    if (/tennis/i.test(text)) return "Tennis";
    if (/football|soccer/i.test(text)) return "Bóng đá";
    if (/basketball/i.test(text)) return "Bóng rổ";
    if (/yoga|training|gym/i.test(text)) return "Training";
    return "Running";
  }
  return "Lifestyle";
}

function inferType(item) {
  const text = productText(item);
  if (/(kt:|backpack|balo|ba lo|bpk|\bbp\b)/i.test(text)) return "Balo";
  if (/(bag|tÃºi|túi|tui|duffel|duffle|tote|pouch|waistbag|x-body|x body)/i.test(text)) return "Túi xách";
  if (/(kt:|backpack|balo|ba lo|bag|túi|tui|duffel|duffle|tote|pouch)/i.test(text)) return "Túi / balo";
  if (/(lace|laces|dây giày|day giay)/i.test(text)) return "Phụ kiện";
  if (/(tee|shirt|t-shirt|áo|ao |short|shorts|quần|quan |pant|pants|tight|jacket|hoodie|jersey|bra|skirt|dress)/i.test(text)) return "Quần áo";
  if (hasApparelSizes(item)) return "Quần áo";
  if (/(shoe|shoes|giày|giay|sandal|sneaker|boot|footwear)/i.test(text)) return "Giày";
  if (/(cap|hat|mũ|mu |sock|socks|tất|tat |bottle|bình|binh|glove|arm band|headband|lace|dây giày|day giay)/i.test(text)) return "Phụ kiện";
  return "Khác";
}

function inferGender(item) {
  const text = productText(item);
  if (/(women|woman|nữ|nu |womens|girl|bé gái)/i.test(text)) return "WO";
  if (/(kids|kid|junior|youth|trẻ em|tre em|boys|girls)/i.test(text)) return "KI";
  if (/(men|man|nam|mens)/i.test(text)) return "ME";
  return "UN";
}

function productText(item) {
  return `${item.name || ""} ${item.code || ""} ${item.category || ""} ${item.division || ""} ${sizeText(item)} ${filterProductSizes(item).join(" ")}`;
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

  if (/\b(footwear|shoe|shoes|sneaker|sneakers|trainer|trainers|sandal|sandals|boot|boots|giay)\b/.test(text)) {
    return "Gi\u00e0y";
  }
  if (/\b(apparel|clothing|clothes|garment|garments|tee|tees|shirt|shirts|t shirt|t shirts|short|shorts|pant|pants|tight|tights|jacket|jackets|hoodie|hoodies|jersey|jerseys|bra|bras|skirt|skirts|dress|dresses|ao|quan)\b/.test(text)) {
    return "Qu\u1ea7n \u00e1o";
  }
  if (/\b(backpack|backpacks|balo|ba lo|bpk|bp)\b/.test(text)) return "Balo";
  if (/\b(bag|bags|tui|duffel|duffle|tote|pouch|waist|x body)\b/.test(text)) return "T\u00fai x\u00e1ch";
  if (/\b(cap|caps|hat|hats|mu|non|beanie)\b/.test(text)) return "M\u0169";
  if (/\b(sock|socks|tat|vo)\b/.test(text)) return "T\u1ea5t";
  if (/\b(hardware|accessory|accessories|equipment|gear|bottle|bottles|binh|glove|gloves|headband|headbands|lace|laces|day giay|phu kien)\b/.test(text)) {
    return "Ph\u1ee5 ki\u1ec7n";
  }

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

  return inferredType || "Ph\u1ee5 ki\u1ec7n";
}

function hasApparelSizes(item) {
  return filterProductSizes(item).some((size) => Boolean(normalizeApparelSize(size)));
}

function normalizeGender(value) {
  const text = String(value || "").trim();
  if (!text) return "UN";
  const upper = text.toUpperCase();
  return genderLabels[upper] ? upper : text;
}

function genderDisplay(value) {
  const upper = String(value || "").toUpperCase();
  return genderLabels[upper] || value || "Unisex";
}

function normalizeTextValue(value) {
  return String(value || "").trim() || "Khác";
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "vi"));
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

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}

function escapeHTML(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

init();

// Nạp lại giỏ khi quay lại trang từ bfcache hoặc khi tab/trang khác thay đổi giỏ chung.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  cart = loadStoredCart();
  if (document.getElementById("cart-count")) renderCart();
});

window.addEventListener("storage", (event) => {
  if (event.key !== CART_STORAGE_KEY) return;
  cart = loadStoredCart();
  if (document.getElementById("cart-count")) renderCart();
});

// ===== Che do CTV khi dang nhap (dot 2026-08-14) =====
// CTV dang nhap roi luot web: URL tu gan ?ref=CODE (khong reload) de link copy/chia se
// mang ma gioi thieu, kem badge nho goc man hinh. KHONG doi hanh vi dat hang
// (attribution phien CTV da duoc server xu ly san).
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
