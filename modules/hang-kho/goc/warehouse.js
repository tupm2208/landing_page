const app = {
  state: null,
  view: "lookup",
  query: "",
  sizeFilter: "",
  productGroupFilter: "all",
  sportGroupFilter: "all",
  maxPriceFilter: "",
  sourceFilters: ["ready", "order", "dasbui"],
  onlyAvailableFilter: true,
  warehouseFilter: "all",
  cartWarehouse: "ready",
  cart: [],
  editingProductId: "",
  selectedProductId: "",
  editingCustomerId: "",
  editingUserId: "",
  mobileToolsOpen: false,
  stockImportRows: [],
  importSearch: "",
  importOrderLines: [],
  previewMode: "desktop"
};

const titles = {
  lookup: "Tra cứu lấy hàng",
  orderWarehouse: "Kho order",
  orders: "Đơn hàng",
  products: "Sản phẩm",
  customers: "Khách hàng",
  stock: "Nhập/chuyển kho",
  users: "Phân quyền"
};

const money = new Intl.NumberFormat("vi-VN");

function $(selector) {
  return document.querySelector(selector);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(value) {
  return `${money.format(Number(value || 0))} đ`;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || payload.error || "Có lỗi xảy ra.");
  }
  return payload;
}

async function loadState() {
  const payload = await api("/api/warehouse/state");
  app.state = payload.data;
  render();
}

function products() {
  return Array.isArray(app.state?.products) ? app.state.products : [];
}

function customers() {
  return Array.isArray(app.state?.customers) ? app.state.customers : [];
}

function orders() {
  return Array.isArray(app.state?.orders) ? app.state.orders : [];
}

function users() {
  return Array.isArray(app.state?.users) ? app.state.users : [];
}

function importOrders() {
  return Array.isArray(app.state?.importOrders) ? app.state.importOrders : [];
}

function productById(id) {
  return products().find((item) => item.id === id) || null;
}

