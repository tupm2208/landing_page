/**
 * @file MODULE SHIPPING ("van-chuyen") — tier "van-hanh", runs on the merchant server.
 *
 * Its job: take a normalised SHIPPING SLIP, create the shipment at a carrier, remember the
 * tracking number, and answer "where is my parcel".
 *
 * It does NOT know what a shop order looks like. Orders (and Purchasing) build a slip and call the
 * service here. So a change to the order shape never touches shipping, and a change of carrier
 * never touches orders. The one exception is `POST /api/van-chuyen/tao-tu-don`: a button on the
 * admin screen that builds the slip FROM an order read through `don-khach.read` — see
 * `buildSlipFromOrder` for why that lives here and not in OMI.
 *
 * Carriers are Strategy classes (`carriers/spx.ts`, `carriers/vtp.ts`); `carrierFor` picks one.
 */

import { ACCESS, EVENTS, defineModule, reply, type ModuleContext } from "../../contract";
import type { OrderServices as OrderServicesOf } from "../don-khach/module";
import { convertToTwoTier } from "./address";
import { searchAddress } from "./address-search";
import type { Carrier, CarrierName, CreateShipmentResult, ShippingSlip, TrackResult } from "./carriers/carrier";
import { SpxCarrier, buildSpxPayload, type SpxConfig } from "./carriers/spx";
import { ViettelPostCarrier, type VtpConfig } from "./carriers/vtp";
import { ShipmentsDocument } from "./shipments-document";
import { SiteAccounts, accountForScreen, withSiteAccount } from "./site-accounts";

/** The shop's warehouse — sender on every shipment (from `KHO_*` in the environment). */
export interface SenderConfig {
  name?: string;
  phone?: string;
  province?: string;
  district?: string;
  ward?: string;
  addressDetail?: string;
}

/** `ctx.config` as `app.ts` builds it (`moduleConfigFromEnv`). Everything optional: tests pass slices. */
export interface Config {
  defaultCarrier?: string;
  sender?: SenderConfig;
  spx?: SpxConfig;
  vtp?: VtpConfig;
}

/**
 * The slice of an order this module reads when building a slip. Declared locally from the old JS
 * because `don-khach` is being ported in parallel: the field names are the order wire format.
 */
export interface OrderForSlip {
  id?: string;
  customerName?: string;
  phone?: string;
  province?: string;
  district?: string;
  ward?: string;
  addressDetail?: string;
  address?: string;
  total?: number | string;
  paidAmount?: number | string;
  /** Filled by the Orders module through the order-money kit. COD is THIS, never `total`. */
  remainingAmount?: number | string | null;
  items?: { productName?: string; productCode?: string; size?: string; qty?: number | string; quantity?: number | string; price?: number | string }[];
}

/** Minimal structural type of the Orders service this module may use (declared locally; see `OrderForSlip`). */
type OrderServices = OrderServicesOf["don-khach"];

/** Services consumed. `don-khach` is OPTIONAL: a shop may not have bought Orders; shipping still runs without the "from order" door. */
interface Services {
  "don-khach"?: Pick<OrderServices, "read"> & Partial<Pick<OrderServices, "parcels">>;
  /** The shop's own carrier keys, typed in OMI and kept on this server (see `khung-nen-tang/shop-settings.ts`). */
  "khung-nen-tang"?: { settings(): Promise<Record<string, string>> };
}

export interface TrackInput {
  maPhieu?: string;
  maVanDon?: string;
  hang?: string;
}

/** What `track` answers: the carrier's answer plus what the document knew. */
export type TrackOutcome = (TrackResult & { maVanDon: string; hang: CarrierName; duongTra: string }) | { ok: false; loiNhan: string };

/** What `createFromOrder` answers: the create result, or what the slip still lacks. */
export type CreateFromOrderOutcome =
  | { ok: false; viSao: "khong_thay_don" | "chua_bat_manh_don_hang" | "thieu_thong_tin"; thieu?: string[] }
  | (CreateShipmentResult & { hang: CarrierName; maDon: string });

/** Options `createFromOrder` accepts (all optional — the slip is built from the order). */
export interface CreateFromOrderInput {
  maDon: string;
  /** Đ3: one PARCEL of a split order (`<maDon>-NN`) — its own lines, its own COD. Empty = the whole order. */
  maKien?: string;
  hang?: string;
  canNangKg?: number;
  danDo?: string;
}

