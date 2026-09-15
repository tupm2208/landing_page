/**
 * @file Hands the shop's Fanpage tokens to this landing — from the old site's file.
 *
 * The old site kept one token per page in `data/fanpage-send-credentials.json` (renamed
 * `.DISABLED-xeon` on 07/09/2026 when sending moved away). This reads it (READ ONLY) and posts the
 * pages to `POST /api/admin/fanpage/credentials` of an app built IN-PROCESS from `.env` — the door
 * Sales Desk used. The landing stores the tokens per page and tells Xeon, which from then on routes
 * those pages' messages here.
 *
 *   node dist/tools/import-fanpage-tokens.js        hand the tokens in
 *   node dist/tools/import-fanpage-tokens.js xem    list the pages found (ids, names, token LENGTHS), change nothing
 * Environment:
 *   THU_MUC_THAT   data directory of the old site (default ~/toprunvn-landing/data)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLandingApp, PACKAGE_ROOT } from "../app";

const SOURCE_DIR = process.env["THU_MUC_THAT"] || path.join(os.homedir(), "toprunvn-landing", "data");
const DRY_RUN = process.argv[2] === "xem";
const FILE_NAMES = ["fanpage-send-credentials.json", "fanpage-send-credentials.json.DISABLED-xeon"];

async function main(): Promise<void> {
  const file = FILE_NAMES.map((name) => path.join(SOURCE_DIR, name)).find((candidate) => fs.existsSync(candidate));
  if (!file) {
    console.error(`[nap-token] khong thay ${FILE_NAMES.join(" / ")} trong ${SOURCE_DIR}`);
    process.exitCode = 1;
    return;
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { pages?: unknown; metaGraphVersion?: unknown };   // READ ONLY
  const pages = Array.isArray(data.pages) ? (data.pages as Record<string, unknown>[]) : [];
  console.log(`[nap-token] doc ${file} (chi doc): ${pages.length} trang, Graph ${String(data.metaGraphVersion ?? "?")}`);
  for (const page of pages) {
    // The token itself never goes to the log — its length is enough to see it is there.
    console.log(`  ${String(page["pageId"] ?? "").padEnd(18)} ${String(page["name"] ?? "").padEnd(30)} token ${String(page["accessToken"] ?? "").length} ky tu`);
  }
  if (DRY_RUN) { console.log("[nap-token] CHI XEM — khong ghi gi."); return; }

  const app = await buildLandingApp({
    dataDirectory: process.env["THU_MUC_DU_LIEU"] || path.join(PACKAGE_ROOT, "du-lieu"),
    envFile: path.join(PACKAGE_ROOT, ".env")
  });
  try {
    const adminToken = String(process.env["LANDING_ADMIN_TOKEN"] || "").trim();
    if (!adminToken) throw new Error("Thieu LANDING_ADMIN_TOKEN trong .env.");
    const reply = await app.kernel.handle({
      method: "POST", path: "/api/admin/fanpage/credentials", query: {}, ip: "127.0.0.1",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      json: async () => ({ pages, metaGraphVersion: data.metaGraphVersion })
    });
    console.log(`[nap-token] landing tra ${reply.status}: ${JSON.stringify(reply.body)}`);
    if (reply.status >= 400) process.exitCode = 1;
  } finally {
    await app.store.close();
  }
}

main()
  .catch((e: unknown) => { console.error("[nap-token] hong:", e instanceof Error ? e.stack ?? e.message : String(e)); process.exitCode = 1; })
  // The in-process app may leave timers behind; this is a one-shot tool.
  .finally(() => process.exit());
