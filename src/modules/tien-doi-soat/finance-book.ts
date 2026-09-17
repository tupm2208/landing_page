/**
 * @file SỔ THU CHI + BÁO CÁO TÀI CHÍNH (Đ4, 17/09/2026) — Sales Desk's `financeTemplate`, on the server.
 *
 * Desk kept manual income/expense in the browser's state and computed profit in the page. Here the
 * book is a table and the numbers come from the server, so two machines of one shop see one profit.
 *
 * THE FORMULA (Desk `financeSummary`):
 *
 *   lãi ước tính = doanh thu + thu khác − giá vốn − phí ship shop chịu − chi phí
 *
 * TWO THINGS THAT ARE EASY TO GET WRONG:
 *
 * 1. PAYING A PARTNER FOR GOODS IS NOT AN EXPENSE. It is recorded in the book (group
 *    `tien_hang_doi_tac`, linked to the partner) so "đã trả tiền hàng" is tracked, but the goods
 *    are ALREADY counted in cost of goods. Counting the transfer again would halve the profit.
 * 2. A WRONG ENTRY IS VOIDED, NOT DELETED — the book keeps what was typed and why it was undone.
 *
 * Every money number of an ORDER (paid, remaining) comes from the order-money kit through Orders;
 * this file only adds them up.
 */

import crypto from "node:crypto";
import type { DataStore, Row, SchemaStep } from "../../contract";
import { isoFromMysql, toMysqlDateTime } from "../../shared/mysql-time";
import { inWindow, type DateWindow } from "../../shared/date-range";

export const ENTRIES_TABLE = "tien_doi_soat_thu_chi";

/** Group of a transfer to a partner for goods — tracked, never counted as an expense (rule 1). */
export const PARTNER_GOODS_GROUP = "tien_hang_doi_tac";

/** Desk's `financeEntryCategoryOptions`, plus the partner-goods group. */
export const ENTRY_GROUPS: Record<string, string> = {
  shipping: "Ship / vận chuyển",
  packaging: "Đóng gói",
  advertising: "Quảng cáo",
  software: "Phần mềm / công cụ",
  salary: "Lương / công xử lý",
  refund: "Hoàn / đổi trả",
  other_income: "Thu khác",
  other_expense: "Chi khác",
  [PARTNER_GOODS_GROUP]: "Tiền hàng đối tác"
};