/** Services this module PROVIDES (`van-chuyen.*`). Consumers `import type` this. */
export interface ShippingServices {
  createShipment(slip: ShippingSlip): Promise<CreateShipmentResult & { hang: CarrierName }>;
  track(input: TrackInput): Promise<TrackOutcome>;
  /** Pre-check before creating for real: what the slip still lacks. The screen shows it to the seller. */
  checkSlip(slip: ShippingSlip): Promise<{ thieu: string[]; luuY?: string }>;
  /**
   * "Create the shipment for THIS order" — the whole of `POST /api/van-chuyen/tao-tu-don` as a
   * service, so another module (the partner portal) can offer the same button without knowing the
   * warehouse address, the COD rule, or which carrier the shop uses. Added 15/09/2026: modules may
   * not import each other's code, so what two callers share has to be a service, not a function.
   */
  createFromOrder(input: CreateFromOrderInput): Promise<CreateFromOrderOutcome>;
}

type Ctx = ModuleContext<Config, Services>;

const TEN_MINUTES = 10 * 60 * 1000;

const text = (v: unknown): string => String(v || "").trim();

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

/**
 * Folds the SHOP'S OWN SETTINGS over what the environment set.
 *
 * Sales Desk kept carrier keys in a `.env` beside the code; OMI serves many shops and keeps no
 * data, so a key typed there is stored on the shop's own landing (`khung-nen-tang.settings`) and
 * read here on every request. The environment stays as the fallback — a self-hosted shop that
 * never opens the Kết nối screen keeps working exactly as before — and only a value the owner
 * actually filled in overrides it, so a half-filled form cannot blank out a working carrier.
 */
export async function effectiveConfig(ctx: Ctx): Promise<Config> {
  const read = ctx.services["khung-nen-tang"]?.settings;
  if (read === undefined) return ctx.config;
  let shop: Record<string, string>;
  try {
    shop = await read();
  } catch {
    return ctx.config;                                   // a settings read must never stop a shipment
  }
  const pick = (key: string, fallback?: string): string => text(shop[key]) || text(fallback);
  const base = ctx.config;
  return {
    defaultCarrier: pick("van_chuyen_mac_dinh", base.defaultCarrier) || "spx",
    sender: {
      name: pick("kho_ten", base.sender?.name),
      phone: pick("kho_dien_thoai", base.sender?.phone),
      province: pick("kho_tinh", base.sender?.province),
      district: pick("kho_huyen", base.sender?.district),
      ward: pick("kho_xa", base.sender?.ward),
      addressDetail: pick("kho_dia_chi", base.sender?.addressDetail)
    },
    spx: {
      ...(base.spx ?? {}),
      appId: pick("spx_app_id", base.spx?.appId),
      appSecret: pick("spx_app_secret", base.spx?.appSecret),
      userId: pick("spx_user_id", base.spx?.userId),
      userSecret: pick("spx_user_secret", base.spx?.userSecret),
      // Đ3: "cách giao" + môi trường typed in OMI. SPX's sandbox is "thu" in this carrier.
      ...(pick("spx_cach_giao") === "1" || pick("spx_cach_giao") === "2" ? { collectType: Number(pick("spx_cach_giao")) } : {}),
      ...(pick("spx_moi_truong") === "test" ? { environment: "thu" } : {})
    },
    vtp: {
      ...(base.vtp ?? {}),
      token: pick("vtp_token", base.vtp?.token),
      username: pick("vtp_tai_khoan", base.vtp?.username),
      password: pick("vtp_mat_khau", base.vtp?.password),
      groupAddressId: pick("vtp_ma_kho", base.vtp?.groupAddressId)
    }
  };
}

/** Picks the carrier strategy by name (the slip's, else the configured default, else SPX). */
export function carrierFor(ctx: Ctx, config: Config, name?: string): Carrier {
  const chosen = String(name || config.defaultCarrier || "spx").toLowerCase();
  const deps = { http: ctx.ports.http, clock: ctx.ports.clock };
  if (chosen === "spx") return new SpxCarrier(deps, config.spx ?? {});
  if (chosen === "vtp" || chosen === "viettelpost") return new ViettelPostCarrier(deps, config.vtp ?? {});
  throw new Error(`Chua co hang van chuyen "${chosen}".`);
}

/**
 * Builds a SHIPPING SLIP from an order.
 *
 * Why here and not in OMI: OMI is a screen. It must not know the shop's warehouse address, must
 * not compute COD, must not guess the weight. The screen only says "create a shipment for this order".
 *
 * The SENDER comes from the server's config (the shop's address) — anything missing is returned in
 * `missing` so the screen tells the person what to fill in, instead of calling a carrier with a
 * blank sender. The entries keep the old `nguoiGui.<field>` spelling: OMI displays them.
 *
 * COD is the order's REMAINING AMOUNT (computed by the order-money kit; the Orders module
 * annotates it). Taking `total` is forbidden: an order with a 20% deposit would collect double.
 */
