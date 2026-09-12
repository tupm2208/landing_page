let product = null;
let adminUnitsPromise = null;
let productCart = [];
let landingContent = {};

const page = document.getElementById("product-page");

init();

// Nạp lại giỏ khi quay lại trang từ bfcache hoặc khi tab/trang khác thay đổi giỏ chung.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  productCart = loadStoredCart();
  if (document.getElementById("product-floating-cart")) renderFloatingProductCart();
});

window.addEventListener("storage", (event) => {
  if (event.key !== CART_STORAGE_KEY) return;
  productCart = loadStoredCart();
  if (document.getElementById("product-floating-cart")) renderFloatingProductCart();
});

async function init() {
  try {
    const key = productLookupKey();
    landingContent = await loadLandingContent();
    productCart = loadStoredCart();
    const response = await fetch(`/api/products/${encodeURIComponent(key)}`);
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Không tìm thấy sản phẩm.");
    product = payload.data;
    document.title = `${product.seoTitle || productDisplayName(product) || product.code} - toprunvn`;
    // Dua URL ve dang /product/<slug> de khach copy tu thanh dia chi luon co link chuan
    // (route nay duoc server chen Open Graph nen share Facebook/Zalo se hien anh san pham).
    const canonicalPath = `/product/${encodeURIComponent(String(product.slug || product.code || key))}`;
    if (window.location.pathname !== canonicalPath) {
      // Chi bo cac tham so tra cuu san pham; giu nguyen phan query con lai (vd ?ref cua CTV
      // vua duoc ctvAffiliateModeInit gan) - truoc day thay ca URL nen xoa mat ref.
      const params = new URLSearchParams(window.location.search);
      ["p", "code", "slug"].forEach((name) => params.delete(name));
      const query = params.toString();
      window.history.replaceState(null, "", `${canonicalPath}${query ? `?${query}` : ""}${window.location.hash || ""}`);
    }
    trackProductEvent("product_view", {
      productCode: product.code,
      productName: productDisplayName(product)
    }, { onceKey: product.code });
    renderProduct();
    window.CtvImage?.init(product, ctvProductImages(product));
  } catch (error) {
    page.innerHTML = `
      <section class="product-page-empty">
        <h1>Không tìm thấy sản phẩm</h1>
        <p>${escapeHTML(error.message || "Sản phẩm không còn tồn tại hoặc đã bị ẩn.")}</p>
        <a class="primary-button" href="/#products">Quay lại catalog</a>
      </section>
    `;
  }
}

function productLookupKey() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("p") || params.get("code") || params.get("slug");
  if (fromQuery) return String(fromQuery).trim();
  const pathKey = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).pop() || "");
  return pathKey === "product.html" ? "" : pathKey;
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

function productDisplayName(item = {}) {
  return String(item.name || item.productName || item.code || item.productCode || "").trim();
}

function trackProductEvent(eventName, payload = {}, options = {}) {
  window.toprunAnalytics?.track?.(eventName, payload, options);
}

