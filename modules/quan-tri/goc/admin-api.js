/*
 * admin-api.js — lớp dịch cho màn quản trị web cũ (16/09/2026).
 *
 * `admin.js` là bản CHÉP NGUYÊN của web đang chạy: nó gọi các đường cũ (`/api/admin/orders`,
 * `/api/admin/operations`, `/api/admin/fanpage`...) và đọc hình dạng cũ (`{ok, data}`). Máy chủ mới
 * chia các việc đó cho từng module với tên trường khác. Thay vì sửa 4.272 dòng, tệp này chạy TRƯỚC
 * `admin.js`, bọc `window.fetch`: lời gọi kiểu cũ được đổi sang đường mới, câu trả lời mới được
 * dựng lại đúng hình dạng cũ. Lời gọi nào không có trong bảng dưới thì đi thẳng, không đụng tới.
 *
 * Không có hàng lệnh Sales Desk nữa: landing là người ghi duy nhất, nên mọi "operation" được làm
 * NGAY bằng đường thật của máy chủ, và lỗi của máy chủ (vd. "chưa mua đủ") hiện nguyên văn.
 */
(function () {
  "use strict";

  const realFetch = window.fetch.bind(window);
  const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

  // ---------------------------------------------------------------- helpers

  const text = (v) => String(v == null ? "" : v).trim();
  const lower = (v) => text(v).toLowerCase();
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const list = (v) => (Array.isArray(v) ? v : []);
  const enc = encodeURIComponent;

  function reply(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
  }
  const ok = (data, extra = {}) => reply({ ok: true, data, ...extra });
  const fail = (status, error, message, extra = {}) => reply({ ok: false, error, message, ...extra }, status);

  /** One call to the NEW server. Throws `ServerError` with the server's own message when refused. */
  async function call(method, path, body) {
    const response = await realFetch(path, {
      method, credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (payload && payload.ok === false)) {
      throw new ServerError(response.status, payload.error || payload.viSao || "loi_may_chu", payload.message || payload.viSao || payload.error || `Máy chủ trả mã ${response.status}`);
    }
    return payload;
  }

  class ServerError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }

  // ---------------------------------------------------------------- caches

  let ordersPromise = null;
  let partnersPromise = null;
  const secrets = new Map();   // orderId -> lookupSecret (only known right after creation)

  const invalidate = () => { ordersPromise = null; };

  function orders() {
    if (!ordersPromise) {
      ordersPromise = call("GET", "/api/orders?limit=500&daXoa=tat-ca").then((rows) => list(rows).map(adaptOrder)).catch((e) => { ordersPromise = null; throw e; });
    }
    return ordersPromise;
  }

  function partnerRows() {
    if (!partnersPromise) {
      partnersPromise = call("GET", "/api/admin/partners").then((rows) => list(rows)).catch((e) => { partnersPromise = null; throw e; });
      setTimeout(() => { partnersPromise = null; }, 60000);
    }
    return partnersPromise;
  }

  async function freshOrder(id) {
    const order = await call("GET", `/api/orders/${enc(id)}`);
    return adaptOrder(order.order || order);
  }

  // ---------------------------------------------------------------- orders: new -> old shape

  function adaptOrder(o) {
    const order = { ...o };
    order.customer = { name: o.customerName, phone: o.phone, email: o.email, address: o.address, province: o.province, district: o.district, ward: o.ward, addressDetail: o.addressDetail };
    order.externalId = o.id;
    order.sourceOrderId = o.id;
    order.channel = /^MAN-/.test(text(o.id)) ? "manual" : "web";
    order.externalSource = "toprun.site";
    order.statusBeforeQuickUpdate = o.statusTruocDoiNhanh || "";
    order.deletedAt = o.daXoa ? (o.xoaLuc || new Date().toISOString()) : null;
    order.sourceOrderStatus = o.status === "returned_to_stock" ? "cancelled" : "";
    order.shippingStatus = "";
    order.carrier = o.shippingProvider || "";
    order.shippingFee = num(o.shippingFee);
    order.addressScheme = !text(o.district) && text(o.province) && text(o.ward) ? "two_tier" : "";
    order.canonicalVersion = 0;
    order.onlineOrderVersion = 0;
    if (secrets.has(o.id)) order.lookupSecret = secrets.get(o.id);
    order.publicLookupUrl = `${location.origin}/order-status.html?order=${enc(o.id)}`;
    order.statusLogs = list(o.statusLogs);
    order.items = list(o.items).map((item) => ({
      ...item,
      sku: item.productCode,
      quantity: num(item.quantity || item.qty) || 1,
      partnerIds: item.partnerId ? [item.partnerId] : [],
      procurement: item.khoaKho ? [{ quantity: Math.max(1, num(item.daMua)) }] : []
    }));
    return order;
  }

  async function lineOf(orderId, lineIndex, productCode, size) {
    const order = await freshOrder(orderId);
    const line = order.items[num(lineIndex)];
    if (!line) throw new ServerError(409, "order_line_conflict", "Dòng hàng đã thay đổi — tải lại đơn rồi thử lại.");
    if ((productCode && lower(line.productCode) !== lower(productCode)) || (size !== undefined && size !== "" && lower(line.size) !== lower(size))) {
      throw new ServerError(409, "order_line_conflict", "Dòng hàng đã thay đổi — tải lại đơn rồi thử lại.");
    }
    return { order, line };
  }

  /** Warehouse id -> the partner who buys from it (running site's matching rule). */
  async function partnerForWarehouse(warehouseId, warehouseName) {
    const rows = (await partnerRows()).filter((p) => text(p.trang_thai || "active") === "active");
    const norm = (v) => lower(v).replace(/^partner_/, "").replace(/^wh_/, "").replace(/[^a-z0-9]+/g, "");
    return rows.find((p) => p.ma === `partner_${warehouseId}`)
      || rows.find((p) => norm(p.ma) === norm(warehouseId))
      || (warehouseName ? rows.find((p) => norm(p.ten) === norm(warehouseName)) : undefined)
      || null;
  }

  async function selectWarehouse(payload) {
    const { order, line } = await lineOf(payload.orderId, payload.lineIndex, payload.productCode, payload.size);
    const warehouseId = text(payload.warehouseId);
    const partner = warehouseId ? await partnerForWarehouse(warehouseId, payload.warehouseName) : null;
    if (warehouseId && !partner && !/^wh_toprun/.test(warehouseId) && warehouseId !== "wh_external") {
      throw new ServerError(422, "warehouse_partner_not_found", `Kho ${payload.warehouseName || warehouseId} chưa gắn với đối tác mua hộ nào.`);
    }
    await call("PATCH", `/api/orders/${enc(order.id)}/dong/${enc(line.maDong)}`, {
      maDoiTac: partner ? partner.ma : "", maKho: warehouseId, tenKho: text(payload.warehouseName) || (partner ? partner.ten : "")
    });
    return "Đã chọn kho cho dòng hàng.";
  }

  async function pushPurchase(payload) {
    const { order, line } = await lineOf(payload.orderId, payload.lineIndex, payload.productCode, payload.size);
    await call("PATCH", `/api/orders/${enc(order.id)}/dong/${enc(line.maDong)}`, { dayMua: payload.action !== "undo" });
    return payload.action === "undo" ? "Đã huỷ đẩy mua." : "Đã đẩy mua cho đối tác.";
  }

  function paymentStatusFor(amount, total) {
    if (amount <= 0) return "payment_pending";
    return amount >= total ? "paid" : "partially_paid";
  }

  const HEAD_KEYS = ["customerName", "phone", "address", "province", "district", "ward", "addressDetail", "note", "paymentMethod", "trackingCode"];

  function itemsChanged(sent, current) {
    const key = (i) => [lower(i.productCode || i.sku), lower(i.size), num(i.quantity || i.qty) || 1, num(i.price)].join("|");
    const a = list(sent).map(key).sort().join(";");
    const b = list(current).map(key).sort().join(";");
    return a !== b;
  }

  /** THE translator of an old order update ({orderId, status, paymentStatus, ...}) into the new calls. */
  async function updateOrder(body) {
    const id = text(body.orderId || body.id);
    if (!id) throw new ServerError(422, "missing_order_id", "Thiếu mã đơn.");
    const order = await freshOrder(id);
    const messages = [];

    // 1. the head: only what really changed
    const patch = {};
    for (const k of HEAD_KEYS) if (body[k] !== undefined && text(body[k]) !== text(order[k])) patch[k] = body[k];
    const provider = body.shippingProvider !== undefined ? body.shippingProvider : body.carrier;
    if (provider !== undefined && text(provider) !== text(order.shippingProvider)) patch.shippingProvider = provider;
    if (body.fulfillmentStatus !== undefined && text(body.fulfillmentStatus) !== text(order.fulfillmentStatus)) patch.fulfillmentStatus = body.fulfillmentStatus;
    const amountGiven = body.paymentAmount !== undefined || body.paidAmount !== undefined;
    if (amountGiven) {
      const amount = Math.max(0, num(body.paymentAmount !== undefined ? body.paymentAmount : body.paidAmount));
      const wantedStatus = paymentStatusFor(amount, num(order.total));
      if (amount !== num(order.paymentAmount) || wantedStatus !== paymentStatusFor(num(order.paymentAmount), num(order.total))) {
        patch.paymentAmount = amount;
        patch.paymentStatus = wantedStatus;
      }
    } else if (body.paymentStatus === "payment_confirmed" && num(order.paidAmount) <= 0) {
      patch.paymentAmount = num(order.total);
      patch.paymentStatus = "paid";
    }
    if (Array.isArray(body.items) && itemsChanged(body.items, order.items)) {
      patch.items = body.items.map((i) => ({ productCode: i.productCode || i.sku, productName: i.productName, size: i.size, qty: num(i.quantity || i.qty) || 1, price: num(i.price) }));
    }
    if (Object.keys(patch).length) {
      const saved = await call("PUT", `/api/orders/${enc(id)}`, patch);
      if (saved.stock && list(saved.stock.thieu).length) messages.push(`${saved.stock.thieu.length} dòng ngoài kho / thiếu tồn.`);
    }

    // 2. an order-level warehouse: onto every open line that has none yet
    const warehouseId = text(body.warehouseId);
    if (warehouseId) {
      for (let i = 0; i < order.items.length; i += 1) {
        const line = order.items[i];
        if (line.khoaKho || text(line.warehouseId) === warehouseId) continue;
        try { await selectWarehouse({ orderId: id, lineIndex: i, warehouseId, warehouseName: body.warehouseName }); } catch (e) { messages.push(e.message); }
      }
    }

    // 3. the status: through the doors that keep the workflow's rules
    const status = text(body.status);
    if (status && status !== order.status) {
      const note = text(body.statusNote);
      const actions = list(order.viecLamDuoc);
      if (order.daXoa) {
        await call("POST", `/api/orders/${enc(id)}/khoi-phuc`, {});
      } else if (status === order.statusTruocDoiNhanh && actions.includes("hoan-tac")) {
        await call("POST", `/api/orders/${enc(id)}/viec`, { viec: "hoan-tac", ghiChu: note });
      } else if (status === "confirmed_by_customer") {
        await call("POST", `/api/orders/${enc(id)}/viec`, { viec: "xac-nhan", ghiChu: note });
      } else if (status === "ready_to_ship") {
        const forced = /bắt buộc|bat buoc/i.test(note);
        await call("POST", `/api/orders/${enc(id)}/viec`, { viec: forced ? "cho-ship-bat-buoc" : "san-sang-giao", ghiChu: note });
      } else if (status === "completed") {
        await call("POST", `/api/orders/${enc(id)}/viec`, { viec: "hoan-tat", ghiChu: note });
      } else if (status === "cancelled") {
        const ended = await call("POST", `/api/orders/${enc(id)}/ket-thuc`, { cach: "huy", lyDo: note || "Huỷ từ màn quản trị web" });
        if (list(ended.canNguoiLam).length) messages.push(`Còn phải làm tay: ${ended.canNguoiLam.join("; ")}`);
      } else {
        await call("PATCH", `/api/orders/${enc(id)}`, { status, note });
      }
    }
    invalidate();
    return ["Đã cập nhật đơn.", ...messages].join(" ");
  }

  async function createOrder(payload) {
    const created = await call("POST", "/api/orders/thu-cong", {
      customerName: payload.customerName, phone: payload.phone, address: payload.address, province: payload.province,
      district: payload.district, ward: payload.ward, addressDetail: payload.addressDetail, note: payload.note,
      paymentAmount: num(payload.paymentAmount || payload.paidAmount), total: payload.total,
      items: list(payload.items).map((i) => ({ productCode: i.productCode, productName: i.productName, size: i.size, qty: num(i.quantity || i.qty) || 1, price: num(i.price) }))
    });
    if (created.lookupSecret) secrets.set(created.orderId, created.lookupSecret);
    invalidate();
    const missing = created.stock && list(created.stock.thieu).length ? ` (${created.stock.thieu.length} dòng ngoài kho)` : "";
    return { message: `Đã tạo đơn ${created.orderId}${missing}.`, orderId: created.orderId, lookupSecret: created.lookupSecret };
  }

  // ---------------------------------------------------------------- products

  async function productsAndWarehouses() {
    const [items, partners] = await Promise.all([call("GET", "/api/admin/products?limit=20000"), partnerRows().catch(() => [])]);
    const nameOf = (warehouseId) => {
      const p = partners.find((row) => row.ma === `partner_${warehouseId}`);
      return p ? p.ten : warehouseId;
    };
    return list(items).map((item) => {
      const stockIds = {};
      const meta = new Map();
      const sizes = list(item.sizes).map((s) => {
        const wid = text(s.warehouseId);
        if (wid) {
          stockIds[wid] = (stockIds[wid] || 0) + num(s.qty);
          if (!meta.has(wid)) meta.set(wid, { id: wid, name: nameOf(wid), active: true });
        }
        return { ...s, stock: num(s.qty), warehouseName: nameOf(wid), warehouse: nameOf(wid) };
      });
      return { ...item, sizes, warehouseStockIds: stockIds, warehouseMeta: [...meta.values()] };
    });
  }

  // ---------------------------------------------------------------- partners

  async function partnersView() {
    const rows = await partnerRows();
    const portals = await Promise.all(rows.map((row) => call("GET", `/api/admin/mua-ho/portal?doiTac=${enc(row.ma)}`).catch(() => null)));
    let syncedAt = "";
    const purchases = [];
    const partners = rows.map((row, i) => {
      const portal = portals[i] || { needs: [], purchases: [], summary: {} };
      if (portal.generatedAt && portal.generatedAt > syncedAt) syncedAt = portal.generatedAt;
      for (const s of list(portal.purchases)) {
        purchases.push({ ...s, partnerId: row.ma, totalCost: list(s.lines).reduce((sum, l) => sum + num(l.lineTotal), 0) });
      }
      return {
        id: row.ma, name: row.ten, login: row.dang_nhap || "", status: row.trang_thai || "active",
        portalPath: row.ma_cong ? `/partner/${enc(row.ma_cong)}` : "",
        needs: list(portal.needs),
        missingQty: list(portal.needs).reduce((sum, n) => sum + num(n.missingQty), 0),
        purchaseCount: list(portal.purchases).length,
        debtAmount: num(portal.summary && portal.summary.debtAmount)
      };
    });
    purchases.sort((a, b) => text(b.createdAt).localeCompare(text(a.createdAt)));
    return { partners, purchases, syncedAt: syncedAt || new Date().toISOString() };
  }

  // ---------------------------------------------------------------- fanpage

  const pending = [];   // replies the page sent that the server has not confirmed yet

  async function fanpageView() {
    const listing = await call("GET", "/api/hop-thu/hoi-thoai?limit=100");
    const threads = list(listing.hoiThoai);
    const details = await Promise.all(threads.slice(0, 40).map((t) => call("GET", `/api/hop-thu/hoi-thoai/${enc(t.ma)}`).then((r) => r.hoiThoai).catch(() => null)));
    const byId = new Map(details.filter(Boolean).map((d) => [d.ma, d]));
    let syncedAt = "";
    const pendingReplies = [...pending];
    const conversations = threads.map((t) => {
      if (text(t.hoatDongLuc) > syncedAt) syncedAt = text(t.hoatDongLuc);
      const detail = byId.get(t.ma);
      const messages = list(detail && detail.tin).slice(-30).map((m) => ({
        id: m.maTin, text: m.chu || (m.soAnh ? `[${m.soAnh} ảnh]` : ""), direction: m.chieu === "di" ? "out" : "in", fromAdmin: m.chieu === "di", createdAt: m.luc
      }));
      for (const m of list(detail && detail.tin)) {
        if (m.chieu === "di" && m.trangThai === "cho-gui") pendingReplies.push({ conversationId: t.ma, text: m.chu, status: "pending", error: "" });
        if (m.chieu === "di" && m.trangThai === "hong") pendingReplies.push({ conversationId: t.ma, text: m.chu, status: "rejected", error: "gửi hỏng" });
      }
      return {
        id: t.ma, pageId: t.trang, customerId: t.nguoi, customerName: t.tenNguoi || "",
        pageName: t.kenh === "facebook" ? "Fanpage" : t.kenh === "facebook-binh-luan" ? "Bình luận" : t.kenh,
        lastMessage: t.tinCuoi, updatedAt: t.hoatDongLuc,
        phone: detail ? detail.dienThoai || "" : "", address: detail ? detail.diaChi || "" : "",
        messages
      };
    });
    // `syncedAt` is shown to the person ("Sync 08:58 17-09"), so it stays a plain time; what the long
    // poll compares also counts threads and unconfirmed replies.
    lastFanpageMark = `${syncedAt}|${threads.length}|${pending.length}`;
    return { source: threads.length ? "hop-thu" : "none", syncedAt, conversations, pendingReplies };
  }

  let lastFanpageMark = "";

  async function waitFanpage(since, timeoutMs) {
    const until = Date.now() + Math.min(Math.max(1000, num(timeoutMs) || 25000), 30000);
    const startMark = lastFanpageMark;
    for (;;) {
      const view = await fanpageView();
      if (view.syncedAt !== since || (startMark && lastFanpageMark !== startMark) || Date.now() >= until) return view;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }

  async function sendReply(payload) {
    const conversationId = text(payload.conversationId);
    const entry = { requestId: payload.requestId, conversationId, text: payload.text || "", imageUrl: payload.imageUrl || "", createdAt: new Date().toISOString(), status: "pending", error: "" };
    pending.push(entry);
    try {
      const imageUrl = text(payload.imageUrl);
      await call("POST", "/api/hop-thu/gui", {
        kenh: conversationId.split(":")[0] || "facebook", nguoi: payload.customerId, chu: payload.text || "",
        ...(imageUrl ? { anhUrl: /^https?:/i.test(imageUrl) ? imageUrl : `${location.origin}${imageUrl}` } : {}),
        maHoiThoai: conversationId
      });
      pending.splice(pending.indexOf(entry), 1);
      return "Đã gửi tin cho khách.";
    } catch (e) {
      entry.status = "rejected";
      entry.error = e.message;
      throw e;
    }
  }

  // ---------------------------------------------------------------- CTV

  const DEVICE_STATUS = { "cho-duyet": "pending", "da-duyet": "approved", "bi-chan": "revoked" };

  async function ctvView() {
    const [accounts, logs] = await Promise.all([call("GET", "/api/admin/ctv"), call("GET", "/api/admin/ctv/nhat-ky?limit=500").catch(() => ({ dong: [] }))]);
    const devices = list(accounts.thietBi);
    return {
      accounts: list(accounts.ctv).map((c) => ({
        id: c.ma, affiliateId: c.ma, name: c.ten, phone: c.dienThoai, email: c.email, username: c.tenDangNhap, code: c.maGioiThieu,
        active: c.dangBat !== false, allowNoLogo: c.choBoLogo === true,
        devices: devices.filter((d) => d.maCtv === c.ma).map((d) => ({ id: d.ma, label: d.nhan || text(d.trinhDuyet).slice(0, 60), ip: d.diaChiIp, requestedAt: d.xinLuc, status: DEVICE_STATUS[d.trangThai] || d.trangThai }))
      })),
      logs: list(logs.dong).map((r) => ({ at: r.luc, ctvId: r.maCtv, productCode: r.maHang, imageIndex: r.soAnh }))
    };
  }

  // ---------------------------------------------------------------- SPX export (built in the browser)

  function codFor(order) {
    const total = Math.max(0, num(order.total));
    if (order.remainingAmount !== undefined && order.remainingAmount !== null) return Math.min(total, Math.max(0, num(order.remainingAmount)));
    return Math.max(0, total - num(order.paidAmount));
  }

  const xmlEscape = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function columnName(index) { let name = ""; let v = index; while (v > 0) { v -= 1; name = String.fromCharCode(65 + (v % 26)) + name; v = Math.floor(v / 26); } return name; }
  function cell(col, row, value, style) {
    const s = style ? ` s="${style}"` : "";
    if (value === null || value === undefined || value === "") return `<c r="${col}${row}"${s}/>`;
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${col}${row}"${s}><v>${value}</v></c>`;
    return `<c r="${col}${row}"${s} t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
  }
  const rowXml = (r, values, style) => `<row r="${r}">${Object.entries(values).map(([c, v]) => cell(c, r, v, style)).join("")}</row>`;

  const SPX_HEADERS = ["STT", "*Tên người nhận", "*Số điện thoại", "*Tỉnh/Thành Phố", "*Quận/Huyện", "*Xã/Phường", "*Địa chỉ chi tiết",
    "Lưu ý về địa chỉ", "Mã bưu chính", "*Tên sản phẩm", "Số lượng", "Giá tiền", "*Tổng cân nặng bưu gửi (KG)",
    "Chiều dài (CM)", "Chiều rộng (CM)", "Chiều cao (CM)", "Mã khách hàng", "*Giá trị đơn hàng",
    "*Giao hàng một phần (Y/N)", "*Cho phép thử hàng (Y/N)", "*Cho xem hàng, không cho thử (Y/N)",
    "Thu phí từ chối nhận hàng (Y/N)", "Phí từ chối nhận hàng cần thu", "*Thu COD (Y/N)", "Số tiền COD",
    "Bưu gửi giá trị cao (Y/N)", "*Hình thức thanh toán", "Lưu ý giao hàng"];

  function spxRow(order, r, seq) {
    const items = list(order.items);
    const c = order.customer || {};
    const total = Math.max(0, num(order.total));
    const cod = codFor(order);
    return rowXml(r, {
      A: seq, B: order.customerName || c.name || "", C: order.phone || c.phone || "",
      D: text(order.province || c.province), E: text(order.district || c.district), F: text(order.ward || c.ward),
      G: text(order.addressDetail || c.addressDetail || order.address || c.address), H: "", I: "",
      J: items.map((i) => `${i.productCode || ""} ${i.productName || ""} size ${i.size || "-"} x${i.quantity || i.qty || 1}`.trim()).join("; ") || "Hàng hóa TopRun",
      K: items.reduce((s, i) => s + Math.max(1, num(i.quantity || i.qty || 1)), 0) || 1,
      L: total, M: 1, N: 15, O: 15, P: 15, Q: order.id || "", R: total,
      S: "N", T: "N", U: "Y", V: "Y", W: 40000,
      X: cod > 0 ? "Y" : "N", Y: cod > 0 ? cod : "", Z: "N",
      AA: ["sender", "shop", "seller", "nguoi_gui"].includes(lower(order.shippingPayer || order.shippingPaymentPayer)) ? "Người gửi trả" : "Người nhận trả",
      AB: order.shippingNote || order.note || ""
    });
  }

  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  /** A stored (uncompressed) zip — enough for an .xlsx, no library. */
  function zip(files) {
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
      const nameBytes = encoder.encode(name);
      const data = encoder.encode(content);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true);
      entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true); entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const centralSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    const count = Object.keys(files).length;
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, count, true); end.setUint16(10, count, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function spxExport(ordersToExport) {
    const chosen = list(ordersToExport).filter((o) => o && o.id);
    if (!chosen.length) return fail(422, "missing_orders", "Chọn ít nhất một đơn để xuất Excel SPX.");
    const errors = [];
    for (const o of chosen) {
      const c = o.customer || {};
      if (!text(o.customerName || c.name)) errors.push(`${o.id}: thiếu tên khách`);
      if (!text(o.phone || c.phone)) errors.push(`${o.id}: thiếu số điện thoại`);
      if (!text(o.address || c.address)) errors.push(`${o.id}: thiếu địa chỉ`);
    }
    if (errors.length) return fail(422, "invalid_orders", errors.slice(0, 8).join("\n"), { errors });
    const header = Object.fromEntries(SPX_HEADERS.map((v, i) => [columnName(i + 1), v]));
    const rows = [rowXml(1, header, 1), ...chosen.map((o, i) => spxRow(o, i + 2, i + 1))].join("");
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const blob = zip({
      "[Content_Types].xml": `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      "_rels/.rels": `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/workbook.xml": `${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Đơn hàng SPX" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      "xl/styles.xml": `${xml}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F6B45"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf></cellXfs></styleSheet>`,
      "xl/worksheets/sheet1.xml": `${xml}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="7" customWidth="1"/><col min="2" max="3" width="18" customWidth="1"/><col min="4" max="7" width="24" customWidth="1"/><col min="8" max="28" width="18" customWidth="1"/></cols><sheetData>${rows}</sheetData><autoFilter ref="A1:AB${chosen.length + 1}"/></worksheet>`
    });
    const fileName = `SPX_toprun_admin_${new Date().toISOString().slice(0, 10)}_${chosen.length}-don.xlsx`;
    return new Response(blob, { status: 200, headers: { "Content-Type": blob.type, "Content-Disposition": `attachment; filename*=UTF-8''${enc(fileName)}` } });
  }

  // ---------------------------------------------------------------- the route table

  const routes = {
    "GET /api/admin/overview": async () => {
      const [items, all, partners, needs, threads, analytics] = await Promise.all([
        call("GET", "/api/admin/products?limit=20000").catch(() => []),
        orders(),
        partnerRows().catch(() => []),
        call("GET", "/api/admin/mua-ho").catch(() => ({ canMua: [] })),
        call("GET", "/api/hop-thu/hoi-thoai?limit=300").catch(() => ({ hoiThoai: [] })),
        call("GET", "/api/admin/analytics?days=30").catch(() => ({ data: { totals: {}, attribution: [] } }))
      ]);
      const live = all.filter((o) => !o.daXoa);
      const ended = new Set(["completed", "cancelled", "soft_deleted", "returned_to_stock"]);
      return ok({
        metrics: {
          products: list(items).length, visibleProducts: list(items).filter((p) => p.status !== "hidden").length,
          orders: live.length, activeOrders: live.filter((o) => !ended.has(o.status)).length,
          partners: list(partners).length, purchaseNeeds: list(needs.canMua).reduce((s, n) => s + num(n.soLuong), 0),
          conversations: list(threads.hoiThoai).length
        },
        analytics: analytics.data || { totals: {}, attribution: [] },
        generatedAt: new Date().toISOString()
      });
    },

    "GET /api/admin/products": async () => { const data = await productsAndWarehouses(); return ok(data, { count: data.length }); },
    "POST /api/admin/products": async (body) => {
      const edit = { ma: text(body.code) };
      if (body.status !== undefined) edit.trangThai = body.status;
      if (text(body.name)) edit.ten = body.name;
      if (num(body.price) > 0) edit.gia = num(body.price);
      const r = await call("POST", "/api/hang-kho/sua-nhanh", { mon: [edit] });
      if (list(r.khongThay).length) return fail(404, "product_not_found", "Không tìm thấy sản phẩm.");
      return ok(null, { message: "Đã lưu sản phẩm." });
    },

    "GET /api/admin/orders": async () => { const data = await orders(); return ok(data, { count: data.length, generatedAt: new Date().toISOString() }); },
    "GET /api/admin/operations": async () => {
      const [data, partners] = await Promise.all([orders(), partnerRows().catch(() => [])]);
      const now = new Date().toISOString();
      return ok({
        orders: data,
        procurementPartners: partners.map((p) => ({ id: p.ma, name: p.ten, status: p.trang_thai === "active" ? "active" : "inactive", warehouseId: text(p.ma).replace(/^partner_/, "") })),
        procurementPurchases: [], partnerFeePayments: [], commands: [], syncedAt: now, updatedAt: now
      });
    },
    "POST /api/admin/orders": async (body) => ok(null, { message: await updateOrder(body) }),
    "POST /api/admin/orders/delete": async (body) => {
      const id = text(body.orderId);
      const op = text(body.operation);
      if (op === "soft_delete") await call("DELETE", `/api/orders/${enc(id)}`);
      else if (op === "restore") await call("POST", `/api/orders/${enc(id)}/khoi-phuc`, {});
      else if (op === "purge") await call("DELETE", `/api/orders/${enc(id)}/vinh-vien`);
      else return fail(422, "invalid_operation", "Thao tác không hợp lệ.");
      invalidate();
      return reply({ ok: true, operation: op, orderId: id, message: op === "soft_delete" ? "Đã xóa đơn (vào thùng rác)." : op === "restore" ? "Đã khôi phục đơn." : "Đã xóa vĩnh viễn." });
    },
    "POST /api/admin/operations": async (body) => {
      const payload = body.payload || {};
      let message = "";
      switch (text(body.type)) {
        case "admin_order.update_requested": message = await updateOrder(payload); break;
        case "admin_order.create_requested": message = (await createOrder(payload)).message; break;
        case "admin_order.warehouse_selected": message = await selectWarehouse(payload); invalidate(); break;
        case "admin_order.purchase_requested": message = await pushPurchase(payload); invalidate(); break;
        case "fanpage.reply_requested": message = await sendReply(payload); break;
        case "ctv_account.create_requested": message = "OK"; break;
        case "affiliate_payment.create_requested": {
          const paid = await call("POST", "/api/admin/ctv/thanh-toan", { maCtv: payload.affiliateId, soTien: num(payload.amount), ghiChu: payload.note || "" });
          message = paid.message || "Đã ghi thanh toán tiền công.";
          break;
        }
        default: return fail(422, "invalid_operation_type", `Thao tác "${text(body.type)}" không còn dùng.`);
      }
      return reply({ ok: true, accepted: true, appliedOnline: true, message });
    },
    "POST /api/admin/shipping/export-spx": async (body) => spxExport(body.orders),

    "POST /api/content": async (body) => { const r = await call("POST", "/api/content", body); return reply({ ok: true, content: r.noiDung }); },

    "GET /api/admin/partners": async () => ok(await partnersView()),

    "GET /api/admin/fanpage": async () => ok(await fanpageView()),
    "GET /api/admin/fanpage/wait": async (_body, url) => ok(await waitFanpage(url.searchParams.get("since") || "", url.searchParams.get("timeoutMs"))),
    "POST /api/admin/fanpage/contact": async (body) => {
      await call("POST", `/api/hop-thu/hoi-thoai/${enc(text(body.conversationId))}/lien-he`, { dienThoai: body.phone, diaChi: body.address });
      return ok(null, { message: "Đã lưu thông tin khách." });
    },
    "POST /api/admin/fanpage/orders": async (body) => {
      const created = await createOrder({ ...body, note: `Tạo từ fanpage ${text(body.conversationId)}` });
      return reply({ ok: true, message: created.message, order: { id: created.orderId } }, 201);
    },

    "GET /api/admin/ctv": async () => ok(await ctvView()),
    "GET /api/admin/ctv/commissions": async () => ok((await call("GET", "/api/admin/ctv/hoa-hong")).data),
    "POST /api/admin/ctv": async (body) => {
      const r = await call("POST", "/api/admin/ctv", { ten: body.name || body.phone || body.email, dienThoai: body.phone, email: body.email, tenDangNhap: body.username, matKhau: body.password });
      const c = r.ctv || {};
      return ok({ id: c.ma, name: c.ten, phone: c.dienThoai, email: c.email, username: c.tenDangNhap, code: c.maGioiThieu });
    },
    "POST /api/admin/ctv/update": async (body) => {
      const patch = { ma: body.id };
      if (body.active !== undefined) patch.dangBat = body.active === true;
      if (body.allowNoLogo !== undefined) patch.choBoLogo = body.allowNoLogo === true;
      await call("POST", "/api/admin/ctv", patch);
      return ok(null, { message: "Đã cập nhật cộng tác viên." });
    },
    "POST /api/admin/ctv/device": async (body) => {
      await call("POST", "/api/admin/ctv/thiet-bi", { ma: body.deviceId, viec: body.action === "approve" ? "duyet" : "chan" });
      return ok(null);
    },
    "POST /api/admin/ctv/delete": async (body) => { await call("POST", "/api/admin/ctv/xoa", { ma: body.id }); return ok(null, { message: "Đã xoá cộng tác viên." }); }
  };

  window.fetch = async function (input, init) {
    const url = new URL(typeof input === "string" ? input : input.url, location.origin);
    const method = String((init && init.method) || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    const handler = url.origin === location.origin ? routes[`${method} ${url.pathname}`] : undefined;
    if (!handler) return realFetch(input, init);
    let body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (_) { body = {}; }
    try {
      return await handler(body, url);
    } catch (e) {
      if (e instanceof ServerError) return fail(e.status || 500, e.code, e.message);
      return fail(500, "loi_lop_dich", e && e.message ? e.message : String(e));
    }
  };

  // For the tests: the translator's pieces, without a browser.
  window.__adminApi = { adaptOrder, spxExport, paymentStatusFor, routes };
})();
