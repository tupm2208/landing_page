/**
 * @file Two things the warehouse page (`/warehouse`, Sales Desk's `warehouse.html`) does with orders
 * and customers that the order screens did not:
 *
 * 1. A PARTIAL RETURN of one line: N pairs come back and go into a CHOSEN warehouse — the page's rule
 *    "hoàn đơn luôn nhập về kho sẵn", whatever warehouse the pair was sold from. The pairs go through
 *    Inventory's stock book (`hang-kho.restockInto`), and the return is written on the order, so
 *    returning more than was sold is refused however many times someone clicks.
 * 2. A CONTACT BOOK: a customer typed in by hand (name, phone, address, note), who never made an
 *    account and may never have ordered on the web. Kept apart from `customers` (the running site's
 *    ACCOUNTS table: e-mail, password) — a phone number written at the counter is not an account.
 */

import type { ReplyDraft, SchemaStep } from "../../contract";
import { isoFromMysql, toMysqlDateTime } from "../../shared/mysql-time";
import type { OrderContext } from "./context";
import { repositoryOf } from "./context";

export const RETURNS_TABLE = "don_khach_hoan_hang";
export const CONTACTS_TABLE = "don_khach_so_khach";

export const RETURNS_AND_CONTACTS_SCHEMA: SchemaStep[] = [
  {
    name: "007-hoan-hang-va-so-khach",
    tables: [RETURNS_TABLE, CONTACTS_TABLE],
    sql: `
CREATE TABLE IF NOT EXISTS don_khach_hoan_hang (
  ma BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ma_don VARCHAR(64) NOT NULL,
  ma_dong VARCHAR(160) NOT NULL,
  so_luong INT NOT NULL,
  ma_kho VARCHAR(128) NOT NULL DEFAULT '',
  ghi_chu VARCHAR(255) NOT NULL DEFAULT '',
  boi VARCHAR(190) NOT NULL DEFAULT '',
  luc DATETIME NOT NULL,
  PRIMARY KEY (ma),
  KEY idx_don_khach_hoan_hang_don (ma_don, ma_dong)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS don_khach_so_khach (
  ma VARCHAR(64) NOT NULL,
  ten VARCHAR(190) NOT NULL,
  dien_thoai VARCHAR(32) NOT NULL DEFAULT '',
  dia_chi VARCHAR(500) NOT NULL DEFAULT '',
  ghi_chu VARCHAR(500) NOT NULL DEFAULT '',
  tao_luc DATETIME NOT NULL,
  sua_luc DATETIME NOT NULL,
  PRIMARY KEY (ma),
  KEY idx_don_khach_so_khach_dien_thoai (dien_thoai)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`
  }
];

const text = (v: unknown): string => String(v ?? "").trim();
const refuse = (status: number, error: string, message: string): ReplyDraft => ({ status, body: { ok: false, error, message } });

/** Pairs already returned, per line id, for one order. */
export async function returnedByLine(ctx: OrderContext, orderId: string): Promise<Map<string, number>> {
  const rows = await ctx.ports.store.table(RETURNS_TABLE).find({ where: { ma_don: orderId } });
  const out = new Map<string, number>();
  for (const r of rows) out.set(text(r["ma_dong"]), (out.get(text(r["ma_dong"])) ?? 0) + Number(r["so_luong"] || 0));
  return out;
}