function productImages(product = {}) {
  return [product.imageUrl, ...(Array.isArray(product.images) ? product.images : [])]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function productVariants(product = {}) {
  return Array.isArray(product.variants) ? product.variants : [];
}

function listText(value) {
  return Array.isArray(value) ? value.join("\n") : String(value || "");
}

function sizeSummary(product = {}) {
  const variants = productVariants(product);
  if (!variants.length) return "";
  return variants.map((item) => `${item.size}: ${Number(item.readyStock || 0)}/${Number(item.orderStock || 0)}`).join(" · ");
}

function productTotalStock(product = {}) {
  return Number(product.readyStock || 0) + Number(product.orderStock || 0);
}

function productGroup(product = {}) {
  const text = [product.category, product.productLine, product.name, product.sku].join(" ").toLowerCase();
  if (text.includes("áo") || text.includes("ao ") || text.includes("quần") || text.includes("quan ") || text.includes("shirt") || text.includes("apparel")) return "apparel";
  return "shoes";
}

function sportGroup(product = {}) {
  const values = [
    product.category,
    product.productLine,
    product.name,
    product.sku,
    ...(Array.isArray(product.hardTags) ? product.hardTags : []),
    ...(Array.isArray(product.surfaceTags) ? product.surfaceTags : []),
    ...(Array.isArray(product.benefitTags) ? product.benefitTags : [])
  ].join(" ").toLowerCase();
  if (values.includes("running") || values.includes("chạy") || values.includes("chay")) return "running";
  if (values.includes("pickleball") || values.includes("tennis") || values.includes("court")) return "pickleball";
  return "general";
}

function customerById(id) {
  return customers().find((item) => item.id === id) || null;
}

function filteredProducts() {
  const query = app.query.trim().toLowerCase();
  const size = app.sizeFilter.trim().toLowerCase();
  const maxPrice = Number(app.maxPriceFilter || 0);
  const activeSources = new Set(app.sourceFilters);
  return products().filter((product) => {
    const haystack = [
      product.sku,
      product.name,
      product.category,
      product.brand,
      product.productLine,
      product.color,
      product.material,
      product.gender,
      product.productUrl,
      product.sourceName,
      product.sourceFile,
      product.primaryLine,
      product.tagRuleId,
      product.buyerInsight,
      product.note,
      sizeSummary(product),
      ...(Array.isArray(product.hardTags) ? product.hardTags : []),
      ...(Array.isArray(product.surfaceTags) ? product.surfaceTags : []),
      ...(Array.isArray(product.benefitTags) ? product.benefitTags : []),
      ...(Array.isArray(product.riskTags) ? product.riskTags : []),
      ...(Array.isArray(product.customerSegments) ? product.customerSegments : []),
      ...(Array.isArray(product.playStyleTags) ? product.playStyleTags : []),
      ...(Array.isArray(product.contentAngles) ? product.contentAngles : []),
      ...(Array.isArray(product.viralHooks) ? product.viralHooks : [])
    ].join(" ").toLowerCase();
    const matchQuery = !query || haystack.includes(query);
    const matchSize = !size || productVariants(product).some((variant) => String(variant.size || "").toLowerCase().includes(size));
    const matchProductGroup = app.productGroupFilter === "all" || productGroup(product) === app.productGroupFilter;
    const matchSportGroup = app.sportGroupFilter === "all" || sportGroup(product) === app.sportGroupFilter;
    const price = Number(product.price || 0);
    const matchPrice = !maxPrice || price <= maxPrice;
    const matchSources = (!activeSources.size)
      || (activeSources.has("ready") && Number(product.readyStock || 0) > 0)
      || (activeSources.has("order") && Number(product.orderStock || 0) > 0)
      || (activeSources.has("dasbui") && String(product.sourceName || "").toLowerCase().includes("dasbui"))
      || (activeSources.has("partner") && String(product.source || "").toLowerCase() === "partner");
    const matchAvailable = !app.onlyAvailableFilter || productTotalStock(product) > 0;
    const matchWarehouse = app.warehouseFilter === "all"
      || (app.warehouseFilter === "ready" && Number(product.readyStock || 0) > 0)
      || (app.warehouseFilter === "order" && Number(product.orderStock || 0) > 0)
      || (app.warehouseFilter === "empty" && Number(product.readyStock || 0) + Number(product.orderStock || 0) <= 0);
    return matchQuery && matchSize && matchProductGroup && matchSportGroup && matchPrice && matchSources && matchAvailable && matchWarehouse;
  });
}

function orderWarehouseProducts() {
  const query = app.query.trim().toLowerCase();
  const size = app.sizeFilter.trim().toLowerCase();
  const maxPrice = Number(app.maxPriceFilter || 0);
  return products()
    .filter((product) => {
      if (Number(product.orderStock || 0) <= 0) return false;
      const haystack = [
        product.sku,
        product.name,
        product.category,
        product.brand,
        product.productLine,
        product.color,
        product.sourceName,
        sizeSummary(product)
      ].join(" ").toLowerCase();
      const matchQuery = !query || haystack.includes(query);
      const matchSize = !size || orderWarehouseVariants(product).some((variant) => String(variant.size || "").toLowerCase().includes(size));
      const matchProductGroup = app.productGroupFilter === "all" || productGroup(product) === app.productGroupFilter;
      const matchSportGroup = app.sportGroupFilter === "all" || sportGroup(product) === app.sportGroupFilter;
      const price = Number(product.price || 0);
      const matchPrice = !maxPrice || price <= maxPrice;
      return matchQuery && matchSize && matchProductGroup && matchSportGroup && matchPrice;
    })
    .sort((left, right) => Number(right.orderStock || 0) - Number(left.orderStock || 0));
}

function orderWarehouseVariants(product = {}) {
  return productVariants(product)
    .filter((variant) => Number(variant.orderStock || 0) > 0)
    .sort((left, right) => String(left.size || "").localeCompare(String(right.size || ""), "vi", { numeric: true }));
}

function orderWarehouseTotals() {
  const orderProducts = products().filter((product) => Number(product.orderStock || 0) > 0);
  const orderVariants = orderProducts.flatMap(orderWarehouseVariants);
  const orderUnits = orderProducts.reduce((sum, product) => sum + Number(product.orderStock || 0), 0);
  const orderValue = orderProducts.reduce((sum, product) => sum + Number(product.orderStock || 0) * Number(product.price || 0), 0);
  return {
    products: orderProducts.length,
    variants: orderVariants.length,
    units: orderUnits,
    value: orderValue
  };
}

function renderStats() {
  const ready = products().reduce((sum, item) => sum + Number(item.readyStock || 0), 0);
  const order = products().reduce((sum, item) => sum + Number(item.orderStock || 0), 0);
  const soldReady = orders().filter((item) => item.warehouse === "ready").length;
  const soldOrder = orders().filter((item) => item.warehouse === "order").length;
  $("#stats").innerHTML = `
    <div class="stat"><span class="muted">SKU</span><b>${products().length}</b></div>
    <div class="stat"><span class="muted">Tồn kho sẵn</span><b>${ready}</b></div>
    <div class="stat"><span class="muted">Tồn kho order</span><b>${order}</b></div>
    <div class="stat"><span class="muted">Đơn đã bán</span><b>${soldReady + soldOrder}</b></div>
  `;
}

function productStockChips(product) {
  return `
    <span class="chip ready">Sẵn: ${Number(product.readyStock || 0)}</span>
    <span class="chip order">Order: ${Number(product.orderStock || 0)}</span>
    <span class="chip">Size: ${productVariants(product).length || "chưa tách"}</span>
    <span class="chip">${formatMoney(product.price)}</span>
  `;
}

function productCopyText(product, warehouse = app.cartWarehouse) {
  const stock = warehouse === "ready" ? product.readyStock : product.orderStock;
  return `${product.name}
SKU: ${product.sku}
Kho: ${warehouse === "ready" ? "Kho sẵn" : "Kho order"}
Tồn: ${stock} ${product.unit || "cái"}
Size: ${sizeSummary(product) || "Chưa tách size"}
Giá: ${formatMoney(product.price)}`;
}

function bestProductVariant(product = {}, warehouse = app.cartWarehouse) {
  const field = warehouse === "ready" ? "readyStock" : "orderStock";
  return productVariants(product).find((variant) => Number(variant[field] || 0) > 0) || productVariants(product)[0] || {};
}

async function copyProduct(id) {
  const product = productById(id);
  if (!product) return;
  const text = productCopyText(product);
  try {
    const imageUrl = productImages(product)[0];
    if (!imageUrl || !navigator.clipboard || typeof ClipboardItem === "undefined") {
      throw new Error("Clipboard ảnh chưa sẵn sàng.");
    }
    const blob = await makePricedProductImageBlob(imageUrl, product);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast("Đã copy ảnh sản phẩm kèm giá.");
  } catch (_) {
    await navigator.clipboard.writeText(text);
    toast("Đã copy thông tin sản phẩm.");
  }
  renderLookupCopyBox(text);
}

async function pushProductImage(id) {
  const product = productById(id);
  if (!product) return;
  await copyProduct(id);
  addToCart(id);
}

async function saveProductImage(id) {
  const product = productById(id);
  if (!product) return;
  const imageUrl = productImages(product)[0];
  if (!imageUrl) {
    toast("Sản phẩm chưa có ảnh để lưu.");
    return;
  }
  const blob = await makePricedProductImageBlob(imageUrl, product);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `${String(product.sku || "san-pham").replace(/[^a-z0-9._-]+/gi, "-")}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  toast("Đã tạo ảnh để lưu.");
}

function addToCart(id) {
  const product = productById(id);
  if (!product) return;
  const field = app.cartWarehouse === "ready" ? "readyStock" : "orderStock";
  if (Number(product[field] || 0) <= 0) {
    toast("Kho đang chọn không còn sản phẩm này.");
    return;
  }
  const line = app.cart.find((item) => item.productId === id);
  if (line) line.quantity += 1;
  else app.cart.push({ productId: id, quantity: 1, price: Number(product.price || 0) });
  render();
}

function updateCartQuantity(id, quantity) {
  const line = app.cart.find((item) => item.productId === id);
  if (!line) return;
  line.quantity = Math.max(1, Number(quantity || 1));
  render();
}

function removeCartLine(id) {
  app.cart = app.cart.filter((item) => item.productId !== id);
  render();
}

function renderLookupCopyBox(text) {
  const box = $("#copy-box");
  if (box) box.textContent = text;
}

function productThumb(product = {}) {
  const image = productImages(product)[0];
  if (image) return `<img class="product-thumb" src="${escapeHTML(image)}" alt="">`;
  return `<div class="product-thumb empty">Ảnh</div>`;
}

function mobileToolPanel(content) {
  return `
    <button id="mobile-tools-toggle" class="mobile-tools-toggle" type="button">${app.mobileToolsOpen ? "Ẩn bộ lọc" : "Bộ lọc / thao tác"}</button>
    <div class="mobile-tools ${app.mobileToolsOpen ? "open" : ""}">${content}</div>
  `;
}

function renderLookup() {
  const list = filteredProducts().map((product) => `
    <article class="card">
      <div class="card-title">
        <div class="product-title">
          ${productThumb(product)}
          <div>
          <h4>${escapeHTML(product.name)}</h4>
          <div class="sku">${escapeHTML(product.sku)} · ${escapeHTML(product.brand || "Chưa có brand")}</div>
          </div>
        </div>
        <div class="line-actions">
          <button class="small" type="button" data-open-product="${product.id}">Mở</button>
          <button class="small" type="button" data-copy="${product.id}">Copy</button>
          <button class="small" type="button" data-save-image="${product.id}">Lưu ảnh</button>
          <button class="primary small" type="button" data-push="${product.id}">Đẩy hàng</button>
        </div>
      </div>
      <div class="row">${productStockChips(product)}</div>
      ${sizeSummary(product) ? `<div class="sku">${escapeHTML(sizeSummary(product))}</div>` : ""}
      <div class="muted">${escapeHTML(product.category || "Chưa phân loại")}${product.note ? ` · ${escapeHTML(product.note)}` : ""}</div>
    </article>
  `).join("");

  const cartLines = app.cart.map((line) => {
    const product = productById(line.productId);
    if (!product) return "";
    return `
      <div class="cart-line">
        <div>
          <b>${escapeHTML(product.name)}</b>
          <div class="sku">${escapeHTML(product.sku)} · ${formatMoney(line.price)}</div>
        </div>
        <input data-cart-qty="${line.productId}" type="number" min="1" value="${line.quantity}">
        <button class="small" data-remove-cart="${line.productId}" type="button">×</button>
      </div>
    `;
  }).join("");

  const total = app.cart.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.price || 0), 0);
  const filterTools = `
    <div class="filters">
      <div class="filter-row primary-row">
        <label class="field query-field"><span>Mã / tên sản phẩm</span><input id="search-input" value="${escapeHTML(app.query)}" placeholder="VD: 1041A370-106"></label>
        <label class="field size-field"><span>Size</span><input id="size-filter" value="${escapeHTML(app.sizeFilter)}" placeholder="42"></label>
      </div>
      <div class="filter-row secondary-row">
        <label class="field"><span>Nhóm hàng</span><select id="product-group-filter">
          <option value="all">Tất cả</option>
          <option value="shoes">Giày</option>
          <option value="apparel">Quần áo</option>
        </select></label>
        <label class="field"><span>Phân loại</span><select id="sport-group-filter">
          <option value="all">Tất cả</option>
          <option value="running">Running</option>
          <option value="pickleball">Court</option>
          <option value="general">Tổng hợp</option>
        </select></label>
        <label class="field price-field"><span>Giá tối đa</span><input id="max-price-filter" inputmode="numeric" value="${escapeHTML(app.maxPriceFilter)}" placeholder="3500000"></label>
        <label class="field"><span>Kho</span><select id="warehouse-filter">
          <option value="all">Tất cả</option>
          <option value="ready">Kho sẵn</option>
          <option value="order">Kho order</option>
          <option value="empty">Hết hàng</option>
        </select></label>
      </div>
      <div class="filter-checks compact-checks">
        <label><input data-source-filter="ready" type="checkbox"> Kho sẵn</label>
        <label><input data-source-filter="order" type="checkbox"> Kho order</label>
        <label><input data-source-filter="dasbui" type="checkbox"> DASBUI</label>
        <label><input data-source-filter="partner" type="checkbox"> Đối tác</label>
        <label><input id="only-available-filter" type="checkbox"> Chỉ còn hàng</label>
      </div>
    </div>
  `;
  $("#view").innerHTML = `
    <div class="split">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>Lọc sản phẩm</h3>
            <p class="muted">Dùng để tra cứu nhanh, đẩy vào đơn hoặc copy gửi khách.</p>
          </div>
        </div>
        ${mobileToolPanel(filterTools)}
        <div class="list" style="margin-top:12px">${list || '<div class="card muted">Không tìm thấy sản phẩm phù hợp.</div>'}</div>
      </section>

      <aside class="panel">
        <div class="panel-head">
          <div>
            <h3>Hàng lấy cho khách</h3>
            <p class="muted">Chọn kho bán trước khi đẩy hàng.</p>
          </div>
        </div>
        <div class="field">
          <label>Kho bán</label>
          <select id="cart-warehouse">
            <option value="ready">Kho sẵn</option>
            <option value="order">Kho order</option>
          </select>
        </div>
        <div class="list" style="margin-top:12px">${cartLines || '<div class="copy-box">Chưa có sản phẩm trong danh sách lấy hàng.</div>'}</div>
        <div class="row" style="justify-content:space-between;margin-top:12px">
          <b>Tổng: ${formatMoney(total)}</b>
          <button id="create-order-from-cart" class="primary" type="button">Tạo đơn</button>
        </div>
        <div id="copy-box" class="copy-box" style="margin-top:12px">Nội dung copy sản phẩm sẽ hiện ở đây.</div>
      </aside>
    </div>
  `;
  $("#warehouse-filter").value = app.warehouseFilter;
  $("#product-group-filter").value = app.productGroupFilter;
  $("#sport-group-filter").value = app.sportGroupFilter;
  $("#only-available-filter").checked = app.onlyAvailableFilter;
  document.querySelectorAll("[data-source-filter]").forEach((input) => {
    input.checked = app.sourceFilters.includes(input.dataset.sourceFilter);
  });
  $("#cart-warehouse").value = app.cartWarehouse;
}

function renderOrderWarehouse() {
  app.cartWarehouse = "order";
  const totals = orderWarehouseTotals();
  const rows = orderWarehouseProducts().map((product) => {
    const variantRows = orderWarehouseVariants(product).map((variant) => `
      <div class="order-size-row">
        <span>Size ${escapeHTML(variant.size || "")}</span>
        <b>${Number(variant.orderStock || 0)}</b>
        <small>${formatMoney(variant.price || product.price || 0)}</small>
      </div>
    `).join("");
    return `
      <article class="order-warehouse-row">
        ${productThumb(product)}
        <div class="order-warehouse-main">
          <div class="card-title">
            <div>
              <h4>${escapeHTML(product.name)}</h4>
              <div class="sku">${escapeHTML(product.sku)} · ${escapeHTML(product.brand || "Chưa có brand")} · ${formatMoney(product.price)}</div>
            </div>
            <span class="chip order">Order ${Number(product.orderStock || 0)}</span>
          </div>
          <div class="order-size-grid">${variantRows || `<div class="sku">Chưa tách size order.</div>`}</div>
          <div class="line-actions">
            <button class="small" type="button" data-open-product="${product.id}">Mở</button>
            <button class="small" type="button" data-order-copy="${product.id}">Copy tư vấn</button>
            <button class="small" type="button" data-save-image="${product.id}">Lưu ảnh</button>
            <button class="primary small" type="button" data-order-push="${product.id}">Thêm vào đơn order</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  const cartLines = app.cart.map((line) => {
    const product = productById(line.productId);
    if (!product) return "";
    return `
      <div class="cart-line">
        <div>
          <b>${escapeHTML(product.name)}</b>
          <div class="sku">${escapeHTML(product.sku)} · Kho order · ${formatMoney(line.price)}</div>
        </div>
        <input data-cart-qty="${line.productId}" type="number" min="1" value="${line.quantity}">
        <button class="small" data-remove-cart="${line.productId}" type="button">×</button>
      </div>
    `;
  }).join("");
  const total = app.cart.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.price || 0), 0);

  $("#view").innerHTML = `
    <div class="order-warehouse">
      <section class="panel order-command">
        <div class="panel-head">
          <div>
            <h3>Kho order</h3>
            <p class="muted">Theo dõi riêng hàng order để xử lý đơn và gửi ảnh tư vấn khách. Mục này không cộng vào tổng kho hệ thống.</p>
          </div>
          <div class="actions">
            <button id="download-order-sideviews" class="ghost" type="button">Tải ảnh side view</button>
            <button id="sync-order-warehouse-lookup" class="primary" type="button">Đồng bộ cho Inventory Lookup</button>
          </div>
        </div>
        <div class="order-metrics">
          <div class="stat"><span class="muted">Mã còn order</span><b>${totals.products}</b></div>
          <div class="stat"><span class="muted">Size còn order</span><b>${totals.variants}</b></div>
          <div class="stat"><span class="muted">Tổng đôi/cái</span><b>${totals.units}</b></div>
          <div class="stat"><span class="muted">Giá trị tạm tính</span><b>${formatMoney(totals.value)}</b></div>
        </div>
      </section>

      <div class="split">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Danh sách hàng order</h3>
              <p class="muted">Dùng ô tìm kiếm ở đây để lọc SKU, tên, brand hoặc size.</p>
            </div>
          </div>
          ${mobileToolPanel(`
            <div class="filters">
              <div class="filter-row primary-row">
                <label class="field query-field"><span>Mã / tên sản phẩm</span><input id="search-input" value="${escapeHTML(app.query)}" placeholder="VD: 1041A538-400"></label>
                <label class="field size-field"><span>Size</span><input id="size-filter" value="${escapeHTML(app.sizeFilter)}" placeholder="42"></label>
              </div>
              <div class="filter-row secondary-row">
                <label class="field"><span>Nhóm hàng</span><select id="product-group-filter">
                  <option value="all">Tất cả</option>
                  <option value="shoes">Giày</option>
                  <option value="apparel">Quần áo</option>
                </select></label>
                <label class="field"><span>Phân loại</span><select id="sport-group-filter">
                  <option value="all">Tất cả</option>
                  <option value="running">Running</option>
                  <option value="pickleball">Court</option>
                  <option value="general">Tổng hợp</option>
                </select></label>
                <label class="field price-field"><span>Giá tối đa</span><input id="max-price-filter" inputmode="numeric" value="${escapeHTML(app.maxPriceFilter)}" placeholder="3500000"></label>
              </div>
            </div>
          `)}
          <div class="order-warehouse-list">${rows || '<div class="card muted">Chưa có hàng order phù hợp.</div>'}</div>
        </section>

        <aside class="panel">
          <div class="panel-head">
            <div>
              <h3>Đơn từ kho order</h3>
              <p class="muted">Các sản phẩm thêm ở mục này luôn trừ kho order.</p>
            </div>
          </div>
          <div class="list">${cartLines || '<div class="copy-box">Chưa có sản phẩm order trong đơn.</div>'}</div>
          <div class="row" style="justify-content:space-between;margin-top:12px">
            <b>Tổng: ${formatMoney(total)}</b>
            <button id="create-order-from-cart" class="primary" type="button">Tạo đơn order</button>
          </div>
          <div id="copy-box" class="copy-box" style="margin-top:12px">Nội dung tư vấn/copy sẽ hiện ở đây.</div>
        </aside>
      </div>
    </div>
  `;
  $("#product-group-filter").value = app.productGroupFilter;
  $("#sport-group-filter").value = app.sportGroupFilter;
}

