// BA CONG NHO: nhat ky, dong ho, goi ra Internet.
//
// Ca ba deu co ban gia de bai kiem tra chay tron ven: khong ghi ra man hinh that,
// khong cho thoi gian that troi qua, khong goi mang that.

"use strict";

function taoNhatKy({ ra = console, mucDo = "tin" } = {}) {
  const bac = { tin: 0, canhBao: 1, im: 2 };
  const nguong = bac[mucDo] ?? 0;
  return {
    tin: (...d) => { if (nguong <= 0) ra.log(...d); },
    canhBao: (...d) => { if (nguong <= 1) ra.warn(...d); }
  };
}

/** Nhat ky gia: giu lai de bai kiem tra doc. */
function taoNhatKyGia() {
  const dong = [];
  return {
    dong,
    tin: (...d) => dong.push({ muc: "tin", noiDung: d.join(" ") }),
    canhBao: (...d) => dong.push({ muc: "canhBao", noiDung: d.join(" ") })
  };
}

const gioThat = { bayGio: () => new Date() };

/** Dong ho gia: bai kiem tra tu quyet dinh may gio, khong cho doi. */
function taoGioGia(batDau = new Date("2026-09-12T00:00:00.000Z")) {
  let moc = new Date(batDau);
  return {
    bayGio: () => new Date(moc),
    dat: (t) => { moc = new Date(t); },
    troi: (ms) => { moc = new Date(moc.getTime() + ms); }
  };
}

/**
 * Cong goi ra Internet. Moi lan goi deu co HAN — khong co han thi mot doi tac treo
 * la ca server treo theo (bai hoc tu duong SPX ben landing).
 */
function taoHttpNgoai({ hanMs = 15000, fetchThat = globalThis.fetch } = {}) {
  return {
    async goi(url, tuyChon = {}) {
      const bo = new AbortController();
      const dongHo = setTimeout(() => bo.abort(), tuyChon.hanMs ?? hanMs);
      try {
        return await fetchThat(url, { ...tuyChon, signal: bo.signal });
      } finally {
        clearTimeout(dongHo);
      }
    }
  };
}

/** Cong gia: tra san cau tra loi theo url, va ghi lai da goi nhung gi. */
function taoHttpNgoaiGia(banTraLoi = {}) {
  const daGoi = [];
  return {
    daGoi,
    async goi(url, tuyChon = {}) {
      daGoi.push({ url: String(url), tuyChon });
      const tl = typeof banTraLoi === "function" ? banTraLoi(String(url), tuyChon) : banTraLoi[String(url)];
      if (!tl) throw new Error(`httpNgoaiGia: chua khai cau tra loi cho ${url}`);
      return tl;
    }
  };
}

module.exports = { taoNhatKy, taoNhatKyGia, gioThat, taoGioGia, taoHttpNgoai, taoHttpNgoaiGia };
