// KHUNG — nap module, phat cong cho tung module, dinh tuyen, tra loi.
//
// Khung KHONG biet gi ve hang hoa, don hang hay van chuyen. No chi biet: mot module trong
// nhu the nao (giao keo), no duoc xin nhung cong nao, va duong cua no di dau.
//
// Mot module nhan duoc gi:
//   tay(ctx, yc) -> tra ve mot trong:
//     { ma, than, tieuDe }                JSON
//     { ma, tep: { duLieu, kieu } }       tep nhi phan (anh, csv...)
//     { chuyenHuong, ma }                 302
//   ctx = { id, cong (chi nhung cong da khai), bus, cauHinh }
//   yc  = { method, duong, tham, truyVan, tieuDe, doc(), tho(), ip }
//
// Module KHONG nhan `request`/`response` cua Node. Nho vay bai kiem tra goi thang duoc
// `tay(ctx, yc)` ma khong can dung may chu — va sau nay doi sang khung khac (Express,
// serverless) thi module khong sua mot dong.

"use strict";

const { kiemToKhai, LOI } = require("../../hop-dong");
const { taoBoDinhTuyen } = require("./dinh-tuyen");
const { taoBus } = require("./bus");
const { diaChiNguoiGoi } = require("./cong/han-goi");

function taoKhung({ cong, toKhais, nhatKy, cauHinh = {}, tinProxy = false }) {
  if (!Array.isArray(toKhais)) throw new Error("taoKhung can `toKhais` la mang to khai module");
  const ky = nhatKy ?? cong?.nhatKy ?? { tin: () => {}, canhBao: () => {} };
  const bus = taoBus({ nhatKy: ky });
  const boDinhTuyen = taoBoDinhTuyen();
  const daNap = [];
  /** @type {Map<string, { moduleId: string, ham: Function }>} so dich vu: ten -> nguoi cap */
  const soDichVu = new Map();
  /** @type {Map<string, string>} bang -> module lam chu. Moi bang dung MOT chu. */
  const chuCuaBang = new Map();
  /** Cho noi sau khi da nap het: module xin dich vu cua module nap sau no. */
  const chuaNoi = [];

  for (const tk of toKhais) {
    const toKhai = kiemToKhai(tk, tk?.id ?? "khong ro");
    if (toKhai.chay !== "server-khach") {
      throw new Error(`Module "${toKhai.id}" khai chay o "${toKhai.chay}" — server khach khong nap no.`);
    }

    // CHI phat nhung cong module da xin. Xin thieu thi no gay ngay o dong dung no,
    // chu khong lang le dung nho cong cua module khac.
    const congChoModule = {};
    for (const ten of toKhai.canCong ?? []) {
      if (ten === "bus" || ten === "cauHinh") continue;
      if (!cong || cong[ten] === undefined) {
        throw new Error(`Module "${toKhai.id}" xin cong "${ten}" nhung khung khong co cong do.`);
      }
      congChoModule[ten] = cong[ten];
    }

    const suKienPhat = new Set(toKhai.suKien?.phat ?? []);
    const busChoModule = {
      phat(ten, duLieu) {
        if (!suKienPhat.has(ten)) {
          throw new Error(`Module "${toKhai.id}" phat su kien "${ten}" ma khong khai trong suKien.phat.`);
        }
        return bus.phat(ten, duLieu);
      },
      soDoNghe: () => bus.soDoNghe()
    };

    // Moi bang chi duoc MOT module lam chu — ke ca bang ke thua tu ban dang chay.
    // Hai module cung ghi mot bang la hai nguoi cung sua mot so ma khong ai biet ai.
    for (const ten of [
      ...(toKhai.bangKeThua ?? []),
      ...(toKhai.luocDo ?? []).flatMap((b) => b.bang ?? [])
    ]) {
      const chuCu = chuCuaBang.get(ten);
      if (chuCu && chuCu !== toKhai.id) {
        throw new Error(`Bang "${ten}" bi hai module nhan lam chu: "${chuCu}" va "${toKhai.id}".`);
      }
      chuCuaBang.set(ten, toKhai.id);
    }

    // Dich vu module nay XIN. Noi sau khi nap het, vi nguoi cap co the nap sau.
    const dichVuChoModule = {};
    chuaNoi.push({ toKhai, dichVuChoModule });

    const ctx = {
      id: toKhai.id,
      cong: congChoModule,
      bus: busChoModule,
      dichVu: dichVuChoModule,
      cauHinh: cauHinh[toKhai.id] ?? {}
    };

    // Dich vu module nay CAP cho nguoi khac. Buoc san `ctx` CUA NGUOI CAP vao — nguoi goi
    // chi truyen doi so nghiep vu, va khong bao gio cham duoc cong cua module khac.
    for (const [ten, ham] of Object.entries(toKhai.capDichVu ?? {})) {
      if (soDichVu.has(ten)) {
        throw new Error(`Dich vu "${ten}" bi cap hai lan: module "${soDichVu.get(ten).moduleId}" va "${toKhai.id}".`);
      }
      soDichVu.set(ten, { moduleId: toKhai.id, ham: (...ds) => ham(ctx, ...ds) });
    }

    for (const d of toKhai.duong ?? []) {
      // Manh cua duong: khai rieng > khai o module > khong thuoc manh nao. `manh: false` = mien.
      const manh = d.manh === false ? null : (d.manh ?? toKhai.manh ?? null);
      boDinhTuyen.them({ method: d.method, path: d.path, moduleId: toKhai.id, quyen: d.quyen, manh, hanGoi: d.hanGoi, hanThan: d.hanThan, tay: (yc) => d.tay(ctx, yc) });
    }
    for (const [ten, ham] of Object.entries(toKhai.suKien?.nghe ?? {})) {
      bus.nghe(ten, toKhai.id, (duLieu) => ham(ctx, duLieu));
    }

    daNap.push({ toKhai, ctx });
    ky.tin(`[khung] nap module "${toKhai.id}" (${toKhai.ten}) — ${(toKhai.duong ?? []).length} duong`);
  }

  // Noi dich vu sau khi da nap het module. Thieu mot dich vu la NEM ngay — de nguoi dung
  // biet ho vua tat mot module ma module khac dang dua vao, chu khong de bot tra loi thieu.
  for (const { toKhai, dichVuChoModule } of chuaNoi) {
    for (const ten of toKhai.canDichVu ?? []) {
      const nguoiCap = soDichVu.get(ten);
      if (!nguoiCap) {
        throw new Error(
          `Module "${toKhai.id}" xin dich vu "${ten}" nhung khong module nao dang bat cap no ` +
          `(module "${ten.split(".")[0]}" chua nap hoac da tat).`
        );
      }
      const [nhom, viec] = [ten.split(".")[0], ten.split(".")[1]];
      if (!dichVuChoModule[nhom]) dichVuChoModule[nhom] = {};
      dichVuChoModule[nhom][viec] = nguoiCap.ham;
    }
    for (const ten of toKhai.canDichVuNeuCo ?? []) {
      const nguoiCap = soDichVu.get(ten);
      if (!nguoiCap) {
        ky.tin(`[khung] module "${toKhai.id}": dich vu "${ten}" khong co — phan dung no dang TAT.`);
        continue;
      }
      const [nhom, viec] = [ten.split(".")[0], ten.split(".")[1]];
      if (!dichVuChoModule[nhom]) dichVuChoModule[nhom] = {};
      dichVuChoModule[nhom][viec] = nguoiCap.ham;
    }
    Object.freeze(dichVuChoModule);
  }

  /** Xu ly mot yeu cau da chuan hoa. Khong dung den Node http — goi thang duoc trong test. */
  async function xuLy(yc) {
    const tim = boDinhTuyen.tim(yc.method, yc.duong);
    if (tim === null) return { ma: 404, than: { ok: false, error: LOI.khong_thay } };
    if (tim.saiPhuongThuc) return { ma: 405, than: { ok: false, error: LOI.sai_yeu_cau, message: "Phuong thuc khong dung cho duong nay." } };

    // CHAN GOI DON truoc khi lam bat ky viec gi — ke goi don khong duoc bat server lam viec.
    if (tim.hanGoi && cong?.hanGoi) {
      const ai = diaChiNguoiGoi(yc, { tinProxy });
      const kq = cong.hanGoi.dem(`${yc.method} ${tim.path}|${ai}`, tim.hanGoi.soLan, tim.hanGoi.trongMs);
      if (!kq.duoc) {
        ky.canhBao(`[khung] chan goi don: ${yc.method} ${tim.path} tu ${ai}`);
        return {
          ma: 429,
          tieuDe: { "Retry-After": String(Math.ceil(kq.choLaiSauMs / 1000)) },
          than: { ok: false, error: LOI.qua_nhieu, message: "Hệ thống đang nhận quá nhiều yêu cầu. Vui lòng thử lại sau ít phút." }
        };
      }
    }

    // CHAN QUYEN O DAY, mot cho duy nhat. Module khong tu kiem, nen khong quen duoc.
    if (tim.quyen !== "cong-khai") {
      const congQuyen = cong?.quyen;
      if (!congQuyen) {
        ky.canhBao(`[khung] duong ${yc.method} ${yc.duong} khai quyen "${tim.quyen}" nhung khung khong co cong quyen`);
        return { ma: 500, than: { ok: false, error: LOI.loi_he_thong } };
      }
      if (!congQuyen.duoc(yc, tim.quyen)) {
        // Ghi AI bi tu choi, khong chi "co nguoi bi tu choi" — de truy duoc khi co chuyen.
        const n = typeof congQuyen.ai === "function" ? congQuyen.ai(yc) : { ten: "", bang: "?" };
        ky.canhBao(`[khung] tu choi ${yc.method} ${tim.path}: can "${tim.quyen}", nguoi goi la "${n.ten || "khong ro"}" (${n.bang})`);
        return { ma: 401, than: { ok: false, error: LOI.chua_dang_nhap, message: "Thiếu mã hoặc mã không đủ quyền cho đường này." } };
      }
      // CHAN THEO MANH: ve may mang danh sach manh shop da mua. Duong thuoc manh chua mua thi
      // 403 va noi ro manh nao — OMI hien "chua mua manh X", khong phai loi la.
      if (tim.manh && typeof congQuyen.thieuManh === "function" && congQuyen.thieuManh(yc, tim.manh)) {
        const n = typeof congQuyen.ai === "function" ? congQuyen.ai(yc) : { ten: "" };
        ky.canhBao(`[khung] tu choi ${yc.method} ${tim.path}: "${n.ten}" chua mua manh "${tim.manh}"`);
        return { ma: 403, than: { ok: false, error: LOI.chua_mua_manh, manh: tim.manh, message: `Shop chưa mua mảnh "${tim.manh}".` } };
      }
    }

    try {
      // Cua nao khai han than rieng thi dat truoc khi module doc than.
      if (tim.hanThan) yc.datHanThan?.(tim.hanThan);
      const ra = await tim.tay({ ...yc, tham: tim.tham ?? {} });
      if (!ra || typeof ra !== "object") {
        throw new Error(`Module "${tim.moduleId}" khong tra ve gi cho ${yc.method} ${yc.duong}`);
      }
      return ra;
    } catch (e) {
      // Than yeu cau qua lon / khong phai JSON la LOI CUA NGUOI GOI, khong phai loi he thong.
      // Hai loi nay nem ra tu `yc.doc()` — tuc la nem BEN TRONG tay module — nen neu khong bat
      // o day thi ca hai ra 500 kem mot dong nhat ky bao dong, va nguoi goi khong biet minh sai gi.
      if (e?.qualon) {
        return { ma: 413, than: { ok: false, error: LOI.sai_yeu_cau, message: "Yêu cầu quá lớn." } };
      }
      if (e?.saiJson) {
        return { ma: 400, than: { ok: false, error: LOI.sai_yeu_cau, message: "Thân yêu cầu không phải JSON." } };
      }
      ky.canhBao(`[khung] module "${tim.moduleId}" loi o ${yc.method} ${yc.duong}: ${e?.stack || e}`);
      return { ma: 500, than: { ok: false, error: LOI.loi_he_thong } };
    }
  }

  return {
    xuLy,
    bus,
    banDuong: () => boDinhTuyen.banDuong(),
    banDichVu: () => [...soDichVu.entries()].map(([ten, x]) => ({ ten, module: x.moduleId })),
    banBang: () => [...chuCuaBang.entries()].map(([bang, module]) => ({ bang, module })),
    danhSachModule: () => daNap.map((m) => ({
      id: m.toKhai.id, ten: m.toKhai.ten, mang: m.toKhai.mang, phienBan: m.toKhai.phienBan,
      duong: (m.toKhai.duong ?? []).length,
      congCuBot: (m.toKhai.congCuBot ?? []).map((c) => c.ten)
    })),
    /** Moi cong cu bot cua moi module — bo nao doc danh sach nay qua API. */
    congCuBot: () => daNap.flatMap((m) => (m.toKhai.congCuBot ?? []).map((c) => ({ ...c, module: m.toKhai.id })))
  };
}

module.exports = { taoKhung };
