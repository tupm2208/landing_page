// MODULE MUA HO & DAT TU DONG — mang "van-hanh", chay tren server cua khach.
//
// Cong cho DOI TAC MUA HO: ho mo link rieng cua minh, thay danh sach can mua, bao da mua
// duoc bao nhieu, hoac bao het hang.
//
// BON LUAT KHONG DUOC PHA:
//
// 1. CHUA DANG NHAP THI CHI THAY MAN DANG NHAP. Khong mot mau thong tin doi tac nao — ten,
//    danh sach can mua, gia von — duoc lo ra truoc khi co phien hop le. Day la luat anh Dung
//    dat trong AGENTS.md, va co bai kiem tra giu.
//
// 2. BAO HET HANG KHOA THEO MA DONG, KHONG THEO VI TRI DONG. Su co ORD-1788854262493
//    (10/09/2026): phieu bao het ap lai theo vi tri dong moi 15 giay, nen thay mot dong don
//    la dong khac tut vao dung vi tri do va bi danh het hang — khach nhan tin bao sai.
//
// 3. GUI LAI CUNG MOT LENH THI KHONG GHI HAI LAN. Mang kem, doi tac bam lai — phai ra cung
//    ket qua chu khong tao hai phieu mua. Khoa duy nhat (doi tac + ma lenh) lo viec nay.
//
// 4. GIA VON LA CUA SHOP, KHONG PHAI CUA DOI TAC. Doi tac bao gia von ho mua duoc; con gia
//    ban cho khach thi ho khong bao gio thay.

"use strict";

const { SU_KIEN } = require("../../../hop-dong");
const { taoPhienCookie } = require("../../../chung/cookie");
const { LUOC_DO } = require("./luoc-do");

const TEN_COOKIE = "toprun_partner_session";
const PHUT10 = 10 * 60 * 1000;
const B_DOI_TAC = "mua_ho_doi_tac";
const B_PHIEU = "mua_ho_phieu_mua";
const B_BAO_HET = "mua_ho_bao_het";

function gioMySQL(d) {
  return new Date(d).toISOString().slice(0, 23).replace("T", " ");
}

function phienCua(ctx) {
  return taoPhienCookie({
    ten: TEN_COOKIE,
    biMat: String(ctx.cauHinh.biMatPhien || ""),
    gio: ctx.cong.gio,
    songGio: Number(ctx.cauHinh.songGio || 12),
    https: ctx.cauHinh.https === true
  });
}

/** Doi tac dang dang nhap, hay `null`. Doc phien roi doi chieu lai voi bang — khoa bi thu
 *  hoi (doi tac bi tat) thi phien cu KHONG duoc dung nua. */
async function doiTacDangNhap(ctx, yc) {
  const p = phienCua(ctx).doc(yc);
  if (!p?.maCong) return null;
  const dong = await ctx.cong.kho.bang(B_DOI_TAC).mot({ ma_cong: String(p.maCong), trang_thai: "active" });
  return dong ? { ma: dong.ma, ten: dong.ten, maCong: dong.ma_cong } : null;
}

/** Nhung dong don doi tac nay can mua — chua bao mua, chua bao het. */
async function canMua(ctx, maDoiTac) {
  const daMua = await ctx.cong.kho.bang(B_PHIEU).tim({ dieuKien: { ma_doi_tac: maDoiTac }, cot: ["ma_dong"] });
  const daHet = await ctx.cong.kho.bang(B_BAO_HET).tim({ dieuKien: { ma_doi_tac: maDoiTac }, cot: ["ma_dong"] });
  const xong = new Set([...daMua, ...daHet].map((d) => d.ma_dong));

  // Nguon viec: cac dong don dang cho mua. Doc qua dich vu cua Don hang — module nay khong
  // bao gio tu mo so don.
  const cacDon = await ctx.dichVu["don-khach"].tim({ trangThai: "pending", gioiHan: 200 });
  const viec = [];
  for (const don of cacDon) {
    (don.items ?? []).forEach((d, i) => {
      // MA DONG on dinh: ma don + so thu tu dong luc TAO don. Khong bao gio la vi tri hien tai.
      const maDong = `${don.id}#${d.variantId || i + 1}`;
      if (xong.has(maDong)) return;
      viec.push({
        maDong, maDon: don.id, maMon: d.productCode, ten: d.productName,
        size: d.size, soLuong: Number(d.qty || 1)
      });
    });
  }
  return viec;
}

