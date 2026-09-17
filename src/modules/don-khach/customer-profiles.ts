/**
 * @file THE OWNER'S CUSTOMER BOOK — Sales Desk's `customerProfiles` (Đ2, 17/09/2026).
 *
 * Not the same thing as `customers` (accounts customers register on the website). A profile is
 * what the SHOP knows about a person: name, phone, several delivery addresses, the size they wear,
 * what they run, which brands they like. Desk kept these in the browser's state file; here they are
 * rows, so the second machine sees the address the first one typed.
 *
 * It grows the table the warehouse page already writes (`don_khach_so_khach`): one book, not two.
 *
 * Rules:
 *  - PHONE IS THE MATCH KEY, digits only. Two profiles with the same phone are refused — that is how
 *    one customer ended up with half their orders under each name on the running site.
 *  - ONE DEFAULT ADDRESS per profile; saving a new default clears the old one in the same transaction.
 *  - An order belongs to a profile by `orders.customer_profile_id`; orders with the same phone but
 *    no id are still shown (history), and the "duyệt khách" door writes the id.
 */

import type { ReplyDraft, Row, SchemaStep } from "../../contract";
import { isoFromMysql, toMysqlDateTime } from "../../shared/mysql-time";
import type { OrderContext } from "./context";
import { CONTACTS_TABLE } from "./returns-and-contacts";

export const ADDRESS_TABLE = "don_khach_so_khach_dia_chi";

export const PROFILE_SCHEMA: SchemaStep[] = [
  {
    name: "009-ho-so-khach",
    tables: [CONTACTS_TABLE, ADDRESS_TABLE],
    sql: `
ALTER TABLE don_khach_so_khach
  ADD COLUMN size_quen VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN form_chan VARCHAR(190) NOT NULL DEFAULT '',
  ADD COLUMN mon_choi VARCHAR(190) NOT NULL DEFAULT '',
  ADD COLUMN hang_thich VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN tom_tat TEXT NULL,
  ADD COLUMN nguon VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN email VARCHAR(190) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS don_khach_so_khach_dia_chi (
  ma VARCHAR(64) NOT NULL,
  ma_khach VARCHAR(64) NOT NULL,
  nguoi_nhan VARCHAR(190) NOT NULL DEFAULT '',
  dien_thoai VARCHAR(32) NOT NULL DEFAULT '',
  he VARCHAR(16) NOT NULL DEFAULT 'ba-cap',
  tinh VARCHAR(190) NOT NULL DEFAULT '',
  huyen VARCHAR(190) NOT NULL DEFAULT '',
  xa VARCHAR(190) NOT NULL DEFAULT '',
  chi_tiet VARCHAR(255) NOT NULL DEFAULT '',
  mac_dinh TINYINT(1) NOT NULL DEFAULT 0,
  tao_luc DATETIME NOT NULL,
  sua_luc DATETIME NOT NULL,
  PRIMARY KEY (ma),
  KEY idx_so_khach_dia_chi_khach (ma_khach)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`
  }
];

const text = (v: unknown): string => String(v ?? "").trim();
const digits = (v: unknown): string => text(v).replace(/[^0-9+]/g, "").slice(0, 32);
const refuse = (status: number, error: string, message: string): ReplyDraft => ({ status, body: { ok: false, error, message } });
const NO_STORE = { "Cache-Control": "no-store" };
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export interface ProfileAddress {
  ma: string; nguoiNhan: string; dienThoai: string; he: string;
  tinh: string; huyen: string; xa: string; chiTiet: string; macDinh: boolean;
}

function addressWire(r: Row): ProfileAddress {
  return {
    ma: text(r["ma"]), nguoiNhan: text(r["nguoi_nhan"]), dienThoai: text(r["dien_thoai"]), he: text(r["he"]) || "ba-cap",
    tinh: text(r["tinh"]), huyen: text(r["huyen"]), xa: text(r["xa"]), chiTiet: text(r["chi_tiet"]), macDinh: Number(r["mac_dinh"] || 0) === 1
  };
}