function renderOrders() {
  const rows = orders().map((order) => {
    const customer = customerById(order.customerId);
    const lines = (order.lines || []).map((line) => {
      const product = productById(line.productId);
      return `${product?.name || "Sản phẩm"} x ${line.quantity}`;
    }).join(", ");
    const returnButtons = (order.lines || []).map((line) => {
      const product = productById(line.productId);
      return `<button class="small" data-return-order="${order.id}" data-return-product="${line.productId}" type="button">Hoàn ${escapeHTML(product?.sku || "")}</button>`;
    }).join("");
    return `
      <div class="card">
        <div class="card-title">
          <div>
            <h4>${escapeHTML(order.code)}</h4>
            <div class="sku">${escapeHTML(customer?.name || order.customerName || "Khách chưa lưu")} · ${order.warehouse === "ready" ? "Kho sẵn" : "Kho order"}</div>
          </div>
          <span class="chip ${order.warehouse === "ready" ? "ready" : "order"}">${formatMoney(order.total)}</span>
        </div>
        <div>${escapeHTML(lines)}</div>
        <div class="line-actions">${returnButtons}</div>
      </div>
    `;
  }).join("");
  $("#view").innerHTML = `<section class="panel"><div class="panel-head"><h3>Đơn đã bán</h3></div><div class="list">${rows || '<div class="card muted">Chưa có đơn hàng.</div>'}</div></section>`;
}

