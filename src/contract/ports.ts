/**
 * @file The PORTS a module may ask the kernel for — and nothing else.
 *
 * A module never opens a file, a socket or a database itself. It declares which of these ports it
 * needs in its manifest and receives exactly those on `ctx.ports`. Every port has a real adapter
 * (in `kernel/ports/`) and a fake one, so a module is tested without disk, clock or network.
 *
 * Only interfaces live here: the contract is the root of the dependency graph and must import
 * nothing from the kernel or the modules.
 */

/** Names a manifest may list under `ports`. `bus` and `config` are always handed over separately. */
export const PORT_NAMES = ["store", "logger", "clock", "http", "bus", "auth", "config", "staticFiles"] as const;
export type PortName = (typeof PORT_NAMES)[number];

// ---------------------------------------------------------------------------------------------
// Logger and clock
// ---------------------------------------------------------------------------------------------

/** Operational log. Messages stay Vietnamese: the merchant's operator reads them. */
export interface Logger {
  info(...parts: unknown[]): void;
  warn(...parts: unknown[]): void;
}

/** The only source of "now". Tests move it by hand; nothing waits on wall-clock time. */
export interface Clock {
  now(): Date;
}

// ---------------------------------------------------------------------------------------------
// Outbound HTTP
// ---------------------------------------------------------------------------------------------

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Per-call deadline; the adapter aborts the request after it. */
  timeoutMs?: number;
}

/** The slice of a fetch `Response` modules use. Fakes in tests implement just this. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/**
 * Calls to the Internet (Graph API, carriers, Telegram, Xeon). Every call has a deadline —
 * a partner that hangs must not hang the whole server (learned from the SPX line on the old site).
 */
export interface HttpClient {
  fetch(url: string, init?: HttpRequestInit): Promise<HttpResponse>;
}

// ---------------------------------------------------------------------------------------------
// Data store: small JSON documents plus (on MySQL) real tables
// ---------------------------------------------------------------------------------------------

/** One database row. Column names are the on-disk contract and stay as they are. */
export type Row = Record<string, unknown>;

export type Comparison = ">" | ">=" | "<" | "<=" | "!=" | "like";

/**
 * A WHERE clause as data:
 *   `{ ma: "X" }`                          -> `ma` = ?
 *   `{ ma: ["A", "B"] }`                   -> `ma` IN (?, ?)   (empty list matches NO row)
 *   `{ tao_luc: { ">": "2026-01-01" } }`   -> `tao_luc` > ?
 *   `{ ghi_chu: null }`                    -> `ghi_chu` IS NULL
 */
export type WhereValue =
  | string | number | boolean | null | Date
  | ReadonlyArray<string | number>
  | Partial<Record<Comparison, string | number | Date>>;
export type Where = Record<string, WhereValue>;

export interface FindOptions {
  where?: Where;
  /** `"col"`, `"col desc"`, or a list of those. */
  orderBy?: string | string[];
  limit?: number;
  offset?: number;
  columns?: "*" | string[];
}

export interface WriteResult {
  insertId: number | null;
  affectedRows: number;
}

/** One table, bound to whoever runs the statements (the pool, or a transaction's connection). */
export interface Table {
  find(options?: FindOptions): Promise<Row[]>;
  one(where?: Where): Promise<Row | null>;
  count(where?: Where): Promise<number>;
  insert(values: Row): Promise<WriteResult>;
  /** Insert; on a duplicate key update the given columns. */
  upsert(values: Row): Promise<WriteResult>;
  /** Insert many rows in batches. Every row must carry the same columns as the first. */
  insertMany(rows: Row[], options?: { batchSize?: number }): Promise<{ affectedRows: number }>;
  /** Refuses an empty `where`: one slip would rewrite the whole table. */
  update(where: Where, values: Row): Promise<number>;
  /** Refuses an empty `where`. Use `truncate()` when you really mean everything. */
  delete(where: Where): Promise<number>;
  truncate(): Promise<number>;
}

/** A small JSON document ("sổ"): blocked codes, page content, the Fanpage inbox. */
export interface Document<T = unknown> {
  read(fallback?: T | null): Promise<T | null>;
  write(value: T): Promise<T>;
  /**
   * Read, change, write as ONE step. `mutate` returns the new value, or `undefined` to leave the
   * document untouched. On MySQL the row is locked for the duration; on files the document has a
   * single writer queue.
   */
  update(mutate: (current: T | null) => T | undefined | Promise<T | undefined>, fallback?: T | null): Promise<T | null>;
}