function profileWire(r: Row, extra: { soDon?: number; tongTien?: number; diaChiMacDinh?: ProfileAddress | null } = {}): Record<string, unknown> {
  return {
    ma: text(r["ma"]), ten: text(r["ten"]), dienThoai: text(r["dien_thoai"]), email: text(r["email"]),
    // `diaChi` / `ghiChu` kept: the warehouse page reads them.
    diaChi: text(r["dia_chi"]), ghiChu: text(r["ghi_chu"]),
    sizeQuen: text(r["size_quen"]), formChan: text(r["form_chan"]), monChoi: text(r["mon_choi"]),
    hangThich: text(r["hang_thich"]), tomTat: text(r["tom_tat"]), nguon: text(r["nguon"]) || "nhap-tay",
    taoLuc: isoFromMysql(r["tao_luc"]), suaLuc: isoFromMysql(r["sua_luc"]),
    ...(extra.soDon === undefined ? {} : { soDon: extra.soDon, tongTien: extra.tongTien ?? 0 }),
    ...(extra.diaChiMacDinh === undefined ? {} : { diaChiMacDinh: extra.diaChiMacDinh })
  };
}

/** Order count and money per phone, for the listed profiles only (one statement). */
async function ordersByPhone(ctx: OrderContext, phones: string[]): Promise<Map<string, { soDon: number; tongTien: number }>> {
  const out = new Map<string, { soDon: number; tongTien: number }>();
  const wanted = [...new Set(phones.filter(Boolean))];
  if (wanted.length === 0) return out;
  const rows = await ctx.ports.store.rows(
    `SELECT phone, COUNT(*) AS so_don, COALESCE(SUM(total), 0) AS tong FROM orders WHERE phone IN (${wanted.map(() => "?").join(",")}) AND deleted_at IS NULL GROUP BY phone`,
    wanted
  );
  for (const r of rows) out.set(text(r["phone"]), { soDon: Number(r["so_don"] || 0), tongTien: Number(r["tong"] || 0) });
  return out;
}

export async function listProfiles(ctx: OrderContext, q: string, limit: number): Promise<ReplyDraft> {
  const cap = Math.min(Math.max(1, Number(limit) || 300), 2000);
  const query = text(q);
  const rows = query === ""
    ? await ctx.ports.store.table(CONTACTS_TABLE).find({ orderBy: "sua_luc desc", limit: cap })
    : await ctx.ports.store.rows(
      `SELECT * FROM ${CONTACTS_TABLE} WHERE ten LIKE ? OR dien_thoai LIKE ? OR dia_chi LIKE ? OR ghi_chu LIKE ? OR tom_tat LIKE ? ORDER BY sua_luc DESC LIMIT ?`,
      [`%${query}%`, `%${digits(query) || query}%`, `%${query}%`, `%${query}%`, `%${query}%`, cap]
    );
  const counts = await ordersByPhone(ctx, rows.map((r) => text(r["dien_thoai"])));
  const ids = rows.map((r) => text(r["ma"]));
  const defaults = new Map<string, ProfileAddress>();
  if (ids.length > 0) {
    const addr = await ctx.ports.store.rows(`SELECT * FROM ${ADDRESS_TABLE} WHERE ma_khach IN (${ids.map(() => "?").join(",")}) AND mac_dinh = 1`, ids);
    for (const a of addr) defaults.set(text(a["ma_khach"]), addressWire(a));
  }
  const khach = rows.map((r) => {
    const c = counts.get(text(r["dien_thoai"])) ?? { soDon: 0, tongTien: 0 };
    return profileWire(r, { soDon: c.soDon, tongTien: c.tongTien, diaChiMacDinh: defaults.get(text(r["ma"])) ?? null });
  });
  return { status: 200, headers: NO_STORE, body: { ok: true, khach } };
}

