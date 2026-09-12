// MODULE CONG TAC VIEN — mang "van-hanh", chay tren server cua khach.
//
// CTV la nguoi ban hang ho shop: ho dang nhap, tai anh san pham ve dang ban, va an hoa hong
// theo don co ma gioi thieu cua ho.
//
// BON LUAT KHONG DUOC PHA:
//
// 1. MAT KHAU KHONG BAO GIO NAM BAN RO. PBKDF2 210.000 vong, dung y hinh dang cua ban dang
//    chay — nho vay 6 tai khoan CTV that nhap sang la dang nhap duoc ngay bang mat khau cu.
//
// 2. THIET BI MOI PHAI DUOC DUYET. Dung mat khau nhung may la thi CHUA vao duoc: don xin nam
//    o bang thiet bi, chu shop duyet tren OMI. Mat khau CTV bi lo (ho dung lai mat khau cu o
//    cho khac) khong thanh mat ca kho anh va danh sach khach.
//
// 3. CTV KHONG THAY DON HANG, KHONG THAY TON KHO, KHONG THAY TEN KHO. Ho chi thay ANH cua mot
//    ma hang. Duong `/api/ctv/anh` doc qua dich vu Hang hoa va CHI lay danh sach anh.
//
// 4. PHIEN KHONG DUOC TU SONG MAI. Phien nam trong bang co han; tat tai khoan la moi phien cu
//    HET TAC DUNG ngay lan goi sau — vi moi lan goi deu doi chieu lai voi bang.

"use strict";

const crypto = require("crypto");
const { taoPhienCookie } = require("../../../chung/cookie.js");
const { gioMySQL, isoTuMySQL } = require("../../../chung/gio-mysql.js");
const { bam, soi, bamMa } = require("./mat-khau");
const { LUOC_DO } = require("./luoc-do");

const B_TK = "ctv_tai_khoan";
const B_TB = "ctv_thiet_bi";
const B_PHIEN = "ctv_phien";
const B_NHAT_KY = "ctv_nhat_ky_tai";

const TEN_COOKIE = "toprun_ctv_phien";
const TEN_COOKIE_MAY = "toprun_ctv_may";
const PHUT15 = 15 * 60 * 1000;
const PHUT10 = 10 * 60 * 1000;
const TRAN_ANH = 30;

function chuanHoaDangNhap(g) {
  return String(g ?? "").trim().toLowerCase();
}

function chiSo(g) {
  return String(g ?? "").replace(/[^0-9]/g, "");
}

function phienCua(ctx) {
  return taoPhienCookie({
    ten: TEN_COOKIE,
    biMat: String(ctx.cauHinh.biMatPhien || ""),
    gio: ctx.cong.gio,
    songGio: Number(ctx.cauHinh.songGio || 24 * 30),
    https: ctx.cauHinh.https === true
  });
}

function mayCua(ctx) {
  return taoPhienCookie({
    ten: TEN_COOKIE_MAY,
    biMat: String(ctx.cauHinh.biMatPhien || ""),
    gio: ctx.cong.gio,
    songGio: Number(ctx.cauHinh.songGioMay || 24 * 365),
    https: ctx.cauHinh.https === true
  });
}

/** Ban ra ngoai cua mot tai khoan CTV. KHONG bao gio kem ban bam mat khau. */
function banCtv(dong = {}) {
  return {
    ma: String(dong.ma ?? ""),
    ten: String(dong.ten ?? ""),
    dienThoai: String(dong.dien_thoai ?? ""),
    email: String(dong.email ?? ""),
    tenDangNhap: String(dong.ten_dang_nhap ?? ""),
    maGioiThieu: String(dong.ma_gioi_thieu ?? ""),
    dangBat: Number(dong.dang_bat ?? 1) === 1,
    choBoLogo: Number(dong.cho_bo_logo ?? 0) === 1,
    coMatKhau: String(dong.bam_mat_khau ?? "") !== "",
    taoLuc: isoTuMySQL(dong.tao_luc)
  };
}

/**
 * CTV dang dang nhap, hay `null`.
 *
 * Doc phien roi DOI CHIEU LAI VOI BANG: phien con han ma tai khoan da bi tat, hay thiet bi bi
 * chan, thi phien do khong con dung duoc. Neu chi tin chu ky cua cookie thi tat mot CTV hom nay
 * ma ho van vao duoc ca thang.
 */
