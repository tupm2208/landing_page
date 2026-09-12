// GOI THAT — hinh dang du lieu Sales Desk va Image Tool GUI THAT, khong phai hinh dang em
// doan. Lay tu tep tren may anh Dung ngay 12/09/2026:
//
//   data/published-products.json  4.834 mon  -> POST /api/products        (Image Tool)
//   data/ready-stock.json           80 mon   -> POST /api/ready-stock/sync (Desk)
//   data/partner-campaigns.json    253 mon   -> POST /api/partner-campaigns (Desk)
//
// Day la rui ro lon nhat con lai cua ban tach: truoc bo bai nay, chua co goi that nao duoc
// doi chieu. Hai khac biet tim ra ngay lan doi chieu dau:
//
//   1. Hang co san dung `variants: [{ size, branchId, qty, salePrice }]` + `branches` rieng,
//      KHONG dung `sizes`. Ban tach chi doc `sizes` -> 80 mon bi bo sach, khong bao mot loi.
//   2. Chien dich doi tac mang ten doi tac that ("Supersports (supersports.com.vn)"). Ban
//      dang chay THAY ten do bang "TopRun" truoc khi tra ra web. Ban tach tra nguyen ten
//      doi tac -> lo cho khach, trai luat anh Dung dat 10/09.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { chuanHoaMon, banCongKhai } = require("../modules/hang-kho/chuan-hoa");
const { doiGoiHangCoSan, doiGoiChienDich } = require("../modules/hang-kho/goi-desk");

// ---------- goi HANG CO SAN that (rut gon tu data/ready-stock.json) ----------

const GOI_CO_SAN = {
  version: 1,
  revision: 412,
  updatedAt: "2026-09-06T15:20:11.000Z",
  policy: {
    summaryText: "Hang san TopRun: giao ngay 24-48h, duoc kiem tra hang truoc khi gui.",
    codAllowed: true,
    depositPercent: 0
  },
  branches: [
    { id: "wh_toprun_yen", name: "TopRun - Yen", active: true },
    { id: "wh_toprun_cau_dien", name: "TopRun - Cau Dien", active: true },
    { id: "wh_toprun_nghi_viec", name: "TopRun - Da nghi", active: false },
    { id: "wh_partner_dasbui", name: "Dasbui", active: true }
  ],
  products: [
    {
      code: "KI0784",
      name: "Giày Adidas GameCourt 2",
      brand: "adidas",
      productKind: "shoe",
      category: "Tennis",
      division: "",
      gender: "",
      imageUrl: "assets/products/ki0784.jpg",
      galleryImages: ["assets/products/ki0784.jpg", "assets/products/ki0784_gallery_02.jpg"],
      variants: [
        { size: "42", branchId: "wh_toprun_yen", qty: 6, salePrice: 1650000, listPrice: 2200000 },
        { size: "43", branchId: "wh_toprun_nghi_viec", qty: 4, salePrice: 1650000, listPrice: 2200000 },
        { size: "44", branchId: "wh_ai_do_khong_khai", qty: 9, salePrice: 1650000, listPrice: 2200000 },
        { size: "45", branchId: "wh_toprun_cau_dien", qty: 0, salePrice: 1650000, listPrice: 2200000 },
        { size: "46", branchId: "wh_toprun_cau_dien", qty: 2, salePrice: 0, listPrice: 2200000 }
      ]
    }
  ],
  pendingSales: [{ orderId: "ORD-1", code: "KI0784", size: "42", branchId: "wh_toprun_yen", qty: 2 }]
};

test("goi hang co san THAT: doi variants+branches thanh mon co sizes", () => {
  const mon = doiGoiHangCoSan(GOI_CO_SAN);
  assert.equal(mon.length, 1, "80 mon that khong duoc bo sach nhu truoc");
  const m = mon[0];
  assert.equal(m.code, "KI0784");
  assert.equal(m.source, "own", "hang co san la hang cua shop, khong phai hang doi tac");
  assert.equal(m.sourceName, "TopRun");
  assert.equal(m.thumbnailImage, "assets/products/ki0784.jpg", "goi that dung `imageUrl`");
  assert.equal(m.readyPolicySummary, GOI_CO_SAN.policy.summaryText);

  const size = m.sizes.map((d) => d.size);
  assert.deepEqual(size, ["42"], "chi size 42 con ban duoc");
  assert.equal(m.sizes[0].qty, 4, "6 ton tru 2 dang giu (pendingSales) = 4");
  assert.equal(m.sizes[0].price, 1650000);
  assert.equal(m.sizes[0].listPrice, 2200000);
  assert.equal(m.sizes[0].warehouseId, "wh_toprun_yen");
  assert.equal(m.sizes[0].warehouseName, "TopRun - Yen", "ten kho lay tu `branches`");
  assert.equal(m.sizes[0].stockMode, "ready");
});

