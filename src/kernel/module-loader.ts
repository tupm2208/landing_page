/**
 * @file Choosing which modules run, and measuring what is still unsplit.
 *
 * Modules are a static registry (`src/modules/index.ts`), not files discovered on disk: TypeScript
 * then checks every manifest, and a typo in a directory name cannot silently drop a module. A shop
 * that bought only some features runs only those modules (`MODULE_BAT`); switching one off must
 * never break another — if it does, the kernel names the module that depends on it.
 */

import fs from "node:fs";
import path from "node:path";
import type { AnyManifest } from "../contract";

/**
 * Filters the registry by id. `enabled = null` keeps everything. An unknown id is an error:
 * a mistyped `MODULE_BAT` would otherwise quietly run a different set of modules.
 */
export function selectModules(all: AnyManifest[], enabled: string[] | null): AnyManifest[] {
  if (enabled === null) return all;
  const known = new Set(all.map((m) => m.id));
  for (const id of enabled) if (!known.has(id)) throw new Error(`MODULE_BAT names an unknown module "${id}".`);
  return all.filter((m) => enabled.includes(m.id));
}

/**
 * Module directories under the static root that have only a `goc/` (verbatim copy of the old
 * site) and no manifest yet — the "not yet split" list printed at startup.
 */
export function unsplitModules(staticRoot: string, manifests: AnyManifest[]): string[] {
  if (!fs.existsSync(staticRoot)) return [];
  const known = new Set(manifests.map((m) => m.id));
  return fs.readdirSync(staticRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !known.has(d.name))
    .map((d) => d.name)
    .sort();
}

/** How many files each module still keeps in `goc/` — the progress meter of the split. */
export function countUnsplitFiles(staticRoot: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!fs.existsSync(staticRoot)) return out;
  for (const d of fs.readdirSync(staticRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const goc = path.join(staticRoot, d.name, "goc");
    out[d.name] = fs.existsSync(goc) ? countFiles(goc) : 0;
  }
  return out;
}

function countFiles(dir: string): number {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    n += entry.isDirectory() ? countFiles(p) : 1;
  }
  return n;
}