function renderProduct() {
  if (productHasInvalidPrice(product) || product.status === "hidden") {
    page.innerHTML = `
      <section class="product-page-empty">
        <h1>Sản phẩm đang tạm ẩn</h1>
        <p>Sản phẩm này cần TopRun kiểm tra lại thông tin trước khi hiển thị.</p>
        <a class="primary-button" href="/#products">Quay lại catalog</a>
      </section>
    `;
    return;
  }
  initProductStockMode(product);
  const images = productGalleryImages(product);
  const sizes = availableProductSizes(product);
  const disabled = product.status !== "orderable" || !sizes.length;
  const description = product.description || product.shortDescription || generatedDescription(product);
  const hasBothModes = productHasBothStockModes(product);
  const showingReady = productHasStockMode(product, "ready") && (productStockMode === "ready" || !productHasStockMode(product, "order"));
  const stockModeTabs = hasBothModes ? `
    <div class="product-stock-mode-tabs" role="tablist" aria-label="Chọn loại hàng">
      <button type="button" class="stock-mode-tab ${productStockMode === "ready" ? "active" : ""}" data-stock-mode="ready" role="tab" aria-selected="${productStockMode === "ready"}">
        <b>🟢 Hàng sẵn</b><small>Giao ngay · ${escapeHTML((product.readyPolicySummary || "").slice(0, 60)) || "Có hàng tại TopRun"}</small>
      </button>
      <button type="button" class="stock-mode-tab ${productStockMode === "order" ? "active" : ""}" data-stock-mode="order" role="tab" aria-selected="${productStockMode === "order"}">
        <b>🔵 Hàng order</b><small>${escapeHTML(contentText("cartNote", "Thanh toán trước 20%, hàng về 3-7 ngày").slice(0, 60))}</small>
      </button>
    </div>` : "";
  const readyPolicyNote = showingReady && product.readyPolicySummary
    ? `<p class="detail-policy ready-policy">🟢 ${escapeHTML(product.readyPolicySummary)}</p>`
    : "";
  page.innerHTML = `
    <section class="product-detail-page">
      <div class="product-gallery" aria-label="Gallery sản phẩm">
        <div class="product-gallery-main" id="product-gallery-main">
          ${images[0] ? `<img id="gallery-main-image" src="${escapeHTML(images[0])}" alt="${escapeHTML(product.name)}">` : `<div class="product-gallery-placeholder">${escapeHTML(product.code)}</div>`}
        </div>
        <div class="product-gallery-thumbs">
          ${images.map((image, index) => `
            <button type="button" class="${index === 0 ? "active" : ""}" data-gallery-index="${index}" data-gallery-image="${escapeHTML(image)}" aria-label="Ảnh ${index + 1}">
              <img src="${escapeHTML(image)}" alt="">
            </button>
          `).join("")}
        </div>
      </div>

      <div class="product-detail-info">
        <a class="back-link" href="/#products">← Quay lại catalog</a>
        <p class="eyebrow">${escapeHTML(product.sourceName || "TopRun")}</p>
        <h1>${escapeHTML(productDisplayName(product))}</h1>
        <p class="product-detail-code">${escapeHTML(product.code)} · ${escapeHTML(product.category || "Lifestyle")} · ${escapeHTML(product.division || "Order")}</p>
        ${productPriceBlock(product)}
        <div class="meta detail-meta">
          <span>Size còn: ${escapeHTML(sizes.join(", ") || "Hết size")}</span>
          ${discountPercent(product) > 0 ? `<span>Sale ${discountPercent(product)}%</span>` : ""}
          <button type="button" class="text-button product-share-link" id="product-share-link">🔗 Chia sẻ sản phẩm</button>
        </div>

        <section class="product-introduction">
          <h2>${escapeHTML(contentText("productIntroTitle", "Giới thiệu sản phẩm"))}</h2>
          <p>${escapeHTML(description)}</p>
          ${product.policy ? `<p class="detail-policy">${escapeHTML(product.policy)}</p>` : ""}
        </section>

        <div class="product-purchase-panel">
          ${stockModeTabs}
          ${readyPolicyNote}
          <a class="size-guide-link" href="/#contact">Hướng dẫn chọn size</a>
          ${sizeChartLinkHTML(product)}
          <div class="product-size-picker">
            <span>Kích thước</span>
            <div class="product-size-buttons" role="radiogroup" aria-label="Chọn kích thước">
              ${sizes.map((size, index) => `
                <button class="product-size-button ${index === 0 ? "active" : ""}" type="button" data-product-size="${escapeHTML(size)}" aria-checked="${index === 0 ? "true" : "false"}" role="radio" ${disabled ? "disabled" : ""}>${escapeHTML(size)}</button>
              `).join("") || `<span class="empty-cart">Hết size có thể đặt.</span>`}
            </div>
            ${productWarehouseMarkerRow(product, sizes[0] || "")}
          </div>
          <div class="product-buy-row">
            <div class="product-qty-stepper" aria-label="Chọn số lượng">
              <button id="product-qty-minus" type="button" ${disabled ? "disabled" : ""}>−</button>
              <input id="product-qty-input" type="number" min="1" max="99" value="1" inputmode="numeric" ${disabled ? "disabled" : ""}>
              <button id="product-qty-plus" type="button" ${disabled ? "disabled" : ""}>+</button>
            </div>
            <button class="secondary-button add-cart-button" id="product-add-cart" type="button" ${disabled ? "disabled" : ""}>
              <span class="button-cart-icon cart-icon-3d" aria-hidden="true">${addCartIconSvg()}</span>
              <span>Thêm vào giỏ hàng</span>
            </button>
          </div>
          <p class="form-message" id="product-action-message"></p>
        </div>

        <form class="quick-order-form legacy-product-order-form" id="quick-order-form">
          <h2>Đặt nhanh sản phẩm này</h2>
          <div class="checkout-notes">
            <p>${escapeHTML(contentText("cartNote", "Hàng order thanh toán trước 20%, đặt hàng thông thường từ 3-7 ngày."))}</p>
            <p>${escapeHTML(shippingNoteText())}</p>
          </div>
          <label>Size
            <select name="size" required ${disabled ? "disabled" : ""}>
              <option value="">Chọn size</option>
              ${sizes.map((size) => `<option value="${escapeHTML(size)}">${escapeHTML(size)}</option>`).join("")}
            </select>
          </label>
          <label>Họ tên
            <input name="customerName" autocomplete="name" required placeholder="Nguyễn Văn A">
          </label>
          <label>Số điện thoại
            <input name="phone" autocomplete="tel" inputmode="tel" required pattern="^(0|\\+84)(3|5|7|8|9)[0-9]{8}$" placeholder="09xxxxxxxx">
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
          <button class="primary-button" type="submit" ${disabled ? "disabled" : ""}>Gửi đơn order</button>
          <p class="form-message" id="quick-order-message"></p>
        </form>
      </div>
    </section>
    <div class="product-lightbox" id="product-lightbox" aria-hidden="true" role="dialog" aria-label="Xem ảnh sản phẩm">
      <button type="button" class="product-lightbox-close" id="product-lightbox-close" aria-label="Đóng">×</button>
      <button type="button" class="product-lightbox-nav prev" id="product-lightbox-prev" aria-label="Ảnh trước">‹</button>
      <figure class="product-lightbox-frame">
        <img id="product-lightbox-image" alt="${escapeHTML(product.name)}">
      </figure>
      <button type="button" class="product-lightbox-nav next" id="product-lightbox-next" aria-label="Ảnh sau">›</button>
      <div class="product-lightbox-counter" id="product-lightbox-counter"></div>
    </div>
  `;

  bindProductGallery(images);
  document.querySelectorAll("[data-stock-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.stockMode === "ready" ? "ready" : "order";
      if (mode === productStockMode) return;
      productStockMode = mode;
      renderProduct();
    });
  });
  document.querySelectorAll("[data-product-size]").forEach((button) => {
    button.addEventListener("click", () => selectProductSize(button));
    button.addEventListener("mouseenter", () => updateProductWarehouseMarkers(button.dataset.productSize || ""));
    button.addEventListener("focus", () => updateProductWarehouseMarkers(button.dataset.productSize || ""));
  });
  document.getElementById("product-qty-minus")?.addEventListener("click", () => changeProductQty(-1));
  document.getElementById("product-qty-plus")?.addEventListener("click", () => changeProductQty(1));
  document.getElementById("product-add-cart").addEventListener("click", addProductToCart);
  document.getElementById("product-size-chart-link")?.addEventListener("click", () => {
    window.SizeChartKit?.openSizeChartModal(product.brand, { gender: window.SizeChartKit.inferShoeGender(product) });
  });
  document.getElementById("product-share-link")?.addEventListener("click", copyProductShareLink);
  ensureFloatingProductCart();
  renderFloatingProductCart();
}

// Nut "Xem bang quy doi size": chi hien khi hang co bang trong size-chart-kit.js.
// Bang chi de tra cuu - khach van chon size goc cua hang tren nut size.
function sizeChartLinkHTML(item = {}) {
  const chart = window.SizeChartKit?.sizeChartForBrand(item.brand);
  if (!chart) return "";
  return `<button type="button" class="size-guide-link" id="product-size-chart-link" style="background:none;border:none;padding:0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer;">Xem bảng quy đổi size ${escapeHTML(chart.label)}</button>`;
}

