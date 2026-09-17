// Builds the web OMI page into modules/quan-tri/goc/omi-web/ (17/09/2026).
//
// The screens are OMI's (omi/packages/omi-ui/src — Sales Desk layout); the only web-specific code is
// web-omi/cau-noi-web.ts. Run after changing either:   node scripts/build-omi-web.mjs
// The output is committed with the landing because the hosting (cPanel) has no OMI sources to build from.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const landing = path.resolve(here, "..");
const omi = path.resolve(landing, "..", "omi");
const out = path.join(landing, "modules", "quan-tri", "goc", "omi-web");

// esbuild lives in OMI's node_modules; the landing does not depend on it at run time.
const { build } = createRequire(path.join(omi, "package.json"))("esbuild");

fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: [path.join(landing, "web-omi", "vao.ts")],
  outfile: path.join(out, "app.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120", "firefox120", "safari16"],
  charset: "utf8",
  legalComments: "none",
  minify: false,
  banner: { js: "// Web OMI: omi-ui/src + web-omi/cau-noi-web.ts, built by scripts/build-omi-web.mjs. Do not edit by hand." }
});
for (const css of ["desk.css", "app.css"]) {
  fs.copyFileSync(path.join(omi, "packages", "vo-omi", "giao-dien", css), path.join(out, css));
}
console.log(`[omi-web] wrote ${path.relative(landing, out)} (app.js, desk.css, app.css)`);
