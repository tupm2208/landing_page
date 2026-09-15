// Chuyển dữ liệu từ bản landing CŨ trên cùng hosting sang bản này — bản chạy bằng nút "Run JS script"
// của Setup Node.js App, cho tài khoản cPanel KHÔNG có shell (Cron/.cpanel.yml không chạy được bash).
//   npm run chuyen-du-lieu:thu     chỉ đếm, không ghi gì
//   npm run chuyen-du-lieu:that    làm thật
// Việc làm và thứ tự giống hệt `chuyen-du-lieu.sh`:
//   1. Nối ảnh cũ (assets/products, assets/thumbnails) bằng symlink — không chép 7,5 GB.
//   2. Nạp đơn còn trong data/orders.json + data/manual-orders.json (đơn đã có trong sổ thì bỏ qua).
//   3. Nạp cộng tác viên (giữ mật khẩu cũ; thiết bị phải duyệt lại).
//   4. Đẩy danh mục hàng nhà, hàng có sẵn, chiến dịch đối tác, nội dung trang qua API của app
//      (app phải đang chạy; danh mục hàng nhà bị THAY toàn bộ).
// Đơn và tài khoản khách trong MySQL cũ KHÔNG chép ở đây — làm bằng phpMyAdmin (INSERT IGNORE ... SELECT).
// Nhật ký: ~/landing-logs/chuyen-du-lieu-<che-do>-<giờ>.log. Bản cũ mặc định ~/toprunvn-landing (đổi bằng BAN_CU).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const mode = process.argv[2];
if (mode !== "thu" && mode !== "that") {
  console.error("Dùng: node scripts/cpanel/chuyen-du-lieu.mjs thu|that");
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, "..", "..");
const home = os.homedir();
const oldRoot = process.env.BAN_CU || path.join(home, "toprunvn-landing");
const logDir = path.join(home, "landing-logs");
fs.mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const logFile = path.join(logDir, `chuyen-du-lieu-${mode}-${stamp}.log`);
const say = (line = "") => { console.log(line); fs.appendFileSync(logFile, `${line}\n`); };

/** Same reading as the app's `loadEnvFile`: trims, skips comments, strips one pair of surrounding quotes. */
function readEnvFile(file) {
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[trimmed.slice(0, eq).trim()] ??= value;
  }
  return values;
}

say(`[chuyen] ${new Date().toLocaleString("vi-VN")} chế độ: ${mode}${mode === "thu" ? " (CHỈ ĐẾM, không ghi gì)" : ""}`);
say(`[chuyen] bản cũ: ${oldRoot}`);
say(`[chuyen] bản mới: ${root}`);
say(`[chuyen] node ${process.version}`);

const problems = [];
const envFile = path.join(root, ".env");
const env = fs.existsSync(envFile) ? readEnvFile(envFile) : (problems.push(`thiếu ${envFile}`), {});
if (!fs.existsSync(path.join(oldRoot, "data"))) problems.push(`không thấy ${path.join(oldRoot, "data")}`);
if (!fs.existsSync(path.join(root, "dist", "tools", "import-orders.js"))) problems.push("chưa build (thiếu dist/tools) — Run JS script -> build trước");
for (const name of ["TOPRUN_MYSQL_URL", "LANDING_ADMIN_TOKEN", "LANDING_SITE_BASE_URL"]) {
  if (!env[name]) problems.push(`.env thiếu ${name}`);
}
if (problems.length > 0) {
  for (const p of problems) say(`LỖI: ${p}`);
  say("[chuyen] DỪNG, chưa làm gì.");
  process.exit(1);
}

let failed = 0;

say();
say("== 1. Ảnh sản phẩm");
const assets = path.join(root, "modules", "gian-hang", "goc", "assets");
for (const dir of ["products", "thumbnails"]) {
  const src = path.join(oldRoot, "assets", dir);
  const dst = path.join(assets, dir);
  if (!fs.existsSync(src)) { say(`  ${dir}: bản cũ không có ${src} — bỏ qua`); failed += 1; continue; }
  const count = fs.readdirSync(src, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
  const existing = fs.lstatSync(dst, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) { say(`  ${dir}: đã nối sẵn -> ${fs.readlinkSync(dst)} (${count} tệp)`); continue; }
  if (existing && !existing.isDirectory()) { say(`  ${dir}: ${dst} là một tệp — không đụng, xem tay`); failed += 1; continue; }
  if (existing && fs.readdirSync(dst).length > 0) { say(`  ${dir}: ${dst} đã có tệp thật — không đụng, xem tay`); failed += 1; continue; }
  if (mode === "thu") { say(`  ${dir}: sẽ nối ${dst} -> ${src} (${count} tệp)`); continue; }
  try {
    if (existing) fs.rmdirSync(dst);
    fs.mkdirSync(assets, { recursive: true });
    fs.symlinkSync(src, dst, "dir");
    say(`  ${dir}: đã nối ${dst} -> ${src} (${count} tệp)`);
  } catch (e) {
    say(`  ${dir}: HỎNG — ${e.message}`);
    failed += 1;
  }
}

const toolEnv = {
  ...process.env,
  THU_MUC_THAT: path.join(oldRoot, "data"),
  CHE_DO_THAT: "1",
  TOPRUN_MYSQL_URL: env.TOPRUN_MYSQL_URL,
  MA_QUAN_TRI: env.LANDING_ADMIN_TOKEN,
  // Nạp danh mục thẳng vào app dựng trong tiến trình: hosting không gọi được tên miền của chính nó
  // (15/09/2026: `fetch failed` khi đẩy tới https://toprun.site từ bên trong).
  DIA_CHI: "noi-bo"
};
if (mode === "thu") toolEnv.CHI_XEM = "1";
else delete toolEnv.CHI_XEM;

function runTool(label, name) {
  say();
  say(`== ${label}`);
  const result = spawnSync(process.execPath, [path.join(root, "dist", "tools", `${name}.js`)], {
    cwd: root, env: toolEnv, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000
  });
  for (const line of `${result.stdout ?? ""}${result.stderr ?? ""}`.split(/\r?\n/)) if (line.trim()) say(line);
  if (result.status === 0) say("  -> OK");
  else { say(`  -> HỎNG (mã ${result.status ?? result.error?.message ?? "?"})`); failed += 1; }
}

runTool("2. Đơn còn trong JSON", "import-orders");
runTool("3. Cộng tác viên", "import-collaborators");

const catalog = fs.statSync(path.join(oldRoot, "data", "published-products.json"), { throwIfNoEntry: false });
if (catalog && catalog.size > 16 * 1024 * 1024) {
  say();
  say(`  CẢNH BÁO: published-products.json nặng ${catalog.size} byte, quá 16 MB — /api/products sẽ từ chối (413).`);
}
runTool("4. Danh mục hàng + nội dung trang (nạp thẳng vào app, không qua mạng)", "import-catalog");

say();
if (failed === 0) {
  say(`[chuyen] XONG${mode === "thu" ? " — chưa ghi gì; số liệu ổn thì chạy chuyen-du-lieu:that" : ""}.`);
} else {
  say(`[chuyen] ${failed} việc HỎNG — xem ở trên. Sửa xong chạy lại được: việc đã xong sẽ được bỏ qua.`);
  process.exitCode = 1;
}
say(`[chuyen] nhật ký: ${logFile}`);
