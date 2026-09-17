// v73 (02/09, anh duyet): QUET TEM SAN PHAM BANG CAMERA tren portal doi tac.
// - AI doc tem chay o SERVER LANDING (may Sales Desk tat van hoat dong).
// - v74: quet KHONG CHO (2 luot AI song song), crop khung net dut. DA DO: kich thuoc anh khong doi
//   thoi gian AI (~5s la hang doi model) — toc do that den tu viec khong cho ket qua.
// - v75 (anh duyet "quet don ca lo"): GIO QUET — moi tem khop tu don vao gio (+1 moi luot, tran =
//   so can mua), quet xong bam DOC XONG → man doi soat → XAC NHAN MUA ghi tuan tu qua API
//   /api/partner-portal/purchases co san (giu nguyen phien mua/gia/hoan tac). Sai size / ngoai
//   danh sach → chi canh bao, KHONG vao gio (luat anh chot).
(function () {
  var openButton = document.getElementById("scan-open-button");
  var modal = document.getElementById("scan-modal");
  if (!openButton || !modal) return;
  var video = document.getElementById("scan-video");
  var videoWrap = modal.querySelector(".scan-video-wrap");
  var statusEl = document.getElementById("scan-status");
  var resultEl = document.getElementById("scan-result");
  var cartEl = document.getElementById("scan-cart");
  var cartBarEl = document.getElementById("scan-cart-bar");
  var reviewEl = document.getElementById("scan-review");
  var closeButton = document.getElementById("scan-close-button");
  var scanNowButton = document.getElementById("scan-now-button");

  var stream = null;
  var timer = null;
  var inFlight = 0;
  var lastSample = null;
  var stillCount = 0;
  var lastScanAt = 0;
  var lastResultKey = "";
  var lastResultAt = 0;
  var confirming = false;

  var probe = document.createElement("canvas");
  probe.width = 160; probe.height = 120;
  var probeCtx = probe.getContext("2d", { willReadFrequently: true });
  var shot = document.createElement("canvas");

  // ----- GIO QUET (v75): giu qua sessionStorage de tat modal / rot mang khong mat -----
  var CART_KEY = "partnerScanCart";
  function loadCart() {
    try { return JSON.parse(sessionStorage.getItem(CART_KEY) || "[]"); } catch (e) { return []; }
  }
  function saveCart(cart) {
    try { sessionStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* het quota thi thoi */ }
  }
  function cartKeyOf(code, size) { return String(code || "") + "|" + String(size || ""); }

  function money(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }
  function esc(s) { return String(s || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function setStatus(text) { statusEl.textContent = text; }

  function addToCart(need) {
    var cart = loadCart();
    var key = cartKeyOf(need.productCode, need.size);
    var row = cart.find(function (r) { return r.key === key; });
    var cap = Math.max(1, Number(need.missingQty || 1));
    if (row) {
      if (row.qty >= cap) { setStatus("Mã " + need.productCode + " size " + need.size + " đã đủ số cần (" + cap + ") — không cộng thêm."); return; }
      row.qty += 1;
      row.missingQty = cap;
    } else if (cart.length < 30) {
      cart.push({ key: key, code: need.productCode, name: need.productName || need.productCode, size: need.size, qty: 1, missingQty: cap, unitCost: Number(need.unitCost || 0) });
    }
    saveCart(cart);
    renderCart();
  }

  function renderCart() {
    var cart = loadCart();
    if (!cart.length) {
      cartEl.hidden = true; cartBarEl.hidden = true;
      return;
    }
    cartEl.hidden = false; cartBarEl.hidden = false;
    cartEl.innerHTML = cart.map(function (r) {
      return '<div class="scan-cart-row" data-key="' + esc(r.key) + '">' +
        '<span class="scan-cart-name">✅ <b>' + esc(r.code) + '</b> · size <b>' + esc(r.size) + '</b><small>' + esc(r.name) + ' · cần ' + esc(r.missingQty) + '</small></span>' +
        '<span class="scan-cart-qty">' +
        '<button type="button" data-cart-minus aria-label="Bớt 1">−</button>' +
        '<b>×' + r.qty + '</b>' +
        '<button type="button" data-cart-plus aria-label="Thêm 1">+</button>' +
        '</span></div>';
    }).join("");
    var totalQty = cart.reduce(function (s, r) { return s + r.qty; }, 0);
    cartBarEl.querySelector("#scan-cart-summary").textContent = "Đã quét " + cart.length + " mã · " + totalQty + " chiếc";
  }

  cartEl.addEventListener("click", function (event) {
    var minus = event.target.closest("[data-cart-minus]");
    var plus = event.target.closest("[data-cart-plus]");
    if (!minus && !plus) return;
    var key = event.target.closest(".scan-cart-row").dataset.key;
    var cart = loadCart();
    var row = cart.find(function (r) { return r.key === key; });
    if (!row) return;
    if (plus && row.qty < row.missingQty) row.qty += 1;
    if (minus) row.qty -= 1;
    if (row.qty <= 0) cart = cart.filter(function (r) { return r.key !== key; });
    saveCart(cart);
    renderCart();
  });

  // ----- MAN DOI SOAT + XAC NHAN CA LO -----
  function showReview() {
    var cart = loadCart();
    if (!cart.length) return;
    videoWrap.hidden = true; cartEl.hidden = true; cartBarEl.hidden = true;
    if (scanNowButton) scanNowButton.hidden = true;
    resultEl.hidden = true;
    reviewEl.hidden = false;
    reviewEl.innerHTML =
      '<div class="scan-review-head">Đối soát trước khi ghi mua</div>' +
      cart.map(function (r) {
        return '<div class="scan-review-row" data-key="' + esc(r.key) + '">' +
          '<span><b>' + esc(r.code) + '</b> · size <b>' + esc(r.size) + '</b><small>' + esc(r.name) + ' · cần ' + r.missingQty + ' · quét ' + r.qty + '</small></span>' +
          '<span class="scan-review-cost"><small>Giá thực tế</small><input type="text" inputmode="numeric" value="' + Number(r.unitCost || 0) + '" data-review-cost></span>' +
          '<span class="scan-review-state" data-review-state></span>' +
          '</div>';
      }).join("") +
      '<button type="button" class="primary-button" id="scan-confirm-all">XÁC NHẬN MUA ' + cart.reduce(function (s, r) { return s + r.qty; }, 0) + ' CHIẾC</button>' +
      '<button type="button" class="small-button" id="scan-back-to-scan">← Quay lại quét tiếp</button>';
    document.getElementById("scan-confirm-all").addEventListener("click", confirmAll);
    document.getElementById("scan-back-to-scan").addEventListener("click", hideReview);
  }

  function hideReview() {
    reviewEl.hidden = true;
    videoWrap.hidden = false;
    if (scanNowButton) scanNowButton.hidden = false;
    renderCart();
  }

  async function confirmAll() {
    if (confirming) return;
    confirming = true;
    var confirmButton = document.getElementById("scan-confirm-all");
    if (confirmButton) { confirmButton.disabled = true; confirmButton.textContent = "Đang ghi mua..."; }
    var cart = loadCart();
    var token = (typeof state === "object" && state && state.token) || "";
    var lastPayload = null;
    var failed = [];
    for (var i = 0; i < cart.length; i += 1) {
      var r = cart[i];
      var rowEl = reviewEl.querySelector('.scan-review-row[data-key="' + CSS.escape(r.key) + '"]');
      var stateEl = rowEl && rowEl.querySelector("[data-review-state]");
      var costRaw = rowEl && rowEl.querySelector("[data-review-cost]") ? rowEl.querySelector("[data-review-cost]").value : r.unitCost;
      var actualUnitCost = Number(String(costRaw || "").replace(/[^\d]/g, "")) || Number(r.unitCost || 0);
      if (stateEl) stateEl.textContent = "…";
      try {
        var response = await fetch("/api/partner-portal/purchases", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            token: token, productCode: r.code, size: r.size,
            quantity: r.qty, actualUnitCost: actualUnitCost,
            commandId: "scan_" + r.key.replace(/[^0-9a-zA-Z]/g, "") + "_" + Date.now(),
            note: "quét tem camera"
          })
        });
        var payload = await response.json().catch(function () { return {}; });
        if (!response.ok || !payload.ok) throw new Error(payload.message || ("HTTP " + response.status));
        lastPayload = payload;
        if (stateEl) { stateEl.textContent = "✓ đã ghi"; stateEl.className = "scan-review-state ok"; }
      } catch (error) {
        failed.push(r);
        if (stateEl) { stateEl.textContent = "✗ " + (error.message || "lỗi"); stateEl.className = "scan-review-state bad"; }
      }
    }
    // Dong bo lai state portal tu phan hoi cuoi (nhu confirmPurchase don le van lam).
    if (lastPayload && typeof state === "object" && state) {
      if (lastPayload.needs) state.needs = lastPayload.needs;
      if (lastPayload.orders) state.orders = lastPayload.orders;
      if (Array.isArray(lastPayload.packingOrders)) state.packingOrders = lastPayload.packingOrders;
      if (lastPayload.summary) state.summary = lastPayload.summary;
      if (typeof render === "function") try { render(); } catch (e) { /* portal tu ve lai o lan tai sau */ }
    }
    saveCart(failed); // dong nao loi thi GIU LAI trong gio de thu lai, dong xong thi xoa
    confirming = false;
    if (!failed.length) {
      if (confirmButton) confirmButton.textContent = "✓ Đã ghi mua xong";
      setTimeout(function () { hideReview(); closeScanner(); }, 1200);
      if (typeof setMessage === "function") try { setMessage("Đã ghi mua " + cart.length + " mã từ phiên quét tem."); } catch (e) {}
    } else {
      if (confirmButton) { confirmButton.disabled = false; confirmButton.textContent = "THỬ LẠI " + failed.length + " DÒNG LỖI"; }
    }
  }

  // ----- KET QUA CANH BAO (khong vao gio): chong toi da 2 the, moi nhat tren cung -----
  function showResult(kind, html, dedupeKey) {
    if (dedupeKey && dedupeKey === lastResultKey && Date.now() - lastResultAt < 8000) return;
    lastResultKey = dedupeKey || "";
    lastResultAt = Date.now();
    resultEl.hidden = false;
    var card = document.createElement("div");
    card.className = "scan-result " + (kind === "ok" ? "scan-ok" : kind === "warn" ? "scan-warn" : "scan-bad");
    card.innerHTML = html;
    resultEl.insertBefore(card, resultEl.firstChild);
    while (resultEl.children.length > 2) resultEl.removeChild(resultEl.lastChild);
  }

  async function openScanner() {
    resultEl.hidden = true;
    resultEl.innerHTML = "";
    reviewEl.hidden = true;
    videoWrap.hidden = false;
    if (scanNowButton) scanNowButton.hidden = false;
    modal.hidden = false;
    renderCart();
    setStatus("Đang mở camera…");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      setStatus("Đưa camera vào tem — quét liên tục, tem khớp tự vào giỏ bên dưới.");
      lastSample = null; stillCount = 0; lastScanAt = 0;
      timer = setInterval(sampleFrame, 350);
    } catch (error) {
      setStatus("Không mở được camera: " + (error && error.message || error) + ". Kiểm tra quyền camera của trình duyệt giúp shop.");
    }
  }

  function closeScanner() {
    modal.hidden = true;
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    video.srcObject = null;
  }

  // Do NET (tong gradient) va DUNG YEN (lech voi mau truoc) tren anh xam 160x120.
  function frameMetrics() {
    probeCtx.drawImage(video, 0, 0, probe.width, probe.height);
    var img = probeCtx.getImageData(0, 0, probe.width, probe.height).data;
    var w = probe.width; var h = probe.height;
    var gray = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i += 1) {
      gray[i] = (img[i * 4] * 3 + img[i * 4 + 1] * 6 + img[i * 4 + 2]) / 10;
    }
    var sharp = 0; var count = 0;
    for (var y = 1; y < h - 1; y += 2) {
      for (var x = 1; x < w - 1; x += 2) {
        var p = gray[y * w + x];
        sharp += Math.abs(p - gray[y * w + x + 1]) + Math.abs(p - gray[(y + 1) * w + x]);
        count += 1;
      }
    }
    sharp = sharp / count;
    var motion = 0;
    if (lastSample) {
      var diff = 0;
      for (var k = 0; k < gray.length; k += 4) diff += Math.abs(gray[k] - lastSample[k]);
      motion = diff / (gray.length / 4);
    } else {
      motion = 999;
    }
    lastSample = gray;
    return { sharp: sharp, motion: motion };
  }

  function sampleFrame() {
    if (inFlight >= 2 || !stream || video.readyState < 2 || !reviewEl.hidden) return;
    var m = frameMetrics();
    var metricText = " (nét " + Math.round(m.sharp) + " · rung " + (m.motion > 99 ? 99 : Math.round(m.motion)) + ")";
    var still = m.motion < 35; // v73d: thuc dia tay cam ~22, chi chan luc dang lia may
    stillCount = still ? stillCount + 1 : 0;
    if (m.sharp < 5) { setStatus("Hình đang mờ — đưa camera gần tem hơn" + metricText); return; }
    if (stillCount < 1) { setStatus("Giữ yên tay một nhịp để hệ quét…" + metricText); return; }
    if (Date.now() - lastScanAt < 2500) return;
    lastScanAt = Date.now();
    captureAndScan();
  }

  async function captureAndScan() {
    // Crop khung net dut (inset 12%/8%) 640px — khong doi thoi gian AI (da do) nhung upload nhe + doc chinh xac hon.
    var vw = video.videoWidth || 1280;
    var vh = video.videoHeight || 720;
    var sx = Math.round(vw * 0.08), sy = Math.round(vh * 0.12);
    var sw = Math.round(vw * 0.84), sh = Math.round(vh * 0.76);
    var scale = Math.min(1, 640 / sw);
    shot.width = Math.round(sw * scale);
    shot.height = Math.round(sh * scale);
    shot.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, shot.width, shot.height);
    var image = shot.toDataURL("image/jpeg", 0.76);
    inFlight += 1;
    setStatus(inFlight > 1 ? ("Đang đọc " + inFlight + " tem… cứ rà tem tiếp ạ.") : "Đang đọc tem… cứ rà tem tiếp, tem khớp tự vào giỏ.");
    try {
      var token = (typeof state === "object" && state && state.token) || "";
      var response = await fetch("/api/partner-portal/scan-label", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token: token, image: image })
      });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok || !payload.ok) throw new Error(payload.message || ("Lỗi máy chủ (" + response.status + ")"));
      renderScanResult(payload);
    } catch (error) {
      showResult("bad", "<b>Lỗi quét:</b> " + esc(error && error.message || error), "err");
    } finally {
      inFlight -= 1;
    }
  }

  function renderScanResult(payload) {
    if (payload.status === "matched") {
      addToCart(payload.need || {});
      setStatus("✅ Vào giỏ: " + (payload.need && payload.need.productCode) + " size " + (payload.need && payload.need.size) + " — quét tem tiếp.");
    } else if (payload.status === "wrong_size") {
      var list = (payload.sizesNeeded || []).map(function (row) { return row.size + " (cần " + row.missingQty + ")"; }).join(", ");
      showResult("warn",
        "<b>⚠️ SAI SIZE — không mua</b><br>Đúng mã <b>" + esc(payload.productCode) + "</b> nhưng tem là size <b>" +
        esc((payload.readSizes || []).join("/") || "?") + "</b>.<br>Size đang cần: <b>" + esc(list || "—") + "</b>",
        "ws:" + payload.productCode + ":" + (payload.readSizes || []).join("/"));
    } else if (payload.status === "not_in_list") {
      showResult("bad", "<b>⛔ NGOÀI DANH SÁCH — không mua</b><br>Mã đọc được: <b>" + esc(payload.productCode || "?") + "</b>" +
        (payload.readSizes && payload.readSizes.length ? " · size " + esc(payload.readSizes.join("/")) : ""),
        "nl:" + payload.productCode);
    } else {
      showResult("warn", esc(payload.message || "Chưa đọc được tem — thử lại."), "unread");
    }
  }

  var doneButton = document.getElementById("scan-done-button");
  if (doneButton) doneButton.addEventListener("click", showReview);
  if (scanNowButton) scanNowButton.addEventListener("click", function () {
    if (inFlight >= 2 || !stream) return;
    lastScanAt = Date.now();
    captureAndScan();
  });
  openButton.addEventListener("click", openScanner);
  closeButton.addEventListener("click", closeScanner);
  modal.addEventListener("click", function (event) { if (event.target === modal) closeScanner(); });
})();
