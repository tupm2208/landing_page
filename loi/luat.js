// LUAT KIEN TRUC — va cach lam no GAY khi bi vi pham.
//
// Anh Dung chot 12/09/2026: "cac module deu tach biet code, chi giao tiep voi nhau qua cac
// cong thoi chu khong phu thuoc dependency."
//
// Luat chi nam trong tai lieu thi som muon cung bi pha — nen no nam o day, va co bai kiem
// tra goi vao. Ba luat:
//   1. Module KHONG duoc require module khac.
//   2. Module KHONG duoc require loi cua khung — moi thu nhan qua `ctx`.
//   3. Module KHONG duoc mo cua ra ngoai (fs, http, mysql, child_process) — phai qua cong.
//
// Thu muc `goc/` trong moi module la ban chep nguyen si tu ban dang chay, CHUA tach —
// no duoc mien tru, va chinh danh sach mien tru la thuoc do con bao xa moi xong.

"use strict";

const fs = require("fs");
const path = require("path");

const CUA_CAM = [
  "fs", "fs/promises", "node:fs", "node:fs/promises",
  "http", "https", "node:http", "node:https", "net", "node:net",
  "child_process", "node:child_process",
  "mysql", "mysql2", "mysql2/promise"
];

/** Tim moi tep .js cua module, BO QUA `goc/` (ban chua tach) va `node_modules`. */
function tepCuaModule(thuMucModule) {
  const ra = [];
  (function di(d) {
    for (const m of fs.readdirSync(d, { withFileTypes: true })) {
      if (m.name === "goc" || m.name === "node_modules" || m.name.startsWith(".")) continue;
      const p = path.join(d, m.name);
      if (m.isDirectory()) di(p);
      else if (m.name.endsWith(".js")) ra.push(p);
    }
  })(thuMucModule);
  return ra;
}

function cacRequire(maNguon) {
  const ra = [];
  const re = /require\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  let m;
  while ((m = re.exec(maNguon)) !== null) ra.push(m[1]);
  return ra;
}

/**
 * Soi ca thu muc `modules/`. NEM voi danh sach day du cac cho vi pham (khong nem o cho dau
 * tien — nguoi sua muon thay het mot lan).
 */
function kiemTachBiet(thuMucModules) {
  const tenModule = fs.readdirSync(thuMucModules, { withFileTypes: true })
    .filter((m) => m.isDirectory()).map((m) => m.name);
  const viPham = [];

  for (const id of tenModule) {
    for (const tep of tepCuaModule(path.join(thuMucModules, id))) {
      const ma = fs.readFileSync(tep, "utf8");
      const noi = path.relative(thuMucModules, tep).replace(/\\/g, "/");

      for (const r of cacRequire(ma)) {
        const la = (viec) => viPham.push(`${noi}: ${viec}`);

        if (CUA_CAM.includes(r)) {
          la(`require("${r}") — mo cua ra ngoai phai di qua cong (ctx.cong), khong require thang`);
          continue;
        }
        if (!r.startsWith(".")) continue; // goi thu vien ngoai: khong phai viec cua luat nay

        const dich = path.resolve(path.dirname(tep), r);
        const tuongDoi = path.relative(thuMucModules, dich).replace(/\\/g, "/");

        // Ra khoi thu muc modules/
        if (tuongDoi.startsWith("..")) {
          const toiLoi = path.relative(path.join(thuMucModules, ".."), dich).replace(/\\/g, "/");
          if (toiLoi.startsWith("loi/")) {
            la(`require("${r}") — module khong duoc goi loi cua khung; moi thu nhan qua ctx`);
          } else if (!toiLoi.startsWith("../hop-dong") && !toiLoi.startsWith("../chung")) {
            la(`require("${r}") — tro ra ngoai modules/ toi "${toiLoi}"`);
          }
          continue;
        }

        // Trong modules/ nhung sang module khac
        const moduleDich = tuongDoi.split("/")[0];
        if (moduleDich !== id) {
          la(`require("${r}") — goi thang sang module "${moduleDich}"; phai di qua bus su kien hoac cong`);
        }
      }
    }
  }

  if (viPham.length > 0) {
    throw new Error(`Luat tach biet bi pha o ${viPham.length} cho:\n  - ${viPham.join("\n  - ")}`);
  }
  return { soModule: tenModule.length };
}

/** Con bao nhieu tep chua tach (con nam trong `goc/`) — thuoc do tien do. */
function demChuaTach(thuMucModules) {
  const ra = {};
  for (const m of fs.readdirSync(thuMucModules, { withFileTypes: true })) {
    if (!m.isDirectory()) continue;
    const g = path.join(thuMucModules, m.name, "goc");
    let so = 0;
    if (fs.existsSync(g)) {
      (function di(d) {
        for (const x of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, x.name);
          if (x.isDirectory()) di(p); else so += 1;
        }
      })(g);
    }
    ra[m.name] = so;
  }
  return ra;
}

module.exports = { kiemTachBiet, demChuaTach, CUA_CAM, tepCuaModule, cacRequire };
