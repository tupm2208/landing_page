(() => {
  const endpoint = "/api/analytics/event";
  const attributionKey = "toprun_attribution_v1";
  const firstAttributionKey = "toprun_first_attribution_v1";

  function storageId(key, prefix) {
    try {
      let value = localStorage.getItem(key);
      if (!value) {
        value = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(key, value);
      }
      return value;
    } catch {
      return `${prefix}_anon`;
    }
  }

  function sessionId() {
    const key = "toprun_session";
    const now = Date.now();
    const timeoutMs = 30 * 60 * 1000;
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored.id && Number(stored.expiresAt || 0) > now) {
        stored.expiresAt = now + timeoutMs;
        localStorage.setItem(key, JSON.stringify(stored));
        return stored.id;
      }
      const next = {
        id: `session_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        expiresAt: now + timeoutMs
      };
      localStorage.setItem(key, JSON.stringify(next));
      return next.id;
    } catch {
      return `session_anon_${Math.floor(now / timeoutMs)}`;
    }
  }

  const visitorId = storageId("toprun_visitor_id", "visitor");
  const sentKeys = new Set();
  let cachedAttribution;

  function cleanAttribution(input = {}) {
    const clean = {};
    const fields = ["source", "medium", "campaign", "pageId", "postId", "commentId", "contentId", "topicId", "signature", "clickId", "capturedAt"];
    fields.forEach((field) => {
      const value = String(input[field] ?? "").trim();
      if (value) clean[field] = value.slice(0, field === "capturedAt" ? 40 : 160);
    });
    return clean;
  }

  function queryAttribution() {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("tr_campaign") && !params.get("utm_campaign")) return null;
    return cleanAttribution({
      source: params.get("tr_source") || params.get("utm_source") || "facebook",
      medium: params.get("tr_medium") || params.get("utm_medium") || "comment",
      campaign: params.get("tr_campaign") || params.get("utm_campaign"),
      pageId: params.get("tr_page"),
      postId: params.get("tr_post"),
      commentId: params.get("tr_comment"),
      contentId: params.get("tr_content"),
      topicId: params.get("tr_topic"),
      signature: params.get("tr_sig"),
      clickId: params.get("tr_click") || `click_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      capturedAt: new Date().toISOString()
    });
  }

  function readAttribution() {
    if (cachedAttribution !== undefined) return { ...cachedAttribution };
    const fromQuery = queryAttribution();
    try {
      if (fromQuery) {
        localStorage.setItem(attributionKey, JSON.stringify(fromQuery));
        if (!localStorage.getItem(firstAttributionKey)) localStorage.setItem(firstAttributionKey, JSON.stringify(fromQuery));
      }
      const stored = fromQuery || JSON.parse(localStorage.getItem(attributionKey) || "null");
      if (!stored) {
        cachedAttribution = {};
        return {};
      }
      const capturedAt = Date.parse(stored.capturedAt || 0);
      if (!capturedAt || Date.now() - capturedAt > 30 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(attributionKey);
        cachedAttribution = {};
        return {};
      }
      cachedAttribution = cleanAttribution(stored);
      return { ...cachedAttribution };
    } catch {
      cachedAttribution = fromQuery || {};
      return { ...cachedAttribution };
    }
  }

  function cleanPayload(payload = {}) {
    return Object.fromEntries(Object.entries(payload)
      .map(([key, value]) => [key, String(value ?? "").trim()])
      .filter(([, value]) => value)
      .slice(0, 16));
  }

  function track(eventName, payload = {}, options = {}) {
    const event = String(eventName || "").trim();
    if (!event) return;
    const dedupeKey = options.onceKey ? `${event}:${options.onceKey}` : "";
    if (dedupeKey && sentKeys.has(dedupeKey)) return;
    if (dedupeKey) sentKeys.add(dedupeKey);
    const body = JSON.stringify({
      event,
      visitorId,
      sessionId: sessionId(),
      path: window.location.pathname,
      query: window.location.search,
      referrer: document.referrer || "",
      title: document.title || "",
      attribution: readAttribution(),
      payload: cleanPayload(payload)
    });
    if (navigator.sendBeacon) {
      try {
        const ok = navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
        if (ok) return;
      } catch {}
    }
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    }).catch(() => {});
  }

  function orderAttribution() {
    const attribution = readAttribution();
    if (!Object.keys(attribution).length) return {};
    let first = {};
    try {
      first = cleanAttribution(JSON.parse(localStorage.getItem(firstAttributionKey) || "{}"));
      if (Date.now() - Date.parse(first.capturedAt || 0) > 30 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(firstAttributionKey);
        first = attribution;
        localStorage.setItem(firstAttributionKey, JSON.stringify(first));
      }
    } catch {}
    return {
      ...attribution,
      firstContentId: first.contentId || "",
      firstPostId: first.postId || "",
      firstTopicId: first.topicId || "",
      firstCapturedAt: first.capturedAt || "",
      visitorId,
      sessionId: sessionId()
    };
  }

  window.toprunAnalytics = { track, attribution: orderAttribution };
  window.addEventListener("DOMContentLoaded", () => {
    const attribution = readAttribution();
    if (attribution.clickId) {
      const clickKey = `toprun_source_click_${attribution.clickId}`;
      let recorded = false;
      try { recorded = sessionStorage.getItem(clickKey) === "1"; } catch {}
      if (!recorded) {
        track("source_click", {}, { onceKey: attribution.clickId });
        try { sessionStorage.setItem(clickKey, "1"); } catch {}
      }
    }
    track("page_view", {}, { onceKey: `${location.pathname}${location.search}` });
  });
})();
