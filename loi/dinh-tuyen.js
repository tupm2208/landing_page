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
  const daKhai = new Set();

  return {
    them({ method, path, moduleId, quyen, hanGoi, tay }) {
      const khoa = `${method} ${path}`;
      if (daKhai.has(khoa)) {
        throw new Error(`Duong "${khoa}" bi khai hai lan — module "${moduleId}" trung voi module da khai truoc.`);
      }
      daKhai.add(khoa);
      bang.push({ method, path, doan: phanDoan(path), moduleId, quyen, hanGoi, tay });
    },

    /** Tim nguoi xu ly. Tra `null` neu khong ai nhan. */
    tim(method, pathname) {
      const doan = phanDoan(pathname);
      let saiPhuongThuc = false;

      for (const r of bang) {
        const tham = khop(r.doan, doan);
        if (tham === null) continue;
        if (r.method !== method) { saiPhuongThuc = true; continue; }
        return { tay: r.tay, moduleId: r.moduleId, quyen: r.quyen, hanGoi: r.hanGoi, tham, path: r.path };
      }
      return saiPhuongThuc ? { saiPhuongThuc: true } : null;
    },

    /** Danh sach duong da khai — bai kiem tra doc de doi chieu voi ban dang chay. */
    banDuong() {
      return bang.map((r) => ({ method: r.method, path: r.path, moduleId: r.moduleId, quyen: r.quyen, hanGoi: r.hanGoi }));
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
