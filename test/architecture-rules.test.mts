/**
 * Architecture rules — and the tests that make them BREAK.
 *
 * Each rule has two halves: "correct code passes" and "broken code throws". A test with only the
 * first half is worthless: it stays green even when the checker blindly returns true.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkIsolation, importsIn, countUnsplitFiles } from "../dist/kernel/index.js";

const REAL_MODULES = path.join(import.meta.dirname, "..", "src", "modules");
const STATIC_ROOT = path.join(import.meta.dirname, "..", "modules");

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), "arch-rules-")); }
function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test("the real modules in the repo do not break isolation", () => {
  const report = checkIsolation(REAL_MODULES);
  assert.ok(report.moduleCount >= 10, `expected at least 10 modules, saw ${report.moduleCount}`);
});

test("BREAKS when a module imports a VALUE from another module; type-only imports are allowed", () => {
  const dir = tmp();
  write(path.join(dir, "hai", "viec.ts"), "export const x = 1;\n");
  write(path.join(dir, "mot", "module.ts"), 'import { x } from "../hai/viec";\n');
  assert.throws(() => checkIsolation(dir), /reaches into module "hai"/);

  write(path.join(dir, "mot", "module.ts"), 'import type { Services } from "../hai/viec";\nexport type S = Services;\n');
  assert.doesNotThrow(() => checkIsolation(dir));
});

test("BREAKS when a module opens the outside world instead of using a port", () => {
  const dir = tmp();
  write(path.join(dir, "mot", "module.ts"), 'import fs from "node:fs";\n');
  assert.throws(() => checkIsolation(dir), /reached through a port/);
  write(path.join(dir, "mot", "module.ts"), 'const m = require("mysql2/promise");\n');
  assert.throws(() => checkIsolation(dir), /reached through a port/);
});

test("BREAKS when a module imports the kernel; contract and shared are fine", () => {
  const dir = tmp();
  write(path.join(dir, "kernel", "index.ts"), "export const k = 1;\n");
  write(path.join(dir, "contract", "index.ts"), "export const c = 1;\n");
  write(path.join(dir, "shared", "x.ts"), "export const s = 1;\n");
  write(path.join(dir, "modules", "mot", "module.ts"), 'import { k } from "../../kernel";\n');
  assert.throws(() => checkIsolation(path.join(dir, "modules")), /never imports the kernel/);
  write(path.join(dir, "modules", "mot", "module.ts"), 'import { c } from "../../contract";\nimport { s } from "../../shared/x";\n');
  assert.doesNotThrow(() => checkIsolation(path.join(dir, "modules")));
  write(path.join(dir, "modules", "mot", "module.ts"), 'import { z } from "../../../elsewhere";\n');
  assert.throws(() => checkIsolation(path.join(dir, "modules")), /points outside modules/);
});

test("the verbatim copy in goc/ is exempt", () => {
  const dir = tmp();
  write(path.join(dir, "mot", "goc", "cu.js"), 'const fs = require("fs");\n');
  assert.doesNotThrow(() => checkIsolation(dir));
});

test("all violations are reported at once, not just the first", () => {
  const dir = tmp();
  write(path.join(dir, "mot", "a.ts"), 'import fs from "fs";\n');
  write(path.join(dir, "mot", "b.ts"), 'import http from "http";\n');
  assert.throws(() => checkIsolation(dir), /broken in 2 place/);
});

test("import scanner sees static, type-only, re-export, require and dynamic imports", () => {
  const refs = importsIn(`
    import a from "./a";
    import type { B } from "./b";
    export { c } from "./c";
    const d = require("./d");
    const e = await import("./e");
  `);
  assert.deepEqual(refs.map((r) => `${r.specifier}${r.typeOnly ? ":type" : ""}`), ["./a", "./b:type", "./c", "./d", "./e"]);
});

test("the unsplit-file counter counts every module's goc/", () => {
  const counts = countUnsplitFiles(STATIC_ROOT);
  assert.ok(Object.keys(counts).length >= 1);
  for (const [id, n] of Object.entries(counts)) assert.ok(Number.isInteger(n), `${id} must have a count`);
});