function renderProductForm() {
  const product = productById(app.editingProductId) || {};
  const images = productImages(product).join("\n");
  const variants = productVariants(product).length ? productVariants(product) : [
    { size: "", barcode: "", color: product.color || "", readyStock: 0, orderStock: 0, price: product.price || 0, note: "" }
  ];
  const variantRows = variants.map((variant) => `
    <div class="variant-row">
      <input name="variantSize" placeholder="Size" value="${escapeHTML(variant.size || "")}">
      <input name="variantBarcode" placeholder="Barcode" value="${escapeHTML(variant.barcode || "")}">
      <input name="variantColor" placeholder="Màu" value="${escapeHTML(variant.color || "")}">
      <input name="variantReady" type="number" min="0" placeholder="Kho sẵn" value="${Number(variant.readyStock || 0)}">
      <input name="variantOrder" type="number" min="0" placeholder="Kho order" value="${Number(variant.orderStock || 0)}">
      <input name="variantPrice" type="number" min="0" placeholder="Giá riêng" value="${Number(variant.price || 0)}">
      <input name="variantNote" placeholder="Ghi chú size" value="${escapeHTML(variant.note || "")}">
    </div>
  `).join("");
  const gallery = productImages(product).map((image) => `<img class="gallery-thumb" src="${escapeHTML(image)}" alt="">`).join("");
  return `
    <form id="product-form" class="panel">
      <div class="panel-head">
        <div>
          <h3>${product.id ? "Sửa sản phẩm" : "Tạo sản phẩm mới"}</h3>
          <p class="muted">Mỗi dòng size có tồn kho sẵn và kho order riêng. Tổng tồn sản phẩm được tính từ các dòng size.</p>
        </div>
        <button id="back-products" class="ghost" type="button">Danh sách</button>
      </div>
      <input name="id" type="hidden" value="${escapeHTML(product.id || "")}">
      <div class="field-grid">
        <div class="field span-2"><label>Tên sản phẩm</label><input name="name" required value="${escapeHTML(product.name || "")}"></div>
        <div class="field"><label>SKU</label><input name="sku" required value="${escapeHTML(product.sku || "")}"></div>
        <div class="field"><label>Đơn vị</label><input name="unit" value="${escapeHTML(product.unit || "cái")}"></div>
        <div class="field"><label>Brand</label><input name="brand" value="${escapeHTML(product.brand || "")}"></div>
        <div class="field"><label>Phân loại</label><input name="category" value="${escapeHTML(product.category || "")}"></div>
        <div class="field"><label>Dòng/mẫu</label><input name="productLine" value="${escapeHTML(product.productLine || "")}"></div>
        <div class="field"><label>Màu chính</label><input name="color" value="${escapeHTML(product.color || "")}"></div>
        <div class="field"><label>Chất liệu</label><input name="material" value="${escapeHTML(product.material || "")}"></div>
        <div class="field"><label>Nhóm khách</label><select name="gender"><option value="">Chưa chọn</option><option value="unisex">Unisex</option><option value="men">Nam</option><option value="women">Nữ</option><option value="kids">Trẻ em</option></select></div>
        <div class="field"><label>Trạng thái</label><select name="status"><option value="active">Đang bán</option><option value="draft">Nháp</option><option value="hidden">Ẩn</option><option value="discontinued">Ngừng bán</option></select></div>
        <div class="field"><label>Giá bán</label><input name="price" type="number" min="0" value="${Number(product.price || 0)}"></div>
        <div class="field"><label>Giá nhập</label><input name="cost" type="number" min="0" value="${Number(product.cost || 0)}"></div>
        <div class="field span-2"><label>Ảnh chính URL</label><input name="imageUrl" value="${escapeHTML(product.imageUrl || "")}" placeholder="https://..."></div>
        <div class="field span-2"><label>Thư viện ảnh</label><textarea name="images" placeholder="Mỗi dòng một link ảnh">${escapeHTML(images)}</textarea></div>
        <div class="field span-4"><label>Link sản phẩm trên web</label><input name="productUrl" value="${escapeHTML(product.productUrl || "")}" placeholder="https://dasbui.com/shop/..."></div>
        <div class="field"><label>Nguồn</label><input name="source" value="${escapeHTML(product.source || "")}" placeholder="partner"></div>
        <div class="field"><label>Tên nguồn</label><input name="sourceName" value="${escapeHTML(product.sourceName || "")}" placeholder="Dasbui"></div>
        <div class="field"><label>File/API nguồn</label><input name="sourceFile" value="${escapeHTML(product.sourceFile || "")}" placeholder="partner-web:Dasbui"></div>
        <div class="field"><label>Trạng thái sync</label><select name="syncStatus"><option value="manual">Manual</option><option value="synced">Đã đồng bộ</option><option value="pending">Chờ đồng bộ</option><option value="error">Lỗi đồng bộ</option></select></div>
        <div class="field"><label>ID sản phẩm ngoài</label><input name="externalProductId" value="${escapeHTML(product.externalProductId || "")}"></div>
        <div class="field"><label>ID nhóm biến thể</label><input name="externalVariantGroupId" value="${escapeHTML(product.externalVariantGroupId || "")}"></div>
        <div class="field"><label>Slug web</label><input name="webSlug" value="${escapeHTML(product.webSlug || "")}"></div>
        <div class="field"><label>Sync lần cuối</label><input name="lastSyncedAt" value="${escapeHTML(product.lastSyncedAt || "")}" placeholder="ISO time"></div>
        <div class="field span-2"><label>Danh mục web</label><input name="webCategoryPath" value="${escapeHTML(product.webCategoryPath || "")}" placeholder="GIÀY TENNIS PICKLEBALL / Nike"></div>
        <div class="field"><label>Cập nhật gốc</label><input name="originalUpdatedAt" value="${escapeHTML(product.originalUpdatedAt || "")}"></div>
        <div class="field"><label>Primary line</label><input name="primaryLine" value="${escapeHTML(product.primaryLine || "")}"></div>
        <div class="field"><label>Tag rule ID</label><input name="tagRuleId" value="${escapeHTML(product.tagRuleId || "")}"></div>
        <div class="field"><label>Nhóm thay thế</label><input name="substituteGroup" value="${escapeHTML(product.substituteGroup || "")}"></div>
        <div class="field span-2"><label>Web tags/filter</label><textarea name="webTags" placeholder="Mỗi dòng một tag/filter">${escapeHTML(listText(product.webTags))}</textarea></div>
        <div class="field span-2"><label>Hard tags</label><textarea name="hardTags">${escapeHTML(listText(product.hardTags))}</textarea></div>
        <div class="field span-2"><label>Surface tags</label><textarea name="surfaceTags">${escapeHTML(listText(product.surfaceTags))}</textarea></div>
        <div class="field span-2"><label>Benefit tags</label><textarea name="benefitTags">${escapeHTML(listText(product.benefitTags))}</textarea></div>
        <div class="field span-2"><label>Risk tags</label><textarea name="riskTags">${escapeHTML(listText(product.riskTags))}</textarea></div>
        <div class="field span-2"><label>Customer segments</label><textarea name="customerSegments">${escapeHTML(listText(product.customerSegments))}</textarea></div>
        <div class="field span-2"><label>Play style tags</label><textarea name="playStyleTags">${escapeHTML(listText(product.playStyleTags))}</textarea></div>
        <div class="field span-2"><label>Content angles</label><textarea name="contentAngles">${escapeHTML(listText(product.contentAngles))}</textarea></div>
        <div class="field span-2"><label>Viral hooks</label><textarea name="viralHooks">${escapeHTML(listText(product.viralHooks))}</textarea></div>
        <div class="field span-4"><label>Chính sách/ghi chú nguồn</label><textarea name="policy">${escapeHTML(product.policy || "")}</textarea></div>
        <div class="field span-4"><label>Buyer insight</label><textarea name="buyerInsight">${escapeHTML(product.buyerInsight || "")}</textarea></div>
        <div class="field span-2"><label>SEO title</label><input name="seoTitle" value="${escapeHTML(product.seoTitle || "")}"></div>
        <div class="field span-2"><label>SEO description</label><textarea name="seoDescription">${escapeHTML(product.seoDescription || "")}</textarea></div>
        <div class="field span-4">
          <label>Upload hoặc dán ảnh</label>
          <div id="image-drop-zone" class="image-drop-zone" tabindex="0">
            <div>
              <b>Chọn ảnh, kéo thả hoặc Ctrl+V</b>
              <span>Ảnh sẽ lưu trong server tại thư mục media/warehouse-products.</span>
            </div>
            <input id="product-image-input" type="file" accept="image/*" multiple>
            <button id="choose-product-image" class="ghost" type="button">Chọn ảnh</button>
          </div>
          <div class="image-gallery">${gallery || '<span class="muted">Chưa có ảnh đã lưu.</span>'}</div>
        </div>
        <div class="field span-4"><label>Mô tả sản phẩm</label><textarea name="description">${escapeHTML(product.description || "")}</textarea></div>
        <div class="field span-4"><label>Ghi chú bán hàng</label><textarea name="salesNote">${escapeHTML(product.salesNote || "")}</textarea></div>
        <div class="field span-4"><label>Ghi chú nội bộ</label><textarea name="note">${escapeHTML(product.note || "")}</textarea></div>
      </div>
      <div class="variant-editor">
        <div class="panel-head">
          <h3>Size và tồn kho</h3>
          <button id="add-variant-row" class="ghost" type="button">Thêm size</button>
        </div>
        <div class="variant-head">
          <span>Size</span><span>Barcode</span><span>Màu</span><span>Kho sẵn</span><span>Kho order</span><span>Giá riêng</span><span>Ghi chú</span>
        </div>
        <div id="variant-rows">${variantRows}</div>
      </div>
      <div class="actions" style="margin-top:12px">
        <button class="primary" type="submit">Lưu sản phẩm</button>
        <button id="clear-product-form" class="ghost" type="button">Nhập mới</button>
      </div>
    </form>
  `;
}

