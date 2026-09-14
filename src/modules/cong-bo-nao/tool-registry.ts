/**
 * @file The registry of brain tools: which are OPEN for this installation, and which handler answers a name.
 *
 * RULE 1 of the gateway: ONLY what the contract lists is open. A tool is a row in the handler
 * table; an unknown name is refused. There is no "run an arbitrary command" door. A tool whose
 * service is missing (the shop did not buy that module) does not appear at all — the brain reads
 * the open list and never calls it.
 */

import type { ServiceMap } from "../../contract";
import type { GatewayContext } from "./context";
import { DEFAULT_TOOL_HANDLERS, type ToolHandler, type ToolName } from "./tool-handlers";

export class ToolRegistry {
  private readonly byName = new Map<string, ToolHandler>();

  constructor(private readonly handlers: readonly ToolHandler[] = DEFAULT_TOOL_HANDLERS) {
    for (const handler of handlers) {
      if (this.byName.has(handler.name)) throw new Error(`Tool "${handler.name}" is registered twice.`);
      this.byName.set(handler.name, handler);
    }
  }

  /** Whether the service the handler needs is wired into this ctx (services vary per installation). */
  isOpen(ctx: GatewayContext, handler: ToolHandler): boolean {
    if (!handler.needs) return true;
    const [moduleId, service] = handler.needs;
    // The typed `Services` has no index signature; at runtime it is the kernel's plain service map.
    return typeof (ctx.services as unknown as ServiceMap)[moduleId]?.[service] === "function";
  }

  /** Names of the tools OPEN for this installation, in table order. */
  openTools(ctx: GatewayContext): ToolName[] {
    return this.handlers.filter((h) => this.isOpen(ctx, h)).map((h) => h.name);
  }

  /** The handler for `name`, only when it is open here; `null` for an unknown or closed tool. */
  find(ctx: GatewayContext, name: string): ToolHandler | null {
    const handler = this.byName.get(name);
    return handler && this.isOpen(ctx, handler) ? handler : null;
  }
}
