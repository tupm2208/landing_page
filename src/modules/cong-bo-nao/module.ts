/**
 * @file The gateway for the brain ("cong-bo-nao") — chatbot tier, running on the merchant server.
 *
 * The brain on Xeon and the merchant server have TWO vocabularies (`stock.lookup` vs `stock`).
 * This module is the ONE place that translates. Three rules of this door:
 *
 * 1. ONLY WHAT THE CONTRACT LISTS IS OPEN. Tools are the handler table in `tool-handlers.ts`; an
 *    unknown name is refused. There is no "run an arbitrary command" door.
 * 2. ORDER LOOKUP ONLY MATCHES A NUMBER THE CUSTOMER TYPED. `order.lookup` requires the phone
 *    number the customer typed IN THAT CONVERSATION. A guessed number never returns someone else's order.
 * 3. MONEY PASSES THROUGH ONE ROOT. Money fields come from the ANNOTATED order of the orders
 *    module, never recomputed here.
 *
 * It also stores the bot's CONVERSATION MEMORY (decided 14/09/2026: the landing holds every bit of
 * the customer's data; Xeon keeps nothing) — see `conversation-memory.ts`.
 */

import { ACCESS, ERROR_CODES, defineModule, reply } from "../../contract";
import {
  CONVERSATION_ID_PATTERN, MEMORY_DOCUMENT, asMemoryBook, defaultMemoryBook, rememberConversation, stateProblem,
  type MemoryBook
} from "./conversation-memory";
import type { Config, Services } from "./context";
import { ToolRegistry } from "./tool-registry";

export type { Config, Services } from "./context";
export { MEMORY_DOCUMENT } from "./conversation-memory";

const NO_STORE = { "Cache-Control": "no-store" };
const registry = new ToolRegistry();

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export const manifest = defineModule<Config, Services>({
  id: "cong-bo-nao",
  name: "Cổng cho bộ não",
  tier: "chatbot",
  runsOn: "server-khach",
  feature: "chatbot-cskh",
  version: "0.2.0",
  ports: ["logger", "clock", "config", "store"],
  // Inventory is REQUIRED: without stock answers the bot has nothing to do.
  requires: ["hang-kho.search", "hang-kho.stock"],
  // Orders and shipping are OPTIONAL: a shop whose package lacks them loses the matching tools
  // from the list and the bot never calls them — the whole bot does not die.
  requiresOptional: ["hang-kho.count", "hang-kho.read", "khung-nen-tang.content", "don-khach.read", "don-khach.search", "van-chuyen.track"],

  routes: [
    {
      // The brain calls a tool. One route for all of them — one place to look and see everything.
      method: "POST", path: "/api/bo-nao/cong-cu", access: ACCESS.service,
      handle: async (ctx, request) => {
        const body = asObject(await request.json());
        const name = String(body["ten"] || body["tool"] || "");
        const open = registry.openTools(ctx);
        const handler = registry.find(ctx, name);
        if (!handler) {
          // RULE 1: an unknown name (or an unbought feature) is refused, and the reply says what IS open.
          return reply.json({ ok: false, error: "cong_cu_khong_co", dangMo: open }, 400);
        }
        try {
          return reply.json({ ok: true, data: await handler.run(ctx, asObject(body["input"])) }, 200, NO_STORE);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          ctx.ports.logger.warn(`[cong-bo-nao] "${name}" loi: ${message}`);
          return reply.json({ ok: false, error: ERROR_CODES.internal, message }, 500);
        }
      }
    },
    {
      method: "GET", path: "/api/bo-nao/cong-cu", access: ACCESS.service,
      handle: (ctx) => reply.json({ ok: true, congCu: registry.openTools(ctx) })
    },

    // Conversation memory: the engine reads before every turn, writes after.
    {
      method: "GET", path: "/api/bo-nao/tri-nho/:ma", access: ACCESS.service,
      rateLimit: { calls: 3000, windowMs: 10 * 60 * 1000 },
      handle: async (ctx, request) => {
        const id = String(request.params["ma"] ?? "");
        if (!CONVERSATION_ID_PATTERN.test(id)) return reply.json({ ok: false, error: "ma_hoi_thoai_sai" }, 400);
        const book = asMemoryBook(await ctx.ports.store.document<MemoryBook>(MEMORY_DOCUMENT).read(null));
        const remembered = book.hoiThoai[id] ?? null;
        return reply.json({ ok: true, trangThai: remembered ? remembered.trangThai : null, capNhatLuc: remembered ? remembered.capNhatLuc : "" }, 200, NO_STORE);
      }
    },
    {
      method: "PUT", path: "/api/bo-nao/tri-nho/:ma", access: ACCESS.service,
      rateLimit: { calls: 3000, windowMs: 10 * 60 * 1000 },
      bodyLimit: 128 * 1024,
      handle: async (ctx, request) => {
        const id = String(request.params["ma"] ?? "");
        if (!CONVERSATION_ID_PATTERN.test(id)) return reply.json({ ok: false, error: "ma_hoi_thoai_sai" }, 400);
        const state = asObject(await request.json())["trangThai"];
        const problem = stateProblem(state);
        if (problem === "thieu_trang_thai") return reply.json({ ok: false, error: problem }, 400);
        if (problem === "trang_thai_qua_lon") return reply.json({ ok: false, error: problem }, 413);
        const at = ctx.ports.clock.now().toISOString();
        await ctx.ports.store.document<MemoryBook>(MEMORY_DOCUMENT).update(
          (current) => rememberConversation(asMemoryBook(current), id, state as Record<string, unknown>, at),
          defaultMemoryBook()
        );
        return reply.json({ ok: true, capNhatLuc: at });
      }
    }
  ],

  botTools: []
});