async function ctvDangNhap(ctx, yc) {
  const p = phienCua(ctx).doc(yc);
  if (!p?.maPhien) return null;
  const bamPhien = bamMa(p.maPhien);
  const dongPhien = await ctx.cong.kho.bang(B_PHIEN).mot({ bam_ma_phien: bamPhien });
  if (!dongPhien) return null;
  if (isoTuMySQL(dongPhien.het_luc) <= ctx.cong.gio.bayGio().toISOString()) return null;

  const tk = await ctx.cong.kho.bang(B_TK).mot({ ma: String(dongPhien.ma_ctv), dang_bat: 1 });
  if (!tk) return null;
  if (dongPhien.ma_thiet_bi) {
    const tb = await ctx.cong.kho.bang(B_TB).mot({ ma: String(dongPhien.ma_thiet_bi) });
    if (!tb || String(tb.trang_thai) !== "da-duyet") return null;
  }
  return { ...banCtv(tk), maPhien: bamPhien, maThietBi: String(dongPhien.ma_thiet_bi || "") };
}

/** Dang nhap: dung mat khau VA thiet bi da duoc duyet. */
async function dangNhap(ctx, yc, than = {}) {
  const chuDangNhap = chuanHoaDangNhap(than.login || than.username || than.email || than.phone);
  const matKhau = String(than.password || than.matKhau || "");
  const luc = ctx.cong.gio.bayGio();

  // Cau tu choi GIONG NHAU cho moi truong hop sai — khong noi "khong co tai khoan nay", keo
  // do duoc danh sach so dien thoai cua CTV.
  const tuChoi = { ma: 401, than: { ok: false, error: "dang_nhap_sai", message: "Số điện thoại, email hoặc mật khẩu không đúng." } };
  if (!chuDangNhap || !matKhau) return tuChoi;

  const [dong] = await ctx.cong.kho.cauLenh(
    `SELECT * FROM ${B_TK} WHERE dang_bat = 1 AND (LOWER(ten_dang_nhap) = ? OR LOWER(email) = ? OR dien_thoai = ?) LIMIT 1`,
    [chuDangNhap, chuDangNhap, chiSo(chuDangNhap)]
  );
  const tk = dong[0];
  if (!tk) return tuChoi;
  if (!(await soi(matKhau, tk.bam_mat_khau))) return tuChoi;

  // LUAT 2: thiet bi phai duoc duyet.
  const may = mayCua(ctx).doc(yc);
  let maMay = String(may?.maMay || "");
  let tb = maMay ? await ctx.cong.kho.bang(B_TB).mot({ ma_ctv: tk.ma, bam_ma_thiet_bi: bamMa(maMay) }) : null;

  if (!tb || String(tb.trang_thai) !== "da-duyet") {
    if (!maMay) maMay = crypto.randomBytes(24).toString("base64url");
    if (!tb) {
      await ctx.cong.kho.bang(B_TB).themHoacThay({
        ma: `tb_${crypto.randomBytes(8).toString("hex")}`,
        ma_ctv: tk.ma,
        bam_ma_thiet_bi: bamMa(maMay),
        trang_thai: "cho-duyet",
        nhan: String(than.tenMay || "").trim().slice(0, 190),
        trinh_duyet: String(yc.tieuDe?.["user-agent"] || "").slice(0, 300),
        dia_chi_ip: String(yc.ip || "").slice(0, 64),
        xin_luc: gioMySQL(luc)
      });
      ctx.cong.nhatKy.tin(`[ctv] thiet bi moi xin duyet cho CTV ${tk.ma}`);
    }
    return {
      ma: 403,
      tieuDe: { ...mayCua(ctx).tieuDeDat({ maMay }), "Cache-Control": "no-store" },
      than: {
        ok: false, error: "thiet_bi_cho_duyet",
        message: "Máy này đang chờ chủ shop duyệt. Nhờ shop duyệt rồi đăng nhập lại."
      }
    };
  }

  const maPhien = crypto.randomBytes(32).toString("base64url");
  await ctx.cong.kho.bang(B_PHIEN).them({
    bam_ma_phien: bamMa(maPhien),
    ma_ctv: tk.ma,
    ma_thiet_bi: tb.ma,
    tao_luc: gioMySQL(luc),
    het_luc: gioMySQL(new Date(luc.getTime() + Number(ctx.cauHinh.songGio || 24 * 30) * 60 * 60 * 1000))
  });
  ctx.cong.nhatKy.tin(`[ctv] ${tk.ma} dang nhap`);

  return {
    ma: 200,
    tieuDe: { ...phienCua(ctx).tieuDeDat({ maPhien }), "Cache-Control": "no-store" },
    than: { ok: true, ctv: banCtv(tk) }
  };
}

