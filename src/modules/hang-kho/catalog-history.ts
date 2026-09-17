/**
 * @file Undo for catalogue edits — Sales Desk's `captureLandingProductsUndo` / `undo-landing-products`.
 *
 * Desk's rule (anh Dũng, 05/08/2026): "an action touches only what it acts on". So a snapshot holds
 * ONLY the items an action touched — never the whole catalogue — and undo puts back only those.
 *
 * One action = one `lan` (group id) = one row per item, with the item row and its variant rows as
 * they were BEFORE. `truoc_json` NULL means the item did not exist: undo removes it again.
 *
 * STOCK IS NOT ROLLED BACK. Between the edit and the undo a customer may have bought the last pair;
 * putting yesterday's count back would sell a pair that is gone. Undo restores descriptions, prices,
 * images and the size list; `ton` of a size that still exists stays what the shelf says now.
 */

import type { DataStore, Row } from "../../contract";
import { mysqlTime } from "./catalog-repository";
import { TABLES } from "./schema";

/** How many actions stay undoable. Older snapshots are dropped when a new one is written. */
const KEEP_GROUPS = 50;

/** The newest undoable action, as OMI shows it on the "Hoàn tác: …" button. Wire names. */
export interface UndoHead {
  lan: string;
  nhan: string;
  luc: string;
  maMon: string[];
}

interface Snapshot {
  item: Row;
  variants: Row[];
}

export class CatalogHistory {
  constructor(private readonly store: DataStore, private readonly now: () => Date) {}

  /** Remembers the current rows of `codes` under one label. Returns the group id ("" when nothing to remember). */
  async capture(label: string, codes: string[], actor: string): Promise<string> {
    const wanted = [...new Set(codes.map((c) => String(c || "").trim()).filter(Boolean))];
    if (wanted.length === 0) return "";
    const at = this.now();
    const group = `hk_${at.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
    for (const code of wanted) {
      const item = await this.store.table(TABLES.items).one({ ma: code });
      const snapshot: Snapshot | null = item ? { item, variants: await this.store.table(TABLES.variants).find({ where: { ma_mon: code } }) } : null;
      await this.store.table(TABLES.snapshots).insert({
        lan: group, nhan: label.slice(0, 255), ma_mon: code, truoc_json: snapshot === null ? null : JSON.stringify(snapshot),
        boi: actor.slice(0, 190), luc: mysqlTime(at), hoan_tac_luc: null
      });
    }
    await this.prune();
    return group;
  }

  /** The newest action not undone yet, or null. */
  async head(): Promise<UndoHead | null> {
    const rows = await this.store.rows(
      `SELECT lan, nhan, luc FROM ${TABLES.snapshots} WHERE hoan_tac_luc IS NULL ORDER BY ma DESC LIMIT 1`, []
    );
    const top = rows[0];
    if (!top) return null;
    const lan = String(top["lan"]);
    const codes = await this.store.rows(`SELECT ma_mon FROM ${TABLES.snapshots} WHERE lan = ? ORDER BY ma ASC`, [lan]);
    return { lan, nhan: String(top["nhan"] || ""), luc: String(top["luc"] || ""), maMon: codes.map((r) => String(r["ma_mon"])) };
  }

  /** Undoes the newest action. `null` = nothing to undo. */
  async undoLatest(): Promise<UndoHead | null> {
    const head = await this.head();
    if (head === null) return null;
    await this.store.transaction(async (tx) => {
      const entries = await tx.rows(`SELECT ma_mon, truoc_json FROM ${TABLES.snapshots} WHERE lan = ? AND hoan_tac_luc IS NULL ORDER BY ma DESC FOR UPDATE`, [head.lan]);
      for (const entry of entries) {
        const code = String(entry["ma_mon"]);
        const raw = entry["truoc_json"];
        const before = raw === null || raw === undefined || raw === "" ? null : (JSON.parse(String(raw)) as Snapshot);
        await restore(tx, code, before, mysqlTime(this.now()));
      }
      await tx.execute(`UPDATE ${TABLES.snapshots} SET hoan_tac_luc = ? WHERE lan = ?`, [mysqlTime(this.now()), head.lan]);
    });
    return head;
  }

  private async prune(): Promise<void> {
    const cut = await this.store.rows(
      `SELECT MIN(ma) AS ma FROM (SELECT MIN(ma) AS ma FROM ${TABLES.snapshots} GROUP BY lan ORDER BY MIN(ma) DESC LIMIT ?) giu`, [KEEP_GROUPS]
    );
    const oldestKept = Number(cut[0]?.["ma"] || 0);
    if (oldestKept > 0) await this.store.execute(`DELETE FROM ${TABLES.snapshots} WHERE ma < ?`, [oldestKept]);
  }
}

/** Puts one item back as `before` says (see the file header for what "back" means for stock). */
async function restore(tx: DataStore, code: string, before: Snapshot | null, at: string): Promise<void> {
  const current = await tx.table(TABLES.variants).find({ where: { ma_mon: code } });
  if (before === null) {
    // The action CREATED the item: take away the house sizes; the row goes when nothing else points at it.
    await tx.table(TABLES.variants).delete({ ma_mon: code, nguon: "own" });
    const left = await tx.rows(`SELECT COUNT(*) AS n FROM ${TABLES.variants} WHERE ma_mon = ?`, [code]);
    if (Number(left[0]?.["n"] || 0) === 0) await tx.table(TABLES.items).delete({ ma: code });
    return;
  }
  await tx.table(TABLES.items).upsert({ ...before.item, sua_luc: at });
  const kept = new Set(before.variants.map((v) => String(v["ma_bien_the"])));
  const now = new Map(current.map((v) => [String(v["ma_bien_the"]), v]));
  for (const v of before.variants) {
    const id = String(v["ma_bien_the"]);
    const live = now.get(id);
    if (live) {
      const { ma_bien_the: _id, ton: _ton, ...columns } = v;
      await tx.table(TABLES.variants).update({ ma_bien_the: id }, { ...columns, sua_luc: at });
    } else {
      await tx.table(TABLES.variants).insert({ ...v, sua_luc: at });
    }
  }
  // House sizes the action ADDED go away; other sources' lines were never the editor's to touch.
  for (const v of current) {
    if (!kept.has(String(v["ma_bien_the"])) && String(v["nguon"]) === "own") {
      await tx.table(TABLES.variants).delete({ ma_bien_the: String(v["ma_bien_the"]) });
    }
  }
}
