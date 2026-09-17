/**
 * @file One handler class per brain tool (Strategy): the tool NAME is the brain's vocabulary, the body speaks the landing's.
 *
 * The brain on Xeon and the merchant server have TWO vocabularies: the brain says `stock.lookup`,
 * the inventory module says `stock`. These handlers are the ONLY place that translates between
 * them. Without it every module would need to know the brain's words — and renaming one would
 * mean fixing seven places.
 *
 * Adding a tool = one class here plus one line in `DEFAULT_TOOL_HANDLERS`; it then appears in
 * `GET /api/bo-nao/cong-cu` on its own. The tool names and the JSON shapes returned are WIRE:
 * the brain (`bo-nao/packages/xeon/src/gateway/landing-gateway.ts`) reads them byte for byte.
 */

import { blindWarehouseId } from "./blind-warehouse-id";
import { findInCatalog } from "./catalog-find";
import type { CatalogItem, GatewayContext, OrderRecord, StockLine } from "./context";

export type ToolName =
  | "catalog.search" | "stock.lookup" | "order.lookup" | "payment.status" | "shipment.track" | "storefront.link"
  | "catalog.count" | "variant.chart" | "policy.get" | "purchase.eta" | "customer.recognize"
  | "catalog.find" | "shop.bankAccount" | "conversation.recent" | "training.knowledge";

/** The tool's input as the brain sent it — checked field by field inside each handler. */
export type ToolInput = Record<string, unknown>;

/** A `[module id, service name]` pair the tool needs; `null` = always open. A missing service = the tool does not appear. */
export type ServiceNeed = readonly [module: string, service: string] | null;

export interface ToolHandler {
  readonly name: ToolName;
  readonly needs: ServiceNeed;
  run(ctx: GatewayContext, input: ToolInput): Promise<unknown>;
}

// ---- shapes the brain expects ----------------------------------------------------------------

/** An item in the compact shape the brain expects (`CatalogItemLite`). */
export function liteItem(item: CatalogItem): Record<string, unknown> {
  const price = Number(item.price || item.suggestedPrice || 0);
  const code = String(item.code ?? "");
  return {
    id: code,
    code,
    name: String(item.name ?? ""),
    brand: String(item.brand ?? "") || undefined,
    priceFrom: price,
    variantCount: (Array.isArray(item.sizes) ? item.sizes : []).length,
    url: String(item.slug ?? "") ? `/product.html?code=${encodeURIComponent(code)}` : undefined
  };
}

/** One stock line in the shape the brain expects (`StockRow`). */
export function stockRow(itemId: string, line: StockLine): Record<string, unknown> {
  return {
    itemId: String(itemId ?? ""),
    variantId: String(line.variantId ?? ""),
    variantLabel: String(line.size ?? ""),
    // The warehouse id is hashed and the name left empty: a sentence sent to the customer must
    // not carry a warehouse or partner name (decided 10/09). The brain only needs HOW MANY
    // sources there are, not which.
    warehouseId: blindWarehouseId(line.warehouseId),
    warehouseName: "",
    qty: Number(line.quantity || 0),
    price: Number(line.price || 0)
  };
}

/** Money on an order — RULE 3: read from the ANNOTATED order of the orders module, never recomputed here. */
export function orderMoney(order: OrderRecord): { total: number; paid: number; remaining: number; cod: number } {
  const total = Number(order.total || 0);
  const paid = Number(order.paidAmount || 0);
  const remaining = Number(order.remainingAmount ?? Math.max(0, total - paid));
  return { total, paid, remaining, cod: remaining };
}

export function liteOrder(order: OrderRecord): Record<string, unknown> {
  const items = (Array.isArray(order.items) ? order.items : []) as unknown as Record<string, unknown>[];
  return {
    orderId: String(order.id ?? ""),
    status: String(order.status ?? ""),
    createdAt: String(order.createdAt ?? ""),
    money: orderMoney(order),
    lines: items.map((line) => ({
      name: String(line["productName"] || line["productCode"] || ""),
      variantLabel: String(line["size"] ?? ""),
      qty: Number(line["qty"] || line["quantity"] || 1)
    }))
  };
}

const text = (value: unknown): string => String(value ?? "").trim();

// ---- the tools ------------------------------------------------------------------------------

class CatalogSearch implements ToolHandler {
  readonly name = "catalog.search" as const;
  readonly needs = ["hang-kho", "search"] as const;
  async run(ctx: GatewayContext, input: ToolInput): Promise<unknown> {
    const limit = Number(input["limit"] || 10);
    const query: { query?: string; limit?: number } = { limit };
    if (typeof input["q"] === "string") query.query = input["q"];
    const items = await ctx.services["hang-kho"].search(query);
    return { items: items.map((item) => liteItem(item)), truncated: items.length >= limit };
  }
}

