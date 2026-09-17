/**
 * @file Loads the REAL orders into the split build — so the admin screen shows real orders.
 *
 * Allowed 12/09/2026. Reads TWO files of the running site and writes into the split build's MySQL:
 *   data/orders.json         web orders (the landing's JSON backup)
 *   data/manual-orders.json  Sales Desk manual orders (ids MAN-*)
 *
 * FOUR THINGS IT NEVER DOES:
 *   1. WRITE into the running site's directory — files are opened read-only.
 *   2. TOUCH MySQL on port 3306 (real data). Throws if the URL points there.
 *   3. OVERWRITE existing orders: by default an existing id is SKIPPED. `GHI_DE=1` overwrites.
 *   4. COMPUTE money itself. `paidAmount` / `remainingAmount` of manual orders are kept as recorded,
 *      and the order-money kit reads them back — nobody adds or subtracts here.
 *
 * KNOW BEFORE RUNNING: these are REAL customers — names, phones, addresses. Afterwards the trial
 * machine holds personal data: do not use it as a shared machine, and drop the database when done.
 *
 *   TOPRUN_MYSQL_URL=mysql://root:...@127.0.0.1:3307/toprun_chay_thu node dist/tools/import-orders.js
 *   THU_MUC_THAT  data directory of the running site (default D:\projects\toprunvn\data)
 *   CHI_XEM=1     count only, write nothing
 *   GHI_DE=1      overwrite existing orders
 */

import fs from "node:fs";
import path from "node:path";
import { ConsoleLogger, openMysqlStore } from "../kernel";
import { toMysqlDateTime } from "../shared/mysql-time";
import { orderLineId } from "../shared/order-line-id";
import { annotateOrderMoneyFields } from "../shared/order-money";
import { manifest as orders } from "../modules/don-khach/module";

const SOURCE_DIR = process.env["THU_MUC_THAT"] || path.join("D:", "projects", "toprunvn", "data");
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const DRY_RUN = String(process.env["CHI_XEM"] || "").trim() === "1";
const OVERWRITE = String(process.env["GHI_DE"] || "").trim() === "1";

type Json = Record<string, unknown>;

function readJson(name: string): unknown {
  try { return JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, name), "utf8")); }   // READ ONLY
  catch (e) { if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return null; throw e; }
}

const text = (v: unknown, max = 190) => String(v ?? "").trim().slice(0, max);
const money = (v: unknown) => Math.max(0, Math.round(Number(v || 0)));

/** One order (web or manual) -> a row of `orders`. Column names are the inherited table's. */
function orderRow(order: Json): Json {
  const createdAt = order["createdAt"] ? new Date(String(order["createdAt"])) : new Date();
  const updatedAt = order["updatedAt"] ? new Date(String(order["updatedAt"])) : createdAt;
  const annotated = annotateOrderMoneyFields(order);
  return {
    id: text(order["id"], 64),
    customer_name: text(order["customerName"]),
    phone: text(order["phone"], 32),
    email: text(order["email"]),
    address: text(order["address"], 500),
    province: text(order["province"]),
    district: text(order["district"]),
    ward: text(order["ward"]),
    address_detail: text(order["addressDetail"], 255),
    note: text(order["note"], 2000),
    total: money(order["total"]),
    status: text(order["status"], 48) || "pending",
    payment_status: text(order["paymentStatus"], 48) || "payment_pending",
    payment_method: text(order["paymentMethod"], 64),
    payment_provider: text(order["paymentProvider"], 64),
    payment_reference: text(order["paymentReference"], 128),
    // Keep the amount RECORDED on the order. A manual order carries only `paidAmount`; put it in
    // `payment_amount` so the kit reads back the same paid figure to the dong.
    payment_amount: money(order["paymentAmount"] || annotated.paidAmount || 0),
    order_lookup_token_hash: text(order["lookupTokenHash"] || order["lookupSecretHash"], 128) || null,
    fulfillment_status: text(order["fulfillmentStatus"], 48) || "not_assigned",
    shipping_provider: text(order["shippingProvider"], 100),
    tracking_code: text(order["trackingCode"], 100),
    created_at: toMysqlDateTime(createdAt),
    updated_at: toMysqlDateTime(updatedAt)
  };
}

