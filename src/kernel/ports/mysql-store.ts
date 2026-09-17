/**
 * @file The store port on MySQL — the real one. Decided 12/09/2026: "everything to MySQL".
 *
 * Same shape as the JSON-file store plus what matters most: TABLES WITH ROWS.
 *
 *   store.table("don_hang").find({ where: { trang_thai: "moi" } })   <- one row per order
 *   store.document("cau-hinh-web").read()                              <- still here, for small documents
 *
 * Why both: some things really are ONE small document (blocked codes, page content); forcing them
 * into tables is busywork. But CUSTOMER data — orders, customers, stock, messages — must be rows:
 *   - writing one order must not rewrite a 14 MB catalogue,
 *   - two customers ordering at once must not overwrite each other (transactions do that, files cannot),
 *   - "orders of this phone number" must be one statement, not read-everything-then-filter.
 *
 * SCHEMA: each module declares its own tables, and their names carry the module's prefix, so the
 * table name says who owns it and no module quietly edits another's. History: `lich_su_luoc_do`.
 *
 * NO module imports this file — they receive `ctx.ports.store`.
 */

import mysql from "mysql2/promise";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  DataStore, Document, FindOptions, Logger, Row, SchemaStep, Table, Where, WriteResult
} from "../../contract";

export const DOCUMENT_TABLE = "so_du_lieu";
export const SCHEMA_HISTORY_TABLE = "lich_su_luoc_do";

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const DOCUMENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const COMPARISONS = new Set([">", ">=", "<", "<=", "!=", "like"]);

/** A runner of statements: the pool, or one connection inside a transaction. */
type Runner = (sql: string, params: unknown[]) => Promise<[RowDataPacket[] | ResultSetHeader, unknown]>;

/**
 * Splits a block of SQL into statements. Splitting on ";" naively is WRONG: a semicolon inside a
 * comment cut a statement in half once (the purchase module's schema). Comments go first.
 * Known limit: a semicolon inside a string literal still splits — schemas must not contain one.
 */
export function splitStatements(sql: string): string[] {
  const withoutComments = String(sql).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");
  return withoutComments.split(";").map((s) => s.trim()).filter(Boolean);
}

/**
 * An `ALTER TABLE t ADD COLUMN c` / `ADD KEY k` with ONE clause whose column or key already exists.
 * Inherited tables (`orders`...) were grown by the old web too, so a step may meet a column that is
 * already there (17/09: `shipping_fee`). Only single-clause statements are forgiven — in a
 * multi-clause ALTER MySQL applies nothing, and skipping it would silently drop the other columns.
 */
export function alreadyPresent(statement: string, error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code !== "ER_DUP_FIELDNAME" && code !== "ER_DUP_KEYNAME") return false;
  const s = statement.replace(/\s+/g, " ").trim();
  if (!/^ALTER TABLE \S+ ADD (COLUMN|KEY|INDEX|UNIQUE KEY) /i.test(s)) return false;
  return !/,\s*(ADD|DROP|MODIFY|CHANGE)\s/i.test(s);
}

/** Only lower-case letters, digits and underscores may become an identifier in a statement. */
export function safeName(name: unknown, kind = "table"): string {
  const s = String(name ?? "");
  if (!NAME_PATTERN.test(s)) throw new Error(`Invalid ${kind} name: ${JSON.stringify(name)}`);
  return s;
}

