// DINH TUYEN — tra ve dung mot nguoi xu ly cho mot duong.
//
// Vi sao khong dung Express: ban dang chay la http tran cua Node, khong co khung ngoai.
// Giu nguyen nhu vay de ban tach khong keo theo mot thu vien moi ma sau nay phai va lo hong.
//
// Hinh dang duong:
//   "/api/orders"            khop dung
//   "/api/products/:ma"      mot doan bat ky, vao `yc.tham.ma`
//   "/api/fanpage-media/*"   khop moi thu con lai, vao `yc.tham.duoi`
//
// LUAT: hai module khai cung mot (phuong thuc + duong) la NEM ngay luc nap — khong de
// hai nguoi cung nhan mot duong roi tuy thu tu nap ma ai thang.

"use strict";

function phanDoan(path) {
  return path.split("/").filter((x) => x !== "");
}

function taoBoDinhTuyen() {
  /** @type {Array<{ method: string, path: string, doan: string[], moduleId: string, tay: Function }>} */
  const bang = [];
  const cuThe = [];    // duong khong co "*"
  const saoBao = [];   // duong co "*" — luon xet sau cung
  const daKhai = new Set();

  return {
    them({ method, path, moduleId, quyen, manh = null, hanGoi, hanThan, tay }) {
      const khoa = `${method} ${path}`;
      if (daKhai.has(khoa)) {
        throw new Error(`Duong "${khoa}" bi khai hai lan — module "${moduleId}" trung voi module da khai truoc.`);
      }
      daKhai.add(khoa);
      const r = { method, path, doan: phanDoan(path), moduleId, quyen, manh, hanGoi, hanThan, tay };
      bang.push(r);
      // Duong co "*" (mat web bat moi thu con lai) phai xet SAU CUNG, va trong nhom do thi
      // duong sau nhieu doan cu the hon di truoc. Neu khong, mot module khai "GET /*" ma nap
      // truoc se nuot het duong API cua module nap sau — tuy thu tu nap ma ai thang.
      (r.doan.includes("*") ? saoBao : cuThe).push(r);
      saoBao.sort((a, b) => b.doan.length - a.doan.length);
    },

    /** Tim nguoi xu ly. Tra `null` neu khong ai nhan. */
    tim(method, pathname) {
      const doan = phanDoan(pathname);
      let saiPhuongThuc = false;

      for (const r of [...cuThe, ...saoBao]) {
        const tham = khop(r.doan, doan);
        if (tham === null) continue;
        if (r.method !== method) { saiPhuongThuc = true; continue; }
        return { tay: r.tay, moduleId: r.moduleId, quyen: r.quyen, manh: r.manh, hanGoi: r.hanGoi, hanThan: r.hanThan, tham, path: r.path };
      }
      return saiPhuongThuc ? { saiPhuongThuc: true } : null;
    },

    /** Danh sach duong da khai — bai kiem tra doc de doi chieu voi ban dang chay. */
    banDuong() {
      return bang.map((r) => ({ method: r.method, path: r.path, moduleId: r.moduleId, quyen: r.quyen, manh: r.manh, hanGoi: r.hanGoi, hanThan: r.hanThan }));
    }
  };
}

function khop(mau, that) {
  const tham = {};
  for (let i = 0; i < mau.length; i += 1) {
    const m = mau[i];
    if (m === "*") {
      tham.duoi = that.slice(i).join("/");
      return tham;
    }
    if (i >= that.length) return null;
    if (m.startsWith(":")) { tham[m.slice(1)] = decodeURIComponent(that[i]); continue; }
    if (m !== that[i]) return null;
  }
  return mau.length === that.length ? tham : null;
}

module.exports = { taoBoDinhTuyen };
