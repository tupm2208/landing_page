// MODULE HOP THU DA KENH — mang "chatbot", chay tren server cua khach.
//
// Viec cua no: nhan tin (tu Meta, tu OMI), giu lai, phat len bang tin, day sang bo nao, va gui
// tin di khi co nguoi (bo nao, hay nguoi that trong OMI) nho gui.
//
// No KHONG biet tra loi khach nhu the nao — do la viec cua bo nao tren Xeon. O day chi co
// duong day va hop thu. Nho vay tat bo nao thi tin van vao hop thu, khong mat.
//
// HAI LUONG (anh Dung chot 14/09/2026):
//   1. Facebook Graph API chinh thuc: Meta goi webhook vao day, landing tra loi qua Graph API.
//      Chay 24/7 tren hosting.
//   2. Zalo, Facebook ca nhan (automation tren OMI, may shop): OMI boc tin -> POST /api/hop-thu/tin-vao;
//      bo nao tra loi vao day nhu moi kenh; landing KHONG gui duoc kenh nay nen xep vao HANG CHO;
//      OMI (may truc) keo ve bang /api/hop-thu/cho-gui/nhan, go bang automation, bao lai /xong.
//   Bo nao va hop thu chi co MOT hinh dang tin; them kenh = them mot dau boc tin tren OMI.
//
// Tin cu (may shop tat, bat lai thay ca dong tin): bot VAN tra loi tin chua duoc tra loi, tru tin
// cu hon nguong (mac dinh 24 gio, shop chinh trong OMI qua /api/hop-thu/cau-hinh).

"use strict";

const { SU_KIEN } = require("../../../hop-dong");
const { chuKyDung, bocTinNhan, guiTinFacebook } = require("./graph");
const choGui = require("./cho-gui");

const SO_TIN = "hop-thu-den";          // nhat ky tho de Desk keo ve (giu tuong thich ban dang chay)
const SO_CHO_GUI = "hop-thu-cho-gui";
const SO_CAU_HINH = "hop-thu-cau-hinh";
const SO_CAN_NGUOI = "hop-thu-can-nguoi";   // bot chuyen nguoi that: hoi thoai nao dang cho nguoi
const GIU_CAN_NGUOI = 200;
const HAN_THAN = 256 * 1024;           // Meta khong gui goi lon hon
const GIU_TOI_DA = 500;                // cat bot cho khoi phinh so
const GIU_MA_TIN = 2000;               // de bo tin trung khi OMI quet lai man hinh
const KENH_OMI = ["zalo", "fb-ca-nhan"];
const NGUONG_TIN_CU_GIO_MAC_DINH = 24;
const PHUT10 = 10 * 60 * 1000;

function soTin(ctx) { return ctx.cong.kho.so(SO_TIN); }
function soMacDinh() { return { version: 1, events: [], daThay: [], updatedAt: "" }; }
function cauHinhMacDinh() { return { nguongTinCuGio: NGUONG_TIN_CU_GIO_MAC_DINH }; }

async function docCauHinh(ctx) {
  const co = await ctx.cong.kho.so(SO_CAU_HINH).doc(null);
  const ch = { ...cauHinhMacDinh(), ...(co && typeof co === "object" ? co : {}) };
  const n = Number(ch.nguongTinCuGio);
  ch.nguongTinCuGio = Number.isFinite(n) && n > 0 ? n : NGUONG_TIN_CU_GIO_MAC_DINH;
  return ch;
}

