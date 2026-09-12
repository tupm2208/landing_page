// MAY CHU — lop mong noi Node http voi khung.
//
// Moi thu dinh den `request`/`response` that nam TRONG tep nay va khong o dau khac.
// Module khong bao gio thay hai doi tuong do.

"use strict";

const http = require("http");
const { LOI } = require("../../hop-dong");

const HAN_THAN_MAC_DINH = 1024 * 1024; // 1 MB

function tieuDeAnToan(kieu = "application/json; charset=utf-8") {
  return {
    "Content-Type": kieu,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY"
  };
}

async function docThan(request, hanBytes) {
  return new Promise((thanhCong, thatBai) => {
    const manh = [];
    let so = 0;
    request.on("data", (m) => {
      so += m.length;
      if (so > hanBytes) {
        thatBai(Object.assign(new Error("than yeu cau qua lon"), { qualon: true }));
        request.destroy();
        return;
      }
      manh.push(m);
    });
    request.on("end", () => thanhCong(Buffer.concat(manh)));
    request.on("error", thatBai);
  });
}

/** Dung `yc` tu mot yeu cau Node. Than chi doc khi module goi `yc.doc()`. */
function dungYeuCau(request, url, { hanThanBytes = HAN_THAN_MAC_DINH } = {}) {
  let thanTho = null;
  const layTho = async () => {
    if (thanTho === null) thanTho = await docThan(request, hanThanBytes);
    return thanTho;
  };
  return {
    method: request.method,
    duong: url.pathname,
    truyVan: Object.fromEntries(url.searchParams),
    tieuDe: request.headers,
    tham: {},
    ip: request.socket?.remoteAddress ?? "",
    tho: layTho,
    async doc() {
      const b = await layTho();
      if (b.length === 0) return {};
      try { return JSON.parse(b.toString("utf8")); }
      catch { throw Object.assign(new Error("than yeu cau khong phai JSON"), { saiJson: true }); }
    }
  };
}

function traLoi(response, ra, { chiTieuDe = false } = {}) {
  // HEAD: tra y nguyen tieu de cua GET nhung khong tra than. Lam o day, mot cho duy nhat,
  // de khong module nao phai biet den HEAD.
  if (chiTieuDe) {
    const than = ra.chuyenHuong ? "" : (ra.tep ? ra.tep.duLieu : JSON.stringify(ra.than ?? null));
    const kieu = ra.chuyenHuong ? "text/plain; charset=utf-8" : (ra.tep ? (ra.tep.kieu || "application/octet-stream") : undefined);
    response.writeHead(ra.ma ?? 200, {
      ...tieuDeAnToan(kieu),
      ...(ra.chuyenHuong ? { Location: ra.chuyenHuong, "Cache-Control": "no-store" } : {}),
      ...(ra.tieuDe ?? {}),
      "Content-Length": String(Buffer.byteLength(than))
    });
    response.end();
    return;
  }
  if (ra.chuyenHuong) {
    response.writeHead(ra.ma ?? 302, { ...tieuDeAnToan("text/plain; charset=utf-8"), Location: ra.chuyenHuong, "Cache-Control": "no-store" });
    response.end();
    return;
  }
  if (ra.tep) {
    response.writeHead(ra.ma ?? 200, { ...tieuDeAnToan(ra.tep.kieu || "application/octet-stream"), ...(ra.tieuDe ?? {}) });
    response.end(ra.tep.duLieu);
    return;
  }
  const than = JSON.stringify(ra.than ?? null);
  response.writeHead(ra.ma ?? 200, { ...tieuDeAnToan(), ...(ra.tieuDe ?? {}) });
  response.end(than);
}

/** Tra ve mot `requestListener` cam thang vao `http.createServer`. */
function tayNgheHttp(khung, tuyChon = {}) {
  return async function (request, response) {
    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    } catch {
      traLoi(response, { ma: 400, than: { ok: false, error: LOI.sai_yeu_cau } });
      return;
    }
    const laHead = request.method === "HEAD";
    try {
      const yc = dungYeuCau(request, url, tuyChon);
      if (laHead) yc.method = "GET";
      traLoi(response, await khung.xuLy(yc), { chiTieuDe: laHead });
    } catch (e) {
      if (e?.qualon) { traLoi(response, { ma: 413, than: { ok: false, error: LOI.sai_yeu_cau, message: "Yeu cau qua lon." } }); return; }
      if (e?.saiJson) { traLoi(response, { ma: 400, than: { ok: false, error: LOI.sai_yeu_cau, message: "Than yeu cau khong phai JSON." } }); return; }
      traLoi(response, { ma: 500, than: { ok: false, error: LOI.loi_he_thong } });
    }
  };
}

function taoMayChu(khung, tuyChon = {}) {
  return http.createServer(tayNgheHttp(khung, tuyChon));
}

module.exports = { taoMayChu, tayNgheHttp, dungYeuCau, traLoi, tieuDeAnToan, HAN_THAN_MAC_DINH };
