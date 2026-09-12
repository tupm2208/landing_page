let products = [];
let cart = [];

const filters = {
  query: "",
  sport: "all",
  type: "all",
  size: "all",
  gender: "all",
  brand: "all",
  source: "all",
  status: "orderable",
  sale: "all",
  sort: "default"
};

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

const orderInfoHTML = `
  <p>Hàng order 1-2 tuần, không đổi trả, thanh toán trước 20%.</p>
  <p>Xin liên hệ fanpage toprunvn hoặc Zalo 0968411655 để xác nhận đơn hàng và chuyển khoản.</p>
`;

async function init() {
  products = await loadProducts();
  normalizeProducts();
  ensureCartUI();
  populateFilterOptions();
  bindFilters();
  renderStats();
  render();
  renderCart();
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
    _sport: normalizeSport(item.category || item.sport || inferSport(item)),
    _type: normalizeTextValue(item.division || item.type || inferType(item)),
    _gender: normalizeGender(item.gender || inferGender(item)),
    _brand: normalizeTextValue(item.sourceName || item.brand || "Chưa rõ")
  }));
}

function bindFilters() {
  window.addEventListener("resize", () => {
    clearTimeout(window.__toprunResizeTimer);
    window.__toprunResizeTimer = setTimeout(render, 120);
  });

  document.getElementById("query-filter").addEventListener("input", (event) => {
    filters.query = event.target.value.trim().toLowerCase();
    render();
  });

  document.querySelectorAll("[data-sale-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      filters.sale = button.dataset.saleFilter || "all";
      updateSaleFilterButtons();
      render();
    });
  });

  ["sport", "type", "size", "gender", "brand", "source", "status", "sort"].forEach((name) => {
    document.getElementById(`${name}-filter`).addEventListener("change", (event) => {
      filters[name] = event.target.value;
      render();
    });
  });

  document.getElementById("reset-filters").addEventListener("click", resetFilters);
  document.getElementById("show-orderable-button").addEventListener("click", () => {
    filters.status = "orderable";
    document.getElementById("status-filter").value = "orderable";
    document.getElementById("products").scrollIntoView({ behavior: "smooth", block: "start" });
    render();
  });
}

function populateFilterOptions() {
  fillSelect("sport-filter", uniqueValues(products.map((item) => item._sport)));
  fillSelect("type-filter", uniqueValues(products.map((item) => item._type)));
  fillSelect("size-filter", availableSizes());
  fillSelect("gender-filter", uniqueValues(products.map((item) => item._gender)), genderDisplay);
  fillSelect("brand-filter", uniqueValues(products.map((item) => item._brand)));
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

function renderStats() {
  document.getElementById("stat-orderable").textContent = products.filter((item) => item.status === "orderable").length;
  document.getElementById("stat-own").textContent = products.filter((item) => item.source === "own" && item.status === "orderable").length;
  document.getElementById("stat-partner").textContent = products.filter((item) => item.source === "partner" && item.status === "orderable").length;
}

function render() {
  const filtered = sortedProducts(filteredProducts());
  resultCount.textContent = `${filtered.length} sản phẩm`;
  activeFilterRow.innerHTML = activeFilterBadges();
  updateSaleFilterButtons();
  grid.innerHTML = filtered.map(productCard).join("") || `<div class="empty-state">Không có sản phẩm phù hợp bộ lọc.</div>`;
  featuredProduct.innerHTML = productCard(filtered[0] || products.find((item) => item.status === "orderable") || products[0], true);
  bindProductActions();
  upgradeProductImages();
}

function bindProductActions() {
  document.querySelectorAll("[data-product-code]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (!isCompactMobileView()) return;
      if (event.target.closest("button, a, select, input, label")) return;
      const product = products.find((item) => item.code === card.dataset.productCode);
      if (product) openProductDetail(product);
    });
  });

  document.querySelectorAll("[data-add-code]").forEach((button) => {
    button.addEventListener("click", () => addToCart(button.dataset.addCode, button.closest(".product-card"), false));
  });

  document.querySelectorAll("[data-buy-code]").forEach((button) => {
    button.addEventListener("click", () => {
      if (addToCart(button.dataset.buyCode, button.closest(".product-card"), false)) {
        openCheckoutDialog();
      }
    });
  });
}

