/**
 * WEB ANALYTICS — the way of counting, the signature, and the door's bouncer.
 *
 * No MySQL needed: `analyticsReport` takes a reader, so these tests hand it rows.
 *
 * The most valuable test in this file is the one about ALIASES. Sales Desk reads "page views" as
 * the first numeric value among `pageViews / pageviews / page_view / views / visits`. Answer with
 * only `page_views` (plural) and the screen shows a confident 0 over a table full of data — which
 * is exactly the failure this whole module was written to end.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  analyticsReport, clampDays, dayKeysOf, DEFAULT_DAYS, MAX_DAYS, toDayKey,
  type ReportReader
} from "../dist/modules/thong-ke/report.js";
import { attributionKey, normaliseAttribution, verifiedAttribution } from "../dist/modules/thong-ke/attribution.js";
import { AbuseGate, eventName, likelyBot, productCode } from "../dist/modules/thong-ke/incoming.js";

const NOW = new Date("2026-09-15T10:00:00.000Z");

/** A reader that answers nothing, with the pieces a test cares about overridden. */
function reader(over: Partial<ReportReader> = {}): ReportReader {
  return {
    eventsByDay: async () => [],
    uniquesByDay: async () => [],
    uniquesInPeriod: async () => ({ uniqueVisitors: 0, sessions: 0 }),
    products: async () => [],
    productCoverageFrom: async () => "",
    recent: async () => [],
    attribution: async () => [],
    attributionProducts: async () => [],
    ...over
  };
}

const run = (over: Partial<ReportReader> = {}, days: number | string = 7) =>
  analyticsReport({ reader: reader(over), now: NOW, days });

// ---------- the day window ----------

test("the window covers `days` days ending today, in UTC, with no day missing", () => {
  const keys = dayKeysOf(NOW, 3);
  assert.deepEqual(keys, ["2026-09-13", "2026-09-14", "2026-09-15"]);
});

test("a quiet day is present with zeros — a chart with holes reads as a broken report", async () => {
  const report = await run({ eventsByDay: async () => [{ day: "2026-09-15", event: "page_view", count: 5 }] }, 3);
  assert.deepEqual(report.days.map((d) => d.day), ["2026-09-13", "2026-09-14", "2026-09-15"]);
  assert.equal(report.days[1]!["page_view"], 0);
  assert.equal(report.days[2]!["page_view"], 5);
});

test("`days` is clamped: garbage falls back to the default, huge asks stop at a year", () => {
  assert.equal(clampDays(undefined), DEFAULT_DAYS);
  assert.equal(clampDays("khong-phai-so"), DEFAULT_DAYS);
  assert.equal(clampDays(0), DEFAULT_DAYS);
  assert.equal(clampDays(-5), DEFAULT_DAYS);
  assert.equal(clampDays(7), 7);
  assert.equal(clampDays(100000), MAX_DAYS);
});

test("a day key survives whatever MySQL hands back", () => {
  assert.equal(toDayKey("2026-09-15"), "2026-09-15");
  assert.equal(toDayKey("2026-09-15 07:30:00"), "2026-09-15");
  assert.equal(toDayKey(new Date("2026-09-15T07:30:00Z")), "2026-09-15");
  assert.equal(toDayKey(""), "");
});

// ---------- the aliases ----------

test("page views are answered under EVERY name Sales Desk looks for — `page_view` included", async () => {
  const report = await run({ eventsByDay: async () => [{ day: "2026-09-15", event: "page_view", count: 12 }] }, 1);
  for (const alias of ["page_view", "pageViews", "page_views", "visits"]) {
    assert.equal(report.totals[alias], 12, `totals.${alias}`);
    assert.equal(report.days[0]![alias], 12, `days[0].${alias}`);
  }
});

test("BREAKS if `page_view` (singular) is ever dropped: Sales Desk would show a zero over real data", async () => {
  // app.js:7968 — firstNumericValue(source, "pageViews", "pageviews", "page_view", "views", "visits").
  // `page_views` is NOT in that list. This asserts the singular key exists on its own.
  const report = await run({ eventsByDay: async () => [{ day: "2026-09-15", event: "page_view", count: 9 }] }, 1);
  const seenBySalesDesk = ["pageViews", "pageviews", "page_view", "views", "visits"]
    .map((k) => report.totals[k])
    .find((v) => typeof v === "number" && Number.isFinite(v));
  assert.equal(seenBySalesDesk, 9, "Sales Desk must find a number under one of ITS names");
});

test("visitors are answered under all three names, and per-session is rounded to one decimal", async () => {
  const report = await run({
    eventsByDay: async () => [{ day: "2026-09-15", event: "page_view", count: 10 }],
    uniquesInPeriod: async () => ({ uniqueVisitors: 4, sessions: 3 })
  }, 1);
  assert.equal(report.totals["uniqueVisitors"], 4);
  assert.equal(report.totals["unique_visitors"], 4);
  assert.equal(report.totals["visitors"], 4);
  assert.equal(report.totals["pages_per_session"], 3.3);
});

