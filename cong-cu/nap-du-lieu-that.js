// NAP DU LIEU THAT vao ban tach — de chay thu bang hang that, don that, khach that.
//
// Anh Dung chot 12/09/2026: "copy tu may that". Cong cu nay lam dung mot viec: DOC tep du lieu
// cua ban dang chay roi DAY vao ban tach qua dung nhung cua ma Sales Desk / Image Tool dung.
//
// HAI DIEU NO KHONG BAO GIO LAM:
//
//   1. KHONG GHI mot byte nao vao thu muc cua ban dang chay. No mo tep o che do doc, het.
//   2. KHONG cham vao MySQL cong 3306 (du lieu that cua landing). Ban tach chi noi toi cong
//      3307 — va `chay.js` tu nem neu ai tro vao 3306.
//
// Vi sao day qua API chu khong ghi thang vao bang: day qua API la DOI CHIEU duoc goi that.
// Neu hinh dang goi lech, no gay ngay o day — chu khong lang le mat 80 mon hang nhu lan truoc.
//
// Cach dung (server tach phai dang chay):
//   node cong-cu/nap-du-lieu-that.js
// Bien moi truong:
//   THU_MUC_THAT   thu muc data cua ban dang chay (mac dinh D:\projects\toprunvn\data)
//   DIA_CHI        goc dia chi ban tach          (mac dinh http://127.0.0.1:4181)
//   MA_QUAN_TRI    ma quan tri cua ban tach      (bat buoc)
//   CHI_XEM=1      chi doc va do, KHONG day gi len

"use strict";

const fs = require("fs");
const path = require("path");

const THU_MUC = process.env.THU_MUC_THAT || path.join("D:", "projects", "toprunvn", "data");
const DIA_CHI = (process.env.DIA_CHI || "http://127.0.0.1:4181").replace(/\/+$/, "");
const MA = String(process.env.MA_QUAN_TRI || "").trim();
const CHI_XEM = String(process.env.CHI_XEM || "").trim() === "1";

function doDai(soByte) {
  return soByte > 1024 * 1024 ? `${(soByte / 1024 / 1024).toFixed(1)} MB` : `${Math.round(soByte / 1024)} KB`;
}

function docTep(ten) {
  const duong = path.join(THU_MUC, ten);
  const tho = fs.readFileSync(duong, "utf8");          // CHI DOC
  return { duLieu: JSON.parse(tho), soByte: Buffer.byteLength(tho) };
}

async function day(duong, than, nhan) {
  const chu = JSON.stringify(than);
  process.stdout.write(`  ${nhan.padEnd(22)} ${doDai(Buffer.byteLength(chu)).padStart(8)} -> `);
  if (CHI_XEM) { console.log("(chi xem, khong day)"); return { ok: true, boQua: true }; }

  const traLoi = await fetch(`${DIA_CHI}${duong}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${MA}` },
    body: chu
  });
  const chuTraLoi = await traLoi.text();
  let ket = null;
  try { ket = JSON.parse(chuTraLoi); } catch { ket = { tho: chuTraLoi.slice(0, 300) }; }
  if (!traLoi.ok) {
    console.log(`LOI ${traLoi.status}: ${JSON.stringify(ket).slice(0, 300)}`);
    return { ok: false, ma: traLoi.status, ket };
  }
  console.log(`OK ${JSON.stringify(ket).slice(0, 160)}`);
  return { ok: true, ket };
}

async function chay() {
  if (!MA && !CHI_XEM) {
    console.error("Can MA_QUAN_TRI (ma quan tri cua ban tach). Hoac dat CHI_XEM=1 de chi do.");
    process.exitCode = 1;
    return;
  }
  console.log(`[nap] doc tu ${THU_MUC} (chi doc)`);
  console.log(`[nap] day vao ${DIA_CHI}${CHI_XEM ? " — CHI XEM" : ""}`);

  const viec = [
    { tep: "published-products.json", duong: "/api/products", nhan: "danh muc hang nha" },
    { tep: "ready-stock.json", duong: "/api/ready-stock/sync", nhan: "hang co san" },
    { tep: "partner-campaigns.json", duong: "/api/partner-campaigns", nhan: "chien dich doi tac" }
  ];

  let hong = 0;
  for (const v of viec) {
    let doc;
    try {
      doc = docTep(v.tep);
    } catch (e) {
      console.log(`  ${v.nhan.padEnd(22)} KHONG DOC DUOC: ${e.message}`);
      hong += 1;
      continue;
    }
    const soMon = Array.isArray(doc.duLieu) ? doc.duLieu.length : (doc.duLieu?.products?.length ?? "?");
    console.log(`  ${v.tep.padEnd(28)} ${doDai(doc.soByte).padStart(8)}  ${soMon} mon`);
    const ra = await day(v.duong, doc.duLieu, v.nhan);
    if (!ra.ok) hong += 1;
  }

  // Doi chieu lai: web doc duoc bao nhieu mon.
  if (!CHI_XEM) {
    const traLoi = await fetch(`${DIA_CHI}/api/products`);
    const ds = await traLoi.json();
    console.log(`[nap] web dang thay ${Array.isArray(ds) ? ds.length : "?"} mon.`);
  }

  if (hong > 0) {
    console.error(`[nap] ${hong} viec HONG — xem o tren.`);
    process.exitCode = 1;
  } else {
    console.log("[nap] xong.");
  }
}

chay().catch((e) => {
  console.error("[nap] hong:", e?.stack || e);
  process.exitCode = 1;
});
