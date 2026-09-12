// CONG TEP TINH — cach duy nhat mot module tra ve mot tep nam san tren dia (HTML, CSS, anh).
//
// Vi sao phai la mot cong: module KHONG duoc require "fs" (bai kiem tra luat kien truc gay
// ngay). Ma mat web thi phai doc tep. Nen khung mo mot cong, module xin `tepTinh`, va no chi
// thay dung thu muc cua chinh no.
//
// Phuc vu tep tinh la cho de lam lo tep KHONG duoc lo nhat (server.js, .env, thu muc data).
// Ban dang chay chan bang mot DANH SACH XAU (".env", "data/", "server.js"...). O day lam
// nguoc lai — CHO QUA THEO DANH SACH, giong che do thu:
//
//   1. Duoi tep khong co trong `DUOI_CHO_QUA` thi khong tra, du nam dung trong thu muc web.
//      Them mot loai tep moi ma quen khai thi no khong ra — chu khong phai lo ra roi moi biet.
//   2. Duong phai nam trong thu muc cua module. Moi "..", moi duong tuyet doi, moi doan bat
//      dau bang "." deu bi tu choi truoc khi cham vao dia.
//   3. Van giu them danh sach ten CAM (server.js, ctv-server.js...) — .js la duoi duoc phep
//      nen ma may chu lot vao thu muc web van phai bi chan.

"use strict";

const fs = require("fs");
const path = require("path");

/** Duoi tep duoc phep tra ra Internet, kem kieu noi dung. Khong co trong day = khong tra. */
const DUOI_CHO_QUA = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4"
};

/** Ten tep cam tra du duoi cua no duoc phep. */
const TEN_CHAN = new Set([
  "server.js",
  "ctv-server.js",
  "chay.js",
  "module.js",
  "package.json",
  "package-lock.json",
  "render.yaml"
]);

/** Thu muc cam di vao. */
const THU_MUC_CHAN = new Set(["data", "logs", "tmp", "node_modules", "test", "loi"]);

/** Bao lau thi trinh duyet phai hoi lai. Giong ban dang chay. */
function nhoDem(duoi) {
  if (duoi === ".html") return "no-cache";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".mp4"].includes(duoi)) {
    return "public, max-age=604800, stale-while-revalidate=2592000";
  }
  return "public, max-age=3600, stale-while-revalidate=86400";
}

/**
 * Chuan hoa duong trinh duyet xin, hoac tra `null` neu duong do khong duoc phep.
 * Tra ve mang cac doan da giai ma — chua ghep voi thu muc goc.
 */
function docDuong(duongXin) {
  let tho = String(duongXin || "").split("\\").join("/");
  if (tho.includes("\0")) return null;
  const doan = [];
  for (const raw of tho.split("/")) {
    if (raw === "") continue;
    let d;
    try { d = decodeURIComponent(raw); } catch { return null; }
    if (d === "" || d === "." ) continue;
    if (d.includes("/") || d.includes("\\") || d.includes("\0")) return null;
    if (d.startsWith(".")) return null;              // ".." va moi tep an
    if (THU_MUC_CHAN.has(d.toLowerCase())) return null;
    doan.push(d);
  }
  if (doan.length === 0) return null;
  const ten = doan[doan.length - 1].toLowerCase();
  if (TEN_CHAN.has(ten)) return null;
  if (!Object.prototype.hasOwnProperty.call(DUOI_CHO_QUA, path.extname(ten))) return null;
  return doan;
}

/**
 * @param thuMucGoc thu muc chua cac module (khung truyen vao, module khong biet)
 */
function taoCongTepTinh({ thuMucGoc, nhatKy } = {}) {
  if (!thuMucGoc) throw new Error("taoCongTepTinh can `thuMucGoc`");
  const ky = nhatKy ?? { tin: () => {}, canhBao: () => {} };
  const goc = path.resolve(thuMucGoc);

  return {
    /** Mo mot khu: module goi `mo(`${ctx.id}/goc`)` — no chi thay tep trong khu do. */
    mo(tenKhu) {
      const khu = path.resolve(goc, String(tenKhu || ""));
      if (khu !== goc && !khu.startsWith(goc + path.sep)) {
        throw new Error(`Khu tep "${tenKhu}" nam ngoai thu muc goc.`);
      }
      return {
        khu,
        /** Tra `{ duLieu, kieu, nhoDem }` hoac `null` khi khong duoc phep / khong co tep. */
        async doc(duongXin) {
          const doan = docDuong(duongXin);
          if (doan === null) {
            ky.tin(`[tepTinh] tu choi duong: ${String(duongXin).slice(0, 120)}`);
            return null;
          }
          const duong = path.resolve(khu, ...doan);
          if (!duong.startsWith(khu + path.sep)) return null;   // bai giu cuoi
          try {
            const duLieu = await fs.promises.readFile(duong);
            const duoi = path.extname(duong).toLowerCase();
            return { duLieu, kieu: DUOI_CHO_QUA[duoi], nhoDem: nhoDem(duoi), duong: doan.join("/") };
          } catch {
            return null;
          }
        },
        /** Co tep do khong — dung cho the og:image, khong phai doc ca tep anh len de biet. */
        async co(duongXin) {
          const doan = docDuong(duongXin);
          if (doan === null) return false;
          const duong = path.resolve(khu, ...doan);
          if (!duong.startsWith(khu + path.sep)) return false;
          try {
            const t = await fs.promises.stat(duong);
            return t.isFile();
          } catch {
            return false;
          }
        }
      };
    }
  };
}

/** Ban gia cho bai kiem tra: `{ "index.html": "<html>" }` — khong cham vao dia. */
function taoCongTepTinhGia(tep = {}) {
  const bang = new Map(Object.entries(tep).map(([k, v]) => [k.replace(/^\/+/, ""), Buffer.isBuffer(v) ? v : Buffer.from(String(v)) ]));
  return {
    bang,
    mo(tenKhu) {
      const tien = String(tenKhu || "").replace(/^\/+|\/+$/g, "");
      return {
        khu: tien,
        async doc(duongXin) {
          const doan = docDuong(duongXin);
          if (doan === null) return null;
          const khoa = [tien, ...doan].filter(Boolean).join("/");
          const duLieu = bang.get(khoa);
          if (!duLieu) return null;
          const duoi = path.extname(khoa).toLowerCase();
          return { duLieu, kieu: DUOI_CHO_QUA[duoi], nhoDem: nhoDem(duoi), duong: khoa };
        },
        async co(duongXin) {
          const doan = docDuong(duongXin);
          return doan !== null && bang.has([tien, ...doan].filter(Boolean).join("/"));
        }
      };
    }
  };
}

module.exports = { taoCongTepTinh, taoCongTepTinhGia, docDuong, nhoDem, DUOI_CHO_QUA, TEN_CHAN, THU_MUC_CHAN };