class StockLookup implements ToolHandler {
  readonly name = "stock.lookup" as const;
  readonly needs = ["hang-kho", "stock"] as const;
  async run(ctx: GatewayContext, input: ToolInput): Promise<unknown> {
    const code = String(input["code"] || input["itemId"] || "");
    const query: { code: string; size?: string } = { code };
    if (typeof input["variantLabel"] === "string") query.size = input["variantLabel"];
    const stock = await ctx.services["hang-kho"].stock(query);
    const itemId = stock.found ? stock.code : code;
    return {
      rows: stock.lines.map((line) => stockRow(itemId, line)),
      asOf: ctx.ports.clock.now().toISOString(),
      truncated: false
    };
  }
}

class OrderLookup implements ToolHandler {
  readonly name = "order.lookup" as const;
  readonly needs = ["don-khach", "search"] as const;
  async run(ctx: GatewayContext, input: ToolInput): Promise<unknown> {
    // RULE 2: no phone number the customer typed THEMSELVES in this conversation = no order at all.
    // A number the bot guessed must never return someone else's order.
    const phoneGiven = text(input["phoneGivenInConversation"]);
    if (!phoneGiven) return { orders: [] };
    const orders = await ctx.services["don-khach"]!.search({ phone: phoneGiven, limit: 10 });
    return { orders: orders.map((order) => liteOrder(order)) };
  }
}

class PaymentStatus implements ToolHandler {
  readonly name = "payment.status" as const;
  readonly needs = ["don-khach", "read"] as const;
  async run(ctx: GatewayContext, input: ToolInput): Promise<unknown> {
    const order = await ctx.services["don-khach"]!.read(String(input["orderId"] ?? ""));
    if (!order) return { money: { total: 0, paid: 0, remaining: 0, cod: 0 } };
    return { money: orderMoney(order) };
  }
}

class ShipmentTrack implements ToolHandler {
  readonly name = "shipment.track" as const;
  readonly needs = ["van-chuyen", "track"] as const;
  async run(ctx: GatewayContext, input: ToolInput): Promise<unknown> {
    const result = await ctx.services["van-chuyen"]!.track({ maPhieu: String(input["orderId"] ?? "") });
    if (!result.ok) return { carrier: "", tracking: "", status: "chua_co_van_don", history: [] };
    const carrierAnswer = (result.don && typeof result.don === "object" ? result.don : {}) as { status?: unknown };
    return {
      carrier: String(result.hang ?? ""),
      tracking: String(result.maVanDon ?? ""),
      status: String(carrierAnswer.status ?? ""),
      history: []
    };
  }
}

class StorefrontLink implements ToolHandler {
  readonly name = "storefront.link" as const;
  readonly needs = null;
  async run(ctx: GatewayContext, input: ToolInput): Promise<unknown> {
    const origin = String(ctx.config.siteUrl ?? "").replace(/\/+$/, "");
    const query = text(input["q"]);
    return { url: query ? `${origin}/?q=${encodeURIComponent(query)}` : `${origin}/` };
  }
}

// ---- Four tools added 14/09/2026 (+ catalog.count). Before, the engine declared them but the
// ---- landing lacked them -> every return / shipping / warranty question fell to "ask again",
// ---- then to a human.

/** Total item count — the engine's "we do not sell X" gate needs >= 200 items before daring to say so. */
class CatalogCount implements ToolHandler {
  readonly name = "catalog.count" as const;
  readonly needs = ["hang-kho", "count"] as const;
  async run(ctx: GatewayContext): Promise<unknown> {
    return { total: Number(await ctx.services["hang-kho"].count()) || 0 };
  }
}

/** The variant (size) chart of one item, with in/out of stock. */
class VariantChart implements ToolHandler {
  readonly name = "variant.chart" as const;
  readonly needs = ["hang-kho", "read"] as const;
  async run(ctx: GatewayContext, input: ToolInput): Promise<unknown> {
    const item = await ctx.services["hang-kho"].read(String(input["itemId"] || input["code"] || ""));
    const sizes = (Array.isArray(item?.sizes) ? item.sizes : []) as unknown as Record<string, unknown>[];
    return {
      axis: "size",
      rows: sizes
        .map((s) => ({ label: String(s["size"] ?? s["label"] ?? ""), note: Number(s["qty"] ?? s["stock"] ?? 0) > 0 ? "còn" : "hết" }))
        .filter((row) => row.label !== "")
    };
  }
}

/**
 * Shop policy — the ONLY legitimate source for the bot to assert anything about returns /
 * shipping / warranty. Read from the page content (the owner edits it in OMI). Empty = not
 * found -> the bot hands over to a human.
 */
class PolicyGet implements ToolHandler {
  readonly name = "policy.get" as const;
  readonly needs = ["khung-nen-tang", "content"] as const;
  async run(ctx: GatewayContext, input: ToolInput): Promise<unknown> {
    const content = await ctx.services["khung-nen-tang"]!.content();
    const topic = String(input["topic"] ?? "").toLowerCase();
    let policy = "";
    if (/doi|tra|hoan|return/.test(topic)) policy = content.chinhSachDoiTra;
    else if (/ship|giao|van-chuyen|phi/.test(topic)) policy = content.chinhSachShip;
    else if (/bao-hanh|baohanh|warranty/.test(topic)) policy = content.chinhSachBaoHanh;
    policy = String(policy || "").trim();
    return { found: policy !== "", text: policy, updatedAt: String(content.updatedAt || "") };
  }
}