export function buildSlipFromOrder(
  config: Config,
  order: OrderForSlip,
  { carrier = "", weightKg = 0, instruction = "" }: { carrier?: string; weightKg?: number; instruction?: string } = {}
): { slip: ShippingSlip; missing: string[] } {
  const s = config.sender ?? {};
  const sender = {
    ten: text(s.name),
    dienThoai: text(s.phone),
    tinh: text(s.province),
    huyen: text(s.district),
    xa: text(s.ward),
    diaChiChiTiet: text(s.addressDetail)
  };
  const missing = Object.entries(sender).filter(([, v]) => v === "").map(([k]) => `nguoiGui.${k}`);

  const items = (Array.isArray(order.items) ? order.items : []).map((m) => ({
    ten: String(m.productName || m.productCode || "Hàng").trim(),
    soLuong: Math.max(1, Math.trunc(Number(m.qty ?? m.quantity ?? 1))),
    donGia: Math.max(0, Math.round(Number(m.price || 0))),
    canNangKg: 0
  }));
  if (items.length === 0) missing.push("don khong co mon nao");
  if (!text(order.phone)) missing.push("dien thoai nguoi nhan");

  const slip: ShippingSlip = {
    maPhieu: text(order.id),
    ...(text(carrier) ? { hang: text(carrier) } : {}),
    nguoiGui: sender,
    nguoiNhan: {
      ten: text(order.customerName),
      dienThoai: text(order.phone),
      tinh: text(order.province),
      huyen: text(order.district),
      xa: text(order.ward),
      diaChiChiTiet: text(order.addressDetail),
      diaChiDayDu: text(order.address)
    },
    mon: items,
    // COD = what is still owed, NOT the order total.
    cod: Math.max(0, Math.round(Number(order.remainingAmount ?? order.total ?? 0))),
    giaTriHang: Math.max(0, Math.round(Number(order.total || 0))),
    ...(Number(weightKg) > 0 ? { canNangKg: Number(weightKg) } : {}),
    ...(text(instruction) ? { danDo: text(instruction) } : {})
  };
  return { slip, missing };
}

/** Đ10: the shop's carrier config with a site's own account folded over it (no site = unchanged). */
export async function configForSite(ctx: Ctx, site: string, carrierName: string): Promise<Config> {
  const base = await effectiveConfig(ctx);
  if (!text(site)) return base;
  const account = await new SiteAccounts(ctx.ports.store).of(site);
  return withSiteAccount(base, account, String(carrierName || base.defaultCarrier || "spx").toLowerCase());
}

async function createShipment(ctx: Ctx, slip: ShippingSlip = {}, site = ""): Promise<CreateShipmentResult & { hang: CarrierName }> {
  if (!text(slip.maPhieu)) throw new Error("Phieu gui thieu `maPhieu`.");
  const slipRef = text(slip.maPhieu);
  const carrier = carrierFor(ctx, await configForSite(ctx, site, text(slip.hang)), slip.hang);
  const result = await carrier.createShipment(slip);

  if (result.daGoi && result.ok) {
    await new ShipmentsDocument(ctx.ports.store, ctx.ports.clock)
      .remember(slipRef, { hang: carrier.name, maVanDon: result.maVanDon, duongTra: result.duongTra, cod: result.cod ?? 0, ...(text(site) ? { site: text(site) } : {}) });
    ctx.bus.emit(EVENTS.shipmentCreated, { maPhieu: slipRef, hang: carrier.name, maVanDon: result.maVanDon, duongTra: result.duongTra });
  } else if (result.daGoi) {
    ctx.ports.logger.warn(`[van-chuyen] ${carrier.name} tu choi ${slipRef}: ${result.loiNhan}`);
  }
  return { ...result, hang: carrier.name };
}

/**
 * Tracking: the document first. Only when the document knows the tracking number is the carrier
 * asked — the bot asks "where is my parcel" many times for one order; not every question may go out.
 */
