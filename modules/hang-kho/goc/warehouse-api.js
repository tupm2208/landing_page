/*
 * warehouse-api.js — lớp dịch cho trang kho (`warehouse.html` chép từ Sales Desk), 16/09/2026.
 *
 * Desk chạy trang này trên một tệp JSON riêng, tồn giữ ở MỨC SẢN PHẨM trong hai ngăn `readyStock`
 * / `orderStock`. Landing giữ tồn ở MỨC SIZE × KHO (`hang_kho_bien_the`) và mọi thay đổi đi qua sổ
 * biến động. Tệp này chạy trước `warehouse.js`, bọc `fetch`: `/api/warehouse/*` được dịch sang các
 * đường thật, và trạng thái trả về được dựng lại đúng hình dạng trang đọc.
 *
 * Hai ngăn của trang = nguồn của dòng tồn: "kho sẵn" là dòng nguồn `ready`, "kho order" là dòng
 * nguồn khác (`own`, `campaign`). Ghi vào một ngăn thì ghi vào kho của dòng đang có trong ngăn đó;
 * size chưa từng có thì vào kho mặc định của ngăn.
 */
(function () {
  "use strict";

  const realFetch = window.fetch.bind(window);
  const text = (v) => String(v == null ? "" : v).trim();
  const lower = (v) => text(v).toLowerCase();
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const list = (v) => (Array.isArray(v) ? v : []);
  const enc = encodeURIComponent;

  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  class ServerError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }

  async function call(method, path, body) {
    const response = await realFetch(path, {
      method, credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (response.status === 401) { location.replace("/admin-login"); throw new ServerError(401, "chua_dang_nhap", "Phiên đăng nhập đã hết."); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (payload && payload.ok === false)) {
      const detail = payload.message || (list(payload.ketQua).find((r) => r && r.ok === false) || {}).message || payload.error;
      throw new ServerError(response.status, payload.error || payload.reason || "loi_may_chu", detail || `Máy chủ trả mã ${response.status}`);
    }
    return payload;
  }

  // ---------------------------------------------------------------- the page's state

  let last = { products: [] };
  const isReady = (size) => size.nguon === "ready" || size.stockMode === "ready";

  async function defaultWarehouses() {
    const kho = list((await call("GET", "/api/hang-kho/kho").catch(() => ({ kho: [] }))).kho);
    const ready = kho.find((k) => list(k.sources).includes("ready"));
    const order = kho.find((k) => list(k.sources).includes("own"));
    return { ready: ready ? ready.id : "wh_kho_san", order: order ? order.id : "wh_kho_order" };
  }

  function adaptProduct(item) {
    const bySize = new Map();
    let ready = 0, order = 0;
    for (const s of list(item.sizes)) {
      const key = text(s.size);
      if (!bySize.has(key)) bySize.set(key, { id: `${item.code}|${key}`, size: key, readyStock: 0, orderStock: 0, price: num(s.price), barcode: "", color: "", note: "", rows: [] });
      const v = bySize.get(key);
      if (isReady(s)) { v.readyStock += num(s.qty); ready += num(s.qty); } else { v.orderStock += num(s.qty); order += num(s.qty); }
      v.rows.push({ warehouseId: s.warehouseId, qty: num(s.qty), ready: isReady(s), source: s.nguon || (isReady(s) ? "ready" : "own") });
    }
    return {
      id: item.code, sku: item.code, name: item.name, brand: item.brand, category: item.category || item.productKind,
      productLine: "", gender: item.gender, price: num(item.price), cost: 0, unit: "đôi",
      imageUrl: item.thumbnailImage || item.highImage || "", images: list(item.galleryImages),
      source: item.source, sourceName: item.sourceName, status: item.status, description: item.description || "",
      readyStock: ready, orderStock: order, variants: [...bySize.values()],
      webTags: [], hardTags: [], surfaceTags: [], benefitTags: [], riskTags: [], customerSegments: [], playStyleTags: [], contentAngles: [], viralHooks: []
    };
  }

  async function buildState() {
    const [items, contacts, orders, returns, people, receipts] = await Promise.all([
      call("GET", "/api/admin/products?limit=20000"),
      call("GET", "/api/admin/so-khach").catch(() => ({ khach: [] })),
      call("GET", "/api/orders?limit=200").catch(() => []),
      call("GET", "/api/admin/hoan-hang").catch(() => ({ hoanHang: [] })),
      call("GET", "/api/admin/nguoi").catch(() => ({ nguoi: [] })),
      call("GET", "/api/hang-kho/phieu-nhap").catch(() => ({ phieu: [] }))
    ]);
    const returnsByOrder = new Map();
    for (const r of list(returns.hoanHang)) {
      if (!returnsByOrder.has(r.maDon)) returnsByOrder.set(r.maDon, []);
      returnsByOrder.get(r.maDon).push(r);
    }
    last = {
      products: list(items).map(adaptProduct),
      customers: list(contacts.khach).map((c) => ({ id: c.ma, name: c.ten, phone: c.dienThoai, address: c.diaChi, note: c.ghiChu })),
      orders: list(orders).filter((o) => !o.daXoa).map((o) => ({
        id: o.id, code: o.id, customerId: "", customerName: o.customerName, warehouse: "order", status: o.status,
        total: num(o.total), createdAt: o.createdAt,
        lines: list(o.items).map((l) => ({ productId: l.productCode, sku: l.productCode, productName: l.productName, size: l.size, quantity: num(l.quantity || l.qty), price: num(l.price), maDong: l.maDong })),
        returns: (returnsByOrder.get(o.id) || []).map((r) => ({ productId: "", maDong: r.maDong, quantity: r.soLuong, createdAt: r.luc }))
      })),
      users: list(people.nguoi).map((p) => ({ id: p.id, name: p.name, phone: p.login, role: p.role === "chu-shop" ? "admin" : "sales", active: p.active, permissions: [] })),
      importOrders: list(receipts.phieu).map((r) => ({ id: r.id, code: r.id, supplier: r.supplier, note: r.note, totalQuantity: r.totalQuantity, totalCost: r.totalCost, lines: r.lines }))
    };
    return last;
  }

  const productOf = (id) => last.products.find((p) => p.id === id || lower(p.sku) === lower(id));

  /** Where a bucket write lands, for one size: the row already there (its warehouse AND source), else the bucket's default. */
  async function placeFor(productId, size, bucket) {
    const product = productOf(productId);
    const variant = product && product.variants.find((v) => lower(v.size) === lower(size));
    const rows = variant ? variant.rows.filter((r) => r.ready === (bucket === "ready")).sort((a, b) => b.qty - a.qty) : [];
    if (rows[0] && rows[0].warehouseId) return { maKho: rows[0].warehouseId, nguon: rows[0].source };
    const defaults = await defaultWarehouses();
    return bucket === "ready" ? { maKho: defaults.ready, nguon: "ready" } : { maKho: defaults.order, nguon: "own" };
  }

  const done = async (message) => { const state = await buildState(); return reply({ ok: true, data: state, state, message }); };

  async function adjust(productId, size, bucket, quantity, note) {
    if (!text(size)) throw new ServerError(400, "thieu_size", "Chọn size — tồn giữ theo từng size.");
    await call("POST", "/api/hang-kho/dieu-chinh-ton", { ma: productId, size, ...(await placeFor(productId, size, bucket)), soLuong: quantity, ghiChu: note || "" });
  }

  // ---------------------------------------------------------------- the routes

  const routes = {
    "GET /api/warehouse/state": async () => { const state = await buildState(); return reply({ ok: true, data: state }); },

    "POST /api/warehouse/stock": async (b) => { await adjust(b.productId, b.size, b.warehouse, num(b.quantity), b.note); return done("Đã cập nhật tồn kho."); },
    "POST /api/warehouse/variant-stock": async (b) => { await adjust(b.productId || b.sku, b.size, b.warehouse, num(b.quantity), b.note); return done("Đã nhập kho theo size."); },
    "POST /api/warehouse/variant-stock/bulk": async (b) => {
      const dong = [];
      for (const item of list(b.items)) dong.push({ ma: item.productId || item.sku, size: item.size, ...(await placeFor(item.productId || item.sku, item.size, item.warehouse)), soLuong: num(item.quantity), ghiChu: item.note || "" });
      await call("POST", "/api/hang-kho/dieu-chinh-ton", { dong });
      return done("Đã nhập kho hàng loạt.");
    },
    "POST /api/warehouse/import-orders": async (b) => {
      const dong = [];
      for (const line of list(b.lines)) {
        dong.push({ ma: line.productId || line.sku, size: line.size, ...(await placeFor(line.productId || line.sku, line.size, line.warehouse)), soLuong: num(line.quantity), giaVon: num(line.cost), ghiChu: line.note || "" });
      }
      await call("POST", "/api/hang-kho/phieu-nhap", { nhaCungCap: b.supplier || "", ghiChu: [b.code, b.note].filter(Boolean).join(" · "), dong });
      return done("Đã tạo đơn nhập và cộng tồn kho.");
    },
    "POST /api/warehouse/transfers/order-to-ready": async (b) => {
      if (!text(b.size)) throw new ServerError(400, "thieu_size", "Chọn size cần chuyển.");
      const from = await placeFor(b.productId, b.size, "order");
      const to = await placeFor(b.productId, b.size, "ready");
      await call("POST", "/api/hang-kho/chuyen-kho", {
        ma: b.productId, size: b.size, tuKho: from.maKho, tuNguon: from.nguon, denKho: to.maKho, denNguon: to.nguon,
        soLuong: num(b.quantity), ghiChu: b.note || ""
      });
      return done("Đã chuyển sang kho sẵn.");
    },

    "POST /api/warehouse/orders": async (b) => {
      // The page sells PRODUCTS; the shelf holds SIZES. Each line is spread over the sizes that have
      // stock in the chosen bucket, fullest first — the same pairs the page's totals counted.
      const items = [];
      for (const line of list(b.lines)) {
        const product = productOf(line.productId);
        if (!product) throw new ServerError(404, "khong_thay", `Không thấy sản phẩm ${line.productId}.`);
        let left = Math.max(1, num(line.quantity));
        const field = b.warehouse === "ready" ? "readyStock" : "orderStock";
        for (const v of [...product.variants].sort((x, y) => y[field] - x[field])) {
          if (left <= 0 || v[field] <= 0) continue;
          const take = Math.min(left, v[field]);
          items.push({ productCode: product.sku, productName: product.name, size: v.size, qty: take, price: num(line.price) || product.price });
          left -= take;
        }
        if (left > 0) throw new ServerError(409, "khong_du_ton", `${product.sku}: kho ${b.warehouse === "ready" ? "sẵn" : "order"} không đủ ${line.quantity} đôi.`);
      }
      await call("POST", "/api/orders/thu-cong", { customerName: b.customerName || "Khách lẻ", note: `Tạo từ trang kho (${b.warehouse === "ready" ? "kho sẵn" : "kho order"})`, items });
      return done("Đã tạo đơn và trừ kho.");
    },
    "POST /api/warehouse/returns": async (b) => {
      const order = last.orders.find((o) => o.id === b.orderId);
      const line = order && order.lines.find((l) => l.productId === b.productId || l.maDong === b.productId);
      if (!line) throw new ServerError(404, "khong_thay_dong", "Không thấy dòng hàng trong đơn.");
      await call("POST", `/api/orders/${enc(order.id)}/dong/${enc(line.maDong)}/tra-hang`, {
        soLuong: num(b.quantity), maKho: (await placeFor(line.productId, line.size, "ready")).maKho, ghiChu: "Hoàn từ trang kho"
      });
      return done("Đã hoàn hàng về kho sẵn.");
    },

    "POST /api/warehouse/customers": async (b) => {
      await call("POST", "/api/admin/so-khach", { ma: b.id || "", ten: b.name, dienThoai: b.phone, diaChi: b.address, ghiChu: b.note });
      return done("Đã lưu khách hàng.");
    },

    "POST /api/warehouse/products": async (b) => {
      const code = text(b.sku);
      if (!code || !text(b.name)) throw new ServerError(400, "thieu_ma_ten", "Sản phẩm cần mã SKU và tên.");
      const existing = productOf(code);
      if (!existing) {
        // A new item: written as house stock with its sizes (the order bucket); ready sizes follow as adjustments.
        const sizes = list(b.variants).filter((v) => text(v.size)).map((v) => ({ size: v.size, qty: num(v.orderStock), price: num(v.price) || num(b.price), warehouseId: "" }));
        const defaults = await defaultWarehouses();
        await call("PUT", `/api/hang-kho/mon/${enc(code)}`, {
          code, name: b.name, brand: b.brand, productKind: b.category, gender: b.gender, description: b.description,
          thumbnailImage: b.imageUrl, status: b.status || "orderable",
          sizes: sizes.map((s) => ({ ...s, warehouseId: defaults.order }))
        });
        await buildState();
        for (const v of list(b.variants)) if (num(v.readyStock) > 0) await adjust(code, v.size, "ready", num(v.readyStock), "Tạo sản phẩm từ trang kho");
        return done("Đã lưu sản phẩm.");
      }
      const edit = { ma: code, ten: b.name };
      if (num(b.price) > 0 && num(b.price) !== existing.price) edit.gia = num(b.price);
      if (b.status) edit.trangThai = b.status === "hidden" ? "hidden" : "orderable";
      await call("POST", "/api/hang-kho/sua-nhanh", { mon: [edit] });
      // Stock typed into the size rows: the DIFFERENCE goes through the stock book, bucket by bucket.
      for (const v of list(b.variants)) {
        const current = existing.variants.find((x) => lower(x.size) === lower(v.size)) || { readyStock: 0, orderStock: 0 };
        const dReady = num(v.readyStock) - current.readyStock;
        const dOrder = num(v.orderStock) - current.orderStock;
        if (dReady) await adjust(code, v.size, "ready", dReady, "Sửa tồn trên trang kho");
        if (dOrder) await adjust(code, v.size, "order", dOrder, "Sửa tồn trên trang kho");
      }
      return done("Đã lưu sản phẩm.");
    },
    "POST /api/warehouse/product-images": async (b) => {
      await call("POST", `/api/hang-kho/mon/${enc(b.productId)}/anh`, { anh: `data:${b.contentType || "image/png"};base64,${b.dataBase64}`, chinh: b.primary === true });
      return done("Đã lưu ảnh vào server.");
    },

    "POST /api/warehouse/users": async () => {
      throw new ServerError(409, "quan_ly_o_trang_quan_tri", "Người dùng quản lý ở trang quản trị: /admin/nguoi (tài khoản, vai trò, máy được vào).");
    },
    "POST /api/warehouse/reset-demo": async () => { throw new ServerError(409, "khong_dung", "Trang kho dùng dữ liệu thật — không có dữ liệu mẫu để reset."); },
    "POST /api/warehouse/order-sideview-images": async () => { throw new ServerError(409, "khong_dung", "Ảnh side view do Image Tool đẩy qua danh mục, không tải ở đây."); },
    "POST /api/realtime-stock/sync-order-warehouse": async () => reply({ ok: true, data: { message: "Tra tồn đọc thẳng từ kho — không cần đồng bộ." }, result: { message: "Tra tồn đọc thẳng từ kho — không cần đồng bộ." } })
  };

  window.fetch = async function (input, init) {
    const url = new URL(typeof input === "string" ? input : input.url, location.origin);
    const method = String((init && init.method) || "GET").toUpperCase();
    const handler = url.origin === location.origin ? routes[`${method} ${url.pathname}`] : undefined;
    if (!handler) return realFetch(input, init);
    let body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (_) { body = {}; }
    try {
      return await handler(body, url);
    } catch (e) {
      if (e instanceof ServerError) return reply({ ok: false, error: e.code, message: e.message }, e.status || 500);
      return reply({ ok: false, error: "loi_lop_dich", message: e && e.message ? e.message : String(e) }, 500);
    }
  };
})();