function productShareUrl() {
  const base = `${window.location.origin}/product/${encodeURIComponent(String(product.slug || product.code || ""))}`;
  const ref = ctvRefCode();
  return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
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

async function copyProductShareLink(event) {
  const button = event?.currentTarget;
  const link = productShareUrl();
  let copied = false;
  try {
    await navigator.clipboard.writeText(link);
    copied = true;
  } catch {
    copied = false;
  }
  if (!copied) {
    window.prompt("Copy link sản phẩm:", link);
    return;
  }
  if (button) {
    const original = button.textContent;
    button.textContent = "Đã copy link ✓";
    setTimeout(() => { button.textContent = original; }, 2000);
  }
}

function bindProductGallery(images) {
  let currentIndex = 0;
  const main = document.getElementById("product-gallery-main");
  const mainImage = document.getElementById("gallery-main-image");
  const lightbox = document.getElementById("product-lightbox");
  const lightboxImage = document.getElementById("product-lightbox-image");
  const lightboxCounter = document.getElementById("product-lightbox-counter");
  const showLightboxImage = () => {
    if (!lightboxImage || !images.length) return;
    lightboxImage.src = images[currentIndex];
    if (lightboxCounter) lightboxCounter.textContent = `${currentIndex + 1} / ${images.length}`;
  };
  const showImage = (index) => {
    if (!images.length) return;
    currentIndex = (index + images.length) % images.length;
    const image = document.getElementById("gallery-main-image");
    if (image) image.src = images[currentIndex];
    document.querySelectorAll("[data-gallery-index]").forEach((item) => {
      item.classList.toggle("active", Number(item.dataset.galleryIndex || 0) === currentIndex);
    });
    showLightboxImage();
  };
  const openLightbox = () => {
    if (!images.length || !lightbox) return;
    trackProductEvent("gallery_open", {
      productCode: product?.code,
      productName: productDisplayName(product)
    }, { onceKey: product?.code || "product" });
    showLightboxImage();
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("product-lightbox-open");
  };
  const closeLightbox = () => {
    if (!lightbox) return;
    lightbox.classList.remove("open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("product-lightbox-open");
  };
  const lightboxNext = (direction) => showImage(currentIndex + direction);
  document.querySelectorAll("[data-gallery-index]").forEach((button) => {
    button.addEventListener("click", () => showImage(Number(button.dataset.galleryIndex || 0)));
  });
  let startX = 0;
  let startY = 0;
  main?.addEventListener("pointerdown", (event) => {
    startX = event.clientX;
    startY = event.clientY;
  });
  main?.addEventListener("pointerup", (event) => {
    const delta = event.clientX - startX;
    const verticalDelta = event.clientY - startY;
    if (Math.abs(delta) < 36 || Math.abs(delta) < Math.abs(verticalDelta)) {
      if (Math.abs(delta) < 12 && Math.abs(verticalDelta) < 12) openLightbox();
      return;
    }
    showImage(currentIndex + (delta < 0 ? 1 : -1));
  });
  mainImage?.addEventListener("click", openLightbox);
  document.getElementById("product-lightbox-close")?.addEventListener("click", closeLightbox);
  document.getElementById("product-lightbox-prev")?.addEventListener("click", () => lightboxNext(-1));
  document.getElementById("product-lightbox-next")?.addEventListener("click", () => lightboxNext(1));
  lightbox?.addEventListener("click", (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  let lightboxStartX = 0;
  let lightboxStartY = 0;
  lightbox?.addEventListener("pointerdown", (event) => {
    lightboxStartX = event.clientX;
    lightboxStartY = event.clientY;
  });
  lightbox?.addEventListener("pointerup", (event) => {
    if (!lightbox.classList.contains("open")) return;
    const delta = event.clientX - lightboxStartX;
    const verticalDelta = event.clientY - lightboxStartY;
    if (Math.abs(delta) < 42 || Math.abs(delta) < Math.abs(verticalDelta)) return;
    lightboxNext(delta < 0 ? 1 : -1);
  });
  document.addEventListener("keydown", (event) => {
    if (!lightbox?.classList.contains("open")) return;
    if (event.key === "Escape") closeLightbox();
    if (event.key === "ArrowLeft") lightboxNext(-1);
    if (event.key === "ArrowRight") lightboxNext(1);
  });
}

function selectedOrderDraft() {
  const size = document.querySelector("[data-product-size].active")?.dataset.productSize || "";
  const qty = Math.max(1, Math.min(99, Number(document.getElementById("product-qty-input")?.value || 1)));
  return { size, qty };
}

function selectProductSize(button) {
  document.querySelectorAll("[data-product-size]").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-checked", active ? "true" : "false");
  });
  const message = document.getElementById("product-action-message");
  if (message) message.textContent = "";
  updateProductPriceForSelectedSize();
  updateProductWarehouseMarkers(button.dataset.productSize || "");
}

function updateProductPriceForSelectedSize() {
  const target = document.querySelector("[data-product-price-block]");
  if (!target) return;
  const size = selectedOrderDraft().size;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = productPriceBlock(product, size).trim();
  const next = wrapper.firstElementChild;
  if (next) target.replaceWith(next);
}

function changeProductQty(delta) {
  const input = document.getElementById("product-qty-input");
  if (!input) return;
  input.value = String(Math.max(1, Math.min(99, Number(input.value || 1) + delta)));
}

function cartIconSvg() {
  return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M6.2 6h15l-1.7 8.4a2 2 0 0 1-2 1.6H8.1a2 2 0 0 1-2-1.7L4.7 3.8H2V2h4.3l.4 4Zm1.1 1.8 1 6.2h9.1l1.2-6.2H7.3ZM9 22a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm8 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" fill="currentColor"/></svg>`;
}

function addCartIconSvg() {
  return `
    <svg viewBox="0 0 48 48" focusable="false" aria-hidden="true">
      <defs>
        <linearGradient id="cartBodyGradient" x1="10" y1="7" x2="39" y2="39" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#ffffff"/>
          <stop offset=".46" stop-color="#dff8ec"/>
          <stop offset="1" stop-color="#7ed7a8"/>
        </linearGradient>
        <linearGradient id="cartTopGradient" x1="13" y1="12" x2="35" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#ffffff"/>
          <stop offset="1" stop-color="#b9f0d0"/>
        </linearGradient>
      </defs>
      <path d="M13 15h28l-3.4 16.5A4.2 4.2 0 0 1 33.5 35H18.2a4.2 4.2 0 0 1-4.1-3.5L11.5 10H5V6h10l.8 6" fill="none" stroke="#075c3c" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M15.5 16.5h22.7l-2.7 13.2A3.2 3.2 0 0 1 32.4 32H19.1a3.2 3.2 0 0 1-3.1-2.7l-2-12.8Z" fill="url(#cartBodyGradient)" stroke="#11845b" stroke-width="1.6"/>
      <path d="M17.3 18.5h17.9l-1.3 6.3H18.2l-.9-6.3Z" fill="url(#cartTopGradient)" opacity=".95"/>
      <circle cx="19" cy="40" r="4" fill="#0e6f4c"/>
      <circle cx="34" cy="40" r="4" fill="#0e6f4c"/>
      <circle cx="19" cy="40" r="1.7" fill="#dff8ec"/>
      <circle cx="34" cy="40" r="1.7" fill="#dff8ec"/>
      <path d="M20 20h12" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity=".9"/>
    </svg>
  `;
}

async function openQuickOrderDialog() {
  const message = document.getElementById("product-action-message");
  const draft = selectedOrderDraft();
  if (!draft.size) {
    message.textContent = "Vui lòng chọn size trước khi đặt hàng.";
    return;
  }
  message.textContent = "";
  const selectedRow = bestSizeRowForSelection(product, draft.size) || {};
  const price = sizeRowPrice(selectedRow) || sellingPriceForSize(product, draft.size);
  trackProductEvent("buy_now", {
    productCode: product.code,
    productName: productDisplayName(product),
    size: draft.size,
    qty: draft.qty
  });
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <form class="order-modal quick-order-form" id="product-order-form">
      <div class="modal-header">
        <div>
          <h2>Thông tin đặt hàng</h2>
          <p>${escapeHTML(product.name)} - Size ${escapeHTML(draft.size)} x${draft.qty}</p>
        </div>
        <button type="button" class="icon-button" id="close-order">X</button>
      </div>
      <div class="checkout-items">
        <div><span>${escapeHTML(product.name)} - Size ${escapeHTML(draft.size)} x${draft.qty}</span><strong>${formatMoney(price * draft.qty)}</strong></div>
      </div>
      <div class="checkout-notes">
        <p>${escapeHTML(contentText("cartNote", "Hàng order thanh toán trước 20%, đặt hàng thông thường từ 3-7 ngày."))}</p>
        <p>${escapeHTML(shippingNoteText())}</p>
      </div>
      <input type="hidden" name="size" value="${escapeHTML(draft.size)}">
      <input type="hidden" name="qty" value="${draft.qty}">
      <label>Họ tên
        <input name="customerName" autocomplete="name" required placeholder="Nguyễn Văn A">
      </label>
      <label>Số điện thoại
        <input name="phone" autocomplete="tel" inputmode="tel" required pattern="^(0|\\+84)(3|5|7|8|9)[0-9]{8}$" placeholder="09xxxxxxxx">
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
      <button class="primary-button" type="submit">Gửi đơn order</button>
      <p class="form-message" id="quick-order-message"></p>
    </form>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.querySelector("#close-order").addEventListener("click", () => overlay.remove());
  const form = overlay.querySelector("#product-order-form");
  form.addEventListener("submit", submitQuickOrder);
  await bindAddressSelectors(form);
  form.elements.customerName.focus();
}

async function submitQuickOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  if (form.dataset.submitting === "1") return;
  const data = Object.fromEntries(new FormData(form).entries());
  const message = form.querySelector(".form-message") || document.getElementById("quick-order-message");
  message.textContent = "";
  const validationError = validateCheckoutPayload(data);
  if (validationError) {
    message.textContent = validationError;
    return;
  }
  form.dataset.submitting = "1";
  const originalButtonText = submitButton?.textContent || "";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Dang gui...";
  }
  const selectedRow = bestSizeRowForSelection(product, data.size) || {};
  const price = sizeRowPrice(selectedRow) || sellingPriceForSize(product, data.size);
  const warehouseId = String(selectedRow.warehouseId || "").trim();
  const warehouse = String(selectedRow.warehouse || selectedRow.warehouseName || "").trim();
  const warehouseLabel = warehouseShortCode(warehouseId, warehouse);
  const qty = Math.max(1, Math.min(99, Number(data.qty || 1)));
  const payload = {
    ...data,
    phone: normalizePhone(data.phone),
    address: [data.addressDetail, data.ward, data.district, data.province].filter(Boolean).join(", "),
    items: [{
      productCode: product.code,
      productName: product.name,
      brand: product.brand || "",
      productKind: product.productKind || product.division || "",
      imageUrl: productGalleryImages(product)[0] || "",
      sourceName: product.sourceName,
      partnerCampaign: Boolean(product.partnerCampaign),
      partnerSource: product.partnerSource || "",
      campaignId: product.campaignId || "",
      campaignName: product.campaignName || "",
      partnerCampaignLineId: selectedRow.partnerCampaignLineId || "",
      partnerProductUrl: product.sourcePageUrl || product.productUrl || "",
      variantId: String(selectedRow.variantId || selectedRow.variant_id || "").trim(),
      size: data.size,
      price,
      saleFilePrice: sizeRowCostPrice(selectedRow, product),
      originalSalePrice: sizeRowCostPrice(selectedRow, product),
      preMarkupSalePrice: sizeRowCostPrice(selectedRow, product),
      listPrice: sizeRowListPrice(selectedRow, product),
      warehouseId,
      warehouse: warehouseLabel,
      warehouseName: warehouseLabel,
      stockMode: rowStockMode(selectedRow),
      qty
    }],
    total: price * qty,
    attribution: window.toprunAnalytics?.attribution?.() || {},
    marketingOptIn: true
  };
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
  message.textContent = response?.ok && result.ok
    ? "Đã nhận đơn. TopRun sẽ liên hệ xác nhận."
    : (result.message || "Chưa gửi được đơn, vui lòng thử lại.");
  if (response?.ok && result.ok) {
    trackProductEvent("order_success", {
      productCode: product.code,
      productName: productDisplayName(product),
      size: data.size,
      qty,
      total: price * qty
    });
    form.reset();
    setTimeout(() => {
      form.closest(".modal-overlay")?.remove();
      showPaymentChatPrompt(orderFromCreateResult(result, payload));
    }, 900);
  } else {
    form.dataset.submitting = "";
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
    }
  }
}