function itemRows(order: Json): Json[] {
  const items = Array.isArray(order["items"]) ? (order["items"] as Json[]) : [];
  return items.map((m, i) => ({
    order_id: text(order["id"], 64),
    line_no: i + 1,
    // The stable line id, written now: the schema's backfill already ran, and a line without it
    // cannot be found by the doors that look lines up (warehouse, purchase, swap).
    line_id: orderLineId(order["id"], "", m["variantId"], i),
    product_code: text(m["productCode"] || m["code"], 128),
    variant_id: text(m["variantId"], 128),
    product_name: text(m["productName"] || m["name"], 255),
    size: text(m["size"], 64),
    quantity: Math.max(1, Math.trunc(Number(m["qty"] ?? m["quantity"] ?? 1))),
    price: money(m["price"]),
    sale_file_price: money(m["costPrice"] || m["saleFilePrice"] || 0),
    source: text(m["source"], 64),
    source_name: text(m["sourceName"], 190),
    warehouse_id: text(m["warehouseId"], 128),
    warehouse_name: text(m["warehouseName"] || m["warehouse"], 190),
    image_url: text(m["imageUrl"], 500)
  }));
}

interface Stats { written: number; existing: number; skipped: number; wouldWrite: number }

async function main(): Promise<void> {
  if (!URL) { console.error("Cần TOPRUN_MYSQL_URL (cổng 3307 — cổng 3306 là dữ liệu thật của landing)."); process.exitCode = 1; return; }
  if (/:3306\//.test(URL) && String(process.env["CHE_DO_THAT"] || "").trim() !== "1") {
    throw new Error("TOPRUN_MYSQL_URL trỏ vào cổng 3306 (dữ liệu thật) mà chưa đặt CHE_DO_THAT=1 — bản thử chỉ dùng 3307.");
  }

  console.log(`[nap-don] đọc từ ${SOURCE_DIR} (chỉ đọc)`);
  console.log(`[nap-don] ghi vào ${URL.replace(/\/\/[^@]*@/, "//***@")}${DRY_RUN ? " — CHỈ XEM" : ""}`);

  const store = await openMysqlStore({ url: URL, logger: new ConsoleLogger() });
  try {
    // The order tables belong to the orders module: run ITS schema, never create tables here.
    await store.runSchema(orders.id, orders.schema ?? [], { inheritedTables: orders.inheritedTables ?? [] });

    const jobs = [
      { file: "orders.json", label: "đơn web", pick: (d: unknown) => (Array.isArray(d) ? d as Json[] : []) },
      { file: "manual-orders.json", label: "đơn nhập tay Sales Desk", pick: (d: unknown) => (Array.isArray(d) ? d as Json[] : ((d as Json)?.["orders"] as Json[] | undefined) ?? []) }
    ];

    for (const job of jobs) {
      const raw = readJson(job.file);
      if (raw === null) { console.log(`  ${job.file.padEnd(24)} không có — bỏ qua`); continue; }
      const list = job.pick(raw);
      const stats: Stats = { written: 0, existing: 0, skipped: 0, wouldWrite: 0 };
      const table = store.table("orders");
      for (const order of list) {
        const id = text(order?.["id"], 64);
        if (!id) { stats.skipped += 1; continue; }
        const existing = await table.one({ id });
        if (existing && !OVERWRITE) { stats.existing += 1; continue; }
        if (DRY_RUN) { stats.wouldWrite += 1; continue; }
        const row = orderRow(order);
        const items = itemRows(order);
        await store.transaction(async (tx) => {
          if (existing) {
            await tx.table("order_items").delete({ order_id: id });
            await tx.table("orders").update({ id }, row);
          } else {
            await tx.table("orders").insert(row);
          }
          if (items.length) await tx.table("order_items").insertMany(items);
          await tx.table("order_status_logs").insert({ order_id: id, status: row["status"], actor_type: "nhap-tu-ban-dang-chay", note: `Nhập từ ${job.label} của bản đang chạy`, created_at: row["created_at"] });
        });
        stats.written += 1;
      }
      console.log(`  ${job.file.padEnd(24)} ${String(list.length).padStart(4)} đơn -> ${DRY_RUN ? `sẽ ghi ${stats.wouldWrite}` : `ghi ${stats.written}`}, đã có ${stats.existing}, bỏ ${stats.skipped}`);
    }

    const [orderCount] = await store.rows<{ n: number }>("SELECT COUNT(*) AS n FROM orders");
    const [itemCount] = await store.rows<{ n: number }>("SELECT COUNT(*) AS n FROM order_items");
    console.log(`[nap-don] trong sổ giờ có ${orderCount?.n} đơn / ${itemCount?.n} dòng hàng.`);
  } finally {
    await store.close();
  }
}

main().catch((e: unknown) => { console.error("[nap-don] hỏng:", e instanceof Error ? e.stack ?? e.message : String(e)); process.exitCode = 1; });