export async function returnLine(
  ctx: OrderContext,
  input: { orderId: string; lineId: string; quantity: unknown; warehouseId: unknown; note: unknown; actor: string }
): Promise<ReplyDraft> {
  const restockInto = ctx.services["hang-kho"].restockInto;
  if (!restockInto) return refuse(503, "chua_co_so_kho", "Kho chưa hỗ trợ nhập hàng hoàn theo kho.");
  const quantity = Math.trunc(Number(input.quantity));
  if (!Number.isFinite(quantity) || quantity <= 0) return refuse(400, "so_luong_sai", "Số lượng hoàn phải là số nguyên dương.");
  const warehouseId = text(input.warehouseId);
  if (!warehouseId) return refuse(400, "thieu_kho", "Chọn kho nhận hàng hoàn.");

  const order = await repositoryOf(ctx).read(input.orderId);
  if (!order) return refuse(404, "khong_thay", "Không thấy đơn hàng.");
  const line = order.items.find((l) => l.maDong === input.lineId);
  if (!line) return refuse(404, "khong_thay_dong", `Đơn ${order.id} không có dòng "${input.lineId}".`);
  const already = (await returnedByLine(ctx, order.id)).get(line.maDong) ?? 0;
  if (already + quantity > line.quantity) {
    return refuse(409, "hoan_qua_so_ban", `Dòng này bán ${line.quantity}, đã hoàn ${already} — không hoàn thêm ${quantity} được.`);
  }

  const at = ctx.ports.clock.now();
  const outcome = await restockInto({
    code: line.productCode, size: line.size, warehouseId, quantity,
    note: `Hoàn từ đơn ${order.id}${text(input.note) ? ` — ${text(input.note)}` : ""}`, actor: input.actor, reference: order.id
  });
  if (!outcome.ok) return refuse(400, outcome.reason, outcome.message);
  await ctx.ports.store.table(RETURNS_TABLE).insert({
    ma_don: order.id, ma_dong: line.maDong, so_luong: quantity, ma_kho: warehouseId,
    ghi_chu: text(input.note).slice(0, 255), boi: input.actor.slice(0, 190), luc: toMysqlDateTime(at)
  });
  ctx.ports.logger.info(`[don-khach] hoàn ${quantity} đôi ${line.productCode}/${line.size} của đơn ${order.id} về kho ${warehouseId}`);
  return { status: 200, body: { ok: true, maDon: order.id, maDong: line.maDong, daHoan: already + quantity, tonSau: outcome.after } };
}

/** Every return of recent orders — the warehouse page draws them under each order. */
export async function listReturns(ctx: OrderContext, limit = 500): Promise<Record<string, unknown>[]> {
  const rows = await ctx.ports.store.table(RETURNS_TABLE).find({ orderBy: "ma desc", limit: Math.min(Math.max(1, limit), 2000) });
  return rows.map((r) => ({
    maDon: text(r["ma_don"]), maDong: text(r["ma_dong"]), soLuong: Number(r["so_luong"] || 0), maKho: text(r["ma_kho"]),
    ghiChu: text(r["ghi_chu"]), boi: text(r["boi"]), luc: isoFromMysql(r["luc"])
  }));
}

export async function saveContact(ctx: OrderContext, body: Record<string, unknown>): Promise<ReplyDraft> {
  const name = text(body["ten"] ?? body["name"]).slice(0, 190);
  if (!name) return refuse(400, "thieu_ten", "Khách hàng cần có tên.");
  const now = toMysqlDateTime(ctx.ports.clock.now());
  const id = text(body["ma"] ?? body["id"]) || `kh_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const table = ctx.ports.store.table(CONTACTS_TABLE);
  const existing = await table.one({ ma: id });
  await table.upsert({
    ma: id, ten: name,
    dien_thoai: text(body["dienThoai"] ?? body["phone"]).replace(/[^0-9+]/g, "").slice(0, 32),
    dia_chi: text(body["diaChi"] ?? body["address"]).slice(0, 500),
    ghi_chu: text(body["ghiChu"] ?? body["note"]).slice(0, 500),
    tao_luc: existing ? existing["tao_luc"] : now, sua_luc: now
  });
  return { status: 200, body: { ok: true, ma: id, taoMoi: !existing } };
}

export async function listContacts(ctx: OrderContext, limit = 500): Promise<Record<string, unknown>[]> {
  const rows = await ctx.ports.store.table(CONTACTS_TABLE).find({ orderBy: "sua_luc desc", limit: Math.min(Math.max(1, limit), 2000) });
  return rows.map((r) => ({
    ma: text(r["ma"]), ten: text(r["ten"]), dienThoai: text(r["dien_thoai"]), diaChi: text(r["dia_chi"]), ghiChu: text(r["ghi_chu"]),
    taoLuc: isoFromMysql(r["tao_luc"]), suaLuc: isoFromMysql(r["sua_luc"])
  }));
}
