// Xem / tắt tiến trình Node của app này trên hosting — cho tài khoản cPanel KHÔNG có shell.
// Setup Node.js App -> Run JS script:
//   tien-trinh:xem   liệt kê tiến trình của tài khoản (pid, giờ bật, thư mục, lệnh), đuôi stderr.log,
//                    và dist/main.js là bản build thật hay tệp mẫu "It works!"
//   tien-trinh:tat   tắt tiến trình web (lsnode/Passenger) của CHÍNH app này; lượt truy cập sau LiteSpeed
//                    bật tiến trình mới nạp dist/ vừa build. Không đụng app khác, không đụng tiến trình đang chạy lệnh này.
// Có từ 15/09/2026: build xong, bấm Restart mà LiteSpeed vẫn giữ tiến trình cũ chạy mã cũ.
import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2];
if (mode !== "xem" && mode !== "tat") {
  console.error("Dùng: node scripts/cpanel/tien-trinh.mjs xem|tat");
  process.exit(2);
}
if (!fs.existsSync("/proc/self/stat")) {
  console.error("Không có /proc — công cụ này chỉ chạy trên hosting Linux.");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "..", "..");
const CLOCK_TICKS = 100;   // USER_HZ trên Linux x86_64
const bootSeconds = Number(/^btime (\d+)$/m.exec(fs.readFileSync("/proc/stat", "utf8"))?.[1] ?? 0);

function readProcess(pid) {
  try {
    const owner = Number(/^Uid:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"))?.[1]);
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    // "pid (tên) trạng-thái ppid ..." — tên có thể chứa dấu cách, nên cắt sau dấu ")" cuối.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ");
    let cwd = "";
    try { cwd = fs.readlinkSync(`/proc/${pid}/cwd`); } catch { /* không đọc được thư mục của tiến trình */ }
    return {
      pid,
      owner,
      ppid: Number(fields[1]),                                                      // trường 4
      started: new Date((bootSeconds + Number(fields[19]) / CLOCK_TICKS) * 1000),   // trường 22
      cmdline,
      cwd
    };
  } catch {
    return null;   // tiến trình vừa thoát
  }
}

const listAll = () => fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name)).map(Number).map(readProcess).filter(Boolean);

const uid = process.getuid();
const mine = listAll().filter((p) => p.owner === uid);

// Chính lệnh này và các tiến trình cha (npm, shell của nút Run JS script) cũng có thư mục = app root.
const ancestors = new Set();
for (let pid = process.pid; pid > 1 && !ancestors.has(pid);) {
  ancestors.add(pid);
  pid = mine.find((p) => p.pid === pid)?.ppid ?? readProcess(pid)?.ppid ?? 1;
}

const belongsToApp = (p) => p.cwd === root || p.cmdline.includes(`${root}/`) || p.cmdline.endsWith(root);
const isWebProcess = (p) => !ancestors.has(p.pid) && belongsToApp(p) && /lsnode|passenger|node/i.test(p.cmdline);
const time = (d) => d.toLocaleString("vi-VN", { hour12: false });

console.log(`[tien-trinh] ${time(new Date())} — app root: ${root}`);
const mainFile = path.join(root, "dist", "main.js");
if (!fs.existsSync(mainFile)) console.log("[tien-trinh] dist/main.js: KHÔNG CÓ — chưa build");
else {
  const text = fs.readFileSync(mainFile, "utf8");
  const kind = text.includes("It works!") ? "TỆP MẪU 'It works!' (chưa build đè)" : text.includes("buildLandingApp") ? "bản build thật" : "không nhận ra";
  console.log(`[tien-trinh] dist/main.js: ${kind}, sửa lúc ${time(fs.statSync(mainFile).mtime)}`);
}
const catalogModule = path.join(root, "dist", "modules", "hang-kho", "module.js");
if (fs.existsSync(catalogModule)) {
  console.log(`[tien-trinh] dist/modules/hang-kho/module.js sửa lúc ${time(fs.statSync(catalogModule).mtime)}`);
}

console.log();
console.log(`== Tiến trình của tài khoản (${mine.length})`);
for (const p of mine.sort((a, b) => a.started - b.started)) {
  const tag = ancestors.has(p.pid) ? "[lệnh này]" : isWebProcess(p) ? "[WEB app này]" : "";
  console.log(`  pid ${String(p.pid).padStart(7)}  bật ${time(p.started)}  ${tag}`);
  console.log(`      thư mục: ${p.cwd || "?"}`);
  console.log(`      lệnh:    ${p.cmdline.slice(0, 200) || "?"}`);
}

const logFile = path.join(root, "stderr.log");
console.log();
if (fs.existsSync(logFile)) {
  const lines = fs.readFileSync(logFile, "utf8").split(/\r?\n/).filter((l) => l.trim());
  console.log(`== stderr.log (${lines.length} dòng, 15 dòng cuối)`);
  for (const line of lines.slice(-15)) console.log(`  ${line}`);
} else {
  console.log("== stderr.log: không có");
}

if (mode === "xem") process.exit(0);

console.log();
const targets = mine.filter(isWebProcess);
if (targets.length === 0) {
  console.log("[tien-trinh] Không thấy tiến trình web nào của app này — không tắt gì. Gửi nguyên kết quả ở trên.");
  process.exit(0);
}
for (const p of targets) {
  try { process.kill(p.pid, "SIGTERM"); console.log(`[tien-trinh] đã gửi SIGTERM cho pid ${p.pid}`); }
  catch (e) { console.log(`[tien-trinh] không tắt được pid ${p.pid}: ${e.message}`); }
}
await new Promise((resolve) => setTimeout(resolve, 3000));
for (const p of targets) {
  if (!readProcess(p.pid)) { console.log(`[tien-trinh] pid ${p.pid} đã tắt`); continue; }
  try { process.kill(p.pid, "SIGKILL"); console.log(`[tien-trinh] pid ${p.pid} không chịu tắt — đã SIGKILL`); }
  catch (e) { console.log(`[tien-trinh] không SIGKILL được pid ${p.pid}: ${e.message}`); }
}
console.log("[tien-trinh] Xong. Mở lại trang web: LiteSpeed sẽ bật tiến trình mới với dist/ vừa build.");