function filteredProducts() {
  return products.filter((item) => {
    const sourceMatch = filters.source === "all" || item.source === filters.source;
    const statusMatch = filters.status === "all" || item.status === filters.status;
    const sizeMatch = filters.size === "all" || availableProductSizes(item).includes(filters.size);
    const sportMatch = filters.sport === "all" || item._sport === filters.sport;
    const typeMatch = filters.type === "all" || item._type === filters.type;
    const genderMatch = filters.gender === "all" || item._gender === filters.gender;
    const brandMatch = filters.brand === "all" || item._brand === filters.brand;
    const saleMatch = filters.sale === "all" || discountPercent(item) >= Number(filters.sale || 0);
    const text = `${item.code} ${item.name} ${item.sourceName} ${item._sport} ${item._type} ${genderDisplay(item._gender)} ${sizeText(item)}`.toLowerCase();
    return sourceMatch && statusMatch && sizeMatch && sportMatch && typeMatch && genderMatch && brandMatch && saleMatch && (!filters.query || text.includes(filters.query));
  });
}

function sortedProducts(items) {
  const sorted = [...items];
  if (filters.sort === "price-asc") sorted.sort((left, right) => sellingPrice(left) - sellingPrice(right));
  if (filters.sort === "price-desc") sorted.sort((left, right) => sellingPrice(right) - sellingPrice(left));
  if (filters.sort === "name-asc") sorted.sort((left, right) => String(left.name).localeCompare(String(right.name), "vi"));
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
    source: "Nguồn",
    status: "Trạng thái",
    sort: "Sắp xếp"
  };
  labelMap.sale = "Sale";
  Object.entries(filters).forEach(([key, value]) => {
    if (!value || value === "all" || (key === "status" && value === "orderable") || (key === "sort" && value === "default")) return;
    const shown = key === "gender" ? genderDisplay(value) : filterValueDisplay(key, value);
    badges.push(`<span>${labelMap[key]}: ${escapeHTML(shown)}</span>`);
  });
  if (filters.query) badges.unshift(`<span>Tìm: ${escapeHTML(filters.query)}</span>`);
  return badges.join("");
}

function filterValueDisplay(key, value) {
  if (key === "source") return value === "own" ? "Hàng nội bộ" : "Hàng đối tác";
  if (key === "status") return value === "hidden" ? "Tạm ẩn" : "Đang bán";
  if (key === "sale") return `Sale ${value}%+`;
  if (key === "sort") {
    return {
      "price-asc": "Giá thấp trước",
      "price-desc": "Giá cao trước",
      "name-asc": "Tên A-Z"
    }[value] || value;
  }
  return value;
}

function resetFilters() {
  Object.assign(filters, {
    query: "",
    sport: "all",
    type: "all",
    size: "all",
    gender: "all",
    brand: "all",
    source: "all",
    status: "orderable",
    sale: "all",
    sort: "default"
  });
  Object.entries(filters).forEach(([key, value]) => {
    const input = document.getElementById(`${key}-filter`);
    if (input) input.value = value;
  });
  document.getElementById("query-filter").value = "";
  updateSaleFilterButtons();
  render();
}

function updateSaleFilterButtons() {
  document.querySelectorAll("[data-sale-filter]").forEach((button) => {
    button.classList.toggle("active", (button.dataset.saleFilter || "all") === filters.sale);
  });
}

function productCard(item, featured = false) {
  if (!item) return "";
  const sourceLabel = item.source === "own" ? "Nội bộ" : "Đối tác";
  const statusLabel = item.status === "orderable" ? "Đang bán" : "Tạm ẩn";
  const sizes = availableProductSizes(item);
  const availableQty = productSizes(item).reduce((sum, size) => sum + Math.max(0, Number(size.qty || 0)), 0);
  const disabled = item.status !== "orderable" || sizes.length === 0;
  const salePct = discountPercent(item);

  if (!featured && isCompactMobileView()) {
    return compactProductCard(item, sizes, disabled);
  }

  return `
    <article class="product-card ${featured ? "featured" : ""}" data-product-code="${escapeHTML(item.code)}">
      ${productImage(item)}
      ${mobileQuickBlock(item, sizes, disabled)}
      <div class="product-body">
        <div class="badges">
          <span class="badge ${item.source === "own" ? "green" : "amber"}">${sourceLabel}</span>
          <span class="badge blue">${escapeHTML(item._sport)}</span>
          <span class="badge ${item.status === "orderable" ? "blue" : "red"}">${statusLabel}</span>
          ${salePct > 0 ? `<span class="badge red">Sale ${salePct}%</span>` : ""}
        </div>
        <h3>${escapeHTML(item.name)}</h3>
        <p class="muted">${escapeHTML(item.code)} · ${escapeHTML(item._brand)} · ${escapeHTML(genderDisplay(item._gender))}</p>
        ${productPriceBlock(item)}
        <div class="meta">
          <span>Loại: ${escapeHTML(item._type)}</span>
          <span>Size: ${escapeHTML(sizeText(item))}</span>
          <span>${availableQty} sản phẩm khả dụng</span>
        </div>
        <label class="card-size-control">
          <span>Chọn size trước khi đặt</span>
          <select data-size-code="${escapeHTML(item.code)}" ${disabled ? "disabled" : ""}>
            ${sizes.map((size) => `<option value="${escapeHTML(size)}">${escapeHTML(size)}</option>`).join("")}
          </select>
        </label>
        <p>${escapeHTML(item.policy)}</p>
        <div class="card-actions">
          <button class="secondary-button add-cart-button" data-add-code="${escapeHTML(item.code)}" ${disabled ? "disabled" : ""}>Thêm giỏ</button>
          <button class="primary-button buy-now-button" data-buy-code="${escapeHTML(item.code)}" ${disabled ? "disabled" : ""}>Đặt hàng</button>
        </div>
      </div>
    </article>
  `;
}

