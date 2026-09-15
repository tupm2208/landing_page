/**
 * @file Loads the REAL catalogue into the split build — trial runs on real products.
 *
 * Decided 12/09/2026: "copy from the real machine". This tool does one thing: READ the data files
 * of the running site and PUSH them into the split build through the very doors Sales Desk and
 * Image Tool use.
 *
 * TWO THINGS IT NEVER DOES:
 *   1. WRITE a single byte into the running site's directory: files are opened read-only.
 *   2. TOUCH MySQL on port 3306 (the landing's real data) unless `CHE_DO_THAT=1`: the app itself
 *      throws if pointed at 3306 in trial mode.
 *
 * Why through the API rather than straight into tables: the API is a CONFORMANCE CHECK of the real
 * payloads. A shape mismatch fails loudly here — instead of quietly losing 80 items as before.
 *
 * Two ways to reach the API:
 *   - over HTTP to a running server (`DIA_CHI=http://...`), the default on a dev machine;
 *   - IN-PROCESS (`DIA_CHI=noi-bo`): builds the app from `.env` here and hands each request to the
 *     kernel — same routes, same auth, same validation, no network. On cPanel the hosting cannot
 *     call its own domain (15/09/2026: `fetch failed` pushing to https://toprun.site from inside).
 *
 * Usage:
 *   node dist/tools/import-catalog.js
 * Environment:
 *   THU_MUC_THAT   data directory of the running site   (default D:\projects\toprunvn\data)
 *   DIA_CHI        origin of the split build, or `noi-bo` (default http://127.0.0.1:4181)
 *   MA_QUAN_TRI    admin token of the split build        (required)
 *   CHI_XEM=1      read and measure only, push nothing
 */

import fs from "node:fs";
import path from "node:path";
import { buildLandingApp, PACKAGE_ROOT } from "../app";
import type { DataStore } from "../contract";

const SOURCE_DIR = process.env["THU_MUC_THAT"] || path.join("D:", "projects", "toprunvn", "data");
const TARGET = (process.env["DIA_CHI"] || "http://127.0.0.1:4181").replace(/\/+$/, "");
const IN_PROCESS = TARGET === "noi-bo";
const TOKEN = String(process.env["MA_QUAN_TRI"] || "").trim();
const DRY_RUN = String(process.env["CHI_XEM"] || "").trim() === "1";

interface Answer { ok: boolean; status: number; body: unknown }
type Send = (method: "GET" | "POST", route: string, body?: unknown) => Promise<Answer>;

function size(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function readJson(name: string): { data: unknown; bytes: number } {
  const raw = fs.readFileSync(path.join(SOURCE_DIR, name), "utf8");   // READ ONLY
  return { data: JSON.parse(raw) as unknown, bytes: Buffer.byteLength(raw) };
}

/** Over the network, to a server that is already listening. */
function httpSender(): Send {
  return async (method, route, body) => {
    const response = await fetch(`${TARGET}${route}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const replyText = await response.text();
    let parsed: unknown;
    try { parsed = JSON.parse(replyText); } catch { parsed = { raw: replyText.slice(0, 300) }; }
    return { ok: response.ok, status: response.status, body: parsed };
  };
}

/** Straight into a kernel built here: the request still passes routing, auth and validation. */
async function inProcessSender(): Promise<{ send: Send; store: DataStore }> {
  const app = await buildLandingApp({
    dataDirectory: process.env["THU_MUC_DU_LIEU"] || path.join(PACKAGE_ROOT, "du-lieu"),
    envFile: path.join(PACKAGE_ROOT, ".env")
  });
  const send: Send = async (method, route, body) => {
    const reply = await app.kernel.handle({
      method,
      path: route,
      query: {},
      ip: "127.0.0.1",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      json: async () => body ?? {}
    });
    return { ok: reply.status < 400, status: reply.status, body: reply.body };
  };
  return { send, store: app.store };
}

async function push(send: Send, route: string, body: unknown, label: string): Promise<boolean> {
  process.stdout.write(`  ${label.padEnd(22)} ${size(Buffer.byteLength(JSON.stringify(body))).padStart(8)} -> `);
  if (DRY_RUN) { console.log("(chỉ xem, không đẩy)"); return true; }
  const answer = await send("POST", route, body);
  if (!answer.ok) { console.log(`LỖI ${answer.status}: ${JSON.stringify(answer.body).slice(0, 300)}`); return false; }
  console.log(`OK ${JSON.stringify(answer.body).slice(0, 160)}`);
  return true;
}

function describe(data: unknown): string {
  if (Array.isArray(data)) return `${data.length} món`;
  const products = (data as { products?: unknown[] })?.products;
  return Array.isArray(products) ? `${products.length} món` : `${Object.keys((data as object) ?? {}).length} trường`;
}

async function main(): Promise<void> {
  if (!TOKEN && !DRY_RUN) {
    console.error("Cần MA_QUAN_TRI (mã quản trị của bản tách). Hoặc đặt CHI_XEM=1 để chỉ đo.");
    process.exitCode = 1;
    return;
  }
  console.log(`[nap] đọc từ ${SOURCE_DIR} (chỉ đọc)`);
  console.log(`[nap] đẩy vào ${IN_PROCESS ? "app dựng ngay trong tiến trình này (không qua mạng)" : TARGET}${DRY_RUN ? " — CHỈ XEM" : ""}`);

  let send: Send = httpSender();
  let store: DataStore | null = null;
  if (IN_PROCESS && !DRY_RUN) ({ send, store } = await inProcessSender());

  const jobs = [
    { file: "published-products.json", route: "/api/products", label: "danh mục hàng nhà" },
    { file: "ready-stock.json", route: "/api/ready-stock/sync", label: "hàng có sẵn" },
    { file: "partner-campaigns.json", route: "/api/partner-campaigns", label: "chiến dịch đối tác" },
    { file: "landing-content.json", route: "/api/content", label: "nội dung trang" }
  ];

  let failed = 0;
  try {
    for (const job of jobs) {
      let read: { data: unknown; bytes: number };
      try { read = readJson(job.file); }
      catch (e) { console.log(`  ${job.label.padEnd(22)} KHÔNG ĐỌC ĐƯỢC: ${e instanceof Error ? e.message : String(e)}`); failed += 1; continue; }
      console.log(`  ${job.file.padEnd(28)} ${size(read.bytes).padStart(8)}  ${describe(read.data)}`);
      if (!(await push(send, job.route, read.data, job.label))) failed += 1;
    }

    if (!DRY_RUN) {
      const list = (await send("GET", "/api/products")).body;
      console.log(`[nap] web đang thấy ${Array.isArray(list) ? list.length : "?"} món.`);
    }
  } finally {
    await store?.close();
  }
  if (failed > 0) { console.error(`[nap] ${failed} việc HỎNG — xem ở trên.`); process.exitCode = 1; }
  else console.log("[nap] xong.");
}

main()
  .catch((e: unknown) => { console.error("[nap] hỏng:", e instanceof Error ? e.stack ?? e.message : String(e)); process.exitCode = 1; })
  // The in-process app may leave timers behind; this is a one-shot tool, so leave when the work is done.
  .finally(() => { if (IN_PROCESS) process.exit(); });