export function buildWhere(where: Where = {}): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of Object.entries(where ?? {})) {
    const c = safeName(column, "column");
    if (value === null) { parts.push(`\`${c}\` IS NULL`); continue; }
    if (Array.isArray(value)) {
      // `IN ()` is invalid SQL, and dropping the clause would match EVERY row — for DELETE/UPDATE
      // that is data loss. An empty list therefore matches nothing.
      if (value.length === 0) { parts.push("1 = 0"); continue; }
      parts.push(`\`${c}\` IN (${value.map(() => "?").join(", ")})`);
      params.push(...value);
      continue;
    }
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      for (const [op, v] of Object.entries(value)) {
        const p = String(op).toLowerCase();
        if (!COMPARISONS.has(p)) throw new Error(`Unsupported comparison: ${op}`);
        parts.push(`\`${c}\` ${p.toUpperCase()} ?`);
        params.push(v);
      }
      continue;
    }
    parts.push(`\`${c}\` = ?`);
    params.push(value);
  }
  return { clause: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

export function buildOrderBy(orderBy?: string | string[]): string {
  if (!orderBy) return "";
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  const parts = list.map((item) => {
    const [column, direction = "asc"] = String(item).split(/\s+/);
    return `\`${safeName(column, "column")}\` ${String(direction).toLowerCase() === "desc" ? "DESC" : "ASC"}`;
  });
  return parts.length ? `ORDER BY ${parts.join(", ")}` : "";
}

function header(result: RowDataPacket[] | ResultSetHeader): ResultSetHeader {
  return result as ResultSetHeader;
}

class MysqlTable implements Table {
  private readonly name: string;
  constructor(private readonly run: Runner, name: string) { this.name = safeName(name); }

  async find(options: FindOptions = {}): Promise<Row[]> {
    const { clause, params } = buildWhere(options.where);
    const columns = options.columns === undefined || options.columns === "*"
      ? "*"
      : options.columns.map((c) => `\`${safeName(c, "column")}\``).join(", ");
    let sql = `SELECT ${columns} FROM \`${this.name}\` ${clause} ${buildOrderBy(options.orderBy)}`;
    if (options.limit && options.limit > 0) { sql += " LIMIT ?"; params.push(Number(options.limit)); }
    if (options.offset && options.offset > 0) { sql += " OFFSET ?"; params.push(Number(options.offset)); }
    const [rows] = await this.run(sql, params);
    return rows as Row[];
  }

  async one(where: Where = {}): Promise<Row | null> {
    const rows = await this.find({ where, limit: 1 });
    return rows[0] ?? null;
  }

  async count(where: Where = {}): Promise<number> {
    const { clause, params } = buildWhere(where);
    const [rows] = await this.run(`SELECT COUNT(*) AS n FROM \`${this.name}\` ${clause}`, params);
    return Number((rows as Row[])[0]?.["n"] ?? 0);
  }

  async insert(values: Row): Promise<WriteResult> {
    const columns = Object.keys(values).map((c) => safeName(c, "column"));
    if (columns.length === 0) throw new Error(`Inserting an empty row into "${this.name}"`);
    const [result] = await this.run(
      `INSERT INTO \`${this.name}\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      Object.values(values)
    );
    return { insertId: header(result).insertId ?? null, affectedRows: header(result).affectedRows ?? 0 };
  }

  async upsert(values: Row): Promise<WriteResult> {
    const columns = Object.keys(values).map((c) => safeName(c, "column"));
    if (columns.length === 0) throw new Error(`Inserting an empty row into "${this.name}"`);
    const [result] = await this.run(
      `INSERT INTO \`${this.name}\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) ` +
      `ON DUPLICATE KEY UPDATE ${columns.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(", ")}`,
      Object.values(values)
    );
    return { insertId: header(result).insertId ?? null, affectedRows: header(result).affectedRows ?? 0 };
  }

  /**
   * Many rows per statement. A catalogue has tens of thousands of variants; one round trip per
   * row turns seconds into minutes. Batched to stay under MySQL's `max_allowed_packet`.
   */
  async insertMany(rows: Row[], { batchSize = 500 } = {}): Promise<{ affectedRows: number }> {
    const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
    if (list.length === 0) return { affectedRows: 0 };
    const columns = Object.keys(list[0]!).map((c) => safeName(c, "column"));
    if (columns.length === 0) throw new Error(`Inserting empty rows into "${this.name}"`);
    let affectedRows = 0;
    for (let i = 0; i < list.length; i += batchSize) {
      const batch = list.slice(i, i + batchSize);
      const params: unknown[] = [];
      batch.forEach((row, j) => {
        // Every row must carry EXACTLY the first row's columns; one missing column shifts the whole statement.
        const missing = columns.filter((c) => !(c in row));
        if (missing.length > 0) throw new Error(`Row ${i + j + 1} is missing columns: ${missing.join(", ")}`);
        for (const c of columns) params.push(row[c]);
      });
      const rowTemplate = `(${columns.map(() => "?").join(", ")})`;
      const [result] = await this.run(
        `INSERT INTO \`${this.name}\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES ${batch.map(() => rowTemplate).join(", ")}`,
        params
      );
      affectedRows += header(result).affectedRows ?? 0;
    }
    return { affectedRows };
  }

  async update(where: Where, values: Row): Promise<number> {
    const columns = Object.keys(values).map((c) => safeName(c, "column"));
    if (columns.length === 0) return 0;
    const { clause, params } = buildWhere(where);
    if (!clause) throw new Error(`Updating table "${this.name}" without a condition — refused.`);
    const [result] = await this.run(`UPDATE \`${this.name}\` SET ${columns.map((c) => `\`${c}\` = ?`).join(", ")} ${clause}`, [...Object.values(values), ...params]);
    return header(result).affectedRows ?? 0;
  }

  async delete(where: Where): Promise<number> {
    const { clause, params } = buildWhere(where);
    if (!clause) throw new Error(`Deleting from table "${this.name}" without a condition — refused.`);
    const [result] = await this.run(`DELETE FROM \`${this.name}\` ${clause}`, params);
    return header(result).affectedRows ?? 0;
  }

  async truncate(): Promise<number> {
    const [result] = await this.run(`DELETE FROM \`${this.name}\``, []);
    return header(result).affectedRows ?? 0;
  }
}