function addProductToCart() {
  const message = document.getElementById("product-action-message");
  const draft = selectedOrderDraft();
  if (!draft.size) {
    message.textContent = "Vui lòng chọn size trước.";
    return;
  }
  const selectedRow = bestSizeRowForSelection(product, draft.size) || {};
  const warehouseId = String(selectedRow.warehouseId || "").trim();
  const warehouse = String(selectedRow.warehouse || selectedRow.warehouseName || "").trim();
  const warehouseLabel = warehouseShortCode(warehouseId, warehouse);
  const variantId = String(selectedRow.variantId || selectedRow.variant_id || "").trim();
  const runtimeKey = String(product.offerKey || product.code || "").trim();
  const key = variantId || `${runtimeKey}__${draft.size}__${warehouseId || warehouse}`;
  const existing = productCart.find((item) => item.key === key);
  if (existing) {
    existing.qty += draft.qty;
  } else {
    productCart.push({
      key,
      productCode: product.code,
      productName: product.name,
      brand: product.brand || "",
      productKind: product.productKind || product.division || "",
      imageUrl: productGalleryImages(product)[0] || "",
      sourceName: product.sourceName,
      partnerCampaign: Boolean(product.partnerCampaign),
      partnerSource: product.partnerSource || "",
      campaignId: product.campaignId || "",
      campaignName: product.campaignName || "",
      partnerCampaignLineId: selectedRow.partnerCampaignLineId || "",
      partnerProductUrl: product.sourcePageUrl || product.productUrl || "",
      variantId,
      size: draft.size,
      price: sizeRowPrice(selectedRow) || sellingPriceForSize(product, draft.size),
      saleFilePrice: sizeRowCostPrice(selectedRow, product),
      originalSalePrice: sizeRowCostPrice(selectedRow, product),
      preMarkupSalePrice: sizeRowCostPrice(selectedRow, product),
      listPrice: sizeRowListPrice(selectedRow, product),
      warehouseId,
      warehouse: warehouseLabel,
      warehouseName: warehouseLabel,
      stockMode: rowStockMode(selectedRow),
      qty: draft.qty
    });
  }
  trackProductEvent("add_to_cart", {
    productCode: product.code,
    productName: productDisplayName(product),
    size: draft.size,
    qty: draft.qty
  });
  saveStoredCart(productCart);
  renderFloatingProductCart();
  message.textContent = `Đã thêm ${draft.qty} sản phẩm size ${draft.size} vào giỏ.`;
}

