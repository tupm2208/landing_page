// NAP DON THAT vao ban tach — de man quan tri co don that ma nhin.
//
// Anh Dung cho phep 12/09/2026 ("t cho phep, lam tat ca di"). Cong cu doc HAI tep cua ban dang
// chay va ghi vao MySQL cua ban tach:
//
//   data/orders.json         don khach dat tren web (ban JSON du phong cua landing)
//   data/manual-orders.json  don Sales Desk nhap tay (ma MAN-*)
//
// BON DIEU NO KHONG LAM:
//
//   1. KHONG GHI vao thu muc cua ban dang chay — mo tep o che do doc, het.
//   2. KHONG CHAM MySQL cong 3306 (du lieu that cua landing). Tu nem neu duong tro vao do.
//   3. KHONG DE DON CU len don da co: mac dinh BO QUA ma don da ton tai. `GHI_DE=1` moi ghi de.
//   4. KHONG tu tinh tien. `paidAmount` / `remainingAmount` cua don nhap tay duoc giu nguyen,
//      va tien tren don van do `order-money-kit` doc ra — khong noi nao tu cong tru.
//
// MOT DIEU PHAI BIET TRUOC KHI CHAY: nhung don nay la DU LIEU KHACH THAT — ten, so dien thoai,
// dia chi. Chay xong la may thu co du lieu ca nhan; dung cho may chung, va xoa khi khong dung nua.
//
// Cach dung:
//   TOPRUN_MYSQL_URL=mysql://root:...@127.0.0.1:3307/toprun_chay_thu node cong-cu/nap-don-that.js
// Bien:
//   THU_MUC_THAT  thu muc data cua ban dang chay (mac dinh D:\projects\toprunvn\data)
//   CHI_XEM=1     chi doc va dem, khong ghi
//   GHI_DE=1      ghi de don da co

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { taoKhoMysql } = require("../loi/cong/kho-mysql");
const { taoNhatKy } = require("../loi/cong/co-ban");
const { gioMySQL } = require("../../chung/gio-mysql.js");
const tienKit = require("../../chung/order-money-kit.js");
const mDonKhach = require("../modules/don-khach/module");

const THU_MUC = process.env.THU_MUC_THAT || path.join("D:", "projects", "toprunvn", "data");
const DUONG = String(process.env.TOPRUN_MYSQL_URL || "").trim();
const CHI_XEM = String(process.env.CHI_XEM || "").trim() === "1";
const GHI_DE = String(process.env.GHI_DE || "").trim() === "1";

