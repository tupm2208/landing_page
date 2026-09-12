// CONG DU LIEU — ban chay bang TEP JSON (giong y ban dang chay hom nay).
//
// Vi sao van la tep JSON o buoc dau: muc tieu cua dot tach la DOI HINH DANG chu khong doi
// noi cat du lieu. Doi ca hai cung luc thi khi sai khong biet sai vi dau. Khi mot module da
// chay qua cong nay thi doi sang MySQL chi la thay `khoTep` bang `khoMySql` o mot cho —
// module khong sua mot dong.
//
// Hai thu bat buoc phai giu tu ban dang chay:
//   1. GHI NGUYEN TU: ghi ra tep tam roi doi ten. Mat dien giua chung thi tep cu con nguyen,
//      khong bao gio co tep JSON cut doi.
//   2. MOT NGUOI GHI: moi so co mot hang doi rieng. Hai yeu cau cung sua mot so thi noi duoi
//      nhau, khong doc-sua-ghi de len nhau (bai `node-single-writer-contract.test.js`).

"use strict";

const fs = require("fs/promises");
const path = require("path");

function taoKhoTep({ thuMuc, nhatKy } = {}) {
  if (!thuMuc) throw new Error("khoTep can `thuMuc`");
  /** @type {Map<string, Promise<unknown>>} hang doi ghi theo tung so */
  const hangDoi = new Map();
  const ghiLoi = nhatKy?.canhBao ?? (() => undefined);

  const duongDan = (ten) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(ten)) throw new Error(`Ten so khong hop le: ${ten}`);
    return path.join(thuMuc, `${ten}.json`);
  };

  async function docTep(ten, macDinh) {
    try {
      const tho = await fs.readFile(duongDan(ten), "utf8");
      return JSON.parse(tho);
    } catch (e) {
      if (e && e.code === "ENOENT") return macDinh;
      if (e instanceof SyntaxError) {
        // Tep hong: KHONG lang le tra ve mac dinh — lam vay la xoa sach du lieu that.
        throw new Error(`So "${ten}" hong dinh dang JSON: ${e.message}`);
      }
      throw e;
    }
  }

  async function ghiTep(ten, giaTri) {
    const dich = duongDan(ten);
    const tam = `${dich}.tam-${process.pid}-${Date.now()}`;
    await fs.mkdir(path.dirname(dich), { recursive: true });
    await fs.writeFile(tam, JSON.stringify(giaTri, null, 2), "utf8");
    await fs.rename(tam, dich);
  }

  /** Noi duoi hang doi cua so `ten`. Moi so mot hang rieng — hai so khac nhau chay song song. */
  function xepHang(ten, viec) {
    const truoc = hangDoi.get(ten) ?? Promise.resolve();
    const sau = truoc.then(viec, viec); // loi cua luot truoc khong chan luot sau
    hangDoi.set(ten, sau.catch((e) => { ghiLoi(`[kho] so "${ten}": ${e?.message || e}`); }));
    return sau;
  }

  return {
    so(ten) {
      return {
        /** Doc ca so. Chua co thi tra `macDinh`. */
        doc: (macDinh = null) => docTep(ten, macDinh),

        /** Thay ca so. Ghi nguyen tu, xep hang. */
        ghi: (giaTri) => xepHang(ten, () => ghiTep(ten, giaTri)),

        /**
         * Doc — sua — ghi trong MOT luot, khong ai chen vao giua.
         * `sua` nhan gia tri hien tai, tra ve gia tri moi. Tra `undefined` = khong ghi gi.
         */
        capNhat: (sua, macDinh = null) => xepHang(ten, async () => {
          const cu = await docTep(ten, macDinh);
          const moi = await sua(cu);
          if (moi === undefined) return cu;
          await ghiTep(ten, moi);
          return moi;
        })
      };
    },

    /** Cho moi viec ghi dang xep hang chay xong — dung khi tat may va trong bai kiem tra. */
    async choXong() {
      await Promise.allSettled([...hangDoi.values()]);
    }
  };
}

module.exports = { taoKhoTep };