async function track(ctx: Ctx, { maPhieu, maVanDon, hang }: TrackInput = {}): Promise<TrackOutcome> {
  const known = maPhieu ? await new ShipmentsDocument(ctx.ports.store, ctx.ports.clock).lookup(maPhieu) : null;
  const trackingNumber = text(maVanDon || known?.maVanDon);
  if (!trackingNumber) return { ok: false, loiNhan: "Chưa có mã vận đơn cho đơn này." };

  const carrier = carrierFor(ctx, await effectiveConfig(ctx), hang || known?.hang);
  const result = await carrier.track(trackingNumber);
  const duongTra = (result.ok ? result.duongTra : "") || known?.duongTra || "";
  return { ...result, maVanDon: trackingNumber, hang: carrier.name, duongTra };
}

/**
 * "Create the shipment for THIS order" — the admin button and the partner portal both want exactly
 * this, and neither may know the warehouse address, the COD rule or which carrier the shop uses.
 *
 * It lives here as a SERVICE rather than a function two modules import, because a module never
 * imports another module's code (see `kernel/architecture-rules.ts`).
 */
async function createFromOrder(ctx: Ctx, input: CreateFromOrderInput): Promise<CreateFromOrderOutcome> {
  const orderId = text(input.maDon);
  const readOrder = ctx.services["don-khach"]?.read;
  if (!readOrder) return { ok: false, viSao: "chua_bat_manh_don_hang" };
  const order = await readOrder(orderId);
  if (!order) return { ok: false, viSao: "khong_thay_don" };

  const extra = order as OrderForSlip & { shippingPayer?: string; shippingNote?: string; site?: string };
  const site = text(extra.site);
  const { slip, missing } = buildSlipFromOrder(await configForSite(ctx, site, text(input.hang)), order, {
    carrier: text(input.hang), weightKg: Number(input.canNangKg ?? 0), instruction: text(input.danDo) || text(extra.shippingNote)
  });
  // Who pays shipping, as the order editor set it (Đ2). Blank = the receiver, the carrier default.
  if (text(extra.shippingPayer) === "sender") slip.aiTraShip = "sender";

  // Đ3: ONE PARCEL. Its lines, its value, and ITS OWN COD — collecting the whole order's remainder
  // on every parcel makes the customer pay twice (see don-khach/parcels.ts).
  const parcelId = text(input.maKien);
  if (parcelId !== "") {
    const parcels = (await ctx.services["don-khach"]?.parcels?.(orderId)) ?? [];
    const parcel = parcels.find((p) => p.maKien === parcelId);
    if (!parcel) return { ok: false, viSao: "thieu_thong_tin", thieu: [`kiện ${parcelId} không có trong đơn ${orderId}`] };
    slip.maPhieu = parcel.maKien;
    slip.mon = parcel.mon.map((m) => ({ ten: text(m.productName || m.productCode) || "Hàng", soLuong: Math.max(1, Number(m.qty || 1)), donGia: Math.max(0, Math.round(Number(m.price || 0))), canNangKg: 0 }));
    slip.cod = Math.max(0, Math.round(parcel.cod));
    slip.giaTriHang = Math.max(0, Math.round(parcel.giaTriHang));
  }
  if (missing.length > 0) return { ok: false, viSao: "thieu_thong_tin", thieu: missing };
  const result = await createShipment(ctx, slip, site);
  if (result.daGoi && result.ok) await new ShipmentsDocument(ctx.ports.store, ctx.ports.clock).patch(text(slip.maPhieu), { maDon: orderId });
  return { ...result, maDon: orderId };
}

// ----- Đ3 (17/09/2026): cancel, label, verify, tracking sync, report -----

const docOf = (ctx: Ctx) => new ShipmentsDocument(ctx.ports.store, ctx.ports.clock);

/** The remembered shipment for a slip, or a clear refusal the screen can show. */
async function knownShipment(ctx: Ctx, slipRef: string) {
  const known = await docOf(ctx).lookup(text(slipRef));
  if (!known || !text(known.maVanDon)) return { ok: false as const, loiNhan: `Chưa có vận đơn nào OMI tạo cho ${text(slipRef)}.` };
  return { ok: true as const, known };
}

async function cancelShipment(ctx: Ctx, slipRef: string): Promise<{ ok: boolean; loiNhan: string }> {
  const found = await knownShipment(ctx, slipRef);
  if (!found.ok) return found;
  if (found.known.daHuy) return { ok: true, loiNhan: `Vận đơn ${found.known.maVanDon} đã huỷ từ trước.` };
  const carrier = carrierFor(ctx, await configForSite(ctx, text(found.known.site), found.known.hang), found.known.hang);
  const answer = await carrier.cancel(found.known.maVanDon);
  if (!answer.ok) return answer;
  await docOf(ctx).patch(text(slipRef), { daHuy: true, trangThaiGiao: "cancelled", capNhatLuc: ctx.ports.clock.now().toISOString() });
  ctx.bus.emit(EVENTS.shipmentStatusChanged, { maPhieu: text(slipRef), maVanDon: found.known.maVanDon, trangThaiGiao: "cancelled", trangThai: "Huỷ từ OMI" });
  return answer;
}

