/**
 * @file Entry point: `node dist/main.js`. Builds the app and listens. Nothing else lives here.
 */

import path from "node:path";
import { buildLandingApp, loadEnvFile, PACKAGE_ROOT } from "./app";
import { createHttpServer } from "./kernel";

// `.env` first: PORT and THU_MUC_DU_LIEU are read here, before `buildLandingApp` would load it.
const envFile = path.join(PACKAGE_ROOT, ".env");
const added = loadEnvFile(envFile, process.env);
if (added > 0) console.log(`[chay] đọc ${added} biến từ ${envFile}`);

const port = Number(process.env["PORT"] || 4180);

buildLandingApp({ dataDirectory: process.env["THU_MUC_DU_LIEU"] || path.join(PACKAGE_ROOT, "du-lieu"), envFile })
  .then(({ kernel, xeon }) => {
    createHttpServer(kernel).listen(port, () => {
      console.log(`[chay] server khách nghe ở cổng ${port}`);
      for (const r of kernel.routes()) console.log(`        ${r.method.padEnd(6)} ${r.path}  (${r.moduleId}${r.feature ? `, mảnh ${r.feature}` : ""})`);
      console.log("");
      if (xeon) console.log(`  Shop "${xeon.shop}" đã đăng ký với Xeon ${xeon.diaChiXeon}. OMI: nhập license key là vào.`);
      else console.log("  CHƯA đăng ký với Xeon. Chạy `npm run install-wizard` hoặc đặt LICENSE_KEY + XEON_DIA_CHI rồi bật lại.");
      console.log("");
    });
  })
  .catch((e: unknown) => {
    console.error("[chay] không khởi động được:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
