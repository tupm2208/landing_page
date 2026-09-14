/**
 * @file Loads the REAL collaborator accounts into the split build.
 *
 * Reads `data/ctv-accounts.json` of the running site (READ ONLY) and writes `ctv_tai_khoan`.
 *
 * PASSWORD HASHES ARE KEPT AS THEY ARE. The split build uses the very same hash format as the
 * running site (`pbkdf2$210000$salt$key`), so the six real collaborators log in AT ONCE with their
 * old passwords — nobody resets anything. That is why `modules/ctv/password.ts` must never change shape.
 *
 * DEVICES ARE NOT IMPORTED. The running site keeps approved devices inside the account file;
 * importing them would pre-approve machines nobody reviewed. A collaborator's first login on the
 * split build asks for approval again — one click for the owner, and certainty about which
 * machines get in.
 */

import fs from "node:fs";
import path from "node:path";
import { ConsoleLogger, openMysqlStore } from "../kernel";
import { toMysqlDateTime } from "../shared/mysql-time";
import { manifest as collaborators } from "../modules/ctv/module";

const SOURCE_DIR = process.env["THU_MUC_THAT"] || path.join("D:", "projects", "toprunvn", "data");
const URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const DRY_RUN = String(process.env["CHI_XEM"] || "").trim() === "1";
const OVERWRITE = String(process.env["GHI_DE"] || "").trim() === "1";

type Json = Record<string, unknown>;
const digits = (v: unknown) => String(v ?? "").replace(/[^0-9]/g, "");
const text = (v: unknown, max = 190) => String(v ?? "").trim().slice(0, max);

async function main(): Promise<void> {
  if (!URL) { console.error("Cần TOPRUN_MYSQL_URL (cổng 3307 — cổng 3306 là dữ liệu thật của landing)."); process.exitCode = 1; return; }
  if (/:3306\//.test(URL)) throw new Error("TOPRUN_MYSQL_URL trỏ vào cổng 3306 — đó là dữ liệu thật của landing.");

  const file = path.join(SOURCE_DIR, "ctv-accounts.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;   // READ ONLY
  const accounts = Array.isArray(raw) ? raw as Json[] : ((raw as Json)?.["accounts"] as Json[] | undefined) ?? [];
  console.log(`[nap-ctv] đọc ${file} (chỉ đọc): ${accounts.length} tài khoản`);

  const store = await openMysqlStore({ url: URL, logger: new ConsoleLogger() });
  try {
    await store.runSchema(collaborators.id, collaborators.schema ?? [], { inheritedTables: collaborators.inheritedTables ?? [] });
    const table = store.table("ctv_tai_khoan");
    const now = toMysqlDateTime(new Date());
    let written = 0, existing = 0, skipped = 0;

    for (const account of accounts) {
      const id = text(account?.["id"] || account?.["affiliateId"], 64);
      const hash = String(account?.["passwordHash"] || "");
      if (!id || !hash.startsWith("pbkdf2$")) {
        console.log(`  bỏ ${id || "(không mã)"}: ${!id ? "không có mã" : "bản băm mật khẩu không đọc được"}`);
        skipped += 1;
        continue;
      }
      const old = await table.one({ ma: id });
      if (old && !OVERWRITE) { existing += 1; continue; }
      if (DRY_RUN) { written += 1; continue; }

      await table.upsert({
        ma: id,
        ten: text(account["name"]),
        dien_thoai: digits(account["phone"]).slice(0, 32),
        email: text(account["email"]).toLowerCase(),
        ten_dang_nhap: text(account["username"] || account["phone"]),
        ma_gioi_thieu: text(account["code"], 40).toUpperCase(),
        dang_bat: account["active"] === false ? 0 : 1,
        cho_bo_logo: account["allowNoLogo"] === true ? 1 : 0,
        bam_mat_khau: hash,
        bam_cap_luc: account["passwordHashUpdatedAt"] ? toMysqlDateTime(new Date(String(account["passwordHashUpdatedAt"]))) : null,
        tao_luc: account["createdAt"] ? toMysqlDateTime(new Date(String(account["createdAt"]))) : now,
        sua_luc: now
      });
      written += 1;
      const devices = Array.isArray(account["devices"]) ? (account["devices"] as unknown[]).length : 0;
      console.log(`  ${id.padEnd(30)} ${text(account["name"]).padEnd(18)} ${devices > 0 ? `(${devices} máy cũ — KHÔNG nhập, sẽ xin duyệt lại)` : ""}`);
    }

    console.log(`[nap-ctv] ${DRY_RUN ? "sẽ ghi" : "đã ghi"} ${written}, đã có ${existing}, bỏ ${skipped}.`);
    const [count] = await store.rows<{ n: number }>("SELECT COUNT(*) AS n FROM ctv_tai_khoan");
    console.log(`[nap-ctv] trong sổ giờ có ${count?.n} cộng tác viên.`);
  } finally {
    await store.close();
  }
}

main().catch((e: unknown) => { console.error("[nap-ctv] hỏng:", e instanceof Error ? e.stack ?? e.message : String(e)); process.exitCode = 1; });
