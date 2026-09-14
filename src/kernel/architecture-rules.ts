/**
 * @file The architecture rules — and the scanner that makes them BREAK when violated.
 *
 * Decided 12/09/2026: "modules are separate code and talk only through ports, never through
 * dependencies." A rule that lives only in a document is broken sooner or later, so it lives here
 * with a test calling it. Three rules over `src/modules/`:
 *   1. A module may not import VALUES from another module. (`import type` is fine: it is erased
 *      at compile time and only shares a service signature.)
 *   2. A module may not import the kernel — everything arrives through `ctx`.
 *   3. A module may not open the outside world itself (fs, http, net, child_process, mysql).
 *
 * `goc/` inside a module is the verbatim copy of the old site and is exempt; the size of that
 * exemption is the measure of how much splitting remains.
 */

import fs from "node:fs";
import path from "node:path";

/** Node built-ins and drivers a module must reach through a port instead. */
export const FORBIDDEN_IMPORTS: readonly string[] = [
  "fs", "fs/promises", "node:fs", "node:fs/promises",
  "http", "https", "node:http", "node:https", "net", "node:net",
  "child_process", "node:child_process",
  "mysql", "mysql2", "mysql2/promise"
];

export interface ImportRef {
  specifier: string;
  typeOnly: boolean;
}

/** Every source file of a module, skipping `goc/`, `node_modules` and dot-directories. */
export function moduleSourceFiles(moduleDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "goc" || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(p);
    }
  };
  walk(moduleDir);
  return out;
}

/** Finds `import ... from "x"`, `import type ... from "x"`, `export ... from "x"`, `require("x")` and `import("x")`. */
export function importsIn(source: string): ImportRef[] {
  const out: ImportRef[] = [];
  const staticImport = /\b(import|export)\s+(type\s+)?(?:[^"'`;]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g;
  const dynamicImport = /\b(?:require|import)\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = staticImport.exec(source)) !== null) out.push({ specifier: m[3]!, typeOnly: m[2] !== undefined });
  while ((m = dynamicImport.exec(source)) !== null) out.push({ specifier: m[1]!, typeOnly: false });
  return out;
}

export interface IsolationReport {
  moduleCount: number;
}

/**
 * Scans a `modules/` directory and THROWS with the FULL list of violations (not just the first —
 * whoever fixes them wants to see them all at once).
 */
export function checkIsolation(modulesDir: string): IsolationReport {
  const moduleIds = fs.readdirSync(modulesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const violations: string[] = [];

  for (const id of moduleIds) {
    for (const file of moduleSourceFiles(path.join(modulesDir, id))) {
      const source = fs.readFileSync(file, "utf8");
      const where = path.relative(modulesDir, file).replace(/\\/g, "/");
      const flag = (what: string) => violations.push(`${where}: ${what}`);

      for (const ref of importsIn(source)) {
        const spec = ref.specifier;
        if (FORBIDDEN_IMPORTS.includes(spec)) {
          flag(`import of "${spec}" — the outside world is reached through a port (ctx.ports), never directly`);
          continue;
        }
        if (!spec.startsWith(".")) continue; // third-party packages are not this rule's business

        const target = path.resolve(path.dirname(file), spec);
        const relative = path.relative(modulesDir, target).replace(/\\/g, "/");

        if (relative.startsWith("..")) {
          // Leaving `modules/`: only the contract and the shared kits are allowed.
          const fromSrc = path.relative(path.join(modulesDir, ".."), target).replace(/\\/g, "/");
          if (fromSrc.startsWith("kernel/") || fromSrc === "kernel") {
            flag(`import of "${spec}" — a module never imports the kernel; everything arrives through ctx`);
          } else if (!fromSrc.startsWith("contract") && !fromSrc.startsWith("shared")) {
            flag(`import of "${spec}" — points outside modules/ to "${fromSrc}"`);
          }
          continue;
        }

        const targetModule = relative.split("/")[0];
        if (targetModule !== id && !ref.typeOnly) {
          flag(`import of "${spec}" — reaches into module "${targetModule}"; talk through the bus or a service (type-only imports are allowed)`);
        }
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`Isolation rules broken in ${violations.length} place(s):\n  - ${violations.join("\n  - ")}`);
  }
  return { moduleCount: moduleIds.length };
}
