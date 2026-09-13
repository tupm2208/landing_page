// KHUNG NEN TANG — phan ha tang chung, KHONG ban rieng va khong tat duoc.
//
// Ban dac ta goi day la "Khung nen tang, 12 duong, khong thuoc manh nao": tai khoan quan tri,
// thiet bi, thao tac nhanh, cau hinh ban dau, phien ban dang chay. Dot nay moi co mot duong —
// doi khoa dai han lay VE 15 phut (anh Dung duyet 12/09/2026).

"use strict";

const { noiDungMacDinh, chuanHoa, soCuaTien } = require("./noi-dung");
const { taoSoGhep, ghep, moMaMoi, xemSo, tenKhoaCuaMay, SO_KHOA_MAY } = require("./ghep-may");
const { gioMySQL } = require("../../../chung/gio-mysql.js");

const SO_NOI_DUNG = "khung-nen-tang-noi-dung";

/**
 * So ghep may trong bo nho cua LAN CHAY NAY. Bat lai server la ma ghep moi — co y: ma ghep chi de
 * bat tay lan dau, khong phai thu de dai lau.
 */
let soGhep = null;

function soGhepCua(ctx) {
  if (soGhep === null) {
    soGhep = taoSoGhep({
      ma: String(ctx.cauHinh.maGhep || ""),
      hetLuc: Number(ctx.cauHinh.maGhepHetLuc || 0)
    });
  }
  return soGhep;
}

/** CHO BAI KIEM TRA: quen so ghep de moi bai bat dau tu trang. */
function quenSoGhep() { soGhep = null; }

async function docNoiDung(ctx) {
  const co = await ctx.cong.kho.so(SO_NOI_DUNG).doc();
  return co ? chuanHoa(co, co.updatedAt || ctx.cong.gio.bayGio()) : noiDungMacDinh();
}