function compactProductCard(item, sizes, disabled) {
  return `
    <article class="product-card compact-card" data-product-code="${escapeHTML(item.code)}">
      ${productImage(item)}
      ${mobileQuickBlock(item, sizes, disabled)}
    </article>
  `;
}

function mobileQuickBlock(item, sizes, disabled) {
  return `
    <div class="mobile-quick">
      <strong>${formatMoney(sellingPrice(item))}</strong>
      <select data-size-code="${escapeHTML(item.code)}" ${disabled ? "disabled" : ""} aria-label="Chọn size ${escapeHTML(item.code)}">
        ${sizes.map((size) => `<option value="${escapeHTML(size)}">${escapeHTML(size)}</option>`).join("")}
      </select>
    </div>
  `;
}

function isCompactMobileView() {
  return window.matchMedia("(max-width: 1024px)").matches || window.matchMedia("(pointer: coarse)").matches;
}

function openProductDetail(item) {
  const sizes = availableProductSizes(item);
  const disabled = item.status !== "orderable" || sizes.length === 0;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay product-detail-overlay";
  overlay.innerHTML = `
    <section class="product-detail-modal">
      <div class="modal-header">
        <div>
          <p class="eyebrow">${escapeHTML(item._brand)}</p>
          <h2>${escapeHTML(item.name)}</h2>
          <p>${escapeHTML(item.code)} · ${escapeHTML(item._sport)} · ${escapeHTML(item._type)} · ${escapeHTML(genderDisplay(item._gender))}</p>
        </div>
        <button type="button" class="icon-button" data-close-detail>X</button>
      </div>
      ${productImage(item)}
      ${productPriceBlock(item)}
      <div class="meta detail-meta">
        <span>Size: ${escapeHTML(sizeText(item))}</span>
        <span>Trạng thái: ${item.status === "orderable" ? "Đang bán" : "Tạm ẩn"}</span>
      </div>
      <label class="card-size-control">
        <span>Chọn size trước khi đặt</span>
        <select data-size-code="${escapeHTML(item.code)}" ${disabled ? "disabled" : ""}>
          ${sizes.map((size) => `<option value="${escapeHTML(size)}">${escapeHTML(size)}</option>`).join("")}
        </select>
      </label>
      <p class="detail-policy">${escapeHTML(item.policy)}</p>
      <div class="card-actions">
        <a class="secondary-button" href="${escapeHTML(googleDetailUrl(item))}" target="_blank" rel="noopener noreferrer">Xem Google</a>
        <button class="primary-button buy-now-button" data-detail-buy-code="${escapeHTML(item.code)}" ${disabled ? "disabled" : ""}>Đặt hàng</button>
      </div>
    </section>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("[data-close-detail]").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.querySelector("[data-detail-buy-code]")?.addEventListener("click", (event) => {
    if (addToCart(event.currentTarget.dataset.detailBuyCode, overlay, false)) {
      overlay.remove();
      openCheckoutDialog();
    }
  });
}

function productImage(item) {
  const highImage = String(item.highImage || "").trim();
  const thumbnailImage = String(item.thumbnailImage || item.image || "").trim();
  const image = thumbnailImage || highImage;
  const detailUrl = productDetailUrl(item);
  const detailLink = `
    <a class="detail-button" href="${escapeHTML(detailUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Xem chi tiết ${escapeHTML(item.code)}">
      Xem chi tiết
    </a>
  `;
  if (image) {
    const highAttr = highImage && highImage !== image ? ` data-high-image="${escapeHTML(highImage)}"` : "";
    return `
      <div class="product-image-wrap">
        <img class="product-image" src="${escapeHTML(image)}"${highAttr} alt="${escapeHTML(item.name)}" loading="lazy">
        ${detailLink}
      </div>
    `;
  }
  return `
    <div class="product-image-wrap">
      <div class="product-image placeholder"><span>${escapeHTML(item.code)}</span></div>
      ${detailLink}
    </div>
  `;
}

function googleDetailUrl(item) {
  const terms = [item.code, item.sourceName, item.name].filter(Boolean).join(" ");
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(terms)}`;
}