/** One profile with its address book and its orders (by profile id, or same phone). */
export async function readProfile(ctx: OrderContext, id: string): Promise<ReplyDraft> {
  const row = await ctx.ports.store.table(CONTACTS_TABLE).one({ ma: text(id) });
  if (!row) return refuse(404, "khong_thay", "Không thấy hồ sơ khách này.");
  const addresses = await ctx.ports.store.table(ADDRESS_TABLE).find({ where: { ma_khach: text(id) }, orderBy: "tao_luc asc" });
  const phone = text(row["dien_thoai"]);
  const orders = await ctx.ports.store.rows(
    `SELECT id, total, status, created_at, payment_amount FROM orders WHERE (customer_profile_id = ? OR (? <> '' AND phone = ?)) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`,
    [text(id), phone, phone]
  );
  return {
    status: 200, headers: NO_STORE,
    body: {
      ok: true,
      khach: profileWire(row),
      diaChi: addresses.map(addressWire),
      don: orders.map((o) => ({ maDon: text(o["id"]), tong: Number(o["total"] || 0), daTra: Number(o["payment_amount"] || 0), trangThai: text(o["status"]), taoLuc: isoFromMysql(o["created_at"]) }))
    }
  };
}

/** By phone — the order editor's "Tìm khách". */
export async function findProfileByPhone(ctx: OrderContext, phone: string): Promise<Row | null> {
  const p = digits(phone);
  if (p === "") return null;
  return ctx.ports.store.table(CONTACTS_TABLE).one({ dien_thoai: p });
}

export async function saveProfile(ctx: OrderContext, body: Record<string, unknown>): Promise<ReplyDraft> {
  const name = text(body["ten"]).slice(0, 190);
  if (!name) return refuse(400, "thieu_ten", "Khách hàng cần có tên.");
  const phone = digits(body["dienThoai"]);
  const table = ctx.ports.store.table(CONTACTS_TABLE);
  const id = text(body["ma"]) || newId("kh");
  const existing = await table.one({ ma: id });
  if (text(body["ma"]) !== "" && !existing) return refuse(404, "khong_thay", "Không thấy hồ sơ khách này.");
  if (phone !== "") {
    const same = await table.one({ dien_thoai: phone });
    if (same && text(same["ma"]) !== id) return refuse(409, "trung_dien_thoai", `Số ${phone} đã thuộc hồ sơ "${text(same["ten"])}".`);
  }
  const now = toMysqlDateTime(ctx.ports.clock.now());
  const keep = (key: string, column: string, max: number) => (body[key] === undefined ? text(existing?.[column]) : text(body[key]).slice(0, max));
  await table.upsert({
    ma: id, ten: name, dien_thoai: phone,
    email: keep("email", "email", 190).toLowerCase(),
    dia_chi: keep("diaChi", "dia_chi", 500), ghi_chu: keep("ghiChu", "ghi_chu", 500),
    size_quen: keep("sizeQuen", "size_quen", 64), form_chan: keep("formChan", "form_chan", 190),
    mon_choi: keep("monChoi", "mon_choi", 190), hang_thich: keep("hangThich", "hang_thich", 500),
    tom_tat: keep("tomTat", "tom_tat", 5000), nguon: keep("nguon", "nguon", 64) || "nhap-tay",
    tao_luc: existing ? existing["tao_luc"] : now, sua_luc: now
  });
  // The first address can come with the profile (the editor has one address block).
  const address = body["diaChiMoi"];
  if (address && typeof address === "object") {
    const saved = await writeAddress(ctx, id, address as Record<string, unknown>, { name, phone });
    if (saved.status !== 200) return saved;
  }
  return readProfile(ctx, id).then((r) => ({ ...r, body: { ...(r.body as Record<string, unknown>), taoMoi: !existing } }));
}

