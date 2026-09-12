const crypto = require("crypto");

const ACTIONS = {
  partner_has_stock: {
    label: "Co hang",
    status: "stock_confirmed",
    paymentStatus: "payment_pending",
    fulfillmentStatus: "stock_reserved",
    note: "Partner xac nhan co hang qua order status add-on."
  },
  partner_out_of_stock: {
    label: "Het hang",
    status: "partner_out_of_stock",
    fulfillmentStatus: "partner_out_of_stock",
    note: "Partner bao het hang qua order status add-on."
  },
  deposit_received: {
    label: "Da nhan coc",
    status: "deposit_received",
    paymentStatus: "payment_confirmed",
    note: "He thong/nhan vien xac nhan da nhan dat coc."
  },
  waiting_purchase: {
    label: "Cho mua hang",
    status: "waiting_purchase",
    fulfillmentStatus: "waiting_purchase",
    note: "Don da chuyen sang trang thai cho partner mua hang."
  },
  purchase_done: {
    label: "Da mua hang",
    status: "purchase_complete",
    fulfillmentStatus: "purchased",
    note: "Partner xac nhan da mua hang."
  },
  packed: {
    label: "Da dong hang",
    status: "ready_to_ship",
    fulfillmentStatus: "packed",
    note: "Partner xac nhan da dong hang."
  },
  shipped: {
    label: "Dang van chuyen",
    status: "shipped",
    fulfillmentStatus: "shipped",
    note: "Don da ban giao van chuyen."
  },
  delivered: {
    label: "Giao thanh cong",
    status: "completed",
    fulfillmentStatus: "delivered",
    note: "Don duoc xac nhan giao thanh cong."
  }
};