function productDetailUrl(item) {
  const directUrl = String(item.productUrl || item.sourcePageUrl || item.detailUrl || item.product_url || item.source_page_url || "").trim();
  return directUrl || googleDetailUrl(item);
}

function upgradeProductImages() {
  document.querySelectorAll("img[data-high-image]").forEach((image) => {
    const highImage = image.dataset.highImage;
    if (!highImage || image.dataset.upgrading === "1") return;
    image.dataset.upgrading = "1";
    const preload = new Image();
    preload.onload = () => {
      image.src = highImage;
      image.removeAttribute("data-high-image");
    };
    preload.src = highImage;
  });
}

function productPriceBlock(item) {
  const listPrice = listedPrice(item);
  const salePrice = sellingPrice(item);
  const showListPrice = listPrice > 0 && listPrice !== salePrice;
  return `
    <div class="price-stack">
      ${showListPrice ? `<div class="price-row list-price"><span>Giá niêm yết</span><strong>${formatMoney(listPrice)}</strong></div>` : ""}
      <div class="price-row sale-price"><span>Giá sale</span><strong>${formatMoney(salePrice)}</strong></div>
    </div>
  `;
}

function sellingPrice(item) {
  const sizePrices = productSizes(item)
    .map((size) => firstPositiveNumber(size.suggestedPrice, size.salePrice, size.sellPrice, size.price))
    .filter((price) => price > 0);
  return sizePrices.length ? Math.min(...sizePrices) : firstPositiveNumber(item.suggestedPrice, item.salePrice, item.sellPrice, item.price);
}

function sellingPriceForSize(item, selectedSize) {
  const match = bestSizeRowForSelection(item, selectedSize);
  return firstPositiveNumber(match?.suggestedPrice, match?.salePrice, match?.sellPrice, match?.price) || sellingPrice(item);
}

function listedPrice(item) {
  return firstPositiveNumber(item.listPrice, item.originalPrice, item.retailPrice, item.marketPrice, item.msrp);
}