module.exports = {
  id: "khung-nen-tang",
  ten: "Khung nền tảng",
  mang: "khung",
  chay: "server-khach",
  phienBan: "0.2.0",
  canCong: ["quyen", "nhatKy", "cauHinh", "kho", "gio"],

  // Chi bai kiem tra dung. Khong module nao goi cai nay.
  __quenSoGhep: quenSoGhep,

  capDichVu: {
    // Module Tien doc phan tram coc / phi ship / tien to chuyen khoan tu day, de chu shop sua
    // mot cho trong man quan tri la ca he doi theo.
    "khung-nen-tang.noiDung": async (ctx) => docNoiDung(ctx),
    "khung-nen-tang.soCuaTien": async (ctx) => soCuaTien(await docNoiDung(ctx))
  },

  duong: [
    {
      // Doi khoa dai han lay ve ngan han. Duong nay CHINH la cho de do ma, nen han chat.
      method: "POST", path: "/api/ve", quyen: "dich-vu",
      hanGoi: { soLan: 60, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => {
        const cap = ctx.cong.quyen.phatVe(yc);
        if (!cap) {
          return { ma: 503, than: { ok: false, error: "chua_bat_ve", message: "Máy chủ chưa bật vé ngắn hạn." } };
        }
        return {
          ma: 200,
          tieuDe: { "Cache-Control": "no-store" },
          than: { ok: true, ve: cap.ve, vai: cap.vai, ten: cap.ten, hetSauGiay: Math.round(cap.hetSauMs / 1000) }
        };
      }
    },
    {
      // GHEP MAY — cach OMI duoc cap khoa rieng ma khong ai phai be ma quan tri sang.
      //
      // CONG KHAI vi may chua ghep thi CHUA CO MA NAO — do la dinh nghia cua viec bat tay. No tu
      // bao ve bang: ma ghep 6 chu so chi in ra o CUA SO MAY CHU (ai doc duoc cua so do la chu
      // shop), dung MOT lan, song 15 phut, sai 10 lan la chet, va han goi 10 lan / 15 phut cho
      // mot dia chi.
      method: "POST", path: "/api/ghep-may", quyen: "cong-khai",
      viSaoCongKhai: "Máy chưa ghép thì chưa có mã nào — đó là định nghĩa của việc bắt tay. Tự bảo vệ bằng: mã ghép chỉ in ở cửa sổ máy chủ, dùng một lần, sống 15 phút, sai 10 lần là chết, và hạn gọi 10 lần/15 phút.",
      hanGoi: { soLan: 10, trongMs: 15 * 60 * 1000 },
      hanThan: 8 * 1024,
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const so = soGhepCua(ctx);
        const kq = ghep(so, ctx.cong.gio.bayGio(), {
          maGhep: than.maGhep ?? than.ma,
          tenMay: than.tenMay ?? than.may
        });

        if (!kq.ok) {
          ctx.cong.nhatKy.canhBao(`[ghep-may] tu choi: ${kq.viSao} (tu ${yc.ip || "khong ro"})`);
          const ma = kq.viSao === "ma_sai" ? 401 : 409;
          return { ma, than: { ok: false, error: kq.viSao, message: kq.message } };
        }

        // Cap khoa: vao cong quyen NGAY (de may dung duoc lien), va ghi vao so de lan khoi dong
        // sau van con. Thu tu nay quan trong: ghi so hong thi khong duoc coi la da ghep.
        const luc = ctx.cong.gio.bayGio();
        await ctx.cong.kho.so(SO_KHOA_MAY).capNhat((cu) => {
          const ds = Array.isArray(cu?.khoa) ? cu.khoa.filter((k) => k.ten !== kq.ten) : [];
          ds.push({ ma: kq.khoa, ten: kq.ten, vai: "quan-tri", ghepLuc: luc.toISOString() });
          return { version: 1, khoa: ds, updatedAt: luc.toISOString() };
        }, { version: 1, khoa: [] });
        ctx.cong.quyen.themKhoa({ ma: kq.khoa, ten: kq.ten, vai: "quan-tri" });

        ctx.cong.nhatKy.tin(`[ghep-may] da ghep "${kq.ten}"`);
        return {
          ma: 200, tieuDe: { "Cache-Control": "no-store" },
          than: { ok: true, ma: kq.khoa, ten: kq.ten }
        };
      }
    },
    {
      // MAN QUAN TRI MAY doc duong nay: may nao dang duoc vao, va ma ghep con song khong.
      //
      // Anh Dung nhac 13/09/2026: "phai co trang de admin quan ly cac key chu". Dung — bo mot may
      // hay cap ma cho may moi la viec hang ngay cua chu shop, khong phai viec go lenh.
      method: "GET", path: "/api/admin/may", quyen: "quan-tri",
      hanGoi: { soLan: 120, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => {
        const so = await ctx.cong.kho.so(SO_KHOA_MAY).doc();
        const ds = Array.isArray(so?.khoa) ? so.khoa : [];
        const toi = ctx.cong.quyen.ai(yc);
        return {
          ma: 200, tieuDe: { "Cache-Control": "no-store" },
          than: {
            ok: true,
            // KHONG tra ban ma — chi ten va luc ghep. `laMayNay` de man hinh khong de chu shop
            // bam bo chinh cai may minh dang ngoi.
            may: ds.map((k) => ({
              ten: k.ten, vai: k.vai, ghepLuc: k.ghepLuc ?? "",
              laMayNay: toi.ten !== "" && k.ten === toi.ten
            })),
            // Ten khoa dang goi: co the la mot khoa cau hinh san (Desk, Image Tool), khong nam
            // trong so may. Man hinh noi ro "anh dang vao bang khoa nao".
            toi: { ten: toi.ten, vai: toi.vai, bang: toi.bang },
            maGhep: xemSo(soGhepCua(ctx), ctx.cong.gio.bayGio())
          }
        };
      }
    },
    {
      // CAP MA GHEP CHO MAY MOI — thay cho viec bat lai may chu chi de lay mot ma 6 chu so.
      //
      // Mot luc chi co MOT ma song: bam nut nay la ma cu chet. Ma khong bao gio duoc ghi nhat ky
      // (nhat ky server thuong duoc gui di khi co su co).
      method: "POST", path: "/api/admin/ma-ghep", quyen: "quan-tri",
      hanGoi: { soLan: 30, trongMs: 10 * 60 * 1000 },
      hanThan: 2 * 1024,
      tay: async (ctx, yc) => {
        const toi = ctx.cong.quyen.ai(yc);
        const moi = moMaMoi(soGhepCua(ctx), ctx.cong.gio.bayGio());
        ctx.cong.nhatKy.tin(`[ghep-may] "${toi.ten}" cap mot ma ghep moi (song ${Math.round(moi.songGiay / 60)} phut)`);
        return {
          ma: 200, tieuDe: { "Cache-Control": "no-store" },
          than: {
            ok: true, ma: moi.ma,
            hetLuc: new Date(moi.hetLuc).toISOString(),
            conLaiGiay: moi.songGiay
          }
        };
      }
    },
    {
      method: "POST", path: "/api/admin/may/bo", quyen: "quan-tri",
      hanGoi: { soLan: 60, trongMs: 10 * 60 * 1000 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const ten = String(than.ten || "").trim();
        if (!ten) return { ma: 400, than: { ok: false, error: "thieu_ten_may" } };
        const toi = ctx.cong.quyen.ai(yc);
        if (toi.ten !== "" && ten === toi.ten) {
          return {
            ma: 409,
            than: {
              ok: false, error: "khong_bo_may_nay",
              message: "Đây là máy anh đang ngồi. Bỏ nó là mất đường vào màn quản trị — bỏ từ một máy khác."
            }
          };
        }
        const luc = ctx.cong.gio.bayGio();
        let bo = 0;
        await ctx.cong.kho.so(SO_KHOA_MAY).capNhat((cu) => {
          const ds = Array.isArray(cu?.khoa) ? cu.khoa : [];
          const con = ds.filter((k) => k.ten !== ten);
          bo = ds.length - con.length;
          return { version: 1, khoa: con, updatedAt: luc.toISOString() };
        }, { version: 1, khoa: [] });
        // KHONG cho bo chinh cai may dang goi: chu shop bo minh la mat duong vao man quan tri,
        // va phai bat lai may chu de lay ma ghep. Bo may khac thi duoc.
        ctx.cong.quyen.boKhoaTheoTen(ten);
        ctx.cong.nhatKy.tin(`[ghep-may] bo may "${ten}" (${bo} khoa)`);
        return { ma: 200, than: { ok: true, daBo: bo } };
      }
    },
    {
      // Mat web doc chu trang chu, phi ship, va thong tin chuyen khoan tu day.
      //
      // CONG KHAI co y: khach phai doc duoc so tai khoan de chuyen tien. Vi vay ban nay chi
      // chua nhung truong da khai trong `noi-dung.js` — khong bao gio co ma Telegram hay khoa.
      method: "GET", path: "/api/content", quyen: "cong-khai",
      viSaoCongKhai: "Chữ trên trang và thông tin chuyển khoản — thứ khách phải đọc được. Chỉ trả các trường đã khai, không có khoá nào.",
      hanGoi: { soLan: 600, trongMs: 10 * 60 * 1000 },
      tay: async (ctx) => ({
        ma: 200,
        tieuDe: { "Cache-Control": "public, max-age=60" },
        than: await docNoiDung(ctx)
      })
    },
    {
      // Chu shop sua noi dung trang.
      method: "POST", path: "/api/content", quyen: "quan-tri",
      hanGoi: { soLan: 60, trongMs: 10 * 60 * 1000 },
      hanThan: 256 * 1024,
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        if (!than || typeof than !== "object" || Array.isArray(than)) {
          return { ma: 400, than: { ok: false, error: "can_mot_doi_tuong" } };
        }
        const cu = await docNoiDung(ctx);
        const moi = chuanHoa({ ...cu, ...than }, ctx.cong.gio.bayGio());
        await ctx.cong.kho.so(SO_NOI_DUNG).ghi(moi);
        ctx.cong.nhatKy.tin("[khung-nen-tang] noi dung trang da doi");
        return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true, noiDung: moi } };
      }
    },
    {
      // Ban dang chay co duong nay va Image Tool doc no sau moi lan deploy.
      method: "GET", path: "/api/runtime-version", quyen: "cong-khai",
      viSaoCongKhai: "Chỉ trả phiên bản đang chạy — không đọc dữ liệu của shop. Image Tool gọi sau mỗi lần deploy.",
      hanGoi: { soLan: 120, trongMs: 10 * 60 * 1000 },
      tay: async (ctx) => ({
        ma: 200,
        tieuDe: { "Cache-Control": "no-store" },
        than: { ok: true, deployId: String(ctx.cauHinh.deployId || "chua-dat"), runtimeRoot: "toprunvn-modules" }
      })
    }
  ],

  congCuBot: []
};