/** How long an order-only item takes — the day count the owner set in the page content. */
class PurchaseEta implements ToolHandler {
  readonly name = "purchase.eta" as const;
  readonly needs = ["hang-kho", "read"] as const;
  async run(ctx: GatewayContext, input: ToolInput): Promise<unknown> {
    const item = await ctx.services["hang-kho"].read(String(input["itemId"] || input["code"] || ""));
    if (!item) return { available: false };
    const platform = ctx.services["khung-nen-tang"];
    const content = platform?.content ? await platform.content() : null;
    const days = Number(String(content?.soNgayHangOrder ?? "").trim());
    return Number.isFinite(days) && days > 0 ? { available: true, days } : { available: false };
  }
}

/**
 * Recognising a returning customer. The landing has NO way yet to map a conversation to a phone
 * number (the customer has not typed one), so it honestly answers "unknown"; the engine currently
 * says nothing based on this result.
 */
class CustomerRecognize implements ToolHandler {
  readonly name = "customer.recognize" as const;
  readonly needs = null;
  async run(): Promise<unknown> {
    return { isReturning: false, orderCount: 0 };
  }
}

// ---- Three tools for the AI agent on Xeon (16/09/2026) — Sales Desk's level-2 agent moved there.

/** The whole public catalogue, kept one minute: the finder scans every item on each call. */
const CATALOG_CACHE_MS = 60 * 1000;
const catalogCache = new WeakMap<object, { at: number; items: CatalogItem[] }>();

async function wholeCatalog(ctx: GatewayContext): Promise<CatalogItem[]> {
  const now = ctx.ports.clock.now().getTime();
  const cached = catalogCache.get(ctx.services["hang-kho"]);
  if (cached && now - cached.at < CATALOG_CACHE_MS) return cached.items;
  const items = await ctx.services["hang-kho"].search({ query: "", limit: 20000 });
  catalogCache.set(ctx.services["hang-kho"], { at: now, items });
  return items;
}

/** Sales Desk's `tra_kho`: in-stock items by name / code / size / purpose / gender (see `catalog-find.ts`). */
class CatalogFind implements ToolHandler {
  readonly name = "catalog.find" as const;
  readonly needs = ["hang-kho", "search"] as const;
  async run(ctx: GatewayContext, input: ToolInput): Promise<unknown> {
    return { ketQua: findInCatalog(await wholeCatalog(ctx), input, String(ctx.config.siteUrl ?? "")) };
  }
}

/**
 * The shop's bank account — the agent checks a customer's transfer screenshot against it.
 * Already public (the storefront shows it for transfers), so nothing new leaves the machine.
 */
class ShopBankAccount implements ToolHandler {
  readonly name = "shop.bankAccount" as const;
  readonly needs = ["khung-nen-tang", "content"] as const;
  async run(ctx: GatewayContext): Promise<unknown> {
    const content = await ctx.services["khung-nen-tang"]!.content();
    return {
      nganHang: content.bankName, maNganHang: content.bankCode,
      soTaiKhoan: content.bankAccountNumber, chuTaiKhoan: content.bankAccountName
    };
  }
}

/**
 * The recent messages of THIS conversation, so the agent answers in context and knows whether a
 * human is on it. Read from the landing's inbox on every turn; Xeon keeps none of it.
 */
class ConversationRecent implements ToolHandler {
  readonly name = "conversation.recent" as const;
  readonly needs = ["hop-thu", "thread"] as const;
  async run(ctx: GatewayContext, input: ToolInput): Promise<unknown> {
    const messages = await ctx.services["hop-thu"]!.thread({ maHoiThoai: text(input["conversationId"]), limit: Number(input["limit"] || 20) });
    return { tin: messages.map((m) => ({ chieu: m.chieu, boi: m.boi, chu: m.chu, soAnh: m.soAnh, luc: m.luc })) };
  }
}

/**
 * Đ7: what the shop approved for the AI (Q&A, rules, style examples, fit notes, libraries, sample
 * profiles) and the external product settled on in this conversation. Approved items only.
 */
class TrainingKnowledge implements ToolHandler {
  readonly name = "training.knowledge" as const;
  readonly needs = ["tro-ly-ai", "knowledge"] as const;
  async run(ctx: GatewayContext, input: ToolInput): Promise<unknown> {
    return ctx.services["tro-ly-ai"]!.knowledge({ q: text(input["q"]), maHoiThoai: text(input["conversationId"]) });
  }
}

/** The tool table, in the order the brain lists them. */
export const DEFAULT_TOOL_HANDLERS: readonly ToolHandler[] = [
  new CatalogSearch(),
  new StockLookup(),
  new OrderLookup(),
  new PaymentStatus(),
  new ShipmentTrack(),
  new StorefrontLink(),
  new CatalogCount(),
  new VariantChart(),
  new PolicyGet(),
  new PurchaseEta(),
  new CustomerRecognize(),
  new CatalogFind(),
  new ShopBankAccount(),
  new ConversationRecent(),
  new TrainingKnowledge()
];