function docTep(ten) {
  try {
    return JSON.parse(fs.readFileSync(path.join(THU_MUC, ten), "utf8"));   // CHI DOC
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

function chuoi(g, tran = 190) {
  return String(g ?? "").trim().slice(0, tran);
}

/** Mot don (web hay nhap tay) -> dong cua bang `orders`. */
function dongDon(don) {
  const luc = don.createdAt ? new Date(don.createdAt) : new Date();
  const sua = don.updatedAt ? new Date(don.updatedAt) : luc;
  const daGan = tienKit.annotateOrderMoneyFields(don);
  return {
    id: chuoi(don.id, 64),
    customer_name: chuoi(don.customerName),
    phone: chuoi(don.phone, 32),
    email: chuoi(don.email),
    address: chuoi(don.address, 500),
    province: chuoi(don.province),
    district: chuoi(don.district),
    ward: chuoi(don.ward),
    address_detail: chuoi(don.addressDetail, 255),
    note: chuoi(don.note, 2000),
    total: Math.max(0, Math.round(Number(don.total || 0))),
    status: chuoi(don.status, 48) || "pending",
    payment_status: chuoi(don.paymentStatus, 48) || "payment_pending",
    payment_method: chuoi(don.paymentMethod, 64),
    payment_provider: chuoi(don.paymentProvider, 64),
    payment_reference: chuoi(don.paymentReference, 128),
    // Giu so tien DA GHI tren don. Neu ban dang chay chi co `paidAmount` (don nhap tay) thi dua
    // no vao `payment_amount` — de kit doc ra dung so da tra, khong lech mot dong nao.
    payment_amount: Math.max(0, Math.round(Number(don.paymentAmount || daGan.paidAmount || 0))),
    order_lookup_token_hash: chuoi(don.lookupTokenHash || don.lookupSecretHash, 128) || null,
    fulfillment_status: chuoi(don.fulfillmentStatus, 48) || "not_assigned",
    shipping_provider: chuoi(don.shippingProvider, 100),
    tracking_code: chuoi(don.trackingCode, 100),
    created_at: gioMySQL(luc),
    updated_at: gioMySQL(sua)
  };
}

function dongMon(don) {
  return (Array.isArray(don.items) ? don.items : []).map((m, i) => ({
    order_id: chuoi(don.id, 64),
    line_no: i + 1,
    product_code: chuoi(m.productCode || m.code, 128),
    variant_id: chuoi(m.variantId, 128),
    product_name: chuoi(m.productName || m.name, 255),
    size: chuoi(m.size, 64),
    quantity: Math.max(1, Math.trunc(Number(m.qty ?? m.quantity ?? 1))),
    price: Math.max(0, Math.round(Number(m.price || 0))),
    sale_file_price: Math.max(0, Math.round(Number(m.costPrice || m.saleFilePrice || 0))),
    source: chuoi(m.source, 64),
    source_name: chuoi(m.sourceName, 190),
    warehouse_id: chuoi(m.warehouseId, 128),
    warehouse_name: chuoi(m.warehouseName || m.warehouse, 190),
    image_url: chuoi(m.imageUrl, 500)
  }));
}

async function nap(kho, cacDon, nhan, thongKe) {
  const bangDon = kho.bang("orders");
  for (const don of cacDon) {
    const ma = chuoi(don?.id, 64);
    if (!ma) { thongKe.boQua += 1; continue; }
    const daCo = await bangDon.mot({ id: ma });
    if (daCo && !GHI_DE) { thongKe.daCo += 1; continue; }
    if (CHI_XEM) { thongKe.seGhi += 1; continue; }

    const dong = dongDon(don);
    const mon = dongMon(don);
    await kho.giaoDich(async (trong) => {
      if (daCo) {
        await trong.bang("order_items").xoa({ order_id: ma });
        await trong.bang("orders").thay({ id: ma }, dong);
      } else {
        await trong.bang("orders").them(dong);
      }
      if (mon.length) await trong.bang("order_items").themNhieu(mon);
      await trong.bang("order_status_logs").them({
        order_id: ma, status: dong.status, actor_type: "nhap-tu-ban-dang-chay",
        note: `Nhập từ ${nhan} của bản đang chạy`, created_at: dong.created_at
      });
    });
    thongKe.daGhi += 1;
  }
}

async function chay() {
  if (!DUONG) {
    console.error("Can TOPRUN_MYSQL_URL (cong 3307 — cong 3306 la du lieu that cua landing).");
    process.exitCode = 1;
    return;
  }
  if (/:3306\//.test(DUONG)) throw new Error("TOPRUN_MYSQL_URL tro vao cong 3306 — do la du lieu that cua landing.");

  const nhatKy = taoNhatKy();
  console.log(`[nap-don] doc tu ${THU_MUC} (chi doc)`);
  console.log(`[nap-don] ghi vao ${DUONG.replace(/\/\/[^@]*@/, "//***@")}${CHI_XEM ? " — CHI XEM" : ""}`);

  const kho = await taoKhoMysql({ duongKetNoi: DUONG, nhatKy });
  try {
    // Bang don do module Don hang lam chu — chay dung luoc do cua no, khong tu tao bang.
    await kho.chayLuocDo("don-khach", mDonKhach.luocDo, { bangKeThua: mDonKhach.bangKeThua });

    const viec = [
      { tep: "orders.json", nhan: "đơn web", doc: (d) => (Array.isArray(d) ? d : []) },
      { tep: "manual-orders.json", nhan: "đơn nhập tay Sales Desk", doc: (d) => (Array.isArray(d) ? d : (d?.orders ?? [])) }
    ];

    for (const v of viec) {
      const tho = docTep(v.tep);
      if (tho === null) { console.log(`  ${v.tep.padEnd(24)} khong co — bo qua`); continue; }
      const cacDon = v.doc(tho);
      const thongKe = { daGhi: 0, daCo: 0, boQua: 0, seGhi: 0 };
      await nap(kho, cacDon, v.nhan, thongKe);
      console.log(
        `  ${v.tep.padEnd(24)} ${String(cacDon.length).padStart(4)} đơn -> ` +
        (CHI_XEM ? `sẽ ghi ${thongKe.seGhi}` : `ghi ${thongKe.daGhi}`) +
        `, đã có ${thongKe.daCo}, bỏ ${thongKe.boQua}`
      );
    }

    const [dem] = await kho.cauLenh("SELECT COUNT(*) AS n FROM orders", []);
    const [demMon] = await kho.cauLenh("SELECT COUNT(*) AS n FROM order_items", []);
    console.log(`[nap-don] trong so giờ có ${dem[0].n} đơn / ${demMon[0].n} dòng hàng.`);
  } finally {
    await kho.dong();
  }
}

chay().catch((e) => {
  console.error("[nap-don] hong:", e?.stack || e);
  process.exitCode = 1;
});