async function labelFor(ctx: Ctx, slipRef: string) {
  const found = await knownShipment(ctx, slipRef);
  if (!found.ok) return found;
  return carrierFor(ctx, await configForSite(ctx, text(found.known.site), found.known.hang), found.known.hang).label(found.known.maVanDon);
}

async function verifyCarrier(ctx: Ctx, name: string, site = "") {
  try {
    return await carrierFor(ctx, await configForSite(ctx, site, name), name).verify();
  } catch (e) {
    return { ok: false, loiNhan: e instanceof Error ? e.message : String(e) };
  }
}

/** Parcels still moving — delivered / returned / cancelled ones are never asked again unless named. */
const FINAL = new Set(["delivered", "returned", "cancelled"]);
const SYNC_CAP = 200;

/**
 * Asks each carrier where every live parcel is, writes what it learned (status, fee, COD collected)
 * and tells Orders through the bus. One failing parcel never stops the others; the reply lists both.
 */
async function syncTracking(ctx: Ctx, only: string[] = []): Promise<{ ok: true; daKiem: number; capNhat: Record<string, unknown>[]; loi: string[] }> {
  const all = await docOf(ctx).all();
  const wanted = new Set(only.map(text).filter(Boolean));
  const targets = Object.entries(all)
    .filter(([ref, s]) => (wanted.size > 0 ? wanted.has(ref) : !s.daHuy && !FINAL.has(text(s.trangThaiGiao))))
    .slice(0, SYNC_CAP);
  const config = await effectiveConfig(ctx);
  const capNhat: Record<string, unknown>[] = [];
  const loi: string[] = [];
  for (const [ref, s] of targets) {
    let carrier: Carrier;
    try { carrier = carrierFor(ctx, text(s.site) ? await configForSite(ctx, text(s.site), s.hang) : config, s.hang); } catch (e) { loi.push(`${ref}: ${e instanceof Error ? e.message : String(e)}`); continue; }
    const tracked = await carrier.track(s.maVanDon);
    if (!tracked.ok) { loi.push(`${ref} (${s.maVanDon}): ${tracked.loiNhan}`); continue; }
    const snap = carrier.readTrack(tracked.don);
    const at = ctx.ports.clock.now().toISOString();
    await docOf(ctx).patch(ref, { trangThai: snap.trangThai, trangThaiGiao: snap.trangThaiGiao, codDaThu: snap.codDaThu, phi: snap.phi, capNhatLuc: at });
    if (snap.trangThaiGiao !== text(s.trangThaiGiao)) {
      ctx.bus.emit(EVENTS.shipmentStatusChanged, { maPhieu: ref, maVanDon: s.maVanDon, trangThaiGiao: snap.trangThaiGiao, trangThai: snap.trangThai });
    }
    capNhat.push({ maPhieu: ref, maVanDon: s.maVanDon, trangThai: snap.trangThai, trangThaiGiao: snap.trangThaiGiao, phi: snap.phi, codDaThu: snap.codDaThu });
  }
  return { ok: true, daKiem: targets.length, capNhat, loi };
}

/** One row of the shipping report, with what does not add up said out loud. */
export interface ReportRow {
  maPhieu: string; maDon: string; hang: string; maVanDon: string; trangThai: string; trangThaiGiao: string;
  cod: number; codDaThu: number | null; phi: number | null; capNhatLuc: string; daHuy: boolean; canhBao: string[];
}