/** Tra loi 200 cho Meta ngay khi da GHI XONG — Meta gui lai moi phan hoi khac 2xx. */
async function nhanWebhook(ctx, yc) {
  const { verifyToken, appSecret } = ctx.cauHinh;
  if (!verifyToken) return { ma: 503, than: { ok: false, error: "hop_thu_chua_cau_hinh" } };

  const tho = await yc.tho();
  if (tho.length > HAN_THAN) return { ma: 413, than: { ok: false, error: "goi_qua_lon" } };

  const chuKy = String(yc.tieuDe["x-hub-signature-256"] || "").trim();
  let goi = null;
  try { goi = JSON.parse(tho.toString("utf8")); } catch { /* de goi = null */ }
  if (!chuKy.startsWith("sha256=") || !goi || goi.object !== "page") {
    return { ma: 400, than: { ok: false, error: "goi_webhook_khong_hop_le" } };
  }

  // Co APP_SECRET thi kiem chu ky that. Khong co thi giu hanh xu ban dang chay (trung chuyen):
  // chi kiem hinh dang, va KHONG tu tra loi khach — khong co secret nghia la khong chac
  // goi nay tu Meta, tra loi bua la gui tin cho nguoi la.
  const daXacMinh = appSecret ? chuKyDung(tho, chuKy, appSecret) : false;
  if (appSecret && !daXacMinh) {
    ctx.cong.nhatKy.canhBao("[hop-thu] chu ky khong khop — bo goi");
    return { ma: 401, than: { ok: false, error: "chu_ky_sai" } };
  }

  const luc = ctx.cong.gio.bayGio().toISOString();
  await soTin(ctx).capNhat((cu) => {
    const so = cu ?? soMacDinh();
    const events = Array.isArray(so.events) ? so.events : [];
    events.push({
      eventId: `fbw_${Date.parse(luc)}_${events.length + 1}`,
      receivedAt: luc,
      signature: chuKy,
      daXacMinh,
      rawBodyBase64: tho.toString("base64")
    });
    return { ...so, version: 1, events: events.slice(-GIU_TOI_DA), updatedAt: luc };
  }, soMacDinh());

  // Chi phat len bang tin khi da xac minh that. Bo nao nghe su kien nay de tra loi khach.
  if (daXacMinh) {
    const cauHinh = await docCauHinh(ctx);
    for (const tin of bocTinNhan(goi)) {
      ctx.bus.phat(SU_KIEN.tin_nhan_den, tin);
      dayNeuKhongCu(ctx, tin, cauHinh);
    }
  }
  return { ma: 200, than: { ok: true, daXacMinh } };
}

/** Tin cu hon nguong thi KHONG tu tra loi — chi nam trong hop thu cho nguoi xem. */
function dayNeuKhongCu(ctx, tin, cauHinh) {
  const luc = Date.parse(String(tin.luc || ""));
  const tuoiMs = Number.isFinite(luc) ? ctx.cong.gio.bayGio().getTime() - luc : 0;
  if (tuoiMs > cauHinh.nguongTinCuGio * 3600 * 1000) {
    ctx.cong.nhatKy.tin(`[hop-thu] tin ${tin.kenh}:${tin.nguoi} cu ${Math.round(tuoiMs / 3600000)} gio — khong tu tra loi`);
    return false;
  }
  daySangBoNao(ctx, tin);
  return true;
}

/**
 * Day tin sang bo nao tren Xeon.
 *
 * KHONG CHO ket qua, va loi o day KHONG duoc chan cau tra loi 200 cho Meta: Meta gui lai
 * moi phan hoi khac 2xx, nen bo nao chet la Meta gui lai vo han va hop thu day rac. Tin da
 * nam trong so roi — bo nao song lai thi keo ve duoc.
 */