test("hang co san: BO dong cua chi nhanh da tat, kho khong khai, het ton, hoac khong co gia", () => {
  const m = doiGoiHangCoSan(GOI_CO_SAN)[0];
  const co = (size) => m.sizes.some((d) => d.size === size);
  assert.equal(co("43"), false, "chi nhanh active:false thi khong ban");
  assert.equal(co("44"), false, "kho la khong nam trong danh sach cho phep thi khong ban");
  assert.equal(co("45"), false, "het ton thi khong ban");
  assert.equal(co("46"), false, "khong co gia thi khong ban — ban mot doi giay 0 dong la mat tien");
});

test("hang co san CHI cua TopRun: ban Dasbui chi duoc lay kho cua chinh no", () => {
  // Luat trong AGENTS.md: ready-stock mac dinh chi TopRun; rieng `wh_partner_dasbui` duoc
  // day sang Dasbui, con moi kho `wh_toprun_*` khac CAM port. Bai nay la day thep giu luat do.
  const goi = {
    ...GOI_CO_SAN,
    pendingSales: [],
    products: [{
      code: "KI0784", name: "Giày Adidas GameCourt 2", imageUrl: "a.jpg",
      variants: [
        { size: "42", branchId: "wh_toprun_yen", qty: 5, salePrice: 1650000 },
        { size: "43", branchId: "wh_partner_dasbui", qty: 5, salePrice: 1650000 }
      ]
    }]
  };

  const toprun = doiGoiHangCoSan(goi);
  assert.deepEqual(toprun[0].sizes.map((d) => d.size).sort(), ["42", "43"], "tren TopRun thi ca hai kho deu duoc");

  const dasbui = doiGoiHangCoSan(goi, { khoChoPhep: ["wh_partner_dasbui"] });
  assert.deepEqual(dasbui[0].sizes.map((d) => d.size), ["43"], "tren Dasbui thi kho wh_toprun_* bi bo");
});

test("goi hang co san rong hoac sai hinh dang thi tra mang rong, khong nem", () => {
  assert.deepEqual(doiGoiHangCoSan(null), []);
  assert.deepEqual(doiGoiHangCoSan({}), []);
  assert.deepEqual(doiGoiHangCoSan({ products: [{ code: "", name: "", variants: [] }] }), []);
  assert.deepEqual(doiGoiHangCoSan({ products: [{ code: "A", name: "B", variants: [] }] }), [],
    "mon khong con size nao ban duoc thi khong dua len web");
});

// ---------- goi CHIEN DICH DOI TAC that (rut gon tu data/partner-campaigns.json) ----------

