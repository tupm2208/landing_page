/**
 * The three tools for the AI agent on Xeon (16/09/2026): catalog.find (Sales Desk's `tra_kho`),
 * shop.bankAccount, conversation.recent. Each finder case is a real Desk conversation that went wrong.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROLE, defineModule } from "../dist/contract/index.js";
import { FixedWindowRateLimiter, JsonFileStore, Kernel, ManualClock, MemoryLogger, TokenAuth } from "../dist/kernel/index.js";
import { manifest as gateway } from "../dist/modules/cong-bo-nao/module.js";
import { adidasEuToUk, apparelSizeKey, findInCatalog } from "../dist/modules/cong-bo-nao/catalog-find.js";
import { defaultPageContent, normalisePageContent } from "../dist/modules/khung-nen-tang/page-content.js";
import type { PublicItem } from "../dist/modules/hang-kho/normalise.js";

const BRAIN = "ma-bo-nao";
const SITE = "https://shop.vn";

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

function item(code: string, name: string, sizes: { size: string; price: number; ready?: boolean; available?: boolean }[], extra: Partial<PublicItem> = {}): PublicItem {
  return {
    code, originalCode: code, name, source: "own", sourceName: "TopRun", brand: "adidas", productKind: "", category: "", division: "", gender: "",
    sizes: sizes.map((s, i) => ({
      variantId: `${code}-${i}`, size: s.size, available: s.available ?? true, qty: (s.available ?? true) ? 1 : 0, price: s.price, suggestedPrice: s.price,
      salePrice: s.price, listPrice: 0, warehouseId: "wh", warehouse: "TopRun", warehouseName: "TopRun", warehouseLabel: "TopRun",
      ...(s.ready ? { stockMode: "ready" as const } : {}), partnerCampaignLineId: ""
    })) as PublicItem["sizes"],
    price: Math.min(...sizes.map((s) => s.price)), suggestedPrice: 0, salePrice: 0, listPrice: 0, saleRatio: 0, discountPercent: 0, discount_percent: 0,
    status: "orderable", thumbnailImage: "", highImage: `https://img/${code}.jpg`, galleryImages: [], slug: code.toLowerCase(),
    shortDescription: "", description: "", seoTitle: "", seoDescription: "", partnerCampaign: false, policy: "", ...extra
  };
}

const CATALOG: PublicItem[] = [
  item("JI1311", "ADIZERO BOSTON 12 M", [{ size: "42", price: 3200000 }]),
  item("JP9252", "ADIZERO BOSTON 13 M", [{ size: "42", price: 3500000 }, { size: "42", price: 3290000, ready: true }, { size: "43 1/3", price: 3500000 }]),
  item("DR100", "DURAMO SL M", [{ size: "42", price: 1200000, ready: true }, { size: "40", price: 1200000, available: false }]),
  item("SB200", "SAMBA OG", [{ size: "42", price: 2500000 }], { category: "Originals" }),
  item("BR300", "HARDEN VOLUME 9", [{ size: "42", price: 3000000 }], { category: "BASKETBALL" }),
  item("TN400", "COURTJAM CONTROL 3", [{ size: "42", price: 2000000 }], { category: "TENNIS" }),
  item("SH500", "RUN IT SHORT", [{ size: "A/88", price: 700000 }], { productKind: "apparel" }),
  item("PT600", "ESSENTIALS PANT", [{ size: "A/88", price: 900000 }], { productKind: "apparel" })
];

const codes = (result: unknown) => (Array.isArray(result) ? result.map((r) => (r as { ma: string }).ma) : result);

test("catalog.find: a numbered model keeps its number (v90 Boston 13 vs 12); merged size rows take the LOWEST price and ready wins", () => {
  const found = findInCatalog(CATALOG, { ten: "Boston 13", size: "42" }, SITE);
  assert.deepEqual(codes(found), ["JP9252"]);
  const boston = (found as { cac_size: unknown[]; loai?: string; link: string }[])[0]!;
  assert.deepEqual(boston.cac_size, [{ size: "42", gia: 3290000 }]);
  assert.match(String(boston.loai), /HANG SAN/);
  assert.equal(boston.link, `${SITE}/product/jp9252`);
  // A name + size in "ten" alone ("Response 42") still finds by name.
  assert.deepEqual(codes(findInCatalog(CATALOG, { ten: "duramo 42" }, SITE)), ["DR100"]);
});

test("catalog.find: sold-out sizes never show; half sizes map to adidas thirds; UK conversion", () => {
  assert.equal(typeof findInCatalog(CATALOG, { ten: "duramo", size: "40" }, SITE), "string", "size 40 is sold out");
  assert.deepEqual(codes(findInCatalog(CATALOG, { ten: "boston 13", size: "43,5" }, SITE)), ["JP9252"], "43.5 -> 43 1/3");
  assert.equal(adidasEuToUk("42"), "8");
  assert.equal(adidasEuToUk("42 2/3"), "8.5");
  assert.equal(apparelSizeKey("a88"), "88");
  assert.equal(apparelSizeKey("XXL"), "2XL");
});

test("catalog.find: everyday purpose excludes court / basketball shoes and returns groups; a sport asked directly is found by category", () => {
  const everyday = findInCatalog(CATALOG, { muc_dich: "di_hoc_di_choi_da_nang", size: "42" }, SITE) as { ma: string; nhom?: string }[];
  const got = everyday.map((r) => r.ma);
  assert.ok(got.includes("SB200") && got.includes("DR100"));
  assert.ok(!got.includes("BR300") && !got.includes("TN400"), "no specialised court / basketball shoe for school");
  assert.equal(everyday.find((r) => r.ma === "SB200")!.nhom, "Sneaker thời trang");
  assert.deepEqual(codes(findInCatalog(CATALOG, { ten: "giay bong ro" }, SITE)), ["BR300"], "v95: 'bong ro' is never in a store name");
});

test("catalog.find: 'quan dai' excludes shorts (v96); apparel size A88 matches A/88; vague words ask back instead of dumping", () => {
  assert.deepEqual(codes(findInCatalog(CATALOG, { ten: "quan dai", size: "A88" }, SITE)), ["PT600"]);
  assert.deepEqual(codes(findInCatalog(CATALOG, { ten: "quan short", size: "88" }, SITE)), ["SH500"]);
  assert.match(String(findInCatalog(CATALOG, { ten: "the thao" }, SITE)), /hoi lai khach/);
  assert.match(String(findInCatalog(CATALOG, { ten: "pegasus 41" }, SITE)), /KHONG tim thay/);
});

function build() {
  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const store = new JsonFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "agent-tools-")), logger);
  let searches = 0;
  const fakeInventory = defineModule({
    id: "hang-kho", name: "Hang kho gia", tier: "van-hanh", runsOn: "server-khach", version: "0",
    provides: { "hang-kho.search": async () => { searches += 1; return CATALOG; }, "hang-kho.stock": async () => ({ found: false, lines: [] }) }
  });
  const fakePlatform = defineModule({
    id: "khung-nen-tang", name: "Khung gia", tier: "khung", runsOn: "server-khach", version: "0",
    provides: { "khung-nen-tang.content": async () => normalisePageContent({ ...defaultPageContent(), bankName: "Techcombank", bankCode: "TCB", bankAccountNumber: "123", bankAccountName: "NGUYEN A" }, clock.now()) }
  });
  const fakeInbox = defineModule({
    id: "hop-thu", name: "Hop thu gia", tier: "van-hanh", runsOn: "server-khach", version: "0",
    provides: {
      "hop-thu.thread": async (_ctx, input: { maHoiThoai: string; limit?: number }) => input.maHoiThoai === "facebook:k1"
        ? [{ maTin: "m1", chieu: "den", chu: "còn size 42 không", soAnh: 0, luc: "2026-09-16T10:00:00.000Z", boi: "khach", trangThai: "" }].slice(-(input.limit ?? 20))
        : []
    }
  });
  const kernel = new Kernel({
    ports: { store, logger, clock, auth: new TokenAuth({ keys: [{ token: BRAIN, name: "bo-nao", role: ROLE.service }], clock }), rateLimiter: new FixedWindowRateLimiter(clock) },
    logger, modules: [fakeInventory, fakePlatform, fakeInbox, gateway], config: { "cong-bo-nao": { siteUrl: SITE } }
  });
  const headers = { authorization: `Bearer ${BRAIN}` };
  const tool = (name: string, input: Record<string, unknown> = {}) => kernel.handle({ method: "POST", path: "/api/bo-nao/cong-cu", query: {}, ip: "1.1.1.1", headers, json: async () => ({ ten: name, input }) });
  const list = () => kernel.handle({ method: "GET", path: "/api/bo-nao/cong-cu", query: {}, ip: "1.1.1.1", headers });
  return { tool, list, clock, searches: () => searches };
}

test("the three agent tools are open, answer through the gateway, and the catalogue is read once a minute", async () => {
  const { tool, list, clock, searches } = build();
  const open = ((await list()).body as Body).congCu as string[];
  for (const name of ["catalog.find", "shop.bankAccount", "conversation.recent"]) assert.ok(open.includes(name), name);

  assert.deepEqual(codes(((await tool("catalog.find", { ten: "boston 13", size: "42" })).body as Body).data.ketQua), ["JP9252"]);
  await tool("catalog.find", { ten: "duramo" });
  assert.equal(searches(), 1, "second call inside a minute uses the cached catalogue");
  clock.advance(61 * 1000);
  await tool("catalog.find", { ten: "duramo" });
  assert.equal(searches(), 2);

  assert.deepEqual(((await tool("shop.bankAccount")).body as Body).data, { nganHang: "Techcombank", maNganHang: "TCB", soTaiKhoan: "123", chuTaiKhoan: "NGUYEN A" });
  assert.deepEqual(((await tool("conversation.recent", { conversationId: "facebook:k1" })).body as Body).data.tin, [
    { chieu: "den", boi: "khach", chu: "còn size 42 không", soAnh: 0, luc: "2026-09-16T10:00:00.000Z" }
  ]);
  assert.deepEqual(((await tool("conversation.recent", { conversationId: "facebook:khac" })).body as Body).data.tin, []);
});