function renderProducts() {
  const rows = products().map((product) => `
    <article class="product-row">
      ${productThumb(product)}
      <div>
        <b>${escapeHTML(product.name)}</b>
        <div class="sku">${escapeHTML(product.sku)} · ${escapeHTML(product.brand || "Chưa có brand")} · ${escapeHTML(product.category || "Chưa phân loại")}</div>
        <div class="sku">${escapeHTML(sizeSummary(product) || "Chưa tách tồn theo size")}</div>
      </div>
      <div class="row">
        <span class="chip ready">Sẵn ${Number(product.readyStock || 0)}</span>
        <span class="chip order">Order ${Number(product.orderStock || 0)}</span>
        <span class="chip">${productVariants(product).length} size</span>
      </div>
      <button class="small" data-open-product="${product.id}" type="button">Mở sản phẩm</button>
    </article>
  `).join("");
  if (app.selectedProductId || app.editingProductId) {
    app.editingProductId = app.selectedProductId || app.editingProductId;
    $("#view").innerHTML = renderProductForm();
    const product = productById(app.editingProductId) || {};
    if (product.gender) $("#product-form [name=gender]").value = product.gender;
    if (product.status) $("#product-form [name=status]").value = product.status;
    if (product.syncStatus) $("#product-form [name=syncStatus]").value = product.syncStatus;
    return;
  }
  $("#view").innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>Danh sách sản phẩm</h3>
          <p class="muted">Bấm mở sản phẩm để vào giao diện riêng, xem ảnh, size, tồn kho và sửa thông tin.</p>
        </div>
        <button id="new-product" class="primary" type="button">Tạo sản phẩm mới</button>
      </div>
      <div class="product-list">${rows || '<div class="card muted">Chưa có sản phẩm.</div>'}</div>
    </section>
  `;
}

function renderCustomers() {
  const customer = customerById(app.editingCustomerId) || {};
  const rows = customers().map((item) => `
    <div class="table-row">
      <div><b>${escapeHTML(item.name)}</b><div class="sku">${escapeHTML(item.phone || "Chưa có SĐT")}</div></div>
      <div>${escapeHTML(item.address || "")}</div>
      <div>${escapeHTML(item.note || "")}</div>
      <div></div>
      <button class="small" data-edit-customer="${item.id}" type="button">Sửa</button>
    </div>
  `).join("");
  $("#view").innerHTML = `
    <form id="customer-form" class="panel">
      <div class="panel-head"><h3>${customer.id ? "Sửa khách hàng" : "Thêm khách hàng"}</h3></div>
      <input name="id" type="hidden" value="${escapeHTML(customer.id || "")}">
      <div class="field-grid">
        <div class="field"><label>Tên khách</label><input name="name" required value="${escapeHTML(customer.name || "")}"></div>
        <div class="field"><label>Số điện thoại</label><input name="phone" value="${escapeHTML(customer.phone || "")}"></div>
        <div class="field span-2"><label>Địa chỉ</label><input name="address" value="${escapeHTML(customer.address || "")}"></div>
        <div class="field span-4"><label>Ghi chú</label><textarea name="note">${escapeHTML(customer.note || "")}</textarea></div>
      </div>
      <div class="actions" style="margin-top:12px"><button class="primary" type="submit">Lưu khách</button><button id="clear-customer-form" class="ghost" type="button">Nhập mới</button></div>
    </form>
    <section class="panel"><div class="panel-head"><h3>Danh sách khách hàng</h3></div><div class="table">${rows}</div></section>
  `;
}

function productOptions() {
  return products().map((product) => `<option value="${product.id}">${escapeHTML(product.sku)} - ${escapeHTML(product.name)}</option>`).join("");
}

function variantSearchRows() {
  const query = app.importSearch.trim().toLowerCase();
  if (!query) return [];
  return products().filter((product) => {
    const text = [product.sku, product.name, product.brand, product.category].join(" ").toLowerCase();
    return text.includes(query);
  }).flatMap((product) => {
    const variants = productVariants(product);
    return (variants.length ? variants : [{ size: "Tổng", readyStock: product.readyStock || 0, orderStock: product.orderStock || 0, price: product.price || 0 }])
      .map((variant) => ({ product, variant }));
  }).slice(0, 30);
}

function importLineKey(line) {
  return `${line.productId}|${line.size}|${line.warehouse}`;
}

function addImportOrderLine(productId, size, warehouse = "ready") {
  const product = productById(productId);
  if (!product) return;
  const variant = productVariants(product).find((item) => String(item.size) === String(size)) || {};
  const line = {
    productId,
    sku: product.sku,
    productName: product.name,
    size,
    warehouse,
    quantity: 1,
    cost: Number(product.cost || 0),
    note: ""
  };
  if (variant.price && !line.cost) line.cost = Number(variant.price || 0);
  if (!app.importOrderLines.some((item) => importLineKey(item) === importLineKey(line))) {
    app.importOrderLines.push(line);
  }
}

function renderStock() {
  const searchRows = variantSearchRows().map(({ product, variant }) => {
    const key = `${product.id}|${variant.size}`;
    return `
      <label class="variant-import-row selectable">
        <input type="checkbox" data-import-pick="${product.id}" data-import-size="${escapeHTML(variant.size || "")}">
        <div>
          <b>${escapeHTML(product.sku)} · ${escapeHTML(product.name)}</b>
          <div class="sku">Size ${escapeHTML(variant.size || "")} · Sẵn ${Number(variant.readyStock || 0)} · Order ${Number(variant.orderStock || 0)}</div>
        </div>
        <select data-pick-warehouse="${escapeHTML(key)}">
          <option value="ready">Nhập kho sẵn</option>
          <option value="order">Nhập kho order</option>
        </select>
        <input data-pick-qty="${escapeHTML(key)}" type="number" min="1" value="1" placeholder="SL">
      </label>
    `;
  }).join("");

  const selectedRows = app.importOrderLines.map((line, index) => `
    <div class="variant-import-row import-order-line">
      <div>
        <b>${escapeHTML(line.sku)} · ${escapeHTML(line.productName)}</b>
        <div class="sku">Size ${escapeHTML(line.size)} · ${line.warehouse === "ready" ? "Kho sẵn" : "Kho order"}</div>
      </div>
      <input data-import-line-qty="${index}" type="number" min="1" value="${Number(line.quantity || 1)}">
      <input data-import-line-cost="${index}" type="number" min="0" value="${Number(line.cost || 0)}" placeholder="Giá nhập">
      <button class="small" data-remove-import-line="${index}" type="button">Bỏ</button>
    </div>
  `).join("");
  const recentImportOrders = importOrders().slice(0, 6).map((order) => `
    <div class="card">
      <div class="card-title">
        <div><h4>${escapeHTML(order.code)}</h4><div class="sku">${escapeHTML(order.supplier || "Chưa có NCC")} · ${Number(order.totalQuantity || 0)} sản phẩm</div></div>
        <span class="chip">${formatMoney(order.totalCost || 0)}</span>
      </div>
    </div>
  `).join("");
  $("#view").innerHTML = `
    <div class="view">
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>Tạo đơn nhập</h3>
          <p class="muted">Gõ SKU/tên sản phẩm, tick nhiều biến thể, nhập số lượng rồi tạo phiếu nhập.</p>
        </div>
      </div>
      <div class="field-grid">
        <div class="field"><label>Mã phiếu</label><input id="import-code" placeholder="Tự sinh nếu bỏ trống"></div>
        <div class="field"><label>Nhà cung cấp</label><input id="import-supplier" placeholder="Tên nhà cung cấp"></div>
        <div class="field span-2"><label>Ghi chú</label><input id="import-note" placeholder="Đợt hàng, vận đơn, ghi chú nội bộ"></div>
        <div class="field span-4"><label>Tìm SKU/biến thể</label><input id="import-search" value="${escapeHTML(app.importSearch)}" placeholder="Gõ SKU, tên, brand..."></div>
      </div>
      <div class="variant-import-list" style="margin-top:12px">${searchRows || '<div class="copy-box">Gõ vài ký tự SKU/tên để hiện danh sách biến thể.</div>'}</div>
      <div class="actions" style="margin-top:12px">
        <button id="add-picked-variants" class="ghost" type="button">Thêm dòng đã tick</button>
      </div>
      <div class="panel-head" style="margin-top:16px">
        <h3>Dòng trong đơn nhập</h3>
        <button id="create-import-order" class="primary" type="button">Tạo đơn nhập</button>
      </div>
      <div class="variant-import-list">${selectedRows || '<div class="copy-box">Chưa chọn biến thể nào.</div>'}</div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>Nhập đơn bằng file</h3>
          <p class="muted">File CSV/TXT: SKU, size, kho, số lượng, giá nhập, ghi chú.</p>
        </div>
      </div>
      <div class="field-grid">
        <div class="field span-2"><label>Chọn file</label><input id="stock-file-input" type="file" accept=".csv,.txt"></div>
        <div class="field span-4"><label>Hoặc dán danh sách</label><textarea id="stock-import-text" placeholder="SKU-DEMO-01,40,order,10,170000,đợt hàng mới"></textarea></div>
      </div>
      <div class="actions" style="margin-top:12px">
        <button id="preview-stock-import" class="ghost" type="button">Đưa vào đơn nhập</button>
      </div>
      <div id="stock-import-preview" class="copy-box" style="margin-top:12px">File sẽ được đưa vào danh sách dòng của đơn nhập để kiểm tra trước khi tạo phiếu.</div>
    </section>
    <div class="split">
      <form id="stock-form" class="panel">
        <div class="panel-head"><h3>Điều chỉnh nhanh</h3></div>
        <div class="field-grid">
          <div class="field span-2"><label>Sản phẩm</label><select name="productId">${productOptions()}</select></div>
          <div class="field"><label>Size</label><input name="size" required placeholder="Ví dụ 42"></div>
          <div class="field"><label>Kho</label><select name="warehouse"><option value="ready">Kho sẵn</option><option value="order">Kho order</option></select></div>
          <div class="field"><label>Số lượng</label><input name="quantity" type="number" required value="1"></div>
          <div class="field span-4"><label>Ghi chú</label><input name="note" placeholder="Ví dụ: nhập order đợt 25/05"></div>
        </div>
        <button class="primary" style="margin-top:12px" type="submit">Ghi nhận</button>
      </form>
      <form id="transfer-form" class="panel">
        <div class="panel-head"><h3>Chuyển order sang kho sẵn</h3></div>
        <div class="field-grid">
          <div class="field span-2"><label>Sản phẩm</label><select name="productId">${productOptions()}</select></div>
          <div class="field"><label>Size</label><input name="size" required placeholder="Ví dụ 42"></div>
          <div class="field"><label>Số lượng</label><input name="quantity" type="number" min="1" required value="1"></div>
          <div class="field span-4"><label>Ghi chú</label><input name="note" placeholder="Hàng order về, chuyển phần còn lại vào kho sẵn"></div>
        </div>
        <button class="primary" style="margin-top:12px" type="submit">Chuyển kho</button>
      </form>
    </div>
    <section class="panel"><div class="panel-head"><h3>Đơn nhập gần đây</h3></div><div class="list">${recentImportOrders || '<div class="card muted">Chưa có đơn nhập.</div>'}</div></section>
    </div>
  `;
}

function renderUsers() {
  const user = users().find((item) => item.id === app.editingUserId) || {};
  const rows = users().map((item) => `
    <div class="table-row">
      <div><b>${escapeHTML(item.name)}</b><div class="sku">${escapeHTML(item.phone || "")}</div></div>
      <div>${escapeHTML(item.role || "")}</div>
      <div>${item.active ? "Đang hoạt động" : "Tạm khóa"}</div>
      <div>${escapeHTML((item.permissions || []).join(", "))}</div>
      <button class="small" data-edit-user="${item.id}" type="button">Sửa</button>
    </div>
  `).join("");
  $("#view").innerHTML = `
    <form id="user-form" class="panel">
      <div class="panel-head"><h3>${user.id ? "Sửa người dùng" : "Thêm người dùng"}</h3></div>
      <input name="id" type="hidden" value="${escapeHTML(user.id || "")}">
      <div class="field-grid">
        <div class="field"><label>Tên</label><input name="name" required value="${escapeHTML(user.name || "")}"></div>
        <div class="field"><label>Số điện thoại</label><input name="phone" value="${escapeHTML(user.phone || "")}"></div>
        <div class="field"><label>Vai trò</label><select name="role"><option value="admin">Admin</option><option value="manager">Quản lý</option><option value="sales">Bán hàng</option><option value="warehouse">Kho</option></select></div>
        <div class="field"><label>Trạng thái</label><select name="active"><option value="true">Hoạt động</option><option value="false">Tạm khóa</option></select></div>
        <div class="field span-4"><label>Quyền</label><input name="permissions" value="${escapeHTML((user.permissions || []).join(", "))}" placeholder="products, customers, orders, stock, users, reports"></div>
      </div>
      <button class="primary" style="margin-top:12px" type="submit">Lưu người dùng</button>
    </form>
    <section class="panel"><div class="panel-head"><h3>Danh sách phân quyền</h3></div><div class="table">${rows}</div></section>
  `;
  if (user.role) $("#user-form [name=role]").value = user.role;
  if (user.id) $("#user-form [name=active]").value = String(user.active !== false);
}

function render() {
  if (!app.state) return;
  document.body.classList.toggle("mobile-preview-mode", app.previewMode === "mobile");
  $("#page-title").textContent = titles[app.view] || titles.lookup;
  $("#desktop-preview-btn")?.classList.toggle("active", app.previewMode === "desktop");
  $("#mobile-preview-btn")?.classList.toggle("active", app.previewMode === "mobile");
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.view === app.view));
  if (app.view === "lookup") $("#stats").innerHTML = "";
  else renderStats();
  if (app.view === "lookup") renderLookup();
  if (app.view === "orderWarehouse") renderOrderWarehouse();
  if (app.view === "orders") renderOrders();
  if (app.view === "products") renderProducts();
  if (app.view === "customers") renderCustomers();
  if (app.view === "stock") renderStock();
  if (app.view === "users") renderUsers();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function productFormData(form) {
  const data = formData(form);
  [
    "webTags",
    "hardTags",
    "surfaceTags",
    "benefitTags",
    "riskTags",
    "customerSegments",
    "playStyleTags",
    "contentAngles",
    "viralHooks"
  ].forEach((key) => {
    data[key] = String(data[key] || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  });
  data.variants = Array.from(form.querySelectorAll(".variant-row")).map((row) => ({
    size: row.querySelector("[name=variantSize]")?.value || "",
    barcode: row.querySelector("[name=variantBarcode]")?.value || "",
    color: row.querySelector("[name=variantColor]")?.value || "",
    readyStock: Number(row.querySelector("[name=variantReady]")?.value || 0),
    orderStock: Number(row.querySelector("[name=variantOrder]")?.value || 0),
    price: Number(row.querySelector("[name=variantPrice]")?.value || 0),
    note: row.querySelector("[name=variantNote]")?.value || ""
  })).filter((item) => item.size || item.readyStock || item.orderStock || item.barcode);
  return data;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadProductImage(file, primary = false) {
  const product = productById(app.editingProductId);
  if (!product?.id || app.editingProductId === "new") {
    toast("Hãy lưu sản phẩm trước rồi upload ảnh.");
    return;
  }
  const dataBase64 = await fileToBase64(file);
  const payload = await api("/api/warehouse/product-images", {
    method: "POST",
    body: JSON.stringify({
      productId: product.id,
      fileName: file.name || "clipboard-image.png",
      contentType: file.type || "image/png",
      dataBase64,
      primary
    })
  });
  app.state = payload.state;
  toast("Đã lưu ảnh vào server.");
  render();
}

function parseStockImportText(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => {
    const cells = line.split(/,|\t|;/).map((cell) => cell.trim());
    return {
      sku: cells[0] || "",
      size: cells[1] || "",
      warehouse: cells[2] || "ready",
      quantity: Number(cells[3] || 0),
      cost: Number(cells[4] || 0),
      note: cells[5] || ""
    };
  }).filter((item) => item.sku && item.size && item.quantity);
}

async function fetchImageObjectUrl(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Không tải được ảnh HTTP ${response.status}.`);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    fetchImageObjectUrl(url).then((objectUrl) => {
      const image = new Image();
      image.onload = () => {
        image.dataset.objectUrl = objectUrl;
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Không tải được ảnh để copy."));
      };
      image.src = objectUrl;
    }).catch(reject);
  });
}

