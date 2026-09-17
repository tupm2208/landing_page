/**
 * @file Loads the REAL purchasing partners and their work into the split build.
 *
 * Reads `data/partner-portal.json` of the running site (READ ONLY — the snapshot Sales Desk pushed:
 * partners, the orders they buy for, purchase sessions, payments) and writes the `mua_ho_*` tables,
 * plus the partner fields on `order_items`.
 *
 * WHY EACH PART MATTERS — skip one and the portal lies:
 *   1. PARTNERS, ids kept (`partner_yen`…): the portal page's name map and every order line point at
 *      them. Password hashes are copied as they are — same PBKDF2 format — so partners log in with
 *      their old passwords. Partners who never had one stay without: the shop sets it.
 *   2. ORDER LINES get `partner_id`, `purchase_authorized`, `procurement_status`, `cost_price` from
 *      the snapshot. The portal shows a partner ONLY lines given to them; without this step every
 *      partner's list is empty.
 *   3. PURCHASES: one slip per allocation not undone. Keyed by the line id the split build uses
 *      (`order_items.line_id`), found by position and checked against code + size — the snapshot's own
 *      `line_…` ids exist nowhere in MySQL. Skip this and every bought line shows as "cần mua" again,
 *      and what the shop owes resets to zero. Slips of one session share a command id (`<phiên>#n`),
 *      so the page draws them as one session, as before.
 *   4. Allocations of 0 marked final are OUT-OF-STOCK reports; packing states and fee payments follow.
 *
 * NEVER: writes the running site's files, touches 3306 without `CHE_DO_THAT=1`, overwrites a partner
 * that already exists (unless `GHI_DE=1`), or overwrites a line already given to a partner.
 *
 *   TOPRUN_MYSQL_URL=mysql://…@127.0.0.1:3307/toprun_chay_thu node dist/tools/import-partners.js
 *   THU_MUC_THAT  data directory of the running site (default D:\projects\toprunvn\data)
 *   CHI_XEM=1     count only, write nothing
 *   GHI_DE=1      overwrite existing partners
 */

import fs from "node:fs";
import path from "node:path";
import type { DataStore, Row } from "../contract";
import { ConsoleLogger, openMysqlStore } from "../kernel";
import { toMysqlDateTime } from "../shared/mysql-time";
import { orderLineId } from "../shared/order-line-id";
import { manifest as orders } from "../modules/don-khach/module";
import { manifest as purchasing } from "../modules/mua-ho/module";
import { normaliseFeeMode } from "../modules/mua-ho/portal-state";
import { LEDGER_TABLE, PACKING_TABLE, PARTNERS_TABLE, PURCHASES_TABLE, STOCK_OUTS_TABLE } from "../modules/mua-ho/schema";

const SOURCE_DIR = process.env["THU_MUC_THAT"] || path.join("D:", "projects", "toprunvn", "data");
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const DRY_RUN = String(process.env["CHI_XEM"] || "").trim() === "1";
const OVERWRITE = String(process.env["GHI_DE"] || "").trim() === "1";

type Json = Record<string, unknown>;
const text = (v: unknown, max = 190): string => String(v ?? "").trim().slice(0, max);
const lower = (v: unknown): string => text(v, 500).toLowerCase();
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter((x): x is Json => !!x && typeof x === "object") : []);
const mysqlTime = (v: unknown, fallback: Date): string => {
  const t = new Date(String(v || ""));
  return toMysqlDateTime(Number.isNaN(t.getTime()) ? fallback : t, { ms: true });
};

/** The partner a snapshot line was given to. */
function partnerOfLine(item: Json): string {
  const ids = Array.isArray(item["partnerIds"]) ? (item["partnerIds"] as unknown[]).map((x) => text(x)).filter(Boolean) : [];
  return ids[0] || text(item["partnerId"], 64);
}

/**
 * The MySQL line a snapshot line is: same position if code + size agree there, otherwise the first
 * line of the order with the same code + size. `null` when the order was never loaded.
 */
function matchLine(dbLines: Row[], index: number, code: unknown, size: unknown): Row | null {
  const same = (row: Row | undefined) => !!row && lower(row["product_code"]) === lower(code) && lower(row["size"]) === lower(size);
  if (same(dbLines[index])) return dbLines[index]!;
  return dbLines.find((row) => same(row)) ?? null;
}

async function linesOf(store: DataStore, cache: Map<string, Row[]>, orderId: string): Promise<Row[]> {
  let rows = cache.get(orderId);
  if (!rows) {
    rows = await store.table("order_items").find({ where: { order_id: orderId }, orderBy: "line_no asc" });
    cache.set(orderId, rows);
  }
  return rows;
}