function ensureFloatingProductCart() {
  if (document.getElementById("product-floating-cart")) return;
  const cart = document.createElement("button");
  cart.className = "product-floating-cart";
  cart.id = "product-floating-cart";
  cart.type = "button";
  cart.innerHTML = `
    <span class="floating-cart-icon">${cartIconSvg()}</span>
    <span class="floating-cart-count" id="product-floating-cart-count">0</span>
  `;
  document.body.appendChild(cart);
  document.addEventListener("pointermove", moveFloatingProductCart, { passive: true });
  cart.addEventListener("click", openProductCartDialog);
}

function moveFloatingProductCart(event) {
  const cart = document.getElementById("product-floating-cart");
  if (!cart || window.matchMedia("(max-width: 760px)").matches) return;
  const y = Math.max(90, Math.min(window.innerHeight - 90, event.clientY));
  cart.style.top = `${y}px`;
}

function renderFloatingProductCart() {
  const count = productCart.reduce((sum, item) => sum + item.qty, 0);
  const badge = document.getElementById("product-floating-cart-count");
  if (badge) badge.textContent = String(count);
  document.getElementById("product-floating-cart")?.classList.toggle("has-items", count > 0);
  const openCart = document.getElementById("product-cart-items");
  if (openCart) renderProductCartItems();
}

