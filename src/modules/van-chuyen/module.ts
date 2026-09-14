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

import { ACCESS, EVENTS, defineModule, type ModuleContext } from "../../contract";
import type { OrderServices as OrderServicesOf } from "../don-khach/module";
import type { Carrier, CarrierName, CreateShipmentResult, ShippingSlip, TrackResult } from "./carriers/carrier";
import { SpxCarrier, buildSpxPayload, type SpxConfig } from "./carriers/spx";
import { ViettelPostCarrier, type VtpConfig } from "./carriers/vtp";
import { ShipmentsDocument } from "./shipments-document";

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
  "don-khach"?: Pick<OrderServices, "read">;
}

export interface TrackInput {
  maPhieu?: string;
  maVanDon?: string;
  hang?: string;
}

/** What `track` answers: the carrier's answer plus what the document knew. */
export type TrackOutcome = (TrackResult & { maVanDon: string; hang: CarrierName; duongTra: string }) | { ok: false; loiNhan: string };

/** Services this module PROVIDES (`van-chuyen.*`). Consumers `import type` this. */
export interface ShippingServices {
  createShipment(slip: ShippingSlip): Promise<CreateShipmentResult & { hang: CarrierName }>;
  track(input: TrackInput): Promise<TrackOutcome>;
  /** Pre-check before creating for real: what the slip still lacks. The screen shows it to the seller. */
  checkSlip(slip: ShippingSlip): { thieu: string[]; luuY?: string };
}

type Ctx = ModuleContext<Config, Services>;

const TEN_MINUTES = 10 * 60 * 1000;

const text = (v: unknown): string => String(v || "").trim();

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

/** Picks the carrier strategy by name (the slip's, else the configured default, else SPX). */
export function carrierFor(ctx: Ctx, name?: string): Carrier {
  const chosen = String(name || ctx.config.defaultCarrier || "spx").toLowerCase();
  const deps = { http: ctx.ports.http, clock: ctx.ports.clock };
  if (chosen === "spx") return new SpxCarrier(deps, ctx.config.spx ?? {});
  if (chosen === "vtp" || chosen === "viettelpost") return new ViettelPostCarrier(deps, ctx.config.vtp ?? {});
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

async function createShipment(ctx: Ctx, slip: ShippingSlip = {}): Promise<CreateShipmentResult & { hang: CarrierName }> {
  if (!text(slip.maPhieu)) throw new Error("Phieu gui thieu `maPhieu`.");
  const slipRef = text(slip.maPhieu);
  const carrier = carrierFor(ctx, slip.hang);
  const result = await carrier.createShipment(slip);

  if (result.daGoi && result.ok) {
    await new ShipmentsDocument(ctx.ports.store, ctx.ports.clock)
      .remember(slipRef, { hang: carrier.name, maVanDon: result.maVanDon, duongTra: result.duongTra, cod: result.cod ?? 0 });
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

  const carrier = carrierFor(ctx, hang || known?.hang);
  const result = await carrier.track(trackingNumber);
  const duongTra = (result.ok ? result.duongTra : "") || known?.duongTra || "";
  return { ...result, maVanDon: trackingNumber, hang: carrier.name, duongTra };
}

function checkSlip(ctx: Ctx, slip: ShippingSlip = {}): { thieu: string[]; luuY?: string } {
  const carrier = carrierFor(ctx, slip.hang);
  if (carrier.name !== "spx") return { thieu: [], luuY: "Chỉ SPX kiểm trước được ở bản này." };
  return { thieu: buildSpxPayload({ slip, config: ctx.config.spx ?? {} }).thieu };
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
  requiresOptional: ["don-khach.read"],

  events: {
    emits: [EVENTS.shipmentCreated, EVENTS.shipmentStatusChanged],
    listens: {}
  },

  provides: {
    "van-chuyen.createShipment": (ctx, slip: ShippingSlip) => createShipment(ctx, slip),
    "van-chuyen.track": (ctx, input: TrackInput) => track(ctx, input),
    "van-chuyen.checkSlip": (ctx, slip: ShippingSlip) => checkSlip(ctx, slip)
  },

  routes: [
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

        const readOrder = ctx.services["don-khach"]?.read;
        if (!readOrder) {
          return { status: 503, body: { ok: false, error: "chua_bat_manh_don_hang", message: "Chưa bật mảnh Đơn hàng nên không đọc được đơn." } };
        }
        const order = await readOrder(orderId);
        if (!order) return { status: 404, body: { ok: false, error: "khong_thay_don" } };

        const { slip, missing } = buildSlipFromOrder(ctx.config, order, {
          carrier: String(body["hang"] ?? ""), weightKg: Number(body["canNangKg"] ?? 0), instruction: String(body["danDo"] ?? "")
        });
        if (missing.length > 0) {
          return {
            status: 400,
            body: { ok: false, error: "thieu_thong_tin", thieu: missing, message: `Chưa tạo được vận đơn: thiếu ${missing.join(", ")}.` }
          };
        }
        return replyForCreate(await createShipment(ctx, slip), { maDon: orderId });
      }
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