function daySangBoNao(ctx, tin) {
  Promise.resolve()
    .then(async () => {
      // Xeon nao, ma nao: doc tu dang ky voi Xeon (khung nen tang). Chua dang ky thi thu cau
      // hinh tay `boNao` (bai kiem tra / chay thu). Khong co ca hai = chua noi bo nao, hop thu
      // van chay binh thuong.
      const dk = ctx.dichVu["khung-nen-tang"]?.xeon ? await ctx.dichVu["khung-nen-tang"].xeon() : null;
      const dich = dk?.maNhanTin
        ? { diaChi: dk.diaChiXeon, ma: dk.maNhanTin, tenant: dk.shop }
        : (ctx.cauHinh.boNao ?? {});
      if (!dich.diaChi) return null;
      const goc = String(dich.diaChi).replace(/\/+$/, "");
      return ctx.cong.httpNgoai.goi(`${goc}/tin-den`, {
        method: "POST",
        hanMs: 8000,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${dich.ma}` },
        body: JSON.stringify({
          tenant: String(dich.tenant || ""),
          kenh: tin.kenh, nguoi: tin.nguoi, chu: tin.chu, soAnh: tin.soAnh,
          maTin: tin.maTin, maHoiThoai: `${tin.kenh}:${tin.nguoi}`, luc: tin.luc
        })
      });
    })
    .then((tl) => { if (tl && !tl.ok) ctx.cong.nhatKy.canhBao(`[hop-thu] bo nao tu choi tin: HTTP ${tl.status}`); })
    .catch((e) => ctx.cong.nhatKy.canhBao(`[hop-thu] khong day duoc tin sang bo nao: ${e?.message || e}`));
}

/** Mot tin OMI boc duoc, da chuan hoa. Tra null neu sai hinh dang. */
function chuanTinOmi(t, luc) {
  if (!t || typeof t !== "object") return null;
  const kenh = String(t.kenh || "").trim();
  const nguoi = String(t.nguoi || "").trim().slice(0, 120);
  const chu = typeof t.chu === "string" ? t.chu.slice(0, 4000) : "";
  const maTin = String(t.maTin || "").trim().slice(0, 160);
  if (!KENH_OMI.includes(kenh) || !nguoi || !maTin || (chu === "" && !(Number(t.soAnh) > 0))) return null;
  const l = Date.parse(String(t.luc || ""));
  return {
    kenh, nguoi, chu, maTin,
    tenNguoi: String(t.tenNguoi || "").slice(0, 120),
    soAnh: Math.max(0, Math.min(20, Number(t.soAnh) || 0)),
    luc: Number.isFinite(l) ? new Date(l).toISOString() : luc.toISOString()
  };
}

/** OMI (may truc) day tin boc duoc tu Zalo / Facebook ca nhan vao hop thu. */
async function nhanTinOmi(ctx, yc) {
  const than = await yc.doc();
  const danhSach = Array.isArray(than.tin) ? than.tin : [than];
  if (danhSach.length > 200) return { ma: 400, than: { ok: false, error: "qua_nhieu_tin", message: "Toi da 200 tin mot lan." } };
  const bayGio = ctx.cong.gio.bayGio();
  const tinMoi = [];
  let saiHinhDang = 0;
  let trung = 0;

  await soTin(ctx).capNhat((cu) => {
    const so = cu ?? soMacDinh();
    const events = Array.isArray(so.events) ? so.events : [];
    const daThay = new Set(Array.isArray(so.daThay) ? so.daThay : []);
    for (const t of danhSach) {
      const tin = chuanTinOmi(t, bayGio);
      if (!tin) { saiHinhDang += 1; continue; }
      const khoa = `${tin.kenh}|${tin.maTin}`;
      if (daThay.has(khoa)) { trung += 1; continue; }
      daThay.add(khoa);
      events.push({ eventId: `omi_${bayGio.getTime()}_${events.length + 1}`, receivedAt: bayGio.toISOString(), kenh: tin.kenh, daXacMinh: true, tin });
      tinMoi.push(tin);
    }
    return {
      ...so, version: 1,
      events: events.slice(-GIU_TOI_DA),
      daThay: [...daThay].slice(-GIU_MA_TIN),
      updatedAt: bayGio.toISOString()
    };
  }, soMacDinh());

  const cauHinh = await docCauHinh(ctx);
  let dayBoNao = 0;
  for (const tin of tinMoi) {
    ctx.bus.phat(SU_KIEN.tin_nhan_den, tin);
    if (dayNeuKhongCu(ctx, tin, cauHinh)) dayBoNao += 1;
  }
  return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true, daNhan: tinMoi.length, trung, saiHinhDang, dayBoNao } };
}

/** Nguoi goi la may truc (hay khoa dai han) — chi may truc duoc keo hang cho de khong hai may cung go. */
function duocKeoHangCho(ctx, yc) {
  const ai = ctx.cong.quyen.ai(yc);
  if (ai.bang !== "ve-xeon") return { duoc: true, ten: ai.ten || "khoa-dai-han" };
  if (ai.truc) return { duoc: true, ten: ai.ten };
  return { duoc: false, ten: ai.ten };
}

module.exports = {
  id: "hop-thu",
  ten: "Hộp thư đa kênh",
  mang: "chatbot",
  chay: "server-khach",
  manh: "hop-thu",
  phienBan: "0.2.0",
  canCong: ["kho", "nhatKy", "gio", "httpNgoai", "bus", "cauHinh", "quyen"],
  // Biet Xeon nao / ma nao de day tin sang bo nao. Khong co (chua dang ky) thi hop thu van chay.
  canDichVuNeuCo: ["khung-nen-tang.xeon"],

  suKien: {
    phat: [SU_KIEN.tin_nhan_den, SU_KIEN.tin_nhan_di],
    nghe: {}
  },

  capDichVu: {
    /**
     * Gui tin cho khach. Dung cho bo nao va cho nguoi that trong OMI.
     * Facebook: gui ngay qua Graph API. Zalo / FB ca nhan: xep vao hang cho, OMI may truc gui.
     */
    "hop-thu.guiTin": async (ctx, { kenh = "facebook", nguoi, chu, nguon = "bo-nao", maHoiThoai = "" }) => {
      if (typeof nguoi !== "string" || nguoi.trim() === "" || typeof chu !== "string" || chu.trim() === "") {
        throw new Error("Gui tin can `nguoi` va `chu`.");
      }
      const luc = ctx.cong.gio.bayGio();
      if (kenh === "facebook") {
        const kq = await guiTinFacebook({ httpNgoai: ctx.cong.httpNgoai, tokenTrang: ctx.cauHinh.tokenTrang, nguoi, chu });
        ctx.bus.phat(SU_KIEN.tin_nhan_di, { kenh, nguoi, chu, luc: luc.toISOString() });
        return { ...kq, guiNgay: true };
      }
      if (KENH_OMI.includes(kenh)) {
        let muc = null;
        await ctx.cong.kho.so(SO_CHO_GUI).capNhat((cu) => {
          const so = cu ?? choGui.soMacDinh();
          muc = choGui.xepVao(so, { kenh, nguoi, chu, nguon, maHoiThoai }, luc);
          return choGui.catBot(so);
        }, choGui.soMacDinh());
        ctx.cong.nhatKy.tin(`[hop-thu] xep hang cho gui ${kenh}:${nguoi} (${muc.id})`);
        return { xepHang: true, id: muc.id, guiNgay: false };
      }
      throw new Error(`Kenh "${kenh}" chua co o ban nay.`);
    }
  },

  duong: [
    // Meta goi de xac nhan dia chi webhook. Thieu verify token = tu choi (fail-closed).
    {
      method: "GET", path: "/api/facebook/webhook", quyen: "cong-khai",
      viSaoCongKhai: "Meta goi tu may cua ho, khong mang ma cua shop. Tu bao ve bang verify token: sai la 403.",
      hanGoi: { soLan: 120, trongMs: PHUT10 },
      tay: (ctx, yc) => {
        const { verifyToken } = ctx.cauHinh;
        const hopLe = yc.truyVan["hub.mode"] === "subscribe" && verifyToken
          && yc.truyVan["hub.verify_token"] === verifyToken;
        if (!hopLe) return { ma: 403, than: { ok: false, error: "verify_token_khong_khop" } };
        return {
          ma: 200,
          tep: { duLieu: Buffer.from(String(yc.truyVan["hub.challenge"] ?? ""), "utf8"), kieu: "text/plain; charset=utf-8" }
        };
      }
    },

    {
      method: "POST", path: "/api/facebook/webhook", quyen: "cong-khai",
      viSaoCongKhai: "Meta goi tu may cua ho. Tu bao ve bang chu ky HMAC tren raw byte; khong khop la 401.",
      // 600/10 phut — dung con so ban dang chay da chon. Meta gui don khi co nhieu tin cung luc.
      hanGoi: { soLan: 600, trongMs: PHUT10 },
      tay: nhanWebhook
    },

    // OMI (may truc) day tin boc duoc tu Zalo / Facebook ca nhan. Trung ma tin thi bo qua.
    {
      method: "POST", path: "/api/hop-thu/tin-vao", quyen: "quan-tri",
      hanGoi: { soLan: 600, trongMs: PHUT10 },
      hanThan: 512 * 1024,
      tay: nhanTinOmi
    },

    // Desk / OMI keo tin ve (giu nguyen duong cu de ban dang chay khong gay khi chuyen sang).
    {
      method: "GET", path: "/api/facebook/webhook-inbox", quyen: "quan-tri",
      tay: async (ctx, yc) => {
        const so = (await soTin(ctx).doc(soMacDinh())) ?? soMacDinh();
        const tu = String(yc.truyVan.since ?? "");
        const gioiHan = Math.min(Number(yc.truyVan.limit ?? 100) || 100, GIU_TOI_DA);
        const events = so.events.filter((e) => !tu || e.eventId > tu).slice(0, gioiHan);
        // TRA CA TIN DA BOC. Trong so chi giu goi THO cua Meta (base64) — de nguyen van la
        // dung, nhung neu bat man quan tri tu doc base64 roi tu hieu hinh dang cua Meta thi
        // hinh dang do lan ra ngoai module nay. Meta doi mot khoa la sua hai noi.
        const tin = [];
        for (const e of events) {
          if (e.tin) { tin.push({ ...e.tin, maSuKien: e.eventId, nhanLuc: e.receivedAt, daXacMinh: true }); continue; }
          let goiTho = null;
          try { goiTho = JSON.parse(Buffer.from(String(e.rawBodyBase64 || ""), "base64").toString("utf8")); } catch { goiTho = null; }
          for (const t of goiTho === null ? [] : bocTinNhan(goiTho)) {
            tin.push({ ...t, maSuKien: e.eventId, nhanLuc: e.receivedAt, daXacMinh: e.daXacMinh === true });
          }
        }
        return {
          ma: 200,
          tieuDe: { "Cache-Control": "no-store" },
          than: { ok: true, events, tin, cursor: events.length ? events[events.length - 1].eventId : tu, updatedAt: so.updatedAt }
        };
      }
    },

    // Bo nao tren Xeon (hay nguoi that trong OMI) goi duong nay de tra loi khach.
    {
      method: "POST", path: "/api/hop-thu/gui", quyen: "dich-vu",
      hanGoi: { soLan: 600, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const ai = ctx.cong.quyen.ai(yc);
        const nguon = ai.vai === "dich-vu" ? "bo-nao" : "omi";
        try {
          const kq = await module.exports.capDichVu["hop-thu.guiTin"](ctx, { ...than, nguon });
          return { ma: 200, than: { ok: true, ketQua: kq } };
        } catch (e) {
          ctx.cong.nhatKy.canhBao(`[hop-thu] gui tin that bai: ${e.message}`);
          return { ma: 502, than: { ok: false, error: "gui_that_bai", message: e.message } };
        }
      }
    },

    // HANG CHO GUI — OMI may truc keo ve, go bang automation, bao lai.
    {
      method: "GET", path: "/api/hop-thu/cho-gui", quyen: "quan-tri",
      hanGoi: { soLan: 600, trongMs: PHUT10 },
      tay: async (ctx) => {
        const so = choGui.donDep((await ctx.cong.kho.so(SO_CHO_GUI).doc(null)) ?? choGui.soMacDinh(), ctx.cong.gio.bayGio());
        return {
          ma: 200, tieuDe: { "Cache-Control": "no-store" },
          than: { ok: true, tomTat: choGui.tomTat(so), muc: so.muc.slice(-200) }
        };
      }
    },
    {
      method: "POST", path: "/api/hop-thu/cho-gui/nhan", quyen: "quan-tri",
      hanGoi: { soLan: 1200, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const ai = duocKeoHangCho(ctx, yc);
        if (!ai.duoc) return { ma: 403, than: { ok: false, error: "khong_phai_may_truc", message: "Chỉ máy trực mới được gửi tin cho kênh này. Đổi máy trực ở trang quản lý máy trên Xeon." } };
        const than = await yc.doc();
        const kenh = String(than.kenh || "");
        if (kenh && !KENH_OMI.includes(kenh)) return { ma: 400, than: { ok: false, error: "kenh_khong_hop_le", kenhHopLe: KENH_OMI } };
        const gioiHan = Math.max(1, Math.min(50, Number(than.gioiHan) || 10));
        let ra = [];
        await ctx.cong.kho.so(SO_CHO_GUI).capNhat((cu) => {
          const so = cu ?? choGui.soMacDinh();
          ra = choGui.nhan(so, { kenh, boi: ai.ten, gioiHan }, ctx.cong.gio.bayGio());
          return so;
        }, choGui.soMacDinh());
        return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true, tin: ra, nhanSongGiay: Math.round(choGui.NHAN_SONG_MS / 1000) } };
      }
    },
    {
      method: "POST", path: "/api/hop-thu/cho-gui/xong", quyen: "quan-tri",
      hanGoi: { soLan: 1200, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const id = String(than.id || "");
        if (!id) return { ma: 400, than: { ok: false, error: "thieu_id" } };
        let muc = null;
        await ctx.cong.kho.so(SO_CHO_GUI).capNhat((cu) => {
          const so = cu ?? choGui.soMacDinh();
          muc = choGui.xong(so, { id, ok: than.ok === true, loi: than.loi }, ctx.cong.gio.bayGio());
          return so;
        }, choGui.soMacDinh());
        if (!muc) return { ma: 404, than: { ok: false, error: "khong_thay_hoac_khong_dang_gui" } };
        if (muc.trangThai === "da-gui") {
          ctx.bus.phat(SU_KIEN.tin_nhan_di, { kenh: muc.kenh, nguoi: muc.nguoi, chu: muc.chu, luc: muc.guiLuc, boi: muc.boi });
        }
        return { ma: 200, than: { ok: true, trangThai: muc.trangThai, thuLai: muc.thuLai } };
      }
    },

    // CAN NGUOI THAT — bo nao co y KHONG tra loi (handoff) thi bao ve day; OMI hien danh sach.
    {
      method: "POST", path: "/api/hop-thu/can-nguoi", quyen: "dich-vu",
      hanGoi: { soLan: 600, trongMs: PHUT10 },
      hanThan: 8 * 1024,
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const maHoiThoai = String(than.maHoiThoai || "").trim().slice(0, 160);
        if (!maHoiThoai) return { ma: 400, than: { ok: false, error: "thieu_ma_hoi_thoai" } };
        const luc = ctx.cong.gio.bayGio().toISOString();
        const muc = {
          maHoiThoai, kenh: String(than.kenh || "").slice(0, 40), nguoi: String(than.nguoi || "").slice(0, 120),
          lyDo: String(than.lyDo || "").slice(0, 300), tinCuoi: String(than.tinCuoi || "").slice(0, 500),
          baoLuc: luc, xongLuc: ""
        };
        await ctx.cong.kho.so(SO_CAN_NGUOI).capNhat((cu) => {
          const ds = Array.isArray(cu?.muc) ? cu.muc.filter((m) => m.maHoiThoai !== maHoiThoai) : [];
          ds.push(muc);
          return { version: 1, muc: ds.slice(-GIU_CAN_NGUOI), updatedAt: luc };
        }, { version: 1, muc: [] });
        ctx.cong.nhatKy.tin(`[hop-thu] can nguoi that: ${maHoiThoai} (${muc.lyDo || "khong ghi ly do"})`);
        return { ma: 200, than: { ok: true } };
      }
    },
    {
      method: "GET", path: "/api/hop-thu/can-nguoi", quyen: "quan-tri",
      hanGoi: { soLan: 600, trongMs: PHUT10 },
      tay: async (ctx) => {
        const so = (await ctx.cong.kho.so(SO_CAN_NGUOI).doc(null)) ?? { muc: [] };
        const muc = (so.muc ?? []).filter((m) => !m.xongLuc);
        return { ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true, muc, soDangCho: muc.length } };
      }
    },
    {
      method: "POST", path: "/api/hop-thu/can-nguoi/xong", quyen: "quan-tri",
      hanGoi: { soLan: 600, trongMs: PHUT10 },
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const maHoiThoai = String(than.maHoiThoai || "").trim();
        let thay = false;
        await ctx.cong.kho.so(SO_CAN_NGUOI).capNhat((cu) => {
          const ds = Array.isArray(cu?.muc) ? cu.muc : [];
          for (const m of ds) if (m.maHoiThoai === maHoiThoai && !m.xongLuc) { m.xongLuc = ctx.cong.gio.bayGio().toISOString(); thay = true; }
          return { version: 1, muc: ds, updatedAt: ctx.cong.gio.bayGio().toISOString() };
        }, { version: 1, muc: [] });
        return thay ? { ma: 200, than: { ok: true } } : { ma: 404, than: { ok: false, error: "khong_thay" } };
      }
    },

    // Cau hinh cua shop: nguong tin cu (gio). Shop chinh trong OMI.
    {
      method: "GET", path: "/api/hop-thu/cau-hinh", quyen: "quan-tri",
      hanGoi: { soLan: 120, trongMs: PHUT10 },
      tay: async (ctx) => ({ ma: 200, tieuDe: { "Cache-Control": "no-store" }, than: { ok: true, cauHinh: await docCauHinh(ctx), kenhOmi: KENH_OMI } })
    },
    {
      method: "POST", path: "/api/hop-thu/cau-hinh", quyen: "quan-tri",
      hanGoi: { soLan: 60, trongMs: PHUT10 },
      hanThan: 4 * 1024,
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        const n = Number(than.nguongTinCuGio);
        if (!Number.isFinite(n) || n < 1 || n > 24 * 30) return { ma: 400, than: { ok: false, error: "nguong_khong_hop_le", message: "Ngưỡng tin cũ phải từ 1 giờ đến 720 giờ." } };
        const moi = { ...(await docCauHinh(ctx)), nguongTinCuGio: n };
        await ctx.cong.kho.so(SO_CAU_HINH).ghi(moi);
        return { ma: 200, than: { ok: true, cauHinh: moi } };
      }
    }
  ],

  // Bot duoc doc hop thu, KHONG duoc tu y gui thay nguoi ban hang o day —
  // duong gui la dich vu co kiem quyen ben tren.
  congCuBot: [
    { ten: "doc_hop_thu", moTa: "Doc cac tin gan nhat cua mot khach", hieuUng: "doc" }
  ]
};

module.exports.KENH_OMI = KENH_OMI;
module.exports.SO_CHO_GUI = SO_CHO_GUI;