const GOI_CHIEN_DICH = {
  version: 1,
  updatedAt: "2026-09-06T22:50:04.000Z",
  source: "toprun-sales-desk",
  campaigns: [
    { id: "cd_song", source: "Supersports (supersports.com.vn)", name: "Supersports campaign", status: "active", expiresAt: "2126-09-13T22:50:04" },
    { id: "cd_da_tat", source: "MaxxSport", name: "MaxxSport campaign", status: "paused", expiresAt: "2126-09-13T22:50:04" },
    { id: "cd_het_han", source: "MaxxSport", name: "MaxxSport cu", status: "active", expiresAt: "2026-01-01T00:00:00" }
  ],
  products: [
    {
      offerKey: "supersports:cd_song:JR5074",
      originalCode: "JR5074", code: "JR5074",
      name: "Giày Chạy Bộ Nam Adidas Adizero Sl2",
      source: "partner", sourceName: "Supersports (supersports.com.vn)",
      brand: "adidas", category: "Giày Chạy Bộ", division: "Giay",
      sizes: [
        { variantId: "", size: "UK 6.5", qty: 1, price: 2090000, salePrice: 2090000, saleFilePrice: 1800000, listPrice: 3000000, warehouseId: "supersports_supersports_com_vn", warehouse: "Supersports (supersports.com.vn)", warehouseName: "Supersports (supersports.com.vn)" },
        { variantId: "", size: "UK 10.5", qty: 1, price: 2090000, salePrice: 2090000, saleFilePrice: 1800000, listPrice: 3000000, warehouseId: "supersports_supersports_com_vn", warehouse: "Supersports (supersports.com.vn)", warehouseName: "Supersports (supersports.com.vn)" }
      ],
      price: 2090000, suggestedPrice: 2090000, salePrice: 2090000, listPrice: 3000000,
      status: "orderable",
      thumbnailImage: "https://cdn.shopify.com/x/JR5074-1.jpg",
      slug: "jr5074-supersports-cd_song",
      partnerCampaign: true, partnerSource: "Supersports (supersports.com.vn)",
      campaignId: "cd_song", campaignName: "Supersports campaign"
    },
    {
      offerKey: "maxx:cd_da_tat:AB1234", code: "AB1234", name: "Áo MaxxSport",
      source: "partner", sourceName: "MaxxSport",
      sizes: [{ size: "M", qty: 3, price: 490000, warehouseId: "maxxsport", warehouseName: "MaxxSport" }],
      partnerCampaign: true, campaignId: "cd_da_tat", status: "orderable"
    },
    {
      offerKey: "maxx:cd_het_han:CD5678", code: "CD5678", name: "Quần MaxxSport",
      source: "partner", sourceName: "MaxxSport",
      sizes: [{ size: "L", qty: 3, price: 390000, warehouseId: "maxxsport", warehouseName: "MaxxSport" }],
      partnerCampaign: true, campaignId: "cd_het_han", status: "orderable"
    },
    {
      offerKey: "maxx:cd_song:EF9012", code: "EF9012", name: "Tất MaxxSport",
      source: "partner", sourceName: "MaxxSport",
      sizes: [{ size: "L", qty: 0, price: 90000, warehouseId: "maxxsport", warehouseName: "MaxxSport" }],
      partnerCampaign: true, campaignId: "cd_song", status: "orderable"
    }
  ]
};

test("goi chien dich THAT: bo chien dich da tat, da het han, va mon het hang", () => {
  const mon = doiGoiChienDich(GOI_CHIEN_DICH, { bayGio: new Date("2026-09-12T00:00:00.000Z") });
  assert.deepEqual(mon.map((m) => m.code), ["JR5074"]);
});

test("chien dich: moi dong duoc mot MA DONG rieng — bao het hang khoa theo ma nay", () => {
  // Bay 10/09 (su co ORD-1788854262493): bao het hang theo VI TRI dong thi thay dong la
  // danh dau sai don. Vi vay moi dong phai co ma rieng, on dinh, sinh lai la ra y nguyen.
  const lan1 = doiGoiChienDich(GOI_CHIEN_DICH, { bayGio: new Date("2026-09-12T00:00:00.000Z") })[0];
  const lan2 = doiGoiChienDich(GOI_CHIEN_DICH, { bayGio: new Date("2026-09-12T00:00:00.000Z") })[0];

  const ma = lan1.sizes.map((d) => d.partnerCampaignLineId);
  assert.equal(ma.length, 2);
  for (const m of ma) assert.match(m, /^pcl_[0-9a-f]{16}$/);
  assert.equal(new Set(ma).size, 2, "hai size phai ra hai ma khac nhau");
  assert.deepEqual(lan2.sizes.map((d) => d.partnerCampaignLineId), ma, "sinh lai phai ra y nguyen");
});

test("chien dich: KHONG duoc lo ten doi tac ra ban cong khai", () => {
  // Anh Dung 10/09/2026: cau gui khach cam kem ten kho / ten doi tac. Ban dang chay thay ten
  // doi tac bang "TopRun" truoc khi tra ra web — ban tach phai lam dung nhu vay.
  const mon = doiGoiChienDich(GOI_CHIEN_DICH, { bayGio: new Date("2026-09-12T00:00:00.000Z") })[0];
  const cong = banCongKhai(chuanHoaMon(mon));
  const chu = JSON.stringify(cong);
  assert.ok(!/Supersports/i.test(chu), `ban cong khai lo ten doi tac: ${chu.slice(0, 300)}`);
  assert.ok(!/supersports_supersports_com_vn/i.test(chu), "khong duoc lo ma kho cua doi tac");
  assert.equal(cong.sourceName, "TopRun");
  assert.equal(cong.source, "own");
  for (const d of cong.sizes) {
    assert.equal(d.warehouseName, "TopRun");
    assert.equal(d.warehouseId, "wh_toprun");
  }
});