/** One step of a module's schema. Table names must start with the module's prefix (see manifest). */
export interface SchemaStep {
  name: string;
  tables: string[];
  sql: string;
}

/**
 * The store port. Documents work everywhere; tables, raw SQL, transactions and schemas need MySQL
 * (`supportsTables`). The JSON-file adapter throws a clear error on those instead of pretending.
 */
export interface DataStore {
  readonly supportsTables: boolean;
  document<T = unknown>(name: string): Document<T>;
  table(name: string): Table;
  /** SELECT-style statement: returns rows. */
  rows<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** INSERT/UPDATE/DELETE-style statement: returns what changed. */
  execute(sql: string, params?: unknown[]): Promise<WriteResult>;
  /** Runs `work` inside one transaction; nested calls reuse the outer transaction. */
  transaction<T>(work: (store: DataStore) => Promise<T>): Promise<T>;
  /** Runs the steps not yet recorded in the schema history. Safe to call again and again. */
  runSchema(moduleId: string, steps: SchemaStep[], options?: { inheritedTables?: string[] }): Promise<void>;
  /** Waits for queued writes (file adapter) — call before shutdown and in tests. */
  flush(): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------------------------

/**
 * Who may call a route. The VALUES are shared with the machine tickets Xeon signs (`vai`), so they
 * stay as they are; code refers to them through `ACCESS`.
 *
 *   public  — anyone. Such a route must protect itself and say how (`whyPublic`).
 *   service — the brain on Xeon. An admin caller passes too (higher level).
 *   admin   — the shop owner's console (OMI), Sales Desk, Image Tool.
 */
export const ACCESS = { public: "cong-khai", service: "dich-vu", admin: "quan-tri" } as const;
export type Access = (typeof ACCESS)[keyof typeof ACCESS];
export const ACCESS_LEVELS: readonly Access[] = [ACCESS.public, ACCESS.service, ACCESS.admin];

/** The role a caller was resolved to. `anonymous` = no usable credential. */
export const ROLE = { admin: "quan-tri", service: "dich-vu", anonymous: "khach-vang-lai" } as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

/**
 * The resolved caller. `via` says HOW they were recognised ("ve-xeon", "khoa-dai-han") or why
 * they were not ("ma-la", "chua-dang-ky-xeon", "ve-het_han"...). Ticket callers also carry the
 * shop, machine and the feature list the shop has bought.
 */
export interface Caller {
  role: Role;
  name: string;
  via: string;
  shop?: string;
  machineId?: string;
  features?: string[];
  onDuty?: boolean;
  expiresAt?: number;
}

/** The request slice the auth port needs: a token comes from a header or the query string. */
export interface CredentialSource {
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
}

export interface XeonPublicKey {
  keyId: string;
  publicKeyPem: string;
  shop: string;
}

export interface AuthPort {
  /** Who is calling. Never throws. */
  identify(request: CredentialSource): Caller;
  /** Does this caller reach a route declared with `access`? Admin reaches service routes too. */
  allows(request: CredentialSource, access: Access): boolean;
  /** Ticket callers lacking the feature are blocked; long-lived keys and anonymous callers are not. */
  lacksFeature(request: CredentialSource, feature: string): boolean;
  /** Registers (or rotates) the Xeon public key used to verify machine tickets. */
  setXeon(key: XeonPublicKey): void;
  hasXeon(): boolean;
  shop(): string;
  isConfigured(): boolean;
  /** Names and roles of the long-lived keys — never the key values. */
  keyNames(): { name: string; role: Role }[];
  isAdmin(request: CredentialSource): boolean;
}

// ---------------------------------------------------------------------------------------------
// Rate limiting, static files, the bus
// ---------------------------------------------------------------------------------------------

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimitPort {
  /** Counts one call under `key`; refuses beyond `limit` calls per `windowMs`. */
  hit(key: string, limit: number, windowMs: number): RateLimitVerdict;
}

export interface StaticFile {
  data: Buffer;
  type: string;
  cacheControl: string;
  /** The normalised relative path that was served. */
  path: string;
}

/** A directory a module may serve files from — its own `goc/` and nothing above it. */
export interface StaticZone {
  readonly root: string;
  read(requestedPath: string): Promise<StaticFile | null>;
  exists(requestedPath: string): Promise<boolean>;
}

export interface StaticFilePort {
  open(zone: string): StaticZone;
}

/** What a module sees of the event bus: it may emit only what its manifest declares. */
export interface ModuleBus {
  emit(event: string, payload: unknown): number;
  listenerMap(): Record<string, string[]>;
}