function openProductCartDialog() {
  if (!productCart.length) {
    const message = document.getElementById("product-action-message");
    if (message) message.textContent = "Giỏ hàng đang trống.";
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay product-cart-overlay";
  overlay.innerHTML = `
    <section class="order-modal product-cart-modal">
      <div class="modal-header">
        <div>
          <p class="eyebrow">Giỏ hàng</p>
          <h2>Sản phẩm đã chọn</h2>
        </div>
        <button type="button" class="icon-button" id="product-cart-close">X</button>
      </div>
      <div id="product-cart-items"></div>
      <div class="cart-notes">
        <p>${escapeHTML(contentText("cartNote", "Hàng order thanh toán trước 20%, đặt hàng thông thường từ 3-7 ngày."))}</p>
        <p>${escapeHTML(shippingNoteText())}</p>
      </div>
      <div class="cart-total">
        <span>Tạm tính</span>
        <strong id="product-cart-total">0đ</strong>
      </div>
      <div class="split-actions">
        <button type="button" class="secondary-button" id="product-cart-continue">Chọn thêm</button>
        <button type="button" class="primary-button" id="product-cart-checkout">Xác nhận đơn hàng</button>
      </div>
      <p class="form-message" id="product-cart-message"></p>
    </section>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.getElementById("product-cart-close")?.addEventListener("click", () => overlay.remove());
  document.getElementById("product-cart-continue")?.addEventListener("click", () => overlay.remove());
  document.getElementById("product-cart-checkout")?.addEventListener("click", () => openProductCartCheckout(overlay));
  renderProductCartItems();
}

function renderProductCartItems() {
  const root = document.getElementById("product-cart-items");
  if (!root) return;
  root.innerHTML = productCart.length ? productCart.map((item) => `
    <div class="cart-item">
      <div>
        <strong>${escapeHTML(productDisplayName(item))}</strong>
        <span>${escapeHTML(item.productCode)} - Size ${escapeHTML(item.size)}</span>
      </div>
      <div class="qty-control">
        <button type="button" data-product-cart-qty="${escapeHTML(item.key)}" data-delta="-1">-</button>
        <span>${item.qty}</span>
        <button type="button" data-product-cart-qty="${escapeHTML(item.key)}" data-delta="1">+</button>
      </div>
      <strong>${formatMoney(item.price * item.qty)}</strong>
    </div>
  `).join("") : `<p class="empty-cart">Chưa có sản phẩm trong giỏ.</p>`;
  document.getElementById("product-cart-total").textContent = formatMoney(productCartTotal());
  root.querySelectorAll("[data-product-cart-qty]").forEach((button) => {
    button.addEventListener("click", () => changeProductCartQty(button.dataset.productCartQty || "", Number(button.dataset.delta || 0)));
  });
}

function changeProductCartQty(key, delta) {
  const item = productCart.find((entry) => entry.key === key);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) productCart = productCart.filter((entry) => entry.key !== key);
  saveStoredCart(productCart);
  renderFloatingProductCart();
  renderProductCartItems();
}

function productCartTotal() {
  return productCart.reduce((sum, item) => sum + item.qty * item.price, 0);
}

async function openProductCartCheckout(cartOverlay) {
  if (!productCart.length) return;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <form class="order-modal quick-order-form checkout-info-modal" id="product-cart-order-form">
      <div class="modal-header">
        <div>
          <p class="eyebrow">Xác nhận đơn</p>
          <h2>Thông tin nhận hàng</h2>
          <p>${productCart.reduce((sum, item) => sum + item.qty, 0)} sản phẩm - ${formatMoney(productCartTotal())}</p>
        </div>
        <button type="button" class="icon-button" id="product-cart-order-close">X</button>
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
        <input name="phone" autocomplete="tel" inputmode="tel" required pattern="^(0|\\+84)(3|5|7|8|9)[0-9]{8}$" placeholder="09xxxxxxxx">
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
      <button class="primary-button" type="submit">Xác nhận đơn hàng</button>
      <p class="form-message" id="product-cart-order-message"></p>
    </form>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.getElementById("product-cart-order-close")?.addEventListener("click", () => overlay.remove());
  const form = document.getElementById("product-cart-order-form");
  form.addEventListener("submit", submitProductCartOrder);
  await bindAddressSelectors(form);
  cartOverlay?.remove();
  form.elements.customerName.focus();
}

async function submitProductCartOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  if (form.dataset.submitting === "1") return;
  const data = Object.fromEntries(new FormData(form).entries());
  const message = document.getElementById("product-cart-order-message");
  message.textContent = "";
  const validationError = validateCustomerPayload(data);
  if (validationError) {
    message.textContent = validationError;
    return;
  }
  form.dataset.submitting = "1";
  const originalButtonText = submitButton?.textContent || "";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Dang gui...";
  }
  const payload = {
    ...data,
    phone: normalizePhone(data.phone),
    address: [data.addressDetail, data.ward, data.district, data.province].filter(Boolean).join(", "),
    items: productCart.map(({ key, ...item }) => item),
    total: productCartTotal(),
    paymentMethod: data.paymentMethod || "manual_confirm",
    attribution: window.toprunAnalytics?.attribution?.() || {},
    marketingOptIn: true
  };
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
  message.textContent = response?.ok && result.ok
    ? "Đã nhận đơn. TopRun sẽ liên hệ xác nhận."
    : (result.message || "Chưa gửi được đơn, vui lòng thử lại.");
  if (response?.ok && result.ok) {
    trackProductEvent("order_success", {
      productCode: product.code,
      productName: productDisplayName(product),
      itemCount: productCart.length,
      total: payload.total
    });
    productCart = [];
    saveStoredCart(productCart);
    renderFloatingProductCart();
    setTimeout(() => {
      form.closest(".modal-overlay")?.remove();
      showPaymentChatPrompt(orderFromCreateResult(result, payload));
    }, 900);
  } else {
    form.dataset.submitting = "";
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
    }
  }
}

function productWarehouseMarkerRow(item = {}, selectedSize = "") {
  const markers = productWarehouseMarkers(item);
  if (!markers.length) return "";
  const active = new Set(warehousesForSize(item, selectedSize).map((entry) => entry.id));
  return `
    <div class="product-warehouse-markers" id="product-warehouse-markers" aria-hidden="true">
      ${markers.map((entry) => `
        <span class="${active.has(entry.id) ? "active" : ""}" data-warehouse-marker="${escapeHTML(entry.id)}">${escapeHTML(entry.label)}</span>
      `).join("")}
    </div>
  `;
}

function productWarehouseMarkers(item = {}) {
  const rows = productSizes(item)
    .filter((row) => Number(row.qty ?? row.available ?? row.stockQty ?? 0) > 0)
    .map(warehouseMarkerFromRow)
    .filter((entry) => entry.id);
  const seen = new Set();
  return rows.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function warehousesForSize(item = {}, selectedSize = "") {
  const normalized = String(selectedSize || "").trim().toLowerCase();
  return productSizes(item)
    .filter((row) => productDisplaySizeFromRow(item, row).toLowerCase() === normalized)
    .filter((row) => Number(row.qty ?? row.available ?? row.stockQty ?? 0) > 0)
    .map(warehouseMarkerFromRow)
    .filter((entry) => entry.id);
}

function warehouseMarkerFromRow(row = {}) {
  const id = warehouseRowValue(row);
  const name = String(row.warehouse || row.warehouseName || row.warehouseId || "").trim();
  return { id, label: warehouseShortCode(id, name) };
}

function warehouseShortCode(id = "", name = "") {
  const rawId = String(id || "").trim();
  const rawName = String(name || "").trim();
  const normalized = normalizeWarehouseId(rawId) || normalizeWarehouseId(rawName);
  if (/^wh_toprun(_|$)/.test(normalized)) return "TR";
  const known = {
    wh_yen: "Y",
    yen: "Y",
    wh_phuong_thu: "PT",
    phuong_thu: "PT",
    wh_cau_dien: "CD",
    cau_dien: "CD",
    wh_toprun: "TR",
    toprun: "TR",
    wh_hang_td: "HTD",
    hang_td: "HTD"
  };
  if (known[normalized]) return known[normalized];
  const raw = rawName || rawId;
  const parts = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!parts.length) return "";
  const initials = parts.map((part) => part[0]).join("").toUpperCase();
  return initials.slice(0, 3);
}

function updateProductWarehouseMarkers(size = "") {
  const active = new Set(warehousesForSize(product, size).map((entry) => entry.id));
  document.querySelectorAll("[data-warehouse-marker]").forEach((item) => {
    item.classList.toggle("active", active.has(item.dataset.warehouseMarker || ""));
  });
}

function productGalleryImages(item) {
  return orderedProductImages(item)
    .map(normalizeProductImageUrl)
    .filter((value) => value && !isInternalThumbnailImage(value));
}

function ctvProductImages(item = {}) {
  const gallery = Array.isArray(item.galleryImages) ? item.galleryImages : [];
  return [...new Set([item.highImage, ...gallery, ...productGalleryImages(item)]
    .map(normalizeProductImageUrl)
    .filter((value) => value && !isInternalThumbnailImage(value)))];
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

function normalizeProductImageUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("/") || url.startsWith("data:")) return url;
  if (/^(assets|media)\//i.test(url)) return `/${url}`;
  return url;
}

function isInternalThumbnailImage(value) {
  const url = String(value || "").trim().toLowerCase();
  if (!url) return true;
  if (/\/assets\/thumbnails\//.test(url) || /^assets\/thumbnails\//.test(url)) return true;
  if (/(^|[_/-])(thumb|thumbnail|compare|source-thumb|original-thumb)([_./-]|$)/i.test(url)) return true;
  return false;
}

function generatedDescription(item) {
  const template = contentText("productIntroDefault", "");
  if (template) {
    return template
      .replaceAll("{productName}", productDisplayName(item) || item.code || "")
      .replaceAll("{productKind}", item.productKind || item.division || item.category || "sản phẩm")
      .replaceAll("{brand}", item.brand || "")
      .replaceAll("{code}", item.code || "");
  }
  const parts = [
    `${item.name || item.code} là sản phẩm hàng order đang được TopRun tổng hợp trong catalog sale.`,
    item.category ? `Phù hợp nhóm ${item.category}.` : "",
    item.division ? `Nhóm hàng: ${item.division}.` : "",
    "Khách chọn size còn hàng và để lại thông tin, TopRun sẽ xác nhận lại trước khi chốt đơn."
  ];
  return parts.filter(Boolean).join(" ");
}

function availableProductSizes(item) {
  return [...new Set(productSizes(item)
    .filter((size) => Number(size.qty || 0) > 0)
    .map((size) => productDisplaySizeFromRow(item, size))
    .filter(Boolean))];
}

function normalizeApparelSize(size) {
  const text = String(size || "").trim().toUpperCase().replace(/\\/g, "/").replace(/\s+/g, "").replace(/^A-/, "A/");
  const match = text.match(/^A\/?(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)(?:\d+(?:"|”|'|IN|INCH)?)?$/i);
  if (match) return `A/${match[1].toUpperCase()}`;
  if (/^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)$/i.test(text)) return text;
  return "";
}

function rawAvailableProductSizes(item) {
  return productSizes(item)
    .filter((size) => Number(size.qty || 0) > 0)
    .map((size) => String(size.size));
}

function productDisplaySizeFromRow(item = {}, row = {}) {
  const raw = String(row.size || "").trim();
  if (!raw) return "";
  if (isBagProduct(item)) return "NS";
  return normalizeApparelSize(raw) || raw;
}

// ===== Kho hàng sẵn 2026-08-11: cùng mã có thể có 2 phiên bản (Sẵn / Order) =====
// Khi sản phẩm có cả 2, mọi hàm chọn size/giá chỉ nhìn thấy các dòng của thẻ đang chọn.
let productStockMode = "order";
let productStockModeInitialized = false;

function rowStockMode(row = {}) {
  return String(row?.stockMode || "").trim().toLowerCase() === "ready" ? "ready" : "order";
}

function productHasStockMode(item = {}, mode = "order") {
  return (Array.isArray(item?.sizes) ? item.sizes : [])
    .some((row) => rowStockMode(row) === mode && Number(row?.qty ?? row?.available ?? 0) > 0);
}

function productHasBothStockModes(item = {}) {
  return productHasStockMode(item, "ready") && productHasStockMode(item, "order");
}

function initProductStockMode(item = {}) {
  if (productStockModeInitialized) return;
  productStockModeInitialized = true;
  const params = new URLSearchParams(window.location.search);
  const wantsReady = (params.get("ban") || "").trim().toLowerCase() === "san";
  if (productHasStockMode(item, "ready") && (wantsReady || !productHasStockMode(item, "order"))) {
    productStockMode = "ready";
  }
}

function productSizes(item) {
  const rows = Array.isArray(item?.sizes) ? item.sizes : [];
  const hasReady = rows.some((row) => rowStockMode(row) === "ready");
  if (!hasReady) return rows;
  const hasOrder = rows.some((row) => rowStockMode(row) === "order");
  if (!hasOrder) return rows;
  return rows.filter((row) => rowStockMode(row) === productStockMode);
}

function isBagProduct(item) {
  const text = `${item.name || ""} ${item.productUrl || ""} ${item.detailUrl || ""} ${item.sourcePageUrl || ""} ${item.division || ""} ${item.category || ""}`.toLowerCase();
  return /(backpack|balo|ba-lo|ba lo|bag|tui|túi|duffel|duffle|tote|waistbag|x-body|pouch)/i.test(text)
    || rawAvailableProductSizes(item).some((size) => /^kt\s*:/i.test(size));
}

function productPriceBlock(item, size = "") {
  const listPrice = listedPrice(item);
  const salePrice = size ? sellingPriceForSize(item, size) : sellingPrice(item);
  const priceRange = size ? null : priceRangeForProduct(item);
  const hasPriceRange = Boolean(priceRange && priceRange.min > 0 && priceRange.max > priceRange.min);
  const displayPrice = hasPriceRange ? formatCompactPriceRange(priceRange) : formatMoney(salePrice);
  const showListPrice = listPrice > 0 && (hasPriceRange ? listPrice > priceRange.min : listPrice !== salePrice);
  return `
    <div class="price-stack" data-product-price-block>
      ${showListPrice ? `<div class="price-row list-price"><span>Giá niêm yết</span><strong>${formatMoney(listPrice)}</strong></div>` : ""}
      <div class="price-row sale-price${hasPriceRange ? " price-range" : ""}"><span>Giá sale</span><strong>${displayPrice}</strong></div>
      ${hasPriceRange ? `<div class="price-size-note">Giá thay đổi theo size</div>` : ""}
    </div>
  `;
}

function priceRangeForProduct(item) {
  const prices = uniqueNumbers(productSizes(item).map((size) => sizeRowPrice(size)).filter((price) => price > 0));
  if (prices.length < 2) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
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
    .replace(/[đĐ]/g, "d")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function warehouseRowValue(row = {}) {
  return String(row.warehouseId || normalizeWarehouseId(row.warehouse || row.warehouseName)).trim();
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
  const rows = productSizes(item).filter((size) => productDisplaySizeFromRow(item, size).toLowerCase() === normalized);
  const candidates = rows.filter((row) => Number(row.qty ?? row.available ?? row.stockQty ?? 0) > 0);
  const sourceRows = candidates.length ? candidates : rows;
  return sourceRows
    .slice()
    .sort(compareSizeRowsForSelection(item))[0] || null;
}

function listedPrice(item) {
  return firstPositiveNumber(item.listPrice, item.originalPrice, item.retailPrice, item.marketPrice, item.msrp);
}

function productHasInvalidPrice(item = {}) {
  const listPrice = listedPrice(item);
  const salePrice = sellingPrice(item);
  return listPrice > 0 && salePrice > listPrice;
}

function discountPercent(item) {
  const explicit = firstPositiveNumber(item.discountPercent, item.discount_percent);
  if (explicit > 0) return Math.round(explicit);
  const ratio = Number(item.saleRatio || item.sale_ratio || 0);
  if (ratio > 0) return Math.round(ratio <= 1 ? ratio * 100 : ratio);
  const list = listedPrice(item);
  const sale = sellingPrice(item);
  return list > 0 && sale > 0 && sale < list ? Math.round((1 - sale / list) * 100) : 0;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value || 0);
    if (number > 0) return number;
  }
  return 0;
}

function validateCheckoutPayload(payload) {
  const required = [
    ["size", "Vui lòng chọn size."],
    ["customerName", "Vui lòng nhập họ tên."],
    ["phone", "Vui lòng nhập số điện thoại."],
    ["province", "Vui lòng nhập Tỉnh/TP theo đơn vị hành chính cũ."],
    ["district", "Vui lòng nhập Huyện/Quận theo đơn vị hành chính cũ."],
    ["ward", "Vui lòng nhập Xã/Phường theo đơn vị hành chính cũ."],
    ["addressDetail", "Vui lòng nhập địa chỉ chi tiết."]
  ];
  for (const [field, error] of required) {
    if (field === "district" && String(payload.addressScheme || "") === "two_tier") continue;
    if (!String(payload[field] || "").trim()) return error;
  }
  if (!/^(0|\+84)(3|5|7|8|9)\d{8}$/.test(normalizePhone(payload.phone))) {
    return "Số điện thoại chưa đúng định dạng. Vui lòng nhập số Việt Nam, ví dụ 09xxxxxxxx.";
  }
  const emailError = validateOptionalEmail(payload.email);
  if (emailError) return emailError;
  const adminError = validateSelectedAdminUnit(payload);
  if (adminError) return adminError;
  return "";
}

function validateCustomerPayload(payload) {
  const required = [
    ["customerName", "Vui lòng nhập họ tên."],
    ["phone", "Vui lòng nhập số điện thoại."],
    ["province", "Vui lòng nhập Tỉnh/TP theo đơn vị hành chính cũ."],
    ["district", "Vui lòng nhập Huyện/Quận theo đơn vị hành chính cũ."],
    ["ward", "Vui lòng nhập Xã/Phường theo đơn vị hành chính cũ."],
    ["addressDetail", "Vui lòng nhập địa chỉ chi tiết."]
  ];
  for (const [field, error] of required) {
    if (field === "district" && String(payload.addressScheme || "") === "two_tier") continue;
    if (!String(payload[field] || "").trim()) return error;
  }
  if (!/^(0|\+84)(3|5|7|8|9)\d{8}$/.test(normalizePhone(payload.phone))) {
    return "Số điện thoại chưa đúng định dạng. Vui lòng nhập số Việt Nam, ví dụ 09xxxxxxxx.";
  }
  const emailError = validateOptionalEmail(payload.email);
  if (emailError) return emailError;
  const adminError = validateSelectedAdminUnit(payload);
  if (adminError) return adminError;
  return "";
}

function validateOptionalEmail(value) {
  const email = String(value || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Email chưa đúng định dạng. Nếu không dùng email, quý khách có thể để trống.";
  }
  return "";
}

function normalizePhone(value) {
  return String(value || "").replace(/[\s.-]/g, "");
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
  // 2 he dia chi, khoa gia tri ngoai danh muc. Chi giu phan tiem clientOrderId.
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

function normalizeAdminText(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
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
