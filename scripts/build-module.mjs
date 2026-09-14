// Builds (or with --check only type-checks) ONE module into dist/, independently of the others.
// Used while several people port modules in parallel: a half-finished module elsewhere must not
// block this one's build. Emits the module's files plus the contract/shared files it imports.
//   node scripts/build-module.mjs hang-kho          # emit dist/modules/hang-kho/*
//   node scripts/build-module.mjs hang-kho --check  # type-check only
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const id = process.argv[2];
if (!id) { console.error("usage: node scripts/build-module.mjs <module-id> [--check]"); process.exit(2); }
const check = process.argv.includes("--check");
const root = path.resolve(import.meta.dirname, "..");
const config = {
  extends: "./tsconfig.base.json",
  compilerOptions: { rootDir: "src", outDir: "dist", noEmit: check, composite: false },
  include: [`src/modules/${id}/**/*.ts`]
};
const file = path.join(root, `.tsconfig.${id}.json`);
fs.writeFileSync(file, JSON.stringify(config, null, 2));
let status = 1;
try {
  status = spawnSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", file], { stdio: "inherit" }).status ?? 1;
} finally {
  fs.unlinkSync(file);   // `process.exit` inside the try would skip this — hence the status variable
}
process.exit(status);
