/**
 * @file The event bus: the only way two modules talk.
 *
 * A direct call would make one module require another; switch off Shipping and Orders breaks.
 * Over the bus nobody notices who is switched off. Rules:
 *   - the emitter does not know who listens and never waits for a result;
 *   - a failing listener is logged and never breaks the emitter;
 *   - a module may emit only what its manifest declares (enforced by the kernel's `ModuleBus`).
 */

import type { Logger } from "../contract";

type Listener = (payload: unknown) => unknown;

interface Subscription {
  moduleId: string;
  listener: Listener;
}

export interface DeliveryResult {
  moduleId: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export class EventBus {
  private readonly subscriptions = new Map<string, Subscription[]>();

  constructor(private readonly logger?: Logger) {}

  /** Subscribes `moduleId` — the id is kept so an error names the culprit. */
  on(event: string, moduleId: string, listener: Listener): void {
    const list = this.subscriptions.get(event) ?? [];
    list.push({ moduleId, listener });
    this.subscriptions.set(event, list);
  }

  /** Fire and forget. Returns how many listeners were notified. */
  emit(event: string, payload: unknown): number {
    const list = this.subscriptions.get(event) ?? [];
    for (const { moduleId, listener } of list) {
      Promise.resolve()
        .then(() => listener(payload))
        .catch((e: unknown) => this.logger?.warn(`[bus] module "${moduleId}" listening to "${event}" failed: ${errorText(e)}`));
    }
    return list.length;
  }

  /** Test-only: waits for every listener and reports each outcome. */
  async emitAndWait(event: string, payload: unknown): Promise<DeliveryResult[]> {
    const results: DeliveryResult[] = [];
    for (const { moduleId, listener } of this.subscriptions.get(event) ?? []) {
      try {
        results.push({ moduleId, ok: true, value: await listener(payload) });
      } catch (e) {
        results.push({ moduleId, ok: false, error: errorText(e) });
        this.logger?.warn(`[bus] module "${moduleId}" listening to "${event}" failed: ${errorText(e)}`);
      }
    }
    return results;
  }

  /** Who listens to what — for tests and the diagnostics screen. */
  listenerMap(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [event, list] of this.subscriptions) out[event] = list.map((s) => s.moduleId);
    return out;
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