test("no sessions = no division by zero", async () => {
  const report = await run({ eventsByDay: async () => [{ day: "2026-09-15", event: "page_view", count: 10 }] }, 1);
  assert.equal(report.totals["pages_per_session"], 0);
});

// ---------- counting ----------

test("a returning visitor is ONE visitor over the window, not one per day", async () => {
  // The running site summed the daily uniques, so someone who came back on Thursday counted twice.
  const report = await run({
    uniquesByDay: async () => [
      { day: "2026-09-14", uniqueVisitors: 1, sessions: 1 },
      { day: "2026-09-15", uniqueVisitors: 1, sessions: 1 }
    ],
    uniquesInPeriod: async () => ({ uniqueVisitors: 1, sessions: 2 })
  }, 2);
  assert.equal(report.totals["uniqueVisitors"], 1, "counted DISTINCT over the window, not summed");
  assert.equal(report.totals["sessions"], 2);
});

test("totals are the sum of the days, for every counted event", async () => {
  const report = await run({
    eventsByDay: async () => [
      { day: "2026-09-14", event: "add_to_cart", count: 2 },
      { day: "2026-09-15", event: "add_to_cart", count: 3 },
      { day: "2026-09-15", event: "gallery_open", count: 7 }
    ]
  }, 2);
  assert.equal(report.totals["add_to_cart"], 5);
  assert.equal(report.totals["gallery_open"], 7);
  assert.equal(report.totals["buy_now"], 0, "an event nobody fired is 0, not missing");
});

test("`daily` and `days` are the same rows — Sales Desk reads whichever it finds first", async () => {
  const report = await run({}, 2);
  assert.deepEqual(report.days, report.daily);
});

test("updatedAt comes from the newest event; no rows = no history", async () => {
  const empty = await run({});
  assert.equal(empty.updatedAt, "");
  assert.equal(empty.historyAvailable, false);

  const withRows = await run({
    recent: async () => [{
      event: "page_view", at: "2026-09-15T09:00:00.000Z", productCode: "", path: "/",
      referrer: "", attribution: {}, userAgent: ""
    }]
  });
  assert.equal(withRows.updatedAt, "2026-09-15T09:00:00.000Z");
  assert.equal(withRows.historyAvailable, true);
});

test("attribution rows carry their products, and the counted numbers beat the stored blob", async () => {
  const report = await run({
    attribution: async () => [{
      key: "c1",
      // A stale blob claiming a hundred clicks must not overwrite the four we counted.
      metadata: { pageId: "p1", postId: "b1", source_click: 100 },
      source_click: 4, page_view: 9, product_view: 3, add_to_cart: 1,
      buy_now: 0, checkout_open: 0, order_success: 0,
      uniqueVisitors: 2, sessions: 2, lastEventAt: "2026-09-15T08:00:00.000Z"
    }],
    attributionProducts: async () => [
      { key: "c1", code: "GX0709", name: "Giày", product_view: 3, add_to_cart: 1, buy_now: 0, order_success: 0 },
      { key: "khac", code: "ZZZ", name: "Khác", product_view: 9, add_to_cart: 9, buy_now: 9, order_success: 9 }
    ]
  });
  const row = report.attribution[0]!;
  assert.equal(row["pageId"], "p1", "metadata is kept");
  assert.equal(row["source_click"], 4, "the counted number wins over the blob");
  const products = row["products"] as Record<string, unknown>[];
  assert.equal(products.length, 1, "only this key's products");
  assert.equal(products[0]!["code"], "GX0709");
  assert.equal(products[0]!["key"], undefined, "the grouping key is not part of a product line");
});

// ---------- attribution signatures ----------

const SECRET = "bi-mat-ky-link-that-dai";
const sign = (pageId: string, postId: string, topicId: string, contentId: string) =>
  crypto.createHmac("sha256", SECRET).update([pageId, postId, topicId, contentId].join("|")).digest("base64url");

test("a correctly signed attribution is kept", () => {
  const input = { pageId: "p1", postId: "b1", topicId: "t1", contentId: "c1", signature: sign("p1", "b1", "t1", "c1") };
  assert.equal(verifiedAttribution(input, SECRET).contentId, "c1");
});

test("BREAKS the claim: a forged or altered signature keeps NOTHING", () => {
  const signature = sign("p1", "b1", "t1", "c1");
  // Right signature, but the caller swapped in someone else's post to steal the credit.
  assert.deepEqual(verifiedAttribution({ pageId: "p1", postId: "KHAC", topicId: "t1", contentId: "c1", signature }, SECRET), {});
  assert.deepEqual(verifiedAttribution({ pageId: "p1", postId: "b1", topicId: "t1", contentId: "c1", signature: "bia-dat" }, SECRET), {});
  assert.deepEqual(verifiedAttribution({ pageId: "p1", postId: "b1", topicId: "t1", contentId: "c1" }, SECRET), {}, "no signature at all");
});

test("no secret configured = nothing is attributed (fail closed)", () => {
  const input = { pageId: "p1", postId: "b1", topicId: "t1", contentId: "c1", signature: sign("p1", "b1", "t1", "c1") };
  assert.deepEqual(verifiedAttribution(input, ""), {});
});