async function writeAddress(ctx: OrderContext, profileId: string, a: Record<string, unknown>, fallback: { name: string; phone: string }): Promise<ReplyDraft> {
  const tinh = text(a["tinh"]).slice(0, 190);
  const xa = text(a["xa"]).slice(0, 190);
  const chiTiet = text(a["chiTiet"] ?? a["diaChiChiTiet"]).slice(0, 255);
  if (tinh === "" && xa === "" && chiTiet === "") return refuse(400, "dia_chi_trong", "Địa chỉ cần ít nhất số nhà hoặc tỉnh/xã.");
  const table = ctx.ports.store.table(ADDRESS_TABLE);
  const id = text(a["ma"]) || newId("dc");
  const existing = await table.one({ ma: id });
  if (text(a["ma"]) !== "" && (!existing || text(existing["ma_khach"]) !== profileId)) return refuse(404, "khong_thay", "Không thấy địa chỉ này trong hồ sơ.");
  const count = (await table.find({ where: { ma_khach: profileId } })).length;
  // The first address is the default; later ones only when asked.
  const makeDefault = a["macDinh"] === true || count === 0 || (count === 1 && existing !== null);
  const now = toMysqlDateTime(ctx.ports.clock.now());
  await ctx.ports.store.transaction(async (tx) => {
    if (makeDefault) await tx.table(ADDRESS_TABLE).update({ ma_khach: profileId }, { mac_dinh: 0 });
    await tx.table(ADDRESS_TABLE).upsert({
      ma: id, ma_khach: profileId,
      nguoi_nhan: text(a["nguoiNhan"]).slice(0, 190) || fallback.name,
      dien_thoai: digits(a["dienThoai"]) || fallback.phone,
      he: text(a["he"]) === "hai-cap" ? "hai-cap" : "ba-cap",
      tinh, huyen: text(a["he"]) === "hai-cap" ? "" : text(a["huyen"]).slice(0, 190), xa, chi_tiet: chiTiet,
      mac_dinh: makeDefault ? 1 : Number(existing?.["mac_dinh"] || 0),
      tao_luc: existing ? existing["tao_luc"] : now, sua_luc: now
    });
    // The one-line address the warehouse page shows follows the default address.
    if (makeDefault) {
      await tx.table(CONTACTS_TABLE).update({ ma: profileId }, { dia_chi: [chiTiet, xa, text(a["huyen"]), tinh].filter(Boolean).join(", ").slice(0, 500), sua_luc: now });
    }
  });
  return { status: 200, headers: NO_STORE, body: { ok: true, ma: id } };
}

export async function saveProfileAddress(ctx: OrderContext, profileId: string, body: Record<string, unknown>): Promise<ReplyDraft> {
  const profile = await ctx.ports.store.table(CONTACTS_TABLE).one({ ma: text(profileId) });
  if (!profile) return refuse(404, "khong_thay", "Không thấy hồ sơ khách này.");
  const saved = await writeAddress(ctx, text(profileId), body, { name: text(profile["ten"]), phone: text(profile["dien_thoai"]) });
  if (saved.status !== 200) return saved;
  return readProfile(ctx, text(profileId));
}

export async function deleteProfileAddress(ctx: OrderContext, profileId: string, addressId: string): Promise<ReplyDraft> {
  const table = ctx.ports.store.table(ADDRESS_TABLE);
  const row = await table.one({ ma: text(addressId) });
  if (!row || text(row["ma_khach"]) !== text(profileId)) return refuse(404, "khong_thay", "Không thấy địa chỉ này trong hồ sơ.");
  await table.delete({ ma: text(addressId) });
  // Deleting the default promotes the oldest remaining address, so a profile with addresses always has one.
  if (Number(row["mac_dinh"] || 0) === 1) {
    const rest = await table.find({ where: { ma_khach: text(profileId) }, orderBy: "tao_luc asc", limit: 1 });
    if (rest[0]) await table.update({ ma: text(rest[0]["ma"]) }, { mac_dinh: 1 });
  }
  return readProfile(ctx, text(profileId));
}
