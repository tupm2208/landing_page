// THE OPEN GRAPH cho trang san pham.
//
// Vi sao phai co: crawler cua Facebook / Zalo / Messenger KHONG chay JavaScript. Neu HTML tra
// ve chi la mot cai vo roi JS moi nap san pham, thi link khach share ra hien tro tren — khong
// ten, khong anh, khong gia. Nen may chu phai nhet san the vao <head> truoc khi tra HTML.
//
// Toan bo tep nay la ham thuan: vao la mon hang + goc site, ra la doan HTML. Khong doc dia,
// khong goi mang — nen bai kiem tra chay truc tiep.

"use strict";

const TEN_SITE = "TopRun";
const ANH_DU_PHONG = "/assets/toprun-product-1.png";

function thoat(gt) {
  return String(gt ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function lamSachChu(gt) {
  return String(gt ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function chuDauTien(mon, cacKhoa) {
  for (const k of cacKhoa) {
    const chu = lamSachChu(mon?.[k]);
    if (chu) return chu;
  }
  return "";
}

function catBot(chu, dai = 190) {
  const gt = String(chu || "");
  return gt.length <= dai ? gt : `${gt.slice(0, dai - 1).trimEnd()}…`;
}

function tenMon(mon) {
  const chinh = chuDauTien(mon, ["seoTitle", "name", "productName"]);
  const hang = chuDauTien(mon, ["brand"]);
  const ma = chuDauTien(mon, ["code", "productCode"]);
  const phan = [];
  for (const p of [hang, chinh, ma]) {
    if (!p) continue;
    if (phan.some((x) => x.toLowerCase().includes(p.toLowerCase()))) continue;
    phan.push(p);
  }
  return phan.join(" ").trim();
}

function giaMon(mon) {
  for (const k of ["suggestedPrice", "salePrice", "price"]) {
    const gia = Number(mon?.[k] || 0);
    if (gia > 0) return gia;
  }
  return 0;
}

/** Khoa tra cuu mon tu duong web: /product/<slug> hoac /product.html?p=<ma>. */
function khoaTuDuong({ duong = "", truyVan = {} } = {}) {
  if (duong === "/product.html") {
    for (const k of ["p", "code", "slug"]) {
      const gt = String(truyVan[k] || "").trim();
      if (gt) return gt;
    }
    return "";
  }
  const doan = String(duong).split("/").filter(Boolean).pop() || "";
  try { return decodeURIComponent(doan).trim(); } catch { return doan.trim(); }
}

/**
 * Chon anh cho the og:image.
 *
 * `coTep(duong)` la ham hoi cong tep tinh "co tep nay khong" — khong doc ca tep anh len chi
 * de biet no ton tai. Anh dat tuyet doi (http...) thi dung luon.
 */
async function chonAnh(mon, gocSite, coTep, gocAnhThat = "") {
  const ungVien = [
    mon?.highImage, mon?.image,
    ...(Array.isArray(mon?.galleryImages) ? mon.galleryImages : []),
    mon?.thumbnailImage
  ];
  for (const uv of ungVien) {
    const anh = String(uv || "").trim();
    if (!anh) continue;
    if (anh.toLowerCase().includes("/assets/thumbnails/")) continue;   // anh nho, share ra xau
    if (/^https?:\/\//i.test(anh)) return anh;
    const tuongDoi = `/${anh.split("\\").join("/").replace(/^\/+/, "")}`;
    if (await coTep(tuongDoi)) return `${gocSite}${tuongDoi}`;
    // Ban chay thu khong cop 7,6 GB anh san pham sang. Neu anh khong co o day nhung co khai
    // `gocAnhThat` thi tro thang ve site that — crawler doc duoc anh, may thu khong phai chua.
    if (gocAnhThat) return `${gocAnhThat}${tuongDoi}`;
  }
  return `${gocSite}${ANH_DU_PHONG}`;
}

/**
 * Nhet the vao HTML mau. Tra ve `{ html, timThay }`.
 *
 * Khong tim thay mon thi van tra trang (de khach khong gap 404) nhung gan
 * `X-Robots-Tag: noindex` o tang goi — giong ban dang chay.
 */
async function nhetThe({ mau, mon, khoa, gocSite, coTep, gocAnhThat = "" }) {
  const timThay = Boolean(mon);
  const khoaDuong = timThay ? String(mon.slug || mon.code || khoa) : khoa;
  const chinhTac = `${gocSite}/product/${encodeURIComponent(khoaDuong)}`;
  const ten = timThay ? tenMon(mon) : "";
  const tieuDe = ten ? `${ten} - ${TEN_SITE}` : `${TEN_SITE} - Giày và đồ thể thao chính hãng`;
  const gia = timThay ? giaMon(mon) : 0;

  let moTa = timThay ? chuDauTien(mon, ["seoDescription", "shortDescription", "description"]) : "";
  if (!moTa && timThay) {
    const tienTo = gia > 0 ? `Giá ${Math.round(gia).toLocaleString("vi-VN")}đ. ` : "";
    moTa = `${tienTo}Xem hình ảnh, size còn hàng và đặt sản phẩm trực tiếp tại ${TEN_SITE}.`;
  }
  moTa = catBot(moTa || `Xem sản phẩm giày và đồ thể thao chính hãng tại ${TEN_SITE}.`);
  const anh = timThay ? await chonAnh(mon, gocSite, coTep, gocAnhThat) : `${gocSite}${ANH_DU_PHONG}`;

  const dong = [
    `  <link rel="canonical" href="${thoat(chinhTac)}">`,
    `  <meta name="description" content="${thoat(moTa)}">`,
    `  <meta property="og:type" content="product">`,
    `  <meta property="og:site_name" content="${thoat(TEN_SITE)}">`,
    `  <meta property="og:title" content="${thoat(tieuDe)}">`,
    `  <meta property="og:description" content="${thoat(moTa)}">`,
    `  <meta property="og:image" content="${thoat(anh)}">`,
    `  <meta property="og:image:alt" content="${thoat(tieuDe)}">`,
    `  <meta property="og:url" content="${thoat(chinhTac)}">`,
    gia > 0 ? `  <meta property="product:price:amount" content="${Math.round(gia)}">` : "",
    gia > 0 ? `  <meta property="product:price:currency" content="VND">` : "",
    `  <meta name="twitter:card" content="summary_large_image">`,
    `  <meta name="twitter:title" content="${thoat(tieuDe)}">`,
    `  <meta name="twitter:description" content="${thoat(moTa)}">`,
    `  <meta name="twitter:image" content="${thoat(anh)}">`
  ].filter(Boolean).join("\n");

  const html = String(mau).replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${thoat(tieuDe)}</title>\n${dong}`);
  return { html, timThay };
}

module.exports = { nhetThe, khoaTuDuong, tenMon, giaMon, chonAnh, thoat, catBot, TEN_SITE, ANH_DU_PHONG };