module.exports = {
  id: "ctv",
  ten: "Cộng tác viên",
  mang: "van-hanh",
  chay: "server-khach",
  phienBan: "0.1.0",
  canCong: ["kho", "nhatKy", "gio", "cauHinh"],
  luocDo: LUOC_DO,

  // Anh cua mot ma hang doc qua manh Hang hoa. Khong co manh do thi duong tai anh tat, con
  // dang nhap va quan ly CTV van chay.
  canDichVuNeuCo: ["hang-kho.doc"],

  duong: [
    {
      method: "POST", path: "/api/ctv/login", quyen: "cong-khai",
      viSaoCongKhai: "Cộng tác viên tự đăng nhập, chưa có mã nào. Tự bảo vệ bằng: mật khẩu PBKDF2, hạn gọi 20 lần/15 phút, và máy lạ phải được chủ shop duyệt mới vào được.",
      hanGoi: { soLan: 20, trongMs: PHUT15 },
      tay: async (ctx, yc) => dangNhap(ctx, yc, await yc.doc())
    },
    {
      method: "POST", path: "/api/ctv/logout", quyen: "cong-khai",
      viSaoCongKhai: "Đăng xuất chính phiên của mình. Không có phiên thì cũng chỉ xoá cookie, không đọc dữ liệu nào.",
      hanGoi: { soLan: 60, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const ai = await ctvDangNhap(ctx, yc);
        if (ai) await ctx.cong.kho.bang(B_PHIEN).xoa({ bam_ma_phien: ai.maPhien });
        return { ma: 200, tieuDe: { ...phienCua(ctx).tieuDeXoa(), "Cache-Control": "no-store" }, than: { ok: true } };
      }
    },
    {
      method: "GET", path: "/api/ctv/me", quyen: "cong-khai",
      viSaoCongKhai: "Trang CTV hỏi 'tôi là ai'. Chưa đăng nhập thì trả 401 và không đọc gì.",
      hanGoi: { soLan: 240, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const ai = await ctvDangNhap(ctx, yc);
        if (!ai) return { ma: 401, than: { ok: false, error: "chua_dang_nhap" } };
        return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true, ctv: ai } };
      }
    },
    {
      // CTV tai anh mot ma hang. CHI anh — khong ton, khong gia von, khong ten kho.
      method: "GET", path: "/api/ctv/anh", quyen: "cong-khai",
      viSaoCongKhai: "Cộng tác viên tải ảnh sản phẩm. Phải có phiên đăng nhập hợp lệ; bản trả về CHỈ có danh sách ảnh, không tồn kho, không giá vốn, không tên kho.",
      hanGoi: { soLan: 120, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const ai = await ctvDangNhap(ctx, yc);
        if (!ai) return { ma: 401, than: { ok: false, error: "chua_dang_nhap" } };

        const ma = String(yc.truyVan.ma || yc.truyVan.code || "").trim();
        if (!ma) return { ma: 400, than: { ok: false, error: "thieu_ma_hang" } };

        const doc = ctx.dichVu["hang-kho"]?.doc;
        if (!doc) return { ma: 503, than: { ok: false, error: "chua_bat_manh_hang_hoa" } };
        const mon = await doc(ma);
        if (!mon) return { ma: 404, than: { ok: false, error: "khong_thay_ma" } };

        const anh = [mon.highImage, mon.thumbnailImage, ...(Array.isArray(mon.galleryImages) ? mon.galleryImages : [])]
          .map((x) => String(x || "").trim())
          .filter((x) => x !== "");
        const khongTrung = [...new Set(anh)].slice(0, TRAN_ANH);

        await ctx.cong.kho.bang(B_NHAT_KY).them({
          ma_ctv: ai.ma, ma_hang: ma, so_anh: khongTrung.length,
          dia_chi_ip: String(yc.ip || "").slice(0, 64),
          luc: gioMySQL(ctx.cong.gio.bayGio())
        });

        return {
          ma: 200, tieuDe: { "Cache-Control": "no-store" },
          than: { ok: true, ma: mon.code, ten: mon.name, anh: khongTrung, choBoLogo: ai.choBoLogo }
        };
      }
    },

    // ---------- man quan tri ----------
    {
      method: "GET", path: "/api/admin/ctv", quyen: "quan-tri",
      hanGoi: { soLan: 120, trongMs: PHUT10 },
      tay: async (ctx) => {
        const tk = await ctx.cong.kho.bang(B_TK).tim({ sapXep: "ten asc" });
        const tb = await ctx.cong.kho.bang(B_TB).tim({ sapXep: "xin_luc desc" });
        return {
          ma: 200, tieuDe: { "Cache-Control": "no-store" },
          than: {
            ok: true,
            ctv: tk.map(banCtv),
            thietBi: tb.map((d) => ({
              ma: String(d.ma), maCtv: String(d.ma_ctv), trangThai: String(d.trang_thai),
              nhan: String(d.nhan || ""), trinhDuyet: String(d.trinh_duyet || ""),
              diaChiIp: String(d.dia_chi_ip || ""), xinLuc: isoTuMySQL(d.xin_luc), duyetLuc: isoTuMySQL(d.duyet_luc)
            }))
          }
        };
      }
    },
    {
      method: "POST", path: "/api/admin/ctv", quyen: "quan-tri",
      hanGoi: { soLan: 60, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const ten = String(than.ten || than.name || "").trim();
        const dienThoai = chiSo(than.dienThoai || than.phone);
        if (!ten || dienThoai.length < 9) {
          return { ma: 400, than: { ok: false, error: "thieu_ten_hoac_dien_thoai" } };
        }
        const matKhau = String(than.matKhau || than.password || "");
        if (matKhau !== "" && matKhau.length < 8) {
          return { ma: 400, than: { ok: false, error: "mat_khau_qua_ngan", message: "Mật khẩu phải từ 8 ký tự." } };
        }

        const luc = ctx.cong.gio.bayGio();
        const ma = String(than.ma || "").trim() || `ctv_${luc.getTime().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
        const cu = await ctx.cong.kho.bang(B_TK).mot({ ma });

        const dong = {
          ma,
          ten,
          dien_thoai: dienThoai,
          email: String(than.email || "").trim().toLowerCase().slice(0, 190),
          ten_dang_nhap: String(than.tenDangNhap || than.username || dienThoai).trim().slice(0, 190),
          ma_gioi_thieu: String(than.maGioiThieu || than.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40)
            || `CTV${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
          dang_bat: than.dangBat === false ? 0 : 1,
          cho_bo_logo: than.choBoLogo === true ? 1 : 0,
          bam_mat_khau: matKhau !== "" ? await bam(matKhau) : String(cu?.bam_mat_khau || ""),
          bam_cap_luc: matKhau !== "" ? gioMySQL(luc) : (cu?.bam_cap_luc ?? null),
          tao_luc: cu ? cu.tao_luc : gioMySQL(luc),
          sua_luc: gioMySQL(luc)
        };
        if (!cu && dong.bam_mat_khau === "") {
          return { ma: 400, than: { ok: false, error: "thieu_mat_khau", message: "Tài khoản mới phải có mật khẩu (từ 8 ký tự)." } };
        }
        await ctx.cong.kho.bang(B_TK).themHoacThay(dong);

        // Tat tai khoan thi CAT moi phien dang mo — khong de ho vao tiep den khi phien tu het.
        if (dong.dang_bat === 0) await ctx.cong.kho.bang(B_PHIEN).xoa({ ma_ctv: ma });

        ctx.cong.nhatKy.tin(`[ctv] ${cu ? "sua" : "them"} tai khoan ${ma}`);
        return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true, ctv: banCtv(dong) } };
      }
    },
    {
      // Chu shop duyet / chan mot thiet bi cua CTV.
      method: "POST", path: "/api/admin/ctv/thiet-bi", quyen: "quan-tri",
      hanGoi: { soLan: 120, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const ma = String(than.ma || "").trim();
        const viec = String(than.viec || "").trim();
        if (!ma || !["duyet", "chan"].includes(viec)) {
          return { ma: 400, than: { ok: false, error: "can_ma_va_viec", message: 'Cần `ma` thiết bị và `viec` là "duyet" hoặc "chan".' } };
        }
        const tb = await ctx.cong.kho.bang(B_TB).mot({ ma });
        if (!tb) return { ma: 404, than: { ok: false, error: "khong_thay_thiet_bi" } };

        const luc = ctx.cong.gio.bayGio();
        await ctx.cong.kho.bang(B_TB).thay({ ma }, {
          trang_thai: viec === "duyet" ? "da-duyet" : "bi-chan",
          duyet_luc: gioMySQL(luc)
        });
        // Chan thiet bi thi cat luon phien dang mo tren chinh thiet bi do.
        if (viec === "chan") await ctx.cong.kho.bang(B_PHIEN).xoa({ ma_thiet_bi: ma });

        ctx.cong.nhatKy.tin(`[ctv] ${viec} thiet bi ${ma} cua CTV ${tb.ma_ctv}`);
        return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true } };
      }
    },
    {
      method: "GET", path: "/api/admin/ctv/nhat-ky", quyen: "quan-tri",
      hanGoi: { soLan: 120, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const dieuKien = {};
        const maCtv = String(yc.truyVan.ctv || "").trim();
        if (maCtv) dieuKien.ma_ctv = maCtv;
        const dong = await ctx.cong.kho.bang(B_NHAT_KY).tim({
          dieuKien, sapXep: "luc desc", gioiHan: Math.min(Number(yc.truyVan.limit || 100) || 100, 500)
        });
        return {
          ma: 200, tieuDe: { "Cache-Control": "no-store" },
          than: {
            ok: true,
            dong: dong.map((d) => ({
              maCtv: String(d.ma_ctv), maHang: String(d.ma_hang), soAnh: Number(d.so_anh || 0),
              diaChiIp: String(d.dia_chi_ip || ""), luc: isoTuMySQL(d.luc)
            }))
          }
        };
      }
    }
  ],

  congCuBot: []
};