/** Pure: document → report rows + totals. A delivered parcel whose COD came in short is the alert that matters most. */
export function shippingReport(book: Record<string, { hang: string; maVanDon: string; cod: number; luc: string; maDon?: string; trangThai?: string; trangThaiGiao?: string; codDaThu?: number | null; phi?: number | null; capNhatLuc?: string; daHuy?: boolean }>) {
  const rows: ReportRow[] = Object.entries(book).map(([ref, s]) => {
    const canhBao: string[] = [];
    const state = text(s.trangThaiGiao);
    if (state === "delivered" && s.codDaThu !== null && s.codDaThu !== undefined && s.codDaThu < s.cod) canhBao.push(`Thu COD thiếu ${s.cod - s.codDaThu}đ`);
    if (state === "returned" || state === "returning") canhBao.push("Hàng hoàn — nhận lại kho và xử lý tiền");
    if (state === "delivery_failed") canhBao.push("Giao không thành công — gọi khách");
    return {
      maPhieu: ref, maDon: text(s.maDon) || ref.replace(/-\d{2}$/, ""), hang: s.hang, maVanDon: s.maVanDon, trangThai: text(s.trangThai), trangThaiGiao: state,
      cod: Number(s.cod || 0), codDaThu: s.codDaThu ?? null, phi: s.phi ?? null, capNhatLuc: text(s.capNhatLuc) || s.luc, daHuy: s.daHuy === true, canhBao
    };
  }).sort((a, b) => b.capNhatLuc.localeCompare(a.capNhatLuc));
  const live = rows.filter((r) => !r.daHuy);
  const sum = (f: (r: ReportRow) => number) => live.reduce((t, r) => t + f(r), 0);
  return {
    dong: rows,
    tong: {
      soVanDon: live.length,
      dangGiao: live.filter((r) => !FINAL.has(r.trangThaiGiao)).length,
      daGiao: live.filter((r) => r.trangThaiGiao === "delivered").length,
      hoan: live.filter((r) => r.trangThaiGiao === "returned" || r.trangThaiGiao === "returning").length,
      codDuKien: sum((r) => r.cod),
      codDaThu: sum((r) => r.codDaThu ?? 0),
      phi: sum((r) => r.phi ?? 0),
      canhBao: live.filter((r) => r.canhBao.length > 0).length
    }
  };
}

async function checkSlip(ctx: Ctx, slip: ShippingSlip = {}): Promise<{ thieu: string[]; luuY?: string }> {
  const config = await effectiveConfig(ctx);
  const carrier = carrierFor(ctx, config, slip.hang);
  if (carrier.name !== "spx") return { thieu: [], luuY: "Chỉ SPX kiểm trước được ở bản này." };
  return { thieu: buildSpxPayload({ slip, config: config.spx ?? {} }).thieu };
}

/** Turns a create result into the HTTP reply: 200 created, 400 not even called, 502 carrier refused. */
function replyForCreate(result: CreateShipmentResult & { hang: CarrierName }, extra: Record<string, unknown> = {}) {
  if (result.daGoi && result.ok) return { status: 200, body: { ...extra, ...result, ok: true } };
  if (!result.daGoi) return { status: 400, body: { ok: false, error: result.viSao, thieu: result.thieu ?? [] } };
  return { status: 502, body: { ok: false, error: "hang_tu_choi", message: result.loiNhan } };
}