function trimCanvasText(ctx, text, maxWidth) {
  const value = String(text || "");
  if (ctx.measureText(value).width <= maxWidth) return value;
  let output = value;
  while (output.length > 4 && ctx.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}...`;
}

async function makePricedProductImageBlob(imageUrl, product) {
  const image = await loadImage(imageUrl);
  const variant = bestProductVariant(product);
  const warehouse = app.cartWarehouse;
  const available = warehouse === "ready" ? variant.readyStock : variant.orderStock;
  const maxWidth = 900;
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const width = Math.max(360, Math.round(image.naturalWidth * scale));
  const imageHeight = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = imageHeight;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, width, imageHeight);
  if (image.dataset?.objectUrl) URL.revokeObjectURL(image.dataset.objectUrl);
  const padding = Math.max(16, Math.round(width * 0.025));
  ctx.translate(0, padding - imageHeight);
  ctx.fillStyle = "#111827";
  ctx.shadowColor = "rgba(255, 255, 255, 0.95)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.font = "700 26px Arial";
  ctx.fillText(trimCanvasText(ctx, product.name || product.sku || "Sản phẩm", width - 32), 16, imageHeight + 36);
  ctx.font = "600 21px Arial";
  const details = [
    product.sku ? `Mã ${product.sku}` : "",
    variant.size ? `Size ${variant.size}` : "",
    Number.isFinite(Number(available)) ? `Còn ${available || 0}` : "",
    warehouse === "ready" ? "Kho sẵn" : "Kho order"
  ].filter(Boolean).join(" · ");
  ctx.fillText(trimCanvasText(ctx, details, width - 32), 16, imageHeight + 70);
  ctx.fillStyle = "#bbf7d0";
  ctx.font = "800 28px Arial";
  ctx.fillText(product.price ? formatMoney(product.price) : "Giá cần kiểm tra", 16, imageHeight + 108);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Không tạo được ảnh copy.")), "image/png", 0.92);
  });
}

function syncImportOrderInputs() {
  app.importOrderLines = app.importOrderLines.map((line, index) => ({
    ...line,
    quantity: Math.max(1, Number(document.querySelector(`[data-import-line-qty="${index}"]`)?.value || line.quantity || 1)),
    cost: Math.max(0, Number(document.querySelector(`[data-import-line-cost="${index}"]`)?.value || line.cost || 0))
  }));
}

async function createImportOrderFromSelection() {
  syncImportOrderInputs();
  if (!app.importOrderLines.length) {
    toast("Chưa có biến thể trong đơn nhập.");
    return;
  }
  const payload = await api("/api/warehouse/import-orders", {
    method: "POST",
    body: JSON.stringify({
      code: $("#import-code")?.value || "",
      supplier: $("#import-supplier")?.value || "",
      note: $("#import-note")?.value || "",
      lines: app.importOrderLines
    })
  });
  app.state = payload.state;
  app.importOrderLines = [];
  app.stockImportRows = [];
  toast("Đã tạo đơn nhập và cộng tồn kho.");
  render();
}

async function postAndReload(path, body, message) {
  const payload = await api(path, {
    method: "POST",
    body: JSON.stringify(body)
  });
  app.state = payload.state || payload.data;
  toast(message);
  render();
}

async function syncOrderWarehouseLookup() {
  const payload = await api("/api/realtime-stock/sync-order-warehouse", {
    method: "POST",
    body: JSON.stringify({ includeEmpty: false })
  });
  const result = payload.result || {};
  toast(result.message || "Đã đồng bộ kho order cho Inventory Lookup.");
}

async function downloadOrderSideviews() {
  toast("Đang tải ảnh side view từ TopRun Image Tool...");
  const payload = await api("/api/warehouse/order-sideview-images", {
    method: "POST",
    body: JSON.stringify({ force: false })
  });
  app.state = payload.state || app.state;
  const result = payload.data || {};
  toast(result.message || "Đã tải ảnh side view kho order.");
  render();
}

async function createOrderFromCart() {
  if (!app.cart.length) {
    toast("Chưa có sản phẩm để tạo đơn.");
    return;
  }
  const customerName = prompt("Tên khách hàng hoặc mã khách:", "Khách lẻ");
  if (customerName === null) return;
  await postAndReload("/api/warehouse/orders", {
    warehouse: app.cartWarehouse,
    customerName,
    lines: app.cart
  }, "Đã tạo đơn và trừ kho.");
  app.cart = [];
  render();
}

async function handleReturn(orderId, productId) {
  const quantity = Number(prompt("Số lượng hoàn về kho sẵn:", "1"));
  if (!quantity) return;
  await postAndReload("/api/warehouse/returns", { orderId, productId, quantity }, "Đã hoàn hàng về kho sẵn.");
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  try {
    if (target.dataset.view) {
      app.view = target.dataset.view;
      app.mobileToolsOpen = false;
      render();
    } else if (target.id === "mobile-tools-toggle") {
      app.mobileToolsOpen = !app.mobileToolsOpen;
      render();
    } else if (target.id === "desktop-preview-btn") {
      app.previewMode = "desktop";
      render();
    } else if (target.id === "mobile-preview-btn") {
      app.previewMode = "mobile";
      render();
    } else if (target.id === "refresh-btn") {
      await loadState();
      toast("Đã làm mới dữ liệu.");
    } else if (target.id === "seed-btn") {
      if (confirm("Reset dữ liệu mẫu của module kho đối tác?")) {
        const payload = await api("/api/warehouse/reset-demo", { method: "POST", body: "{}" });
        app.state = payload.data;
        app.cart = [];
        render();
      }
    } else if (target.dataset.copy) {
      await copyProduct(target.dataset.copy);
    } else if (target.dataset.orderCopy) {
      const previousWarehouse = app.cartWarehouse;
      app.cartWarehouse = "order";
      await copyProduct(target.dataset.orderCopy);
      app.cartWarehouse = previousWarehouse === "ready" ? "order" : previousWarehouse;
    } else if (target.dataset.saveImage) {
      await saveProductImage(target.dataset.saveImage);
    } else if (target.dataset.push) {
      await pushProductImage(target.dataset.push);
    } else if (target.dataset.orderPush) {
      app.cartWarehouse = "order";
      await pushProductImage(target.dataset.orderPush);
    } else if (target.id === "download-order-sideviews") {
      await downloadOrderSideviews();
    } else if (target.id === "sync-order-warehouse-lookup") {
      await syncOrderWarehouseLookup();
    } else if (target.dataset.openProduct) {
      app.view = "products";
      app.selectedProductId = target.dataset.openProduct;
      app.editingProductId = target.dataset.openProduct;
      render();
    } else if (target.id === "new-product") {
      app.selectedProductId = "";
      app.editingProductId = "new";
      render();
    } else if (target.id === "back-products") {
      app.selectedProductId = "";
      app.editingProductId = "";
      render();
    } else if (target.id === "add-variant-row") {
      $("#variant-rows").insertAdjacentHTML("beforeend", `
        <div class="variant-row">
          <input name="variantSize" placeholder="Size">
          <input name="variantBarcode" placeholder="Barcode">
          <input name="variantColor" placeholder="Màu">
          <input name="variantReady" type="number" min="0" placeholder="Kho sẵn" value="0">
          <input name="variantOrder" type="number" min="0" placeholder="Kho order" value="0">
          <input name="variantPrice" type="number" min="0" placeholder="Giá riêng" value="0">
          <input name="variantNote" placeholder="Ghi chú size">
        </div>
      `);
    } else if (target.id === "choose-product-image") {
      $("#product-image-input")?.click();
    } else if (target.dataset.importVariant) {
      const productId = target.dataset.importVariant;
      const size = target.dataset.importSize;
      const key = `${productId}|${size}`;
      const quantity = Number(document.querySelector(`[data-import-qty="${CSS.escape(key)}"]`)?.value || 0);
      const warehouse = document.querySelector(`[data-import-warehouse="${CSS.escape(key)}"]`)?.value || "ready";
      await postAndReload("/api/warehouse/variant-stock", { productId, size, warehouse, quantity }, "Đã nhập kho theo size.");
    } else if (target.id === "add-picked-variants") {
      document.querySelectorAll("[data-import-pick]:checked").forEach((checkbox) => {
        const productId = checkbox.dataset.importPick;
        const size = checkbox.dataset.importSize;
        const key = `${productId}|${size}`;
        const warehouse = document.querySelector(`[data-pick-warehouse="${CSS.escape(key)}"]`)?.value || "ready";
        const quantity = Number(document.querySelector(`[data-pick-qty="${CSS.escape(key)}"]`)?.value || 1);
        addImportOrderLine(productId, size, warehouse);
        const line = app.importOrderLines[app.importOrderLines.length - 1];
        if (line && line.productId === productId && line.size === size && line.warehouse === warehouse) line.quantity = Math.max(1, quantity);
      });
      render();
    } else if (target.dataset.removeImportLine !== undefined) {
      syncImportOrderInputs();
      app.importOrderLines.splice(Number(target.dataset.removeImportLine), 1);
      render();
    } else if (target.id === "create-import-order") {
      await createImportOrderFromSelection();
    } else if (target.id === "preview-stock-import") {
      app.stockImportRows = parseStockImportText($("#stock-import-text")?.value || "");
      for (const row of app.stockImportRows) {
        const product = products().find((item) => String(item.sku || "").toLowerCase() === row.sku.toLowerCase());
        if (!product) continue;
        const line = {
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          size: row.size,
          warehouse: row.warehouse,
          quantity: row.quantity,
          cost: row.cost || Number(product.cost || 0),
          note: row.note
        };
        const existing = app.importOrderLines.find((item) => importLineKey(item) === importLineKey(line));
        if (existing) existing.quantity += line.quantity;
        else app.importOrderLines.push(line);
      }
      toast(`Đã đưa ${app.stockImportRows.length} dòng file vào đơn nhập.`);
      render();
    } else if (target.id === "submit-stock-import") {
      const rows = app.stockImportRows.length ? app.stockImportRows : parseStockImportText($("#stock-import-text")?.value || "");
      if (!rows.length) {
        toast("Chưa có dữ liệu nhập kho hợp lệ.");
        return;
      }
      await postAndReload("/api/warehouse/variant-stock/bulk", { items: rows }, "Đã nhập kho hàng loạt.");
      app.stockImportRows = [];
    } else if (target.dataset.removeCart) {
      removeCartLine(target.dataset.removeCart);
    } else if (target.id === "create-order-from-cart") {
      await createOrderFromCart();
    } else if (target.dataset.editProduct) {
      app.editingProductId = target.dataset.editProduct;
      app.selectedProductId = target.dataset.editProduct;
      render();
    } else if (target.id === "clear-product-form") {
      app.editingProductId = "new";
      app.selectedProductId = "";
      render();
    } else if (target.dataset.editCustomer) {
      app.editingCustomerId = target.dataset.editCustomer;
      render();
    } else if (target.id === "clear-customer-form") {
      app.editingCustomerId = "";
      render();
    } else if (target.dataset.editUser) {
      app.editingUserId = target.dataset.editUser;
      render();
    } else if (target.dataset.returnOrder) {
      await handleReturn(target.dataset.returnOrder, target.dataset.returnProduct);
    }
  } catch (error) {
    toast(error.message);
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "search-input") {
    const cursor = event.target.selectionStart;
    app.query = event.target.value;
    render();
    const input = $("#search-input");
    input.focus();
    input.setSelectionRange(cursor, cursor);
  } else if (event.target.id === "import-search") {
    const cursor = event.target.selectionStart;
    app.importSearch = event.target.value;
    render();
    const input = $("#import-search");
    input.focus();
    input.setSelectionRange(cursor, cursor);
  } else if (event.target.id === "size-filter") {
    const cursor = event.target.selectionStart;
    app.sizeFilter = event.target.value;
    render();
    const input = $("#size-filter");
    input.focus();
    input.setSelectionRange(cursor, cursor);
  } else if (event.target.id === "max-price-filter") {
    const cursor = event.target.selectionStart;
    app.maxPriceFilter = event.target.value;
    render();
    const input = $("#max-price-filter");
    input.focus();
    input.setSelectionRange(cursor, cursor);
  } else if (event.target.dataset.cartQty) {
    updateCartQuantity(event.target.dataset.cartQty, event.target.value);
  } else if (event.target.dataset.importLineQty !== undefined || event.target.dataset.importLineCost !== undefined) {
    syncImportOrderInputs();
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "warehouse-filter") {
    app.warehouseFilter = event.target.value;
    render();
  } else if (event.target.id === "product-group-filter") {
    app.productGroupFilter = event.target.value;
    render();
  } else if (event.target.id === "sport-group-filter") {
    app.sportGroupFilter = event.target.value;
    render();
  } else if (event.target.id === "only-available-filter") {
    app.onlyAvailableFilter = event.target.checked;
    render();
  } else if (event.target.dataset.sourceFilter) {
    const value = event.target.dataset.sourceFilter;
    const set = new Set(app.sourceFilters);
    if (event.target.checked) set.add(value);
    else set.delete(value);
    app.sourceFilters = Array.from(set);
    render();
  } else if (event.target.id === "cart-warehouse") {
    app.cartWarehouse = event.target.value;
    app.cart = [];
    render();
  } else if (event.target.id === "product-image-input") {
    Array.from(event.target.files || []).forEach((file, index) => uploadProductImage(file, index === 0));
  } else if (event.target.id === "stock-file-input") {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      $("#stock-import-text").value = text;
      app.stockImportRows = parseStockImportText(text);
      $("#stock-import-preview").textContent = app.stockImportRows.length
        ? app.stockImportRows.map((item) => `${item.sku} | ${item.size} | ${item.warehouse} | ${item.quantity} | ${item.cost || 0} | ${item.note}`).join("\n")
        : "Không đọc được dòng nhập kho hợp lệ.";
    }).catch((error) => toast(error.message));
  }
});

document.addEventListener("paste", (event) => {
  const zone = event.target.closest?.("#image-drop-zone");
  if (!zone) return;
  const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  event.preventDefault();
  files.forEach((file, index) => uploadProductImage(file, index === 0));
});

document.addEventListener("dragover", (event) => {
  if (event.target.closest?.("#image-drop-zone")) {
    event.preventDefault();
    event.target.closest("#image-drop-zone").classList.add("dragging");
  }
});

document.addEventListener("dragleave", (event) => {
  event.target.closest?.("#image-drop-zone")?.classList.remove("dragging");
});

document.addEventListener("drop", (event) => {
  const zone = event.target.closest?.("#image-drop-zone");
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove("dragging");
  Array.from(event.dataTransfer?.files || [])
    .filter((file) => file.type.startsWith("image/"))
    .forEach((file, index) => uploadProductImage(file, index === 0));
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  // `form.id` is NOT the form's id when the form holds an <input name="id"> (the product, customer
  // and user forms do): it returns that input, and none of the three save buttons ever matched.
  // Bug of the Sales Desk page, found clicking the copy on 16/09/2026.
  const formId = form.getAttribute("id");
  try {
    if (formId === "product-form") {
      await postAndReload("/api/warehouse/products", productFormData(form), "Đã lưu sản phẩm.");
      app.editingProductId = "";
      app.selectedProductId = "";
      render();
    } else if (formId === "customer-form") {
      await postAndReload("/api/warehouse/customers", formData(form), "Đã lưu khách hàng.");
      app.editingCustomerId = "";
      render();
    } else if (formId === "stock-form") {
      await postAndReload("/api/warehouse/stock", formData(form), "Đã cập nhật tồn kho.");
    } else if (formId === "transfer-form") {
      await postAndReload("/api/warehouse/transfers/order-to-ready", formData(form), "Đã chuyển sang kho sẵn.");
    } else if (formId === "user-form") {
      const data = formData(form);
      data.active = data.active === "true";
      data.permissions = String(data.permissions || "").split(",").map((item) => item.trim()).filter(Boolean);
      await postAndReload("/api/warehouse/users", data, "Đã lưu người dùng.");
      app.editingUserId = "";
      render();
    }
  } catch (error) {
    toast(error.message);
  }
});

loadState().catch((error) => toast(error.message));