test("first-touch fields are dropped when they point at a different post", () => {
  const signature = sign("p1", "b1", "t1", "c1");
  const kept = verifiedAttribution({ pageId: "p1", postId: "b1", topicId: "t1", contentId: "c1", signature, firstContentId: "c1", firstPostId: "b1" }, SECRET);
  assert.equal(kept.firstPostId, "b1");
  const dropped = verifiedAttribution({ pageId: "p1", postId: "b1", topicId: "t1", contentId: "c1", signature, firstContentId: "KHAC", firstPostId: "bKHAC" }, SECRET);
  assert.equal(dropped.firstPostId, undefined, "another post's first touch must not ride along");
});

test("normalising keeps only known fields and caps their length", () => {
  const out = normaliseAttribution({ contentId: "c".repeat(500), khong_biet: "x", capturedAt: "y".repeat(90) });
  assert.equal(out.contentId!.length, 160);
  assert.equal(out.capturedAt!.length, 40);
  assert.equal((out as Record<string, unknown>)["khong_biet"], undefined);
});

test("the grouping key falls back content → post → campaign", () => {
  assert.equal(attributionKey({ contentId: "c", postId: "p", campaign: "k" }), "c");
  assert.equal(attributionKey({ postId: "p", campaign: "k" }), "p");
  assert.equal(attributionKey({ campaign: "k" }), "k");
  assert.equal(attributionKey({}), "");
});

// ---------- the door's bouncer ----------

test("the event name is an ALLOW-LIST, not a sanitiser", () => {
  assert.equal(eventName("page_view"), "page_view");
  assert.equal(eventName("  Page_View  "), "page_view", "trimmed and lower-cased");
  assert.equal(eventName("payment_choice"), "payment_choice", "the checkout pages have been firing this since August");
  assert.equal(eventName("admin_password_seen"), "", "an invented name is refused");
  assert.equal(eventName(""), "");
  assert.equal(eventName(null), "");
});

test("a product code is stripped to what a code may contain", () => {
  assert.equal(productCode({ productCode: "GX0709" }), "GX0709");
  assert.equal(productCode({ code: "gx-07.09_a" }), "gx-07.09_a");
  assert.equal(productCode({ sku: "<script>alert(1)</script>" }), "scriptalert1script");
  assert.equal(productCode({}), "");
});

test("bots are recognised by user agent", () => {
  assert.equal(likelyBot("Mozilla/5.0 (compatible) facebookexternalhit/1.1"), true);
  assert.equal(likelyBot("HeadlessChrome/120"), true);
  assert.equal(likelyBot("Mozilla/5.0 (iPhone) Safari/604.1"), false);
});

test("`order_success` from a browser is ALWAYS refused — only the server writes it", () => {
  const gate = new AbuseGate(() => NOW);
  assert.equal(gate.check("order_success", { contentId: "c1" }, "1.2.3.4"), "server_order_only");
  assert.equal(gate.check("order_success", {}, "1.2.3.4"), "server_order_only");
});

test("unattributed browsing is not throttled per content — the kernel's per-IP limit is the guard", () => {
  const gate = new AbuseGate(() => NOW);
  for (let i = 0; i < 200; i += 1) assert.equal(gate.check("page_view", {}, "1.2.3.4"), "");
});

test("BREAKS an attempt to inflate ONE post: attributed events stop at 30 per ten minutes", () => {
  const gate = new AbuseGate(() => NOW);
  const attribution = { contentId: "c1" };
  for (let i = 0; i < 30; i += 1) assert.equal(gate.check("product_view", attribution, "1.2.3.4"), "", `call ${i + 1}`);
  assert.equal(gate.check("product_view", attribution, "1.2.3.4"), "analytics_rate_limited");
  // Another visitor, and another post, are unaffected.
  assert.equal(gate.check("product_view", attribution, "9.9.9.9"), "");
  assert.equal(gate.check("product_view", { contentId: "c2" }, "1.2.3.4"), "");
});

test("one comment link counts ONE click a day, however many times the tab is reopened", () => {
  let now = NOW;
  const gate = new AbuseGate(() => now);
  const click = { contentId: "c1", clickId: "click-1" };
  assert.equal(gate.check("source_click", click, "1.2.3.4"), "");
  assert.equal(gate.check("source_click", click, "1.2.3.4"), "analytics_rate_limited");
  now = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
  assert.equal(gate.check("source_click", click, "1.2.3.4"), "", "a day later it counts again");
});

test("the per-content window reopens once it has passed", () => {
  let now = NOW;
  const gate = new AbuseGate(() => now);
  const attribution = { contentId: "c1" };
  for (let i = 0; i < 30; i += 1) gate.check("add_to_cart", attribution, "1.2.3.4");
  assert.equal(gate.check("add_to_cart", attribution, "1.2.3.4"), "analytics_rate_limited");
  now = new Date(NOW.getTime() + 11 * 60 * 1000);
  assert.equal(gate.check("add_to_cart", attribution, "1.2.3.4"), "");
});