async function main(): Promise<void> {
  if (!URL) { console.error("Cần TOPRUN_MYSQL_URL (cổng 3307 — cổng 3306 là dữ liệu thật của landing)."); process.exitCode = 1; return; }
  if (/:3306\//.test(URL) && String(process.env["CHE_DO_THAT"] || "").trim() !== "1") {
    throw new Error("TOPRUN_MYSQL_URL trỏ vào cổng 3306 (dữ liệu thật) mà chưa đặt CHE_DO_THAT=1 — bản thử chỉ dùng 3307.");
  }

  const file = path.join(SOURCE_DIR, "partner-portal.json");
  if (!fs.existsSync(file)) { console.log(`[nap-doi-tac] không có ${file} — bỏ qua.`); return; }
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as Json;   // READ ONLY
  const partners = list(data["procurementPartners"]);
  const snapshotOrders = list(data["orders"]);
  const sessions = list(data["procurementPurchases"]);
  const payments = list(data["partnerFeePayments"]);
  console.log(`[nap-doi-tac] đọc ${file} (chỉ đọc): ${partners.length} đối tác, ${snapshotOrders.length} đơn, ${sessions.length} phiên mua, ${payments.length} lần trả tiền`);
  if (DRY_RUN) console.log("[nap-doi-tac] CHI_XEM=1 — chỉ đếm, không ghi gì.");

  const store = await openMysqlStore({ url: URL, logger: new ConsoleLogger() });
  try {
    for (const m of [orders, purchasing]) await store.runSchema(m.id, m.schema ?? [], { inheritedTables: m.inheritedTables ?? [] });
    const now = new Date();

    // ---- 1. partners ----
    let partnersWritten = 0, partnersKept = 0;
    const loginsTaken = new Set((await store.table(PARTNERS_TABLE).find({ columns: ["ma", "dang_nhap"] })).map((r) => `${text(r["dang_nhap"])}|${text(r["ma"])}`));
    for (const p of partners) {
      const id = text(p["id"], 64);
      const portalCode = text(p["portalToken"], 128);
      if (!id || !portalCode) { console.log(`  bỏ đối tác ${id || "(không mã)"}: thiếu mã hoặc mã cổng`); continue; }
      const existing = await store.table(PARTNERS_TABLE).one({ ma: id });
      if (existing && !OVERWRITE) { partnersKept += 1; continue; }
      const hash = String(p["passwordHash"] || "");
      const login = lower(p["login"]).slice(0, 190);
      const clash = login && [...loginsTaken].some((k) => k.startsWith(`${login}|`) && !k.endsWith(`|${id}`));
      console.log(`  ${id.padEnd(28)} ${text(p["name"]).padEnd(14)} đăng nhập: ${login || "-"}${hash.startsWith("pbkdf2$") ? "" : "  (CHƯA CÓ MẬT KHẨU — chủ shop đặt)"}${clash ? "  (TRÙNG tên đăng nhập — bỏ tên)" : ""}`);
      partnersWritten += 1;
      if (DRY_RUN) continue;
      await store.table(PARTNERS_TABLE).upsert({
        ma: id, ten: text(p["name"]) || id, ma_cong: portalCode,
        trang_thai: text(p["status"], 32) === "inactive" ? "inactive" : "active",
        dien_thoai: text(p["phone"], 32),
        tinh: text(p["addressProvince"]), huyen: text(p["addressDistrict"]), xa: text(p["addressWard"]),
        dia_chi_chi_tiet: text(p["addressDetail"] || p["address"], 255),
        dang_nhap: login && !clash ? login : null,
        bam_mat_khau: hash.startsWith("pbkdf2$") ? hash : "",
        bam_cap_luc: p["passwordUpdatedAt"] ? mysqlTime(p["passwordUpdatedAt"], now).slice(0, 19) : null,
        cong_moi_mon: Math.max(0, num(p["productFee"])),
        cong_moi_don: Math.max(0, num(p["orderFee"])),
        cach_tinh: normaliseFeeMode(p["feeMode"]),
        sua_luc: mysqlTime(p["updatedAt"], now)
      });
    }
    console.log(`[nap-doi-tac] đối tác: ${DRY_RUN ? "sẽ ghi" : "đã ghi"} ${partnersWritten}, đã có ${partnersKept}.`);

    // ---- 2. order lines ----
    const cache = new Map<string, Row[]>();
    let linesGiven = 0, linesKept = 0, ordersMissing = 0;
    for (const order of snapshotOrders) {
      const orderId = text(order["id"], 64);
      const dbLines = orderId ? await linesOf(store, cache, orderId) : [];
      if (dbLines.length === 0) { ordersMissing += 1; continue; }
      const items = list(order["items"]);
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i]!;
        const partnerId = partnerOfLine(item);
        if (!partnerId) continue;
        const line = matchLine(dbLines, i, item["productCode"], item["size"]);
        if (!line) continue;
        if (text(line["partner_id"]) !== "") { linesKept += 1; continue; }   // the split build already decided
        linesGiven += 1;
        if (DRY_RUN) continue;
        const cost = num(item["costPrice"]) || num(item["saleFilePrice"]);
        await store.table("order_items").update({ id: line["id"] as number }, {
          partner_id: partnerId,
          procurement_status: text(item["procurementStatus"], 48),
          purchase_authorized: item["purchaseAuthorized"] === true ? 1 : 0,
          ...(num(line["cost_price"]) === 0 && cost > 0 ? { cost_price: cost } : {})
        });
        line["partner_id"] = partnerId;
      }
    }
    console.log(`[nap-doi-tac] dòng đơn: ${DRY_RUN ? "sẽ gán" : "đã gán"} đối tác cho ${linesGiven}, đã có sẵn ${linesKept}; ${ordersMissing} đơn trong bản chụp không có trong sổ (bỏ qua dòng, vẫn nạp phiếu mua để công nợ đúng).`);

    // ---- 3. purchases and out-of-stock reports ----
    let slips = 0, slipsKept = 0, undone = 0, outs = 0, unmatched = 0;
    for (const session of sessions) {
      const sessionId = text(session["id"], 100);
      const allocations = list(session["allocations"]);
      for (let n = 0; n < allocations.length; n += 1) {
        const a = allocations[n]!;
        if (a["undoneAt"]) { undone += 1; continue; }
        const partnerId = text(a["partnerId"] || session["partnerId"], 64);
        const orderId = text(a["orderId"], 64);
        const index = Math.max(0, Math.trunc(num(a["lineIndex"])));
        const dbLines = orderId ? await linesOf(store, cache, orderId) : [];
        const line = matchLine(dbLines, index, a["productCode"], a["size"]);
        // An order the split build never loaded still earned the partner a fee: keep the slip, keyed as the old backfill would.
        // An empty column (orders copied in with phpMyAdmin) is keyed exactly as the order screen computes it.
        const lineId = line ? (text(line["line_id"], 160) || orderLineId(orderId, "", line["variant_id"], dbLines.indexOf(line))) : `${orderId}#${index + 1}`;
        if (!line) unmatched += 1;
        const quantity = Math.max(0, Math.trunc(num(a["quantity"])));
        const at = mysqlTime(a["respondedAt"] || session["createdAt"], now);

        if (quantity === 0) {
          if (a["responseFinal"] !== true) continue;
          outs += 1;
          if (DRY_RUN) continue;
          await store.table(STOCK_OUTS_TABLE).upsert({
            ma_dong: lineId, ma_doi_tac: partnerId, ma_don: orderId, ma_mon: text(a["productCode"], 128), size: text(a["size"], 64),
            ly_do: "Nạp từ bản cũ", bao_luc: at
          });
          continue;
        }

        const slipId = text(a["allocationId"], 64) || `${sessionId}_${n}`.slice(0, 64);
        if (await store.table(PURCHASES_TABLE).one({ ma_phieu: slipId })) { slipsKept += 1; continue; }
        slips += 1;
        if (DRY_RUN) continue;
        const systemCost = num(a["unitCost"]);
        await store.table(PURCHASES_TABLE).insert({
          ma_phieu: slipId, ma_doi_tac: partnerId, ma_don: orderId, ma_dong: lineId,
          ma_mon: text(a["productCode"], 128), size: text(a["size"], 64), so_luong: quantity,
          gia_von: num(a["actualCostPrice"]) || systemCost, gia_he_thong: systemCost,
          ma_lenh: `${sessionId}#${n}`.slice(0, 128), ghi_chu: "", tao_luc: at
        });
      }
    }
    console.log(`[nap-doi-tac] phiếu mua: ${DRY_RUN ? "sẽ ghi" : "đã ghi"} ${slips}, đã có ${slipsKept}, bỏ ${undone} đã hoàn tác; báo hết ${outs}; ${unmatched} lượt không khớp dòng trong sổ.`);

    // ---- 4. packing and payments ----
    let packed = 0, paid = 0;
    for (const order of snapshotOrders) {
      const statuses = order["partnerPackingStatuses"];
      if (!statuses || typeof statuses !== "object") continue;
      for (const [partnerId, entry] of Object.entries(statuses as Record<string, Json>)) {
        packed += 1;
        if (DRY_RUN) continue;
        await store.table(PACKING_TABLE).upsert({
          ma_don: text(order["id"], 64), ma_doi_tac: text(partnerId, 64),
          trang_thai: text(entry?.["status"]) === "packed" ? "packed" : "pending",
          boi: text(entry?.["updatedBy"]), sua_luc: mysqlTime(entry?.["updatedAt"], now)
        });
      }
    }
    for (const payment of payments) {
      if (payment["voidedAt"]) continue;
      const id = text(payment["id"], 64) || `tien_cu_${paid}`;
      if (await store.table(LEDGER_TABLE).one({ ma: id })) continue;
      paid += 1;
      if (DRY_RUN) continue;
      await store.table(LEDGER_TABLE).insert({
        ma: id, ma_doi_tac: text(payment["partnerId"], 64), loai: "tra", so_tien: Math.max(0, num(payment["amount"])),
        ghi_chu: text(payment["note"], 255), boi: "nap-tu-ban-cu", tao_luc: mysqlTime(payment["paidAt"] || payment["createdAt"], now)
      });
    }
    console.log(`[nap-doi-tac] đóng gói: ${packed}; trả tiền đối tác: ${paid}.`);
  } finally {
    await store.close();
  }
}

main().catch((e: unknown) => { console.error("[nap-doi-tac] hỏng:", e instanceof Error ? e.stack ?? e.message : String(e)); process.exitCode = 1; });