test("MOT CHO LO THAT, chua va: duong dan anh cua doi tac", () => {
  // 22 trong 253 mon chien dich dung anh nam tren `supersports.com.vn`. Ban DANG CHAY cung
  // tra nguyen duong dan do ra web, nen khach mo xem nguon trang la doc duoc TopRun lay hang
  // o dau. Day khong phai loi cua ban tach — nhung cung khong phai thu da duoc vá, nen ghi
  // ro o day de khong ai tuong bo bai tren da phu het. Vá that phai la tai anh ve may minh
  // (viec cua Image Tool), khong phai che chuoi.
  const mon = doiGoiChienDich({
    campaigns: [],
    products: [{
      code: "IF1156", name: "Giày adidas", partnerCampaign: true,
      thumbnailImage: "https://supersports.com.vn/cdn/shop/files/IF1156-1.jpg",
      sizes: [{ size: "42", qty: 1, price: 100000, warehouseId: "supersports", warehouseName: "Supersports" }]
    }]
  })[0];
  const cong = banCongKhai(chuanHoaMon(mon));
  assert.match(cong.thumbnailImage, /supersports\.com\.vn/, "ghi lai su that hien tai, khong phai loi hua");
  assert.equal(cong.sizes[0].warehouseName, "TopRun", "con ten kho thi da che roi");
});

test("chien dich: ben TRONG van giu ten doi tac that — doi tac mua ho can biet mua o dau", () => {
  // Doi ten thanh "TopRun" la viec cua BAN CONG KHAI, khong phai viec cua luc nhan goi. Trong
  // so van phai la ten doi tac that: khong co no thi khong biet dat mua o dau.
  const mon = doiGoiChienDich(GOI_CHIEN_DICH, { bayGio: new Date("2026-09-12T00:00:00.000Z") })[0];
  assert.equal(mon.sourceName, "Supersports (supersports.com.vn)");
  assert.equal(mon.sizes[0].warehouseId, "supersports_supersports_com_vn");
  assert.equal(mon.sizes[0].saleFilePrice, 1800000, "gia von phai giu de doi soat — chi khong ra web");
});

test("goi chien dich rong thi tra mang rong, khong nem", () => {
  assert.deepEqual(doiGoiChienDich(null), []);
  assert.deepEqual(doiGoiChienDich({ products: [] }), []);
  assert.deepEqual(doiGoiChienDich({ products: [{ code: "A", name: "B", sizes: [] }] }), []);
});

test("mon khong khai chien dich nao thi van len web (khong co bang chien dich de tra)", () => {
  const goi = {
    campaigns: [],
    products: [{
      code: "ZZ1", name: "Mon le", sizes: [{ size: "M", qty: 2, price: 100000, warehouseId: "kho_la", warehouseName: "Kho la" }],
      partnerCampaign: true
    }]
  };
  assert.deepEqual(doiGoiChienDich(goi).map((m) => m.code), ["ZZ1"]);
});

// ---------- ma kho gui sang bo nao ----------

test("ma kho gui sang bo nao la ma MU, nhung hai kho khac nhau van ra hai ma khac nhau", () => {
  const { maKhoMu } = require("../modules/cong-bo-nao/ma-kho-mu");
  assert.match(maKhoMu("wh_yen"), /^kho_[0-9a-f]{8}$/);
  assert.ok(!/yen/.test(maKhoMu("wh_yen")), "khong duoc doc ra ten nguoi");
  assert.ok(!/supersports/.test(maKhoMu("supersports_supersports_com_vn")), "khong duoc doc ra ten doi tac");
  assert.equal(maKhoMu("wh_yen"), maKhoMu("wh_yen"), "cung kho thi cung ma — keo bo nao dem sai so nguon");
  assert.notEqual(maKhoMu("wh_yen"), maKhoMu("wh_cau_dien"));
  assert.equal(maKhoMu(""), "");
});