function parseDocument<T>(raw: unknown): T {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
}

/**
 * The store over one runner. The pool-backed instance is the public one; `transaction()` hands
 * `work` a second instance bound to one connection, whose nested `transaction()` reuses it.
 */
class BoundStore implements DataStore {
  readonly supportsTables = true;

  constructor(
    private readonly run: Runner,
    private readonly openTransaction: (<T>(work: (store: DataStore) => Promise<T>) => Promise<T>) | null,
    private readonly logger: Logger,
    private readonly pool: Pool | null
  ) {}

  table(name: string): Table { return new MysqlTable(this.run, name); }

  document<T = unknown>(name: string): Document<T> {
    const key = String(name ?? "").trim();
    if (!DOCUMENT_NAME_PATTERN.test(key)) throw new Error(`Invalid document name: ${name}`);
    return {
      read: async (fallback = null) => {
        const [rows] = await this.run(`SELECT noi_dung FROM \`${DOCUMENT_TABLE}\` WHERE ten = ?`, [key]);
        const first = (rows as Row[])[0];
        return first ? parseDocument<T>(first["noi_dung"]) : fallback;
      },
      write: async (value) => {
        await this.run(
          `INSERT INTO \`${DOCUMENT_TABLE}\` (ten, noi_dung, sua_luc) VALUES (?, ?, NOW(3)) ON DUPLICATE KEY UPDATE noi_dung = VALUES(noi_dung), sua_luc = VALUES(sua_luc)`,
          [key, JSON.stringify(value)]
        );
        return value;
      },
      // Read-modify-write in ONE transaction with a ROW LOCK (`FOR UPDATE`): the second writer
      // waits instead of reading the old value and overwriting the first writer's work.
      update: (mutate, fallback = null) => this.transaction(async (inner) => {
        const rows = await inner.rows(`SELECT noi_dung FROM \`${DOCUMENT_TABLE}\` WHERE ten = ? FOR UPDATE`, [key]);
        const current = rows[0] ? parseDocument<T>(rows[0]["noi_dung"]) : fallback;
        const next = await mutate(current);
        if (next === undefined) return current;
        await inner.document<T>(key).write(next);
        return next;
      })
    };
  }

