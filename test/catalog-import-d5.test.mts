/**
 * Đ5 — "Đồng bộ kho" from pasted CSV / Google Sheet: the pure rules (no MySQL, no network).
 * Breaks if: a US/UK size lands on the web as the raw number, a private sheet's sign-in page is
 * read as data, or one bad row silently drops the whole paste.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { googleSheetCsvUrl, itemsFromRows, looksLikeHtml, normaliseSize, parseCsv } from "../dist/modules/hang-kho/import-sheet.js";

test("Google Sheet links become their CSV export; anything else is refused with a sentence", () => {
  assert.equal(
    googleSheetCsvUrl("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=77"),
    "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=77"
  );
  assert.match(googleSheetCsvUrl("https://docs.google.com/spreadsheets/d/e/2PACX-x/pubhtml"), /output=csv/);
  assert.equal(googleSheetCsvUrl("https://shop.vn/ton.csv"), "https://shop.vn/ton.csv");
  assert.throws(() => googleSheetCsvUrl("https://shop.vn/ton.xlsx"), /Google Sheet hoặc link CSV/);
  assert.throws(() => googleSheetCsvUrl("không phải link"), /không hợp lệ/);
  assert.equal(looksLikeHtml("<!DOCTYPE html><html>"), true);
  assert.equal(looksLikeHtml("product_code,size"), false);
});

test("sizes: US / UK read through Desk's table, explicit prefix wins, adidas thirds, letters kept", () => {
  assert.equal(normaliseSize("US 9", "EU"), "42.5", "explicit US prefix beats the sheet's EU");
  assert.equal(normaliseSize("8.5", "US_MEN"), "42");
  assert.equal(normaliseSize("UK 8", "EU"), "42");
  assert.equal(normaliseSize("42 2/3", "EU"), "42.5");
  assert.equal(normaliseSize("43 1/3", "EU"), "43");
  assert.equal(normaliseSize("43.5", "EU", "adidas"), "43", "adidas has no .5 on odd numbers");
  assert.equal(normaliseSize("42,5", "EU"), "42.5");
  assert.equal(normaliseSize("xxxl", "EU"), "3XL");
  assert.equal(normaliseSize("free size", "EU"), "OS");
  assert.equal(normaliseSize("US 20", "US_MEN"), "", "unknown US size is not guessed");
});

test("CSV rows group by product code, keep SKU + cost per size, and report rows they cannot read", () => {
  const csv = [
    "product_code,sku,product_name,brand,size,stock_qty,sale_price,cost_price,image_url",
    "NB1,NB1-9,\"New Balance SC, Trainer\",New Balance,US 9,2,\"3,650,000\",2000000,https://example.com/a.jpg",
    "NB1,,New Balance SC Trainer,New Balance,US 10,1,3650000,2000000,",
    ",x,Không mã,Nike,42,1,1,1,",
    "AS4,,ASICS Novablast 4,ASICS,US 99,1,3150000,,"
  ].join("\r\n");
  const rows = parseCsv(csv);
  assert.equal(rows[1]![2], "New Balance SC, Trainer", "quoted comma stays in the cell");
  const out = itemsFromRows(rows, { sizeSystem: "US_MEN", source: "own", sourceName: "" });
  assert.equal(out.rowCount, 4);
  assert.equal(out.items.length, 1);
  assert.equal(out.skipped, 2);
  assert.match(out.warnings.join(" | "), /Dòng 4: thiếu mã/);
  assert.match(out.warnings.join(" | "), /Dòng 5: không đọc được size "US 99"/);
  const item = out.items[0] as { code: string; sizes: Record<string, unknown>[]; thumbnailImage: string };
  assert.equal(item.code, "NB1");
  assert.deepEqual(item.sizes.map((s) => [s["size"], s["qty"], s["price"], s["costPrice"], s["sku"]]), [
    ["42.5", 2, 3650000, 2000000, "NB1-9"],
    ["44", 1, 3650000, 2000000, "NB1-44"]
  ]);
  assert.equal(item.thumbnailImage, "https://example.com/a.jpg");
});

test("Vietnamese headers and a tab paste work; partner stock is marked and warehoused under the partner", () => {
  const tsv = "Mã\tTên sản phẩm\tSize\tTồn\tGiá bán\nKJ1\tGiày KJ\t42\t3\t1500000";
  const out = itemsFromRows(parseCsv(tsv), { sizeSystem: "EU", source: "partner", sourceName: "Yến Sport" });
  assert.equal(out.items.length, 1);
  const item = out.items[0] as Record<string, unknown> & { sizes: Record<string, unknown>[] };
  assert.equal(item["partnerCampaign"], true);
  assert.equal(item["sourceName"], "Yến Sport");
  assert.equal(item.sizes[0]!["warehouseId"], "partner_yen_sport");
  assert.deepEqual(itemsFromRows([["a", "b"], ["1", "2"]], { sizeSystem: "EU", source: "own", sourceName: "" }).warnings.length, 1, "no code column = one clear warning");
});
