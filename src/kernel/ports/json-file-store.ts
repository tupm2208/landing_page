/**
 * @file The store port backed by JSON files — for machines without MySQL (trial runs only).
 *
 * Two things carried over from the old site and never to be dropped:
 *   1. ATOMIC WRITES: write a temp file, then rename. A power cut mid-write leaves the old file
 *      intact; there is never a half-written JSON document.
 *   2. ONE WRITER PER DOCUMENT: each document has its own queue. Two requests changing the same
 *      document run one after the other, never read-modify-write over each other.
 *
 * Tables are not supported here: the adapter says so loudly instead of pretending.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { DataStore, Document, Logger, SchemaStep, Table, WriteResult } from "../../contract";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export class JsonFileStore implements DataStore {
  readonly supportsTables = false;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly directory: string, private readonly logger?: Logger) {
    if (!directory) throw new Error("JsonFileStore needs a directory");
  }

  private filePath(name: string): string {
    if (!NAME_PATTERN.test(name)) throw new Error(`Invalid document name: ${name}`);
    return path.join(this.directory, `${name}.json`);
  }

  private async readFile<T>(name: string, fallback: T | null): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(this.filePath(name), "utf8")) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return fallback;
      // A corrupt file must NOT quietly become the fallback: that would erase real data on the next write.
      if (e instanceof SyntaxError) throw new Error(`Document "${name}" is not valid JSON: ${e.message}`);
      throw e;
    }
  }

  private async writeFile(name: string, value: unknown): Promise<void> {
    const target = this.filePath(name);
    const temp = `${target}.tam-${process.pid}-${Date.now()}`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(temp, target);
  }

  /** Appends to the document's queue. Different documents run in parallel. */
  private enqueue<T>(name: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(name) ?? Promise.resolve();
    const next = previous.then(work, work); // a failed earlier step does not block later ones
    this.queues.set(name, next.catch((e: unknown) => { this.logger?.warn(`[kho] sổ "${name}": ${e instanceof Error ? e.message : String(e)}`); }));
    return next;
  }

  document<T = unknown>(name: string): Document<T> {
    return {
      read: (fallback = null) => this.readFile<T>(name, fallback),
      write: (value) => this.enqueue(name, async () => { await this.writeFile(name, value); return value; }),
      update: (mutate, fallback = null) => this.enqueue(name, async () => {
        const current = await this.readFile<T>(name, fallback);
        const next = await mutate(current);
        if (next === undefined) return current;
        await this.writeFile(name, next);
        return next;
      })
    };
  }

  table(name: string): Table { throw new Error(`Table "${name}" needs MySQL (TOPRUN_MYSQL_URL); the JSON file store keeps documents only.`); }
  rows(): Promise<never> { return Promise.reject(new Error("Raw SQL needs MySQL (TOPRUN_MYSQL_URL).")); }
  execute(): Promise<WriteResult> { return Promise.reject(new Error("Raw SQL needs MySQL (TOPRUN_MYSQL_URL).")); }
  transaction<T>(): Promise<T> { return Promise.reject(new Error("Transactions need MySQL (TOPRUN_MYSQL_URL).")); }
  runSchema(moduleId: string, _steps: SchemaStep[]): Promise<void> {
    return Promise.reject(new Error(`Schema of module "${moduleId}" needs MySQL (TOPRUN_MYSQL_URL).`));
  }

  /** Waits for every queued write — before shutdown and in tests. */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.queues.values()]);
  }

  async close(): Promise<void> { await this.flush(); }
}