  async rows<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [result] = await this.run(sql, params);
    return result as unknown as T[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<WriteResult> {
    const [result] = await this.run(sql, params);
    return { insertId: header(result).insertId ?? null, affectedRows: header(result).affectedRows ?? 0 };
  }

  transaction<T>(work: (store: DataStore) => Promise<T>): Promise<T> {
    // Inside a transaction already: the outer one holds the locks, so just continue in it.
    if (this.openTransaction === null) return work(this);
    return this.openTransaction(work);
  }

  /**
   * Runs the steps not yet in the history. A step's tables must carry the module prefix or be in
   * `inheritedTables` (`orders`, `order_items`...: renaming those would break Sales Desk and Image Tool).
   */
  async runSchema(moduleId: string, steps: SchemaStep[] = [], { inheritedTables = [] as string[] } = {}): Promise<void> {
    const prefix = `${String(moduleId).replace(/-/g, "_")}_`;
    const allowed = new Set(inheritedTables.map(String));
    for (const step of steps) {
      const [done] = await this.run(`SELECT 1 FROM \`${SCHEMA_HISTORY_TABLE}\` WHERE module = ? AND ten = ?`, [moduleId, step.name]);
      if ((done as Row[]).length > 0) continue;
      for (const t of step.tables ?? []) {
        if (!String(t).startsWith(prefix) && !allowed.has(String(t))) {
          throw new Error(`Module "${moduleId}" declares table "${t}" — names must start with "${prefix}" or be listed in \`inheritedTables\`.`);
        }
      }
      // One step may hold several statements. The driver's `multipleStatements` stays OFF (it
      // opens an injection path everywhere else); statements are split by hand here.
      for (const statement of splitStatements(step.sql)) {
        try {
          await this.run(statement, []);
        } catch (error) {
          if (!alreadyPresent(statement, error)) throw error;
          this.logger.warn(`[kho] ${moduleId}/${step.name}: bỏ qua, đã có sẵn — ${statement.replace(/\s+/g, " ").slice(0, 120)}`);
        }
      }
      await this.run(`INSERT INTO \`${SCHEMA_HISTORY_TABLE}\` (module, ten, chay_luc) VALUES (?, ?, NOW(3))`, [moduleId, step.name]);
      this.logger.info(`[kho] chạy lược đồ ${moduleId}/${step.name}`);
    }
  }

  async flush(): Promise<void> { /* MySQL has no in-memory write queue */ }

  async close(): Promise<void> { if (this.pool) await this.pool.end(); }
}

export interface MysqlStoreOptions {
  url: string;
  logger?: Logger;
  connectionLimit?: number;
  /** A hung statement must not hold a connection forever (learned on the A4 line). */
  statementTimeoutMs?: number;
}

export type MysqlStore = DataStore;

/** Opens the pool, creates the two kernel-owned tables, returns the store. */
export async function openMysqlStore(options: MysqlStoreOptions): Promise<DataStore> {
  if (!options.url) throw new Error("MysqlStore needs `url` (mysql://user:pass@host:port/db)");
  const logger = options.logger ?? { info: () => undefined, warn: () => undefined };
  const statementTimeoutMs = options.statementTimeoutMs ?? 30000;

  const pool = mysql.createPool({
    uri: options.url,
    connectionLimit: options.connectionLimit ?? 10,
    waitForConnections: true,
    namedPlaceholders: false,
    dateStrings: true,
    connectAttributes: { program_name: "toprun-server-khach" }
  });

  const runOnPool: Runner = async (sql, params) => {
    const connection = await pool.getConnection();
    try {
      const timer = setTimeout(() => { try { connection.destroy(); } catch { /* closing */ } }, statementTimeoutMs);
      try { return await connection.query(sql, params) as [RowDataPacket[] | ResultSetHeader, unknown]; }
      finally { clearTimeout(timer); }
    } finally {
      try { connection.release(); } catch { /* destroyed */ }
    }
  };

  await runOnPool(
    `CREATE TABLE IF NOT EXISTS \`${DOCUMENT_TABLE}\` (
       ten VARCHAR(190) NOT NULL,
       noi_dung LONGTEXT NOT NULL,
       sua_luc DATETIME(3) NOT NULL,
       PRIMARY KEY (ten)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, []);
  await runOnPool(
    `CREATE TABLE IF NOT EXISTS \`${SCHEMA_HISTORY_TABLE}\` (
       module VARCHAR(64) NOT NULL,
       ten VARCHAR(190) NOT NULL,
       chay_luc DATETIME(3) NOT NULL,
       PRIMARY KEY (module, ten)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, []);

  const openTransaction = async <T>(work: (store: DataStore) => Promise<T>): Promise<T> => {
    const connection: PoolConnection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const runOnConnection: Runner = (sql, params) => connection.query(sql, params) as Promise<[RowDataPacket[] | ResultSetHeader, unknown]>;
      const inner = new BoundStore(runOnConnection, null, logger, null);
      const result = await work(inner);
      await connection.commit();
      return result;
    } catch (e) {
      try { await connection.rollback(); } catch { /* connection is gone */ }
      throw e;
    } finally {
      connection.release();
    }
  };

  return new BoundStore(runOnPool, openTransaction, logger, pool);
}