function createOrderStatusAddon(options = {}) {
  const env = options.env || process.env;
  const logger = options.logger || console;
  const fetchImpl = options.fetch || global.fetch;
  const enabled = truthy(env.ORDER_STATUS_ADDON_ENABLED);
  const telegramEnabled = enabled && truthy(env.ORDER_STATUS_TELEGRAM_ENABLED);
  const telegramToken = String(env.ORDER_STATUS_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || "").trim();
  const telegramPartnerChatId = String(env.ORDER_STATUS_PARTNER_TELEGRAM_CHAT_ID || env.ORDER_STATUS_TELEGRAM_CHAT_ID || "").trim();
  const telegramOpsChatId = String(env.ORDER_STATUS_OPS_TELEGRAM_CHAT_ID || env.TELEGRAM_ALERT_CHAT_ID || env.TELEGRAM_CHAT_ID || "").trim();
  const telegramWebhookSecret = String(env.ORDER_STATUS_TELEGRAM_WEBHOOK_SECRET || "").trim();
  const publicBaseUrl = String(env.ORDER_STATUS_PUBLIC_BASE_URL || env.LANDING_SITE_BASE_URL || "").replace(/\/+$/, "");
  const actionSecret = String(env.ORDER_STATUS_ACTION_SECRET || env.LANDING_ADMIN_TOKEN || env.LANDING_ORDERS_TOKEN || "").trim();
  const genericWebhookUrl = String(env.ORDER_STATUS_GENERIC_WEBHOOK_URL || "").trim();

  function isEnabled() {
    return enabled;
  }

  async function onOrderCreated(order) {
    if (!enabled) return { ok: false, skipped: true, reason: "ORDER_STATUS_ADDON_ENABLED is not enabled" };
    const results = [];
    results.push(await sendTelegramOrder(order, "partner"));
    if (telegramOpsChatId && telegramOpsChatId !== telegramPartnerChatId) {
      results.push(await sendTelegramOrder(order, "ops"));
    }
    results.push(await sendGenericWebhook("order.created", { order }));
    return summarizeResults(results);
  }

  async function onOrderUpdated(order, context = {}) {
    if (!enabled) return { ok: false, skipped: true, reason: "ORDER_STATUS_ADDON_ENABLED is not enabled" };
    const event = {
      type: "order.updated",
      order,
      action: context.action || "",
      actor: context.actor || "",
      note: context.note || ""
    };
    const results = [await sendGenericWebhook(event.type, event)];
    if (telegramEnabled && telegramOpsChatId && context.action) {
      results.push(await sendTelegramText(telegramOpsChatId, orderUpdateMessage(order, context)));
    }
    return summarizeResults(results);
  }

  async function handleTelegramWebhook(request, body, applyAction) {
    if (!enabled || !telegramEnabled) return { ok: false, status: 404, error: "addon_disabled" };
    if (telegramWebhookSecret) {
      const received = String(request.headers["x-telegram-bot-api-secret-token"] || "").trim();
      if (received !== telegramWebhookSecret) {
        return { ok: false, status: 401, error: "invalid_telegram_secret" };
      }
    }
    const query = body && body.callback_query;
    if (!query) return { ok: true, skipped: true };
    const parsed = parseCallbackData(query.data);
    if (!parsed.ok) {
      await answerCallbackQuery(query.id, "Lenh khong hop le.");
      return { ok: false, status: 400, error: parsed.error };
    }
    const result = await applyNamedAction(parsed.action, parsed.orderId, {
      actor: telegramActor(query),
      source: "telegram_callback",
      applyAction
    });
    await answerCallbackQuery(query.id, result.ok ? `Da cap nhat: ${actionLabel(parsed.action)}` : (result.message || "Cap nhat that bai."));
    return result;
  }

  async function handleSignedAction(query = {}, applyAction) {
    if (!enabled) return { ok: false, status: 404, error: "addon_disabled" };
    if (!actionSecret) return { ok: false, status: 503, error: "action_secret_not_configured" };
    const orderId = String(query.orderId || "").trim();
    const action = String(query.action || "").trim();
    const expires = Number(query.expires || 0);
    const signature = String(query.sig || "").trim();
    if (!orderId || !action || !expires || !signature) {
      return { ok: false, status: 400, error: "missing_signed_action_fields" };
    }
    if (Math.floor(Date.now() / 1000) > expires) {
      return { ok: false, status: 410, error: "signed_action_expired", message: "Link xac nhan da het han." };
    }
    const expected = signAction(orderId, action, expires, actionSecret);
    if (!timingSafeEqual(signature, expected)) {
      return { ok: false, status: 401, error: "invalid_signed_action" };
    }
    return applyNamedAction(action, orderId, {
      actor: "signed_action_link",
      source: "signed_action_link",
      applyAction
    });
  }

  async function applyNamedAction(action, orderId, context = {}) {
    const mapped = ACTIONS[action];
    if (!mapped) return { ok: false, status: 400, error: "unknown_action" };
    if (typeof context.applyAction !== "function") {
      return { ok: false, status: 500, error: "missing_apply_action" };
    }
    const update = {
      orderId,
      status: mapped.status,
      paymentStatus: mapped.paymentStatus,
      fulfillmentStatus: mapped.fulfillmentStatus,
      statusNote: mapped.note,
      orderStatusAddon: {
        action,
        source: context.source || "addon",
        actor: context.actor || "order-status-addon"
      }
    };
    const result = await context.applyAction(update);
    if (result && result.ok && result.order) {
      await onOrderUpdated(result.order, { action, actor: update.orderStatusAddon.actor, note: mapped.note });
    }
    return result;
  }

  function actionUrl(orderId, action) {
    if (!publicBaseUrl || !actionSecret) return "";
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const signature = signAction(orderId, action, expiresAt, actionSecret);
    const url = new URL(`${publicBaseUrl}/api/order-status-addon/action`);
    url.searchParams.set("orderId", orderId);
    url.searchParams.set("action", action);
    url.searchParams.set("expires", String(expiresAt));
    url.searchParams.set("sig", signature);
    return url.toString();
  }

  async function sendTelegramOrder(order, audience) {
    const chatId = audience === "partner" ? telegramPartnerChatId : telegramOpsChatId;
    if (!telegramEnabled || !telegramToken || !chatId) {
      return { ok: false, skipped: true, channel: `telegram:${audience}`, reason: "telegram channel is not configured" };
    }
    return sendTelegramText(chatId, orderPartnerMessage(order), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Co hang", callback_data: callbackData(order.id, "partner_has_stock") },
            { text: "Het hang", callback_data: callbackData(order.id, "partner_out_of_stock") }
          ],
          [
            { text: "Da mua", callback_data: callbackData(order.id, "purchase_done") },
            { text: "Da dong hang", callback_data: callbackData(order.id, "packed") }
          ]
        ]
      }
    });
  }

  async function sendTelegramText(chatId, text, extra = {}) {
    if (!fetchImpl || !telegramToken || !chatId) return { ok: false, skipped: true, channel: "telegram" };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetchImpl(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          protect_content: true,
          ...extra
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        return { ok: false, channel: "telegram", status: response.status, reason: payload.description || "telegram_failed" };
      }
      return { ok: true, channel: "telegram", status: response.status };
    } catch (error) {
      logger.warn?.("[order-status-addon] telegram failed:", error?.message || error);
      return { ok: false, channel: "telegram", reason: error?.message || String(error) };
    }
  }

  async function answerCallbackQuery(callbackQueryId, text) {
    if (!fetchImpl || !telegramToken || !callbackQueryId) return;
    await fetchImpl(`https://api.telegram.org/bot${telegramToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: String(text || "").slice(0, 180) })
    }).catch(() => {});
  }

  async function sendGenericWebhook(type, payload) {
    if (!enabled || !genericWebhookUrl || !fetchImpl) {
      return { ok: false, skipped: true, channel: "generic_webhook" };
    }
    try {
      const response = await fetchImpl(genericWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payload, sentAt: new Date().toISOString() })
      });
      return { ok: response.ok, channel: "generic_webhook", status: response.status };
    } catch (error) {
      return { ok: false, channel: "generic_webhook", reason: error?.message || String(error) };
    }
  }

  return {
    ACTIONS,
    isEnabled,
    onOrderCreated,
    onOrderUpdated,
    handleTelegramWebhook,
    handleSignedAction,
    applyNamedAction,
    actionUrl
  };
}

function callbackData(orderId, action) {
  return `os:${action}:${String(orderId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 28)}`.slice(0, 64);
}

function parseCallbackData(value) {
  const parts = String(value || "").split(":");
  if (parts.length !== 3 || parts[0] !== "os") return { ok: false, error: "invalid_callback_data" };
  return { ok: true, action: parts[1], orderId: parts[2] };
}

function telegramActor(query = {}) {
  const user = query.from || {};
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || user.username || user.id || "telegram_user";
}

function orderPartnerMessage(order = {}) {
  const items = (Array.isArray(order.items) ? order.items : []).map((item, index) =>
    `${index + 1}. ${item.productCode || "-"} - ${item.productName || "-"} | Size ${item.size || "-"} | SL ${item.qty || item.quantity || 1}`
  ).join("\n");
  return [
    `DON CAN XAC NHAN ${order.id || ""}`,
    `Khach: ${order.customerName || "-"} | ${order.phone || "-"}`,
    `Dia chi: ${order.address || "-"}`,
    "",
    items || "Khong co san pham",
    "",
    `Tong: ${formatVND(order.total)}`,
    "Vui long bam Co hang/Het hang de cap nhat he thong."
  ].join("\n");
}

function orderUpdateMessage(order = {}, context = {}) {
  return [
    `CAP NHAT DON ${order.id || ""}`,
    `Trang thai: ${order.status || "-"}`,
    `Thanh toan: ${order.paymentStatus || "-"}`,
    `Xu ly: ${order.fulfillmentStatus || "-"}`,
    `Tac vu: ${actionLabel(context.action)}`,
    `Nguoi cap nhat: ${context.actor || "-"}`
  ].join("\n");
}

function actionLabel(action) {
  return ACTIONS[action]?.label || action || "-";
}

function summarizeResults(results = []) {
  const flat = results.filter(Boolean);
  return {
    ok: flat.some((item) => item.ok),
    results: flat
  };
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function signAction(orderId, action, expiresAt, secret = process.env.ORDER_STATUS_ACTION_SECRET || process.env.LANDING_ADMIN_TOKEN || process.env.LANDING_ORDERS_TOKEN || "") {
  const payload = [orderId, action, expiresAt].join("|");
  return crypto.createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function formatVND(value) {
  return `${Number(value || 0).toLocaleString("vi-VN")} VND`;
}

module.exports = {
  ACTIONS,
  createOrderStatusAddon
};