export const FINANCE_SCHEMA: SchemaStep[] = [
  {
    name: "001-thu-chi",
    tables: [ENTRIES_TABLE],
    sql: `
      CREATE TABLE IF NOT EXISTS tien_doi_soat_thu_chi (
        ma VARCHAR(64) NOT NULL,
        -- 'thu' = income, 'chi' = expense.
        loai VARCHAR(8) NOT NULL DEFAULT 'chi',
        nhom VARCHAR(40) NOT NULL DEFAULT 'other_expense',
        so_tien DECIMAL(14,2) NOT NULL DEFAULT 0,
        ma_don VARCHAR(64) NOT NULL DEFAULT '',
        ma_doi_tac VARCHAR(64) NOT NULL DEFAULT '',
        ghi_chu VARCHAR(500) NOT NULL DEFAULT '',
        boi VARCHAR(190) NOT NULL DEFAULT '',
        tao_luc DATETIME(3) NOT NULL,
        huy_luc DATETIME(3) NULL,
        ly_do_huy VARCHAR(255) NOT NULL DEFAULT '',
        PRIMARY KEY (ma),
        KEY idx_tien_thu_chi_luc (tao_luc),
        KEY idx_tien_thu_chi_doi_tac (ma_doi_tac, tao_luc)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
  }
];

const text = (v: unknown): string => String(v ?? "").trim();
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** One book entry as screens read it (wire names). */
export interface FinanceEntry {
  ma: string;
  loai: "thu" | "chi";
  nhom: string;
  tenNhom: string;
  soTien: number;
  maDon: string;
  maDoiTac: string;
  ghiChu: string;
  boi: string;
  taoLuc: string;
  huyLuc: string;
  lyDoHuy: string;
}

function entryOf(r: Row): FinanceEntry {
  const nhom = text(r["nhom"]);
  return {
    ma: text(r["ma"]), loai: text(r["loai"]) === "thu" ? "thu" : "chi", nhom, tenNhom: ENTRY_GROUPS[nhom] ?? nhom,
    soTien: num(r["so_tien"]), maDon: text(r["ma_don"]), maDoiTac: text(r["ma_doi_tac"]), ghiChu: text(r["ghi_chu"]),
    boi: text(r["boi"]), taoLuc: isoFromMysql(r["tao_luc"]), huyLuc: r["huy_luc"] ? isoFromMysql(r["huy_luc"]) : "", lyDoHuy: text(r["ly_do_huy"])
  };
}

export interface NewEntry {
  loai: "thu" | "chi";
  nhom: string;
  soTien: number;
  maDon: string;
  maDoiTac: string;
  ghiChu: string;
  boi: string;
  at: Date;
}

/** Repository over the book table. */
export class FinanceBook {
  constructor(private readonly store: DataStore) {}

  async add(entry: NewEntry): Promise<FinanceEntry> {
    const ma = `tc_${entry.at.getTime().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
    const row = {
      ma, loai: entry.loai, nhom: entry.nhom.slice(0, 40), so_tien: Math.round(entry.soTien),
      ma_don: entry.maDon.slice(0, 64), ma_doi_tac: entry.maDoiTac.slice(0, 64), ghi_chu: entry.ghiChu.slice(0, 500),
      boi: entry.boi.slice(0, 190), tao_luc: toMysqlDateTime(entry.at, { ms: true })
    };
    await this.store.table(ENTRIES_TABLE).insert(row);
    return entryOf(row);
  }

  /** Entries inside a window (voided ones included — the screen strikes them through). */
  async inWindow(window: DateWindow): Promise<FinanceEntry[]> {
    const rows = await this.store.table(ENTRIES_TABLE).find({ orderBy: "tao_luc desc", limit: 5000 });
    return rows.map(entryOf).filter((e) => inWindow(e.taoLuc, window));
  }

  /** Voids one entry. 0 = unknown or already voided. */
  voidEntry(ma: string, reason: string, at: Date): Promise<number> {
    return this.store.table(ENTRIES_TABLE).update({ ma: text(ma), huy_luc: null }, { huy_luc: toMysqlDateTime(at, { ms: true }), ly_do_huy: reason.slice(0, 255) });
  }
}

// ---------------------------------------------------------------------------------------------
// The report — pure: the module hands it orders, shipments, costs and entries.
// ---------------------------------------------------------------------------------------------

/** The slice of an order the report reads (Orders' wire format). */
export interface FinanceOrder {
  id: string;
  createdAt: string;
  customerName?: string;
  status?: string;
  daXoa?: boolean;
  total?: number;
  paidAmount?: number;
  remainingAmount?: number;
  shippingFee?: number;
  /** `sender` = the shop pays the carrier; anything else = the receiver does. */
  shippingPayer?: string;
  trackingCode?: string;
  items?: { maDong?: string; productCode?: string; productName?: string; size?: string; qty?: number; quantity?: number; price?: number; costPrice?: number; partnerId?: string }[];
}

/** A waybill as Shipping remembers it (`van-don` document). */
export interface FinanceShipment {
  hang?: string;
  maVanDon?: string;
  maDon?: string;
  cod?: number;
  codDaThu?: number | null;
  phi?: number | null;
  trangThaiGiao?: string;
  daHuy?: boolean;
}

/** Orders that are not revenue (Desk `financeActiveOrders`). */
const NOT_REVENUE = new Set(["cancelled", "canceled", "returned_to_stock", "partner_out_of_stock", "soft_deleted"]);

export interface FinanceInput {
  orders: FinanceOrder[];
  window: DateWindow;
  shipments: Record<string, FinanceShipment>;
  /** Average cost per line from partner purchase slips — used when the line has no cost of its own. */
  slipCost: ReadonlyMap<string, number>;
  partnerNames: ReadonlyMap<string, string>;
  entries: FinanceEntry[];
  /** Rows per table the screen draws. */
  rowCap?: number;
}

/** Everything the Tài chính screen draws. Wire names. */
export function financeReport(input: FinanceInput): Record<string, unknown> {
  const cap = input.rowCap ?? 400;
  const orders = input.orders
    .filter((o) => !o.daXoa && !NOT_REVENUE.has(text(o.status).toLowerCase()) && inWindow(o.createdAt, input.window))
    .sort((a, b) => text(b.createdAt).localeCompare(text(a.createdAt)));
  const orderIds = new Set(orders.map((o) => o.id));
  const byOrder = new Map(orders.map((o) => [o.id, o]));

  // ---- cost of goods, line by line ----
  const costRows: Record<string, unknown>[] = [];
  const partnerPayable = new Map<string, number>();
  let costOfGoods = 0;
  for (const order of orders) {
    for (const line of order.items ?? []) {
      const qty = Math.max(1, Math.trunc(num(line.qty ?? line.quantity ?? 1)));
      const own = num(line.costPrice);
      const fromSlip = input.slipCost.get(text(line.maDong)) ?? 0;
      const unit = own > 0 ? own : fromSlip;
      const lineCost = unit * qty;
      costOfGoods += lineCost;
      const partnerId = text(line.partnerId);
      if (partnerId && lineCost > 0) partnerPayable.set(partnerId, (partnerPayable.get(partnerId) ?? 0) + lineCost);
      if (costRows.length < cap) {
        costRows.push({
          maDon: order.id, khach: text(order.customerName), maDong: text(line.maDong), ma: text(line.productCode), ten: text(line.productName),
          size: text(line.size), soLuong: qty, giaBan: num(line.price), giaVon: unit,
          nguonGiaVon: own > 0 ? "don" : fromSlip > 0 ? "phieu-mua" : "", giaVonDong: lineCost
        });
      }
    }
  }

  // ---- shipping: one row per waybill (parcel), fee as the carrier charged ----
  const shippingRows: Record<string, unknown>[] = [];
  let shippingActual = 0;
  let shippingShopCost = 0;
  const withSlip = new Set<string>();
  for (const [slip, record] of Object.entries(input.shipments)) {
    if (record.daHuy) continue;
    const orderId = text(record.maDon) || slip.replace(/-\d{2}$/, "");
    const order = byOrder.get(orderId) ?? (orderIds.has(slip) ? byOrder.get(slip) : undefined);
    if (!order) continue;
    withSlip.add(order.id);
    const fee = record.phi === null || record.phi === undefined ? 0 : num(record.phi);
    const shopPays = text(order.shippingPayer) === "sender";
    shippingActual += fee;
    if (shopPays) shippingShopCost += fee;
    if (shippingRows.length < cap) {
      shippingRows.push({
        maPhieu: slip, maDon: order.id, maVanDon: text(record.maVanDon), hang: text(record.hang), nguoiTraShip: text(order.shippingPayer),
        cod: num(record.cod), codDaThu: record.codDaThu ?? null, phi: record.phi ?? null, shopChiu: shopPays ? fee : 0,
        trangThaiGiao: text(record.trangThaiGiao), nguon: record.phi === null || record.phi === undefined ? "chua-dong-bo" : "hang"
      });
    }
  }
  for (const order of orders) {
    if (withSlip.has(order.id) || !(num(order.shippingFee) > 0 || text(order.trackingCode) !== "")) continue;
    if (shippingRows.length >= cap) break;
    shippingRows.push({
      maPhieu: "", maDon: order.id, maVanDon: text(order.trackingCode), hang: "", nguoiTraShip: text(order.shippingPayer),
      cod: 0, codDaThu: null, phi: null, shopChiu: 0, trangThaiGiao: "", nguon: "chua-co-van-don"
    });
  }

  // ---- the book ----
  const live = input.entries.filter((e) => !e.huyLuc);
  const incomeEntries = live.filter((e) => e.loai === "thu").reduce((t, e) => t + e.soTien, 0);
  const expenseEntries = live.filter((e) => e.loai === "chi" && e.nhom !== PARTNER_GOODS_GROUP).reduce((t, e) => t + e.soTien, 0);
  const partnerPaid = new Map<string, number>();
  for (const e of live) {
    if (e.nhom !== PARTNER_GOODS_GROUP || !e.maDoiTac) continue;
    partnerPaid.set(e.maDoiTac, (partnerPaid.get(e.maDoiTac) ?? 0) + e.soTien);
  }
  const partnerIds = new Set([...partnerPayable.keys(), ...partnerPaid.keys()]);
  const partnerRows = [...partnerIds].map((id) => {
    const payable = partnerPayable.get(id) ?? 0;
    const paid = partnerPaid.get(id) ?? 0;
    return { maDoiTac: id, tenDoiTac: input.partnerNames.get(id) || id, tienHang: payable, daTra: paid, conLai: Math.max(0, payable - paid) };
  }).filter((r) => r.tienHang > 0 || r.daTra > 0).sort((a, b) => b.conLai - a.conLai);

  const sum = (pick: (o: FinanceOrder) => number) => orders.reduce((t, o) => t + pick(o), 0);
  const salesRevenue = sum((o) => num(o.total));
  return {
    ok: true,
    tong: {
      soDon: orders.length,
      doanhThu: salesRevenue,
      khachDaTra: sum((o) => num(o.paidAmount)),
      conPhaiThu: sum((o) => Math.max(0, num(o.remainingAmount))),
      phiShipKhachTra: sum((o) => num(o.shippingFee)),
      phiHangVanChuyen: shippingActual,
      shipShopChiu: shippingShopCost,
      giaVon: costOfGoods,
      thuKhac: incomeEntries,
      chiPhi: expenseEntries,
      laiUocTinh: salesRevenue + incomeEntries - costOfGoods - shippingShopCost - expenseEntries
    },
    giaVon: costRows,
    phiShip: shippingRows,
    thuChi: input.entries,
    doiTac: partnerRows,
    nhom: ENTRY_GROUPS
  };
}
