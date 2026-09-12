// Tach tu m-order.html vi CSP toprun.site chan inline script (script-src 'self') — 31/08/2026
// v72 (02/09, anh duyet the nhieu san pham — ca Dang Anh Khoi chot 3 mon nhung the chi ho tro 1):
// nhan them ?items=CODE:SIZE~CODE:SIZE (size da encodeURIComponent) → mot phieu dat NHIEU mon,
// moi mon mot o chon size rieng. Link cu ?p=CODE&size=... van chay nhu truoc (1 mon).
(function () {
  var qs = new URLSearchParams(location.search);
  var code = String(qs.get("p") || "").trim().toUpperCase();
  var presetSize = String(qs.get("size") || "").trim();
  var conv = String(qs.get("conv") || "").trim().replace(/[^A-Za-z0-9_.-]/g, "");
  var psid = String(qs.get("psid") || "").trim().replace(/[^0-9]/g, "");
  // v65 (01/09): ghi kem MA PAGE. Thieu no, Desk khong biet gui bien nhan qua page nao nen khach dat
  // don xong khong nhan duoc gi (ca don ORD-1788263336892 cua anh Pham Quang Hiep 01/09 18:48).
  var pg = String(qs.get("pg") || "").trim().replace(/[^0-9]/g, "");
  var form = document.getElementById("m-order-form");
  var msgEl = document.getElementById("m-order-message");

  // Danh sach mon tren phieu: items= thang truoc, khong co thi roi ve p/size (link cu).
  var specs = [];
  var itemsParam = String(qs.get("items") || "").trim();
  if (itemsParam) {
    itemsParam.split("~").forEach(function (part) {
      var idx = part.indexOf(":");
      if (idx < 1) return;
      var c = part.slice(0, idx).trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
      if (c && specs.length < 5) specs.push({ code: c, presetSize: part.slice(idx + 1).trim() });
    });
  }
  if (!specs.length && code) specs.push({ code: code, presetSize: presetSize });

  var lines = []; // {product, bySize, sizeRows, select, noteEl, priceEl}

  function money(v) { return Number(v || 0).toLocaleString("vi-VN") + "đ"; }
  function esc(s) { return String(s || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // Gom size trung nhan (nhieu kho): cong qty. v66 (02/09, ca Ha Nguyen): cung MOT size co the co
  // nhieu kho voi GIA KHAC NHAU (IE0841: 1.250k vs 1.350k) — luon lay GIA THAP NHAT dang ban va giu
  // variant/kho tuong ung de don ghi dung nguon hang.
  function buildSizeRows(product) {
    var bySize = {};
    (product.sizes || []).forEach(function (row) {
      if (Number(row.qty) <= 0) return;
      var key = String(row.size || "").trim();
      if (!key) return;
      if (!bySize[key]) bySize[key] = { size: key, qty: 0, price: Number(row.salePrice || row.price || product.salePrice || product.price || 0), variantId: row.variantId || "", warehouseId: row.warehouseId || "", warehouse: row.warehouse || "" };
      bySize[key].qty += Number(row.qty || 0);
      var rowPrice = Number(row.salePrice || row.price || product.salePrice || product.price || 0);
      if (rowPrice > 0 && (!bySize[key].price || rowPrice < bySize[key].price)) {
        bySize[key].price = rowPrice;
        bySize[key].variantId = row.variantId || "";
        bySize[key].warehouseId = row.warehouseId || "";
        bySize[key].warehouse = row.warehouse || "";
      }
      // v28 (31/08): co SAN/ORDER theo landing — size co dong stockMode="ready" la hang san giao ngay.
      if (String(row.stockMode || "").toLowerCase() === "ready") bySize[key].ready = true;
    });
    return bySize;
  }

  function renderLine(product, spec, container) {
    var bySize = buildSizeRows(product);
    var sizeRows = Object.keys(bySize).map(function (k) { return bySize[k]; });
    var block = document.createElement("div");
    block.className = "card";
    var img = product.highImage || product.thumbnailImage || "";
    block.innerHTML = '<div class="prod">' + (img ? '<img src="' + esc(img) + '" alt="">' : "") +
      '<div><div class="n">' + esc(product.name) + '</div><div class="c">' + esc(product.code) + (product.brand ? " · " + esc(product.brand) : "") + '</div><div class="price">' + money(product.salePrice || product.price) + '</div></div></div>' +
      '<label>Size <span style="color:var(--acc);font-weight:600" data-role="size-price"></span></label>';
    var sel = document.createElement("select");
    sel.required = true;
    var empty = document.createElement("option");
    empty.value = ""; empty.textContent = "Chọn size";
    sel.appendChild(empty);
    sizeRows.forEach(function (row) {
      var opt = document.createElement("option");
      opt.value = row.size;
      opt.textContent = row.size + " — " + money(row.price);
      sel.appendChild(opt);
    });
    if (spec.presetSize && bySize[spec.presetSize]) sel.value = spec.presetSize;
    block.appendChild(sel);
    var noteEl = document.createElement("p");
    noteEl.className = "note";
    noteEl.style.cssText = "border-radius:8px;padding:9px 12px;margin:8px 0 0;display:none";
    block.appendChild(noteEl);
    container.appendChild(block);
    var line = { product: product, bySize: bySize, sizeRows: sizeRows, select: sel, noteEl: noteEl, priceEl: block.querySelector('[data-role="size-price"]'), headPriceEl: block.querySelector(".price") };
    sel.addEventListener("change", function () { updateLine(line); });
    updateLine(line);
    return line;
  }

  function updateLine(line) {
    var row = line.bySize[line.select.value];
    line.priceEl.textContent = row ? "· " + money(row.price) : "";
    if (row) line.headPriceEl.textContent = money(row.price);
    // v28 (31/08): bao ro loai hang cho size dang chon truoc khi khach dat.
    var allOrder = line.sizeRows.length && !line.sizeRows.some(function (r) { return r.ready; });
    if (!row && !allOrder) { line.noteEl.textContent = ""; line.noteEl.style.display = "none"; return; }
    line.noteEl.style.display = "";
    if (row && row.ready) {
      line.noteEl.style.background = "#eef8f0"; line.noteEl.style.border = "1px solid #bfe3c8"; line.noteEl.style.color = "#1f6b3a";
      line.noteEl.textContent = "🟢 Hàng sẵn — giao ngay, hỗ trợ đổi size.";
    } else {
      line.noteEl.style.background = "#eef3fb"; line.noteEl.style.border = "1px solid #c4d6f0"; line.noteEl.style.color = "#274b7a";
      line.noteEl.textContent = "🔵 Hàng order — hàng về 3-7 ngày, cần chuyển khoản trước tối thiểu 20% để giữ đơn (chọn ở bước thanh toán), không hỗ trợ đổi trả.";
    }
  }

  fetch("/api/products").then(function (r) { return r.json(); }).then(function (data) {
    var list = Array.isArray(data) ? data : (data.products || []);
    var container = document.getElementById("product-card");
    container.innerHTML = "";
    var missing = [];
    specs.forEach(function (spec) {
      var product = list.find(function (p) { return String(p.code || "").toUpperCase() === spec.code; });
      if (!product) { missing.push(spec.code); return; }
      lines.push(renderLine(product, spec, container));
    });
    if (missing.length) {
      var warn = document.createElement("div");
      warn.className = "card";
      warn.innerHTML = '<div class="prod"><div><b>Không tìm thấy sản phẩm ' + esc(missing.join(", ")) + '</b><div class="c">Bạn quay lại Messenger nhắn shop giúp nhé.</div></div></div>';
      container.appendChild(warn);
    }
    if (!lines.length) {
      if (!missing.length) container.innerHTML = '<div class="card"><div class="prod"><div><b>Thiếu thông tin sản phẩm</b><div class="c">Bạn quay lại Messenger nhắn shop giúp nhé.</div></div></div></div>';
      document.getElementById("submit-btn").disabled = true;
    }
  }).catch(function () { msgEl.textContent = "Không tải được dữ liệu sản phẩm — thử tải lại trang."; });

  // v22 (31/08): khach quen — Desk truyen san ten/SDT/dia chi don truoc qua query (n, ph, pv, dt, wd, ad, as).
  // Dien san + nhac khach XEM LAI; khach sua truc tiep duoc.
  (function prefillFromQuery() {
    var map = { n: "customerName", ph: "phone", pv: "province", dt: "district", wd: "ward", ad: "addressDetail" };
    var filled = false;
    Object.keys(map).forEach(function (key) {
      var value = String(qs.get(key) || "").trim();
      if (!value) return;
      var input = form.querySelector('[name="' + map[key] + '"]');
      if (input) { input.value = value; filled = true; }
    });
    var scheme = String(qs.get("as") || "").trim();
    if (scheme) {
      setTimeout(function () {
        var schemeInput = form.querySelector('[name="addressScheme"]');
        if (schemeInput) schemeInput.value = scheme;
      }, 800);
    }
    if (filled) {
      var notice = document.createElement("p");
      notice.className = "note";
      notice.style.cssText = "background:#fff8e6;border:1px solid #f0dfae;border-radius:8px;padding:10px 12px;color:#7a5b00;margin:10px 0 0";
      notice.textContent = "Em đã điền sẵn thông tin nhận hàng của bác — bác xem lại giúp em cho chính xác, có thay đổi thì sửa trực tiếp rồi hãy bấm Đặt đơn nhé ạ.";
      form.insertBefore(notice, form.firstChild);
    }
  })();
  if (window.TopRunAddressKit && TopRunAddressKit.bindAddressSelectors) TopRunAddressKit.bindAddressSelectors(form);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!lines.length) return;
    var data = Object.fromEntries(new FormData(form).entries());
    var items = [];
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      var row = line.bySize[line.select.value];
      if (!row) { msgEl.textContent = "Bạn chọn size cho " + line.product.name + " giúp shop nhé."; line.select.focus(); return; }
      items.push({
        productCode: line.product.code, productName: line.product.name, size: row.size, qty: 1,
        price: row.price, variantId: row.variantId, warehouseId: row.warehouseId, warehouse: row.warehouse,
        brand: line.product.brand || "", imageUrl: line.product.thumbnailImage || line.product.highImage || ""
      });
    }
    var tag = conv ? "[MSG:" + conv + (psid ? "|PSID:" + psid : "") + (pg ? "|PG:" + pg : "") + "] " : "";
    var idPart = items.map(function (it) { return it.productCode + it.size.replace(/[^0-9a-zA-Z]/g, ""); }).join("-");
    var payload = {
      items: items,
      customerName: data.customerName, phone: data.phone,
      province: data.province, district: data.district || "", ward: data.ward,
      addressDetail: data.addressDetail, addressScheme: data.addressScheme || "",
      note: (tag + String(data.note || "")).trim(),
      clientOrderId: "msg-" + (conv || "x") + "-" + idPart,
      paymentMethod: "", attribution: { source: "messenger" }
    };
    var btn = document.getElementById("submit-btn");
    btn.disabled = true; btn.textContent = "Đang gửi đơn…"; msgEl.textContent = "";
    fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (!res.body || res.body.ok !== true) {
          btn.disabled = false; btn.textContent = "Đặt đơn";
          msgEl.textContent = res.body && res.body.error === "invalid_order" ? "Thiếu hoặc sai thông tin — bạn kiểm tra SĐT và địa chỉ giúp shop nhé." : (res.status === 409 ? "Size vừa hết hàng, bạn quay lại Messenger để shop kiểm tra giúp nhé." : "Không gửi được đơn, thử lại giúp shop nhé.");
          return;
        }
        // BAN TACH: POST /api/orders tra { ok, id, token, total }. Ban cu tra ca `order`.
        var order = res.body.order || {
          id: res.body.id || "",
          total: Number(res.body.total || 0),
          lookupUrl: res.body.id && res.body.token
            ? "/order-status.html?order=" + encodeURIComponent(res.body.id) + "&token=" + encodeURIComponent(res.body.token)
            : ""
        };
        form.classList.add("hidden");
        var ok = document.getElementById("ok-box");
        ok.classList.remove("hidden");
        var itemsText = items.map(function (it) { return it.productName + " size " + it.size; }).join(" + ");
        var totalGuess = items.reduce(function (sum, it) { return sum + Number(it.price || 0); }, 0);
        document.getElementById("ok-detail").textContent = "Mã đơn " + (order.id || "") + " · " + itemsText + " · " + money(order.total || totalGuess) + ". Đơn trong dịp lễ sẽ được TopRun kiểm tra lại trước khi gửi đi.";
        var link = document.getElementById("ok-link");
        if (order.lookupUrl) { link.href = order.lookupUrl; } else { link.classList.add("hidden"); }
      })
      .catch(function () { btn.disabled = false; btn.textContent = "Đặt đơn"; msgEl.textContent = "Mạng chập chờn, thử lại giúp shop nhé."; });
  });
})();