export const manifest = defineModule<Config, Services>({
  id: "van-chuyen",
  name: "Vận chuyển",
  tier: "van-hanh",
  runsOn: "server-khach",
  feature: "van-chuyen",
  version: "0.1.0",
  ports: ["store", "logger", "clock", "http", "bus", "config"],
  // Creating a shipment FROM AN ORDER needs to read that order. Optional because the merchant may
  // not have bought Orders — shipping still runs, only without the "from order" door.
  requiresOptional: ["don-khach.read", "don-khach.parcels", "khung-nen-tang.settings"],

  events: {
    emits: [EVENTS.shipmentCreated, EVENTS.shipmentStatusChanged],
    listens: {}
  },

  provides: {
    "van-chuyen.createShipment": (ctx, slip: ShippingSlip) => createShipment(ctx, slip),
    "van-chuyen.track": (ctx, input: TrackInput) => track(ctx, input),
    "van-chuyen.checkSlip": (ctx, slip: ShippingSlip) => checkSlip(ctx, slip),
    "van-chuyen.createFromOrder": (ctx, input: CreateFromOrderInput) => createFromOrder(ctx, input),
    /** Every remembered waybill with the fee the carrier charged (Đ4: the finance screen's shipping table). */
    "van-chuyen.shipmentBook": (ctx) => new ShipmentsDocument(ctx.ports.store, ctx.ports.clock).all()
  },

  routes: [
    {
      /**
       * TÌM TRONG DANH MỤC HÀNH CHÍNH — người bán gõ vài chữ, màn hình hiện mục để bấm chọn.
       *
       * Ở đây chứ không ở Đơn hàng, vì module này sở hữu dữ liệu địa chỉ (bảng sáp nhập 2025 và
       * hai danh mục) và vì nó là bên phải nói chuyện với hãng vận chuyển — hãng từ chối đơn có
       * tên tỉnh/xã không khớp danh mục, và mỗi lần từ chối là một lần sửa tay.
       */
      method: "GET", path: "/api/dia-chi/tim", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (_ctx, request) => {
        const scheme = request.query["he"] === "hai-cap" ? "hai-cap" : "ba-cap";
        const cap = request.query["cap"];
        if (cap !== "tinh" && cap !== "huyen" && cap !== "xa") {
          return reply.json({ ok: false, error: "cap_la", message: 'Cấp phải là "tinh", "huyen" hoặc "xa".' }, 422);
        }
        return reply.json({
          ok: true, he: scheme, cap,
          muc: searchAddress({
            scheme, cap,
            q: String(request.query["q"] ?? ""),
            tinh: String(request.query["tinh"] ?? ""),
            huyen: String(request.query["huyen"] ?? ""),
            limit: Number(request.query["limit"] ?? 12)
          })
        }, 200, { "Cache-Control": "no-store" });
      }
    },
    {
      /**
       * MỘT XÃ CŨ CÓ BỊ TÁCH ĐÔI KHÔNG — thứ làm hãng vận chuyển từ chối đơn sau sáp nhập 2025.
       *
       * Trả về `mapMo: true` kèm các lựa chọn khi một địa chỉ ba cấp ứng với nhiều xã hai cấp.
       * Lúc đó người bán phải hỏi khách, không được đoán: đoán sai là gửi hàng tới nhầm nơi.
       */
      method: "GET", path: "/api/dia-chi/doi-hai-cap", access: ACCESS.admin,
      rateLimit: { calls: 600, windowMs: TEN_MINUTES },
      handle: async (_ctx, request) => reply.json(
        convertToTwoTier({ tinh: request.query["tinh"], huyen: request.query["huyen"], xa: request.query["xa"] }),
        200, { "Cache-Control": "no-store" }
      )
    },
    {
      method: "POST", path: "/api/van-chuyen/tao", access: ACCESS.admin,
      handle: async (ctx, request) => replyForCreate(await createShipment(ctx, asRecord(await request.json()) as ShippingSlip))
    },
    {
      // One button on the admin screen: create a shipment for this order. The screen need not know
      // the warehouse address or compute COD — the slip is built here.
      method: "POST", path: "/api/van-chuyen/tao-tu-don", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const orderId = text(body["maDon"] || body["orderId"]);
        if (!orderId) return { status: 400, body: { ok: false, error: "thieu_ma_don" } };

        const result = await createFromOrder(ctx, {
          maDon: orderId, maKien: String(body["maKien"] ?? ""), hang: String(body["hang"] ?? ""), canNangKg: Number(body["canNangKg"] ?? 0), danDo: String(body["danDo"] ?? "")
        });
        // `daGoi` marks a real create result; without it the slip never reached a carrier.
        if (!("daGoi" in result)) {
          if (result.viSao === "chua_bat_manh_don_hang") {
            return { status: 503, body: { ok: false, error: result.viSao, message: "Chưa bật mảnh Đơn hàng nên không đọc được đơn." } };
          }
          if (result.viSao === "khong_thay_don") return { status: 404, body: { ok: false, error: result.viSao } };
          const missing = result.thieu ?? [];
          return {
            status: 400,
            body: { ok: false, error: "thieu_thong_tin", thieu: missing, message: `Chưa tạo được vận đơn: thiếu ${missing.join(", ")}.` }
          };
        }
        return replyForCreate(result, { maDon: orderId });
      }
    },
    // ----- Đ3 (17/09/2026) -----
    {
      // Many orders (or parcels) in one go — Desk `batch-create-shipments`. Sequential on purpose: a
      // carrier throttles bursts, and one refusal must not hide the others. Capped at 50.
      method: "POST", path: "/api/van-chuyen/tao-hang-loat", access: ACCESS.admin,
      rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const list = (Array.isArray(body["phieu"]) ? body["phieu"] as unknown[] : []).map(asRecord).slice(0, 50);
        if (list.length === 0) return { status: 400, body: { ok: false, error: "thieu_phieu", message: "Chưa chọn đơn nào." } };
        const ketQua: Record<string, unknown>[] = [];
        for (const p of list) {
          const maDon = text(p["maDon"]);
          const r = await createFromOrder(ctx, { maDon, maKien: text(p["maKien"]), hang: text(body["hang"] || p["hang"]) });
          if ("daGoi" in r && r.daGoi && r.ok) ketQua.push({ maDon, maKien: text(p["maKien"]), ok: true, maVanDon: r.maVanDon, hang: r.hang });
          else if ("daGoi" in r && r.daGoi) ketQua.push({ maDon, maKien: text(p["maKien"]), ok: false, loiNhan: r.loiNhan });
          else ketQua.push({ maDon, maKien: text(p["maKien"]), ok: false, loiNhan: "thieu" in r && r.thieu?.length ? `Thiếu ${r.thieu.join(", ")}` : String(("viSao" in r && r.viSao) || "không tạo được") });
        }
        return { status: 200, headers: { "Cache-Control": "no-store" }, body: { ok: true, ketQua, soTao: ketQua.filter((k) => k.ok).length } };
      }
    },
    {
      method: "POST", path: "/api/van-chuyen/huy", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const r = await cancelShipment(ctx, text(asRecord(await request.json())["maPhieu"]));
        return { status: r.ok ? 200 : 409, body: { ok: r.ok, message: r.loiNhan, loiNhan: r.loiNhan } };
      }
    },
    {
      method: "GET", path: "/api/van-chuyen/nhan/:maPhieu", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const r = await labelFor(ctx, request.params["maPhieu"] ?? "");
        return { status: r.ok ? 200 : 409, headers: { "Cache-Control": "no-store" }, body: r.ok ? { ...r } : { ok: false, message: r.loiNhan, loiNhan: r.loiNhan } };
      }
    },
    {
      method: "POST", path: "/api/van-chuyen/thu-ket-noi", access: ACCESS.admin,
      rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const r = await verifyCarrier(ctx, text(body["hang"]), text(body["site"]));
        return { status: 200, headers: { "Cache-Control": "no-store" }, body: r };
      }
    },
    {
      // Đ10 Desk "Tài khoản vận chuyển đối tác": the sites and whether each carrier account is set — never a secret.
      method: "GET", path: "/api/van-chuyen/tai-khoan-site", access: ACCESS.admin,
      rateLimit: { calls: 120, windowMs: TEN_MINUTES },
      handle: async (ctx) => {
        const settings = (await ctx.services["khung-nen-tang"]?.settings().catch(() => ({} as Record<string, string>))) ?? {};
        return {
          status: 200, headers: { "Cache-Control": "no-store" },
          body: { ok: true, partnerSites: (await new SiteAccounts(ctx.ports.store).all()).map(accountForScreen), siteDoi: { ma: text(settings["site_doi_ma"]), ten: text(settings["site_doi_ten"]) } }
        };
      }
    },
    {
      // Add a site (slug + label), save its fields (empty box = unchanged), or remove it (`remove: true`).
      method: "POST", path: "/api/van-chuyen/tai-khoan-site", access: ACCESS.admin,
      rateLimit: { calls: 60, windowMs: TEN_MINUTES }, bodyLimit: 16 * 1024,
      handle: async (ctx, request) => {
        const r = await new SiteAccounts(ctx.ports.store).save(asRecord(await request.json()), ctx.ports.clock.now().toISOString());
        if (r.ok) ctx.ports.logger.info(`[van-chuyen] tai khoan site ${r.site}: ${r.removed ? "go" : `${r.savedFields ?? 0} truong`}`);
        return { status: r.status, headers: { "Cache-Control": "no-store" }, body: { ...r, ok: r.ok } };
      }
    },
    {
      method: "POST", path: "/api/van-chuyen/dong-bo", access: ACCESS.admin,
      rateLimit: { calls: 30, windowMs: TEN_MINUTES },
      handle: async (ctx, request) => {
        const body = asRecord(await request.json());
        const only = Array.isArray(body["maPhieu"]) ? (body["maPhieu"] as unknown[]).map(text) : [];
        return { status: 200, headers: { "Cache-Control": "no-store" }, body: await syncTracking(ctx, only) };
      }
    },
    {
      method: "GET", path: "/api/van-chuyen/bao-cao", access: ACCESS.admin,
      handle: async (ctx) => ({ status: 200, headers: { "Cache-Control": "no-store" }, body: { ok: true, ...shippingReport(await docOf(ctx).all()) } })
    },
    {
      // The brain calls this when a customer asks "where is my parcel".
      method: "GET", path: "/api/van-chuyen/tra-cuu/:maPhieu", access: ACCESS.service,
      handle: async (ctx, request) => {
        const result = await track(ctx, { maPhieu: request.params["maPhieu"] ?? "" });
        return { status: result.ok ? 200 : 404, headers: { "Cache-Control": "no-store" }, body: { ...result } };
      }
    }
  ],

  botTools: [
    { ten: "tra_van_don", moTa: "Tra trạng thái vận đơn của một đơn", hieuUng: "doc" }
  ]
});