function originalSalePrice(item) {
  return firstPositiveNumber(item.preMarkupSalePrice, item.originalSalePrice, item.saleFilePrice, item.baseSalePrice, item.rawSalePrice);
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

function normalizeWarehouseId(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function warehouseRowValue(row = {}) {
  return String(row.warehouseId || normalizeWarehouseId(row.warehouse || row.warehouseName)).trim();
}

function warehousePriorityIndex(item = {}, row = {}) {
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

function bestSizeRowForSelection(item, selectedSize) {
  const normalized = String(selectedSize || "").trim().toLowerCase();
  const rows = productSizes(item).filter((size) => String(size.size || "").trim().toLowerCase() === normalized);
  const candidates = rows.filter((row) => Number(row.qty ?? row.available ?? row.stockQty ?? 0) > 0);
  const sourceRows = candidates.length ? candidates : rows;
  return sourceRows
    .slice()
    .sort((left, right) => {
      const leftPrice = sizeRowPrice(left) || Number.MAX_SAFE_INTEGER;
      const rightPrice = sizeRowPrice(right) || Number.MAX_SAFE_INTEGER;
      if (leftPrice !== rightPrice) return leftPrice - rightPrice;
      const leftPriority = warehousePriorityIndex(item, left);
      const rightPriority = warehousePriorityIndex(item, right);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return warehouseRowValue(left).localeCompare(warehouseRowValue(right), "vi", { numeric: true });
    })[0] || null;
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
  const product = products.find((item) => item.code === code);
  if (!product) return false;
  const sizeSelect = scope?.querySelector?.(`[data-size-code="${cssEscape(code)}"]`) || document.querySelector(`[data-size-code="${cssEscape(code)}"]`);
  const size = sizeSelect ? sizeSelect.value : availableProductSizes(product)[0];
  if (!size) return false;
  const selectedRow = bestSizeRowForSelection(product, size) || {};
  const warehouseId = String(selectedRow.warehouseId || "").trim();
  const warehouse = String(selectedRow.warehouse || selectedRow.warehouseName || "").trim();

  const key = `${code}__${size}__${warehouseId || warehouse}`;
  const current = cart.find((item) => item.key === key);
  if (current) {
    current.qty += 1;
  } else {
    cart.push({
      key,
      productCode: product.code,
      productName: product.name,
      sourceName: product.sourceName,
      size,
      price: sizeRowPrice(selectedRow) || sellingPriceForSize(product, size),
      saleFilePrice: sizeRowCostPrice(selectedRow, product),
      originalSalePrice: sizeRowCostPrice(selectedRow, product),
      preMarkupSalePrice: sizeRowCostPrice(selectedRow, product),
      listPrice: sizeRowListPrice(selectedRow, product),
      warehouseId,
      warehouse,
      warehouseName: warehouse,
      qty: 1
    });
  }
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
        ${orderInfoHTML}
      </div>
      <div class="cart-total">
        <span>Tạm tính</span>
        <strong id="cart-total">0đ</strong>
      </div>
      <button class="primary-button" id="checkout-button" type="button">Đặt hàng</button>
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
        <div>
          <strong>${escapeHTML(item.productName)}</strong>
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
  renderCart();
}

function openCheckoutDialog() {
  if (!cart.length) return;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <form class="order-modal" id="order-form">
      <div class="modal-header">
        <div>
          <p class="eyebrow">Đặt hàng</p>
          <h2>Thông tin nhận hàng</h2>
          <p>${cart.reduce((sum, item) => sum + item.qty, 0)} sản phẩm - ${formatMoney(cart.reduce((sum, item) => sum + item.qty * item.price, 0))}</p>
        </div>
        <button type="button" class="icon-button" id="close-order">X</button>
      </div>
      <div class="checkout-items">
        ${cart.map((item) => `<div><span>${escapeHTML(item.productName)} - Size ${escapeHTML(item.size)} x${item.qty}</span><strong>${formatMoney(item.price * item.qty)}</strong></div>`).join("")}
      </div>
      <div class="checkout-notes">
        ${orderInfoHTML}
      </div>
      <label>Họ tên
        <input name="customerName" required placeholder="Nguyễn Văn A">
      </label>
      <label>Số điện thoại
        <input name="phone" required placeholder="09xxxxxxxx">
      </label>
      <label>Địa chỉ nhận hàng
        <input name="address" required placeholder="Số nhà, phường/xã, quận/huyện">
      </label>
      <label>Ghi chú
        <input name="note" placeholder="Màu sắc, thời gian nhận hàng...">
      </label>
      <button class="primary-button" type="submit">Gửi đơn hàng</button>
      <p class="form-message" id="order-message"></p>
    </form>
  `;
  document.body.appendChild(overlay);
  document.getElementById("close-order").addEventListener("click", () => overlay.remove());
  document.getElementById("order-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.items = cart.map(({ key, ...item }) => item);
    payload.total = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
    const message = document.getElementById("order-message");
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    const orderUrl = result?.order?.lookupUrl || "";
    message.innerHTML = response.ok
      ? `Đã nhận đơn. ${orderUrl ? `<a href="${escapeHTML(orderUrl)}">Xem trạng thái đơn</a>` : "TopRun sẽ liên hệ xác nhận."}`
      : "Chưa gửi được đơn, vui lòng thử lại."
    if (response.ok) {
      cart = [];
      renderCart();
      setTimeout(() => overlay.remove(), 1400);
    }
  });
}

function availableSizes() {
  return uniqueValues(products.flatMap((item) => availableProductSizes(item)))
    .sort((a, b) => sizeSortValue(a) - sizeSortValue(b) || a.localeCompare(b, "vi"));
}

function availableProductSizes(item) {
  return productSizes(item).filter((size) => Number(size.qty || 0) > 0).map((size) => String(size.size));
}

function productSizes(item) {
  return Array.isArray(item?.sizes) ? item.sizes : [];
}

function sizeText(item) {
  const available = availableProductSizes(item);
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
  if (/(shoe|shoes|giày|giay|sandal|slide|sneaker|boot|runner|running|adizero|ultraboost|supernova)/i.test(text)) return "Giày";
  if (/(tee|shirt|t-shirt|áo|ao |short|shorts|quần|quan |pant|pants|tight|jacket|hoodie|jersey|bra|skirt|dress)/i.test(text)) return "Quần áo";
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
  return `${item.name || ""} ${item.code || ""} ${item.category || ""} ${item.division || ""} ${sizeText(item)}`;
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
