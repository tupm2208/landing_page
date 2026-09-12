// BANG TIN SU KIEN — cach duy nhat hai module noi chuyen voi nhau.
//
// Vi sao khong cho module goi thang ham cua nhau: goi thang la buoc module nay phai co
// module kia moi chay. Khach tat module Van chuyen thi module Don hang gay. Qua bang tin
// thi khong ai phat hien ra ai da tat.
//
// Luat cua bang tin:
//   - Nguoi phat KHONG biet ai nghe, va KHONG cho ket qua.
//   - Nguoi nghe hong thi ghi nhat ky, KHONG keo sap nguoi phat.
//   - Module chi duoc phat su kien da khai trong `suKien.phat` cua chinh no.

"use strict";

function taoBus({ nhatKy } = {}) {
  /** @type {Map<string, Array<{ id: string, ham: Function }>>} */
  const nguoiNghe = new Map();
  const ghi = nhatKy?.canhBao ?? (() => undefined);

  return {
    /** Dang ky nghe. `id` la module nao nghe — de bao loi cho biet thu pham. */
    nghe(ten, id, ham) {
      if (!nguoiNghe.has(ten)) nguoiNghe.set(ten, []);
      nguoiNghe.get(ten).push({ id, ham });
    },

    /**
     * Phat su kien. KHONG cho, KHONG tra ket qua — nguoi phat khong duoc phu thuoc
     * vao viec nguoi nghe lam gi. Loi cua nguoi nghe chi vao nhat ky.
     */
    phat(ten, duLieu) {
      const ds = nguoiNghe.get(ten) ?? [];
      for (const { id, ham } of ds) {
        Promise.resolve()
          .then(() => ham(duLieu))
          .catch((e) => ghi(`[bus] module "${id}" nghe "${ten}" bi loi: ${e?.message || e}`));
      }
      return ds.length;
    },

    /** Chi dung trong bai kiem tra: doi moi nguoi nghe xu ly xong. */
    async phatVaCho(ten, duLieu) {
      const ds = nguoiNghe.get(ten) ?? [];
      const ketQua = [];
      for (const { id, ham } of ds) {
        try { ketQua.push({ id, ok: true, giaTri: await ham(duLieu) }); }
        catch (e) { ketQua.push({ id, ok: false, loi: e?.message || String(e) }); ghi(`[bus] module "${id}" nghe "${ten}" bi loi: ${e?.message || e}`); }
      }
      return ketQua;
    },

    /** Ai dang nghe su kien nao — dung cho bai kiem tra va man chan doan. */
    soDoNghe() {
      const ra = {};
      for (const [ten, ds] of nguoiNghe) ra[ten] = ds.map((x) => x.id);
      return ra;
    }
  };
}

module.exports = { taoBus };
