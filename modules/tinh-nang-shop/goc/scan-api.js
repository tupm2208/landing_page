/*
 * scan-api.js — lớp dịch cho trang quét tem (`scan.html` / `scan.js` chép nguyên văn từ Sales Desk), 17/09/2026.
 *
 * Desk chạy trang này trên máy chủ riêng: tồn "hàng sẵn" giữ theo chi nhánh trong một tệp JSON, đọc
 * tem bằng OCR offline + AI dự phòng, đăng nhập thiết bị bằng ADMIN_ACCESS_TOKEN. Landing giữ tồn ở
 * MỨC SIZE × KHO (`hang_kho_bien_the`, nguồn `ready`), mọi thay đổi đi qua sổ biến động, đọc tem do
 * Xeon làm (tốn tiền mỗi lần), và đăng nhập là phiên quản trị (cookie).
 *
 * Tệp này chạy TRƯỚC `scan.js`, bọc `fetch`: các đường Desk được dịch sang đường thật và trả về đúng
 * hình dạng `scan.js` đọc.
 *
 * Chi nhánh của Desk = kho (`ma_kho`) của landing. `scan.js` so `variant.branchId.toLowerCase()` với
 * mã chi nhánh đang chọn, nên mã đưa cho trang là CHỮ THƯỜNG; lớp này đổi lại mã thật trước khi gửi.
 */