/** Doi tac bao da mua duoc. LUAT 3: cung ma lenh thi khong ghi hai lan. */
async function baoDaMua(ctx, doiTac, than = {}) {
  const maDong = String(than.maDong || "").trim();
  const soLuong = Math.max(0, Math.trunc(Number(than.soLuong ?? than.quantity ?? 0)));
  const maLenh = String(than.maLenh || than.commandId || "").trim();
  if (!maDong || soLuong <= 0) return { ok: false, viSao: "thieu_ma_dong_hoac_so_luong" };

  if (maLenh) {
    const daCo = await ctx.cong.kho.bang(B_PHIEU).mot({ ma_doi_tac: doiTac.ma, ma_lenh: maLenh });
    if (daCo) return { ok: true, trungLenh: true, maPhieu: daCo.ma_phieu };
  }

  const luc = ctx.cong.gio.bayGio();
  const maPhieu = `mua_${luc.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
  const [maDon] = maDong.split("#");

  try {
    await ctx.cong.kho.bang(B_PHIEU).them({
      ma_phieu: maPhieu, ma_doi_tac: doiTac.ma, ma_don: maDon, ma_dong: maDong,
      ma_mon: String(than.maMon || ""), size: String(than.size || ""),
      so_luong: soLuong,
      // LUAT 4: doi tac bao gia VON ho mua duoc.
      gia_von: Math.max(0, Number(than.giaVon ?? than.actualUnitCost ?? 0)),
      ma_lenh: maLenh, ghi_chu: String(than.ghiChu || ""), tao_luc: gioMySQL(luc)
    });
  } catch (e) {
    // Hai lan bam cung luc: lan sau dam vao khoa duy nhat — tra ve phieu da co, khong nem.
    if (/duplicate entry/i.test(String(e?.message || ""))) {
      const daCo = await ctx.cong.kho.bang(B_PHIEU).mot({ ma_doi_tac: doiTac.ma, ma_lenh: maLenh });
      if (daCo) return { ok: true, trungLenh: true, maPhieu: daCo.ma_phieu };
    }
    throw e;
  }

  ctx.bus.phat(SU_KIEN.hang_ve_lai, { maDon, maDong, maMon: String(than.maMon || ""), soLuong, boi: doiTac.ma });
  return { ok: true, maPhieu, maDong, soLuong };
}

/** Doi tac bao het hang. LUAT 2: khoa theo MA DONG. */
async function baoHetHang(ctx, doiTac, than = {}) {
  const maDong = String(than.maDong || "").trim();
  if (!maDong) return { ok: false, viSao: "thieu_ma_dong" };
  const [maDon] = maDong.split("#");
  const luc = ctx.cong.gio.bayGio();

  // Bao lai cung mot dong thi cap nhat, khong tao dong thu hai — doi tac co the bam lai.
  await ctx.cong.kho.bang(B_BAO_HET).themHoacThay({
    ma_dong: maDong, ma_doi_tac: doiTac.ma, ma_don: maDon,
    ma_mon: String(than.maMon || ""), size: String(than.size || ""),
    ly_do: String(than.lyDo || than.reason || ""), bao_luc: gioMySQL(luc)
  });

  ctx.bus.phat(SU_KIEN.hang_het, { maDon, maDong, maMon: String(than.maMon || ""), boi: doiTac.ma });
  return { ok: true, maDong };
}

const CHUA_DANG_NHAP = { ma: 401, than: { ok: false, error: "chua_dang_nhap", message: "Mở lại link riêng của bạn để vào cổng." } };

module.exports = {
  id: "mua-ho",
  ten: "Mua hộ & đặt tự động",
  mang: "van-hanh",
  chay: "server-khach",
  phienBan: "0.1.0",
  canCong: ["kho", "nhatKy", "gio", "bus", "cauHinh"],
  canDichVu: ["don-khach.tim"],
  luocDo: LUOC_DO,

  suKien: { phat: [SU_KIEN.hang_het, SU_KIEN.hang_ve_lai], nghe: {} },

  capDichVu: {
    "mua-ho.canMua": (ctx, maDoiTac) => canMua(ctx, String(maDoiTac || "")),
    /** Dong nao dang bi bao het — module khac hoi truoc khi hua voi khach. */
    "mua-ho.daBaoHet": async (ctx, maDon) => {
      const dong = await ctx.cong.kho.bang(B_BAO_HET).tim({ dieuKien: { ma_don: String(maDon || "") } });
      return dong.map((d) => ({ maDong: d.ma_dong, maMon: d.ma_mon, size: d.size, lyDo: d.ly_do }));
    }
  },

  duong: [
    {
      // Doi tac mo link rieng -> dat phien. Day la cua DUY NHAT de vao cong.
      method: "POST", path: "/api/partner-portal/login", quyen: "cong-khai",
      viSaoCongKhai: "Đối tác mở link riêng của họ, không có tài khoản. Tự bảo vệ bằng: mã cổng phải khớp một đối tác đang bật; sai là 401 và không lộ gì.",
      hanGoi: { soLan: 20, trongMs: 15 * 60 * 1000 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const maCong = String(than.token || than.maCong || "").trim();
        if (!maCong) return CHUA_DANG_NHAP;
        const dong = await ctx.cong.kho.bang(B_DOI_TAC).mot({ ma_cong: maCong, trang_thai: "active" });
        if (!dong) {
          ctx.cong.nhatKy.canhBao("[mua-ho] ma cong khong dung hoac doi tac da tat");
          return CHUA_DANG_NHAP;
        }
        return {
          ma: 200,
          tieuDe: { ...phienCua(ctx).tieuDeDat({ maCong }), "Cache-Control": "no-store" },
          than: { ok: true, doiTac: { ma: dong.ma, ten: dong.ten } }
        };
      }
    },
    {
      method: "POST", path: "/api/partner-portal/logout", quyen: "cong-khai",
      viSaoCongKhai: "Chỉ xoá cookie phiên của chính người gọi, không đọc gì và không sửa gì.",
      hanGoi: { soLan: 60, trongMs: PHUT10 },
      tay: async (ctx) => ({ ma: 200, tieuDe: phienCua(ctx).tieuDeXoa(), than: { ok: true } })
    },
    {
      // LUAT 1: chua dang nhap thi KHONG mot mau thong tin nao.
      method: "GET", path: "/api/partner-portal", quyen: "cong-khai",
      viSaoCongKhai: "Cổng đối tác. Chưa có phiên hợp lệ thì chỉ trả về 'chưa đăng nhập' — không lộ tên, việc cần mua hay giá vốn.",
      hanGoi: { soLan: 240, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const doiTac = await doiTacDangNhap(ctx, yc);
        if (!doiTac) return CHUA_DANG_NHAP;
        return {
          ma: 200, tieuDe: { "Cache-Control": "no-store" },
          than: { ok: true, doiTac: { ma: doiTac.ma, ten: doiTac.ten }, canMua: await canMua(ctx, doiTac.ma) }
        };
      }
    },
    {
      method: "POST", path: "/api/partner-portal/purchases", quyen: "cong-khai",
      viSaoCongKhai: "Đối tác báo đã mua. Tự bảo vệ bằng phiên cookie ký HMAC; không có phiên là 401 trước khi đọc bất cứ gì.",
      hanGoi: { soLan: 60, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const doiTac = await doiTacDangNhap(ctx, yc);
        if (!doiTac) return CHUA_DANG_NHAP;
        const kq = await baoDaMua(ctx, doiTac, await yc.doc());
        return kq.ok ? { ma: 200, than: kq } : { ma: 400, than: { ok: false, error: kq.viSao } };
      }
    },
    {
      method: "POST", path: "/api/partner-portal/out-of-stock", quyen: "cong-khai",
      viSaoCongKhai: "Đối tác báo hết hàng. Cùng phiên cookie như đường báo đã mua; khoá theo mã dòng nên báo lại không đụng dòng khác.",
      hanGoi: { soLan: 60, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const doiTac = await doiTacDangNhap(ctx, yc);
        if (!doiTac) return CHUA_DANG_NHAP;
        const kq = await baoHetHang(ctx, doiTac, await yc.doc());
        return kq.ok ? { ma: 200, than: kq } : { ma: 400, than: { ok: false, error: kq.viSao } };
      }
    },
    {
      // Shop quan ly doi tac.
      method: "GET", path: "/api/admin/partners", quyen: "quan-tri",
      tay: async (ctx) => ({
        ma: 200, tieuDe: { "Cache-Control": "no-store" },
        than: await ctx.cong.kho.bang(B_DOI_TAC).tim({ sapXep: "ten asc" })
      })
    },
    {
      method: "POST", path: "/api/admin/partners", quyen: "quan-tri",
      hanGoi: { soLan: 60, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const ma = String(than.ma || "").trim();
        const maCong = String(than.maCong || "").trim();
        if (!ma || !maCong) return { ma: 400, than: { ok: false, error: "thieu_ma_hoac_ma_cong" } };
        await ctx.cong.kho.bang(B_DOI_TAC).themHoacThay({
          ma, ten: String(than.ten || ma), ma_cong: maCong,
          trang_thai: String(than.trangThai || "active"),
          dien_thoai: String(than.dienThoai || ""),
          tinh: String(than.tinh || ""), huyen: String(than.huyen || ""), xa: String(than.xa || ""),
          dia_chi_chi_tiet: String(than.diaChiChiTiet || ""),
          sua_luc: gioMySQL(ctx.cong.gio.bayGio())
        });
        return { ma: 200, than: { ok: true, ma } };
      }
    }
  ],

  congCuBot: [
    { ten: "hang_order_bao_lau", moTa: "Hàng này phải order thì bao lâu về", hieuUng: "doc" }
  ]
};
