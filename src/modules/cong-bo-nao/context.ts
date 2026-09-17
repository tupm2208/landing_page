/**
 * @file The gateway's configuration and the services it consumes.
 *
 * Service shapes are imported as TYPES from the provider modules: erased at compile time, so no
 * runtime dependency exists, but a renamed field in a provider breaks this build instead of a
 * customer conversation.
 */

import type { ModuleContext } from "../../contract";
import type { InventoryServices } from "../hang-kho/module";
import type { PublicItem } from "../hang-kho/normalise";
import type { StockLine } from "../hang-kho/catalog-repository";
import type { OrderServices } from "../don-khach/module";
import type { Order } from "../don-khach/order-repository";
import type { PlatformServices } from "../khung-nen-tang/module";
import type { ShippingServices } from "../van-chuyen/module";
import type { InboxServices } from "../hop-thu/module";
import type { AssistantServices } from "../tro-ly-ai/module";

/** `ctx.config` as `app.ts` builds it (`moduleConfigFromEnv`). */
export interface Config {
  /** Links the bot hands to customers must be the shop's public address. */
  siteUrl: string;
}

/** A catalogue item as the inventory module returns it (the public view). */
export type CatalogItem = PublicItem;
export type { StockLine };
/** An order as the orders module returns it, already annotated with money fields. */
export type OrderRecord = Order;

/**
 * Inventory is REQUIRED: without stock answers the bot has nothing to do. Orders, shipping and
 * the platform base are OPTIONAL: a shop that did not buy them just loses the matching tools.
 */
export interface Services {
  "hang-kho": Pick<InventoryServices, "search" | "stock" | "count" | "read">;
  "khung-nen-tang"?: Pick<PlatformServices, "content">;
  "don-khach"?: Pick<OrderServices["don-khach"], "read" | "search">;
  "van-chuyen"?: Pick<ShippingServices, "track">;
  "hop-thu"?: Pick<InboxServices, "thread">;
  "tro-ly-ai"?: Pick<AssistantServices, "knowledge">;
}

export type GatewayContext = ModuleContext<Config, Services>;