(function () {
  "use strict";

  // Trang Desk hỏi mã truy cập khi không chạy trên localhost. Ở landing, quyền là phiên quản trị:
  // đặt sẵn một giá trị để trang bỏ qua ô nhập mã; 401 thật thì chuyển về trang đăng nhập.
  try { localStorage.setItem("toprunScanAdminToken", "phien"); } catch (_) { /* chế độ riêng tư */ }

  const realFetch = window.fetch.bind(window);
  const text = (v) => String(v == null ? "" : v).trim();
  const lower = (v) => text(v).toLowerCase();
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const list = (v) => (Array.isArray(v) ? v : []);
  const enc = encodeURIComponent;

  const ANALYZE_GAP_MS = 2500;
  const DEFAULT_WAREHOUSE = "wh_kho_san";

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
      const failedLine = list(payload.ketQua).find((r) => r && r.ok === false) || {};
      const detail = payload.message || failedLine.message || payload.viSao || payload.error;
      throw new ServerError(response.status, payload.error || payload.reason || "loi_may_chu", detail || `Máy chủ trả mã ${response.status}`);
    }
    return payload;
  }

  // ---------------------------------------------------------------- warehouses (= Desk branches)

  /** lowercase id the page holds -> the real warehouse id the server wants. */
  const realWarehouse = new Map();
  const warehouseOf = (branchId) => realWarehouse.get(lower(branchId)) || text(branchId) || DEFAULT_WAREHOUSE;

  async function loadBranches() {
    const kho = list((await call("GET", "/api/hang-kho/kho").catch(() => ({ kho: [] }))).kho);
    // Kho đang giữ hàng sẵn lên trước — trang chọn chi nhánh đầu tiên làm mặc định.
    const sorted = [...kho].sort((a, b) => Number(list(b.sources).includes("ready")) - Number(list(a.sources).includes("ready")));
    const branches = sorted.map((k) => {
      const id = text(k.id);
      realWarehouse.set(lower(id), id);
      const note = list(k.sources).includes("ready") ? "hàng sẵn" : "";
      return { id: lower(id), name: note ? `${id} (${note} · ${num(k.pairs)} đôi)` : `${id} (${num(k.pairs)} đôi)`, active: true };
    });
    if (!branches.length) {
      realWarehouse.set(DEFAULT_WAREHOUSE, DEFAULT_WAREHOUSE);
      branches.push({ id: DEFAULT_WAREHOUSE, name: "Kho sẵn", active: true });
    }
    return branches;
  }

  async function readyItems() {
    return list((await call("GET", "/api/hang-kho/theo-nguon/ready?limit=2000")).mon);
  }

  const isReadySize = (s) => !s || s.nguon === undefined || s.nguon === "" || s.nguon === "ready";

  async function buildReadyStock() {
    const [branches, items] = await Promise.all([loadBranches(), readyItems()]);
    const products = items.map((item) => ({
      code: text(item.code),
      name: text(item.name),
      variants: list(item.sizes).filter(isReadySize).map((s) => {
        const id = text(s.warehouseId);
        if (id && !realWarehouse.has(lower(id))) realWarehouse.set(lower(id), id);
        return { branchId: lower(id), size: text(s.size), qty: num(s.qty), salePrice: num(s.price || s.salePrice) };
      })
    }));
    return { branches, products };
  }

  // ---------------------------------------------------------------- reading a tag (costs money)

  let lastAnalyzeAt = 0;
  let analyzeInFlight = false;
  const nothingRead = () => reply({ ok: true, code: "", codeConfidence: "none", codeCandidates: [], knownProduct: null, size: "", sizeOptions: [], engine: "xeon", elapsedMs: 0 });

  function cameraRunning() {
    const video = document.getElementById("scan-video");
    return Boolean(video && video.srcObject);
  }

  async function analyze(body) {
    // Camera rà liên tục gửi một khung mỗi 0,7 giây; mỗi lần đọc thật là một lần gọi AI có tính tiền.
    // Khi camera đang chạy: tối đa một lần thật mỗi 2,5 giây, các khung còn lại trả "chưa đọc được".
    // Ảnh chụp / chọn từ máy (camera tắt) luôn được đọc.
    const now = Date.now();
    if (cameraRunning() && (analyzeInFlight || now - lastAnalyzeAt < ANALYZE_GAP_MS)) return nothingRead();
    lastAnalyzeAt = now;
    analyzeInFlight = true;
    try {
      const result = await call("POST", "/api/tinh-nang-shop/quet-tem/doc", { anh: text(body.imageBase64), maKho: warehouseOf(body.branchId) });
      return reply({ engine: "xeon", elapsedMs: 0, codeCandidates: [], sizeOptions: [], ...result, ok: true });
    } finally {
      analyzeInFlight = false;
      lastAnalyzeAt = Date.now();
    }
  }

  // ---------------------------------------------------------------- goods-in and stocktake

  async function knownCodes(codes) {
    const known = new Set(readyCodesCache);
    const missing = codes.filter((c) => !known.has(lower(c)));
    for (const code of missing) {
      const found = await call("GET", `/api/admin/products?q=${enc(code)}&limit=5`).catch(() => []);
      const rows = Array.isArray(found) ? found : list(found.mon || found.items);
      if (rows.some((row) => lower(row.code) === lower(code))) known.add(lower(code));
    }
    return known;
  }

  let readyCodesCache = new Set();

  async function importLines(body) {
    const lines = list(body.lines).filter((l) => text(l.code) && text(l.size) && num(l.qty) > 0);
    if (!lines.length) throw new ServerError(400, "khong_co_dong", "Phiên chưa có dòng nào để ghi.");
    readyCodesCache = new Set((await readyItems().catch(() => [])).map((item) => lower(item.code)));
    const known = await knownCodes([...new Set(lines.map((l) => text(l.code)))]);

    // Mã chưa có: tạo món trước (mỗi mã một lần, đủ các size đang nhập, tồn 0) rồi phiếu nhập mới cộng tồn.
    const fresh = new Map();
    for (const line of lines) {
      if (known.has(lower(line.code))) continue;
      const code = text(line.code);
      if (!fresh.has(code)) fresh.set(code, { name: text(line.name) || code, listPrice: 0, sizes: new Map() });
      const entry = fresh.get(code);
      if (text(line.name)) entry.name = text(line.name);
      if (num(line.listPrice) > 0) entry.listPrice = num(line.listPrice);
      if (num(line.salePrice) <= 0) throw new ServerError(400, "thieu_gia_ban", `Mã mới ${code} cần giá bán.`);
      entry.sizes.set(lower(line.size), {
        size: text(line.size), qty: 0, price: num(line.salePrice),
        ...(num(line.listPrice) > 0 ? { listPrice: num(line.listPrice) } : {}),
        warehouseId: warehouseOf(line.branchId)
      });
    }
    for (const [code, entry] of fresh) {
      await call("PUT", `/api/hang-kho/mon/${enc(code)}`, {
        code, name: entry.name, status: "orderable",
        ...(entry.listPrice > 0 ? { listPrice: entry.listPrice } : {}),
        sizes: [...entry.sizes.values()]
      });
    }

    const outcome = await call("POST", "/api/hang-kho/phieu-nhap", {
      nhaCungCap: "Quét tem",
      ghiChu: text(body.note),
      dong: lines.map((l) => ({
        ma: text(l.code), size: text(l.size), maKho: warehouseOf(l.branchId),
        soLuong: Math.trunc(num(l.qty)), giaVon: Math.max(0, Math.round(num(l.costPrice))), nguon: "ready"
      }))
    });
    return reply({ ok: true, receipt: outcome, created: [...fresh.keys()], message: `Đã ghi phiếu nhập ${outcome.id || ""}`.trim() });
  }

  async function stocktake(body) {
    const maKho = warehouseOf(body.branchId);
    const dong = list(body.adjustments)
      .filter((a) => text(a.code) && text(a.size) && Math.trunc(num(a.delta)) !== 0)
      .map((a) => ({ ma: text(a.code), size: text(a.size), maKho, soLuong: Math.trunc(num(a.delta)), ghiChu: text(body.note), nguon: "ready" }));
    if (!dong.length) return reply({ ok: true, applied: 0 });
    const outcome = await call("POST", "/api/hang-kho/dieu-chinh-ton", { dong });
    return reply({ ok: true, applied: dong.length, ketQua: outcome.ketQua });
  }

  // ---------------------------------------------------------------- the routes

  const routes = {
    "GET /api/ready-stock/state": async () => reply({ ok: true, readyStock: await buildReadyStock() }),
    "GET /api/scan-tem/lan-info": async () => reply({ ok: true, urls: [] }),
    "POST /api/scan-tem/analyze": async (b) => analyze(b),
    "GET /api/scan-tem/product": async (_b, url) => {
      const code = text(url.searchParams.get("code"));
      const maKho = warehouseOf(url.searchParams.get("branchId"));
      try {
        const payload = await call("GET", `/api/tinh-nang-shop/quet-tem/mon?ma=${enc(code)}&maKho=${enc(maKho)}`);
        return reply({ ok: true, knownProduct: payload.knownProduct || null });
      } catch (e) {
        if (e instanceof ServerError && e.status === 404) return reply({ ok: true, knownProduct: null });
        throw e;
      }
    },
    // Desk học lại vị trí đọc trên tem từ lần sửa. Xeon chưa có cửa học — ghi nhận tại chỗ, không gửi.
    "POST /api/scan-tem/correction": async () => reply({ ok: true, learned: false }),
    "POST /api/ready-stock/import": async (b) => importLines(b),
    "POST /api/scan-tem/stocktake-apply": async (b) => stocktake(b)
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
      if (e instanceof ServerError) return reply({ ok: false, error: e.code, message: e.message }, e.status === 401 ? 403 : (e.status || 500));
      return reply({ ok: false, error: "loi_lop_dich", message: e && e.message ? e.message : String(e) }, 500);
    }
  };
})();
