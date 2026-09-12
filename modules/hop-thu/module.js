// MODULE HOP THU DA KENH — mang "chatbot", chay tren server cua khach.
//
// Viec cua no: nhan tin tu Meta, giu lai, phat len bang tin, va gui tin di khi co nguoi
// (bo nao, hay nguoi that trong OMI) nho gui.
//
// No KHONG biet tra loi khach nhu the nao — do la viec cua bo nao tren Xeon. O day chi co
// duong day va hop thu. Nho vay tat bo nao thi tin van vao hop thu, khong mat.
//
// Zalo va TikTok: chua co o ban landing hien tai, se them vao chinh module nay (cung mot
// hinh dang `tin`), khong de ra module rieng.

"use strict";

const { SU_KIEN } = require("../../../hop-dong");
const { chuKyDung, bocTinNhan, guiTinFacebook } = require("./graph");

const SO_TIN = "hop-thu-den";          // nhat ky tho de Desk keo ve (giu tuong thich ban dang chay)
const HAN_THAN = 256 * 1024;           // Meta khong gui goi lon hon
const GIU_TOI_DA = 500;                // cat bot cho khoi phinh so

function soTin(ctx) { return ctx.cong.kho.so(SO_TIN); }
function soMacDinh() { return { version: 1, events: [], updatedAt: "" }; }

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
    return { version: 1, events: events.slice(-GIU_TOI_DA), updatedAt: luc };
  }, soMacDinh());

  // Chi phat len bang tin khi da xac minh that. Bo nao nghe su kien nay de tra loi khach.
  if (daXacMinh) {
    for (const tin of bocTinNhan(goi)) {
      ctx.bus.phat(SU_KIEN.tin_nhan_den, tin);
      daySangBoNao(ctx, tin);
    }
  }
  return { ma: 200, than: { ok: true, daXacMinh } };
}

/**
 * Day tin sang bo nao tren Xeon.
 *
 * KHONG CHO ket qua, va loi o day KHONG duoc chan cau tra loi 200 cho Meta: Meta gui lai
 * moi phan hoi khac 2xx, nen bo nao chet la Meta gui lai vo han va hop thu day rac. Tin da
 * nam trong so roi — bo nao song lai thi keo ve duoc.
 */
function daySangBoNao(ctx, tin) {
  const { diaChi, ma, tenant } = ctx.cauHinh.boNao ?? {};
  if (!diaChi) return;                       // chua noi bo nao: hop thu van chay binh thuong
  const goc = String(diaChi).replace(/\/+$/, "");
  Promise.resolve()
    .then(() => ctx.cong.httpNgoai.goi(`${goc}/tin-den`, {
      method: "POST",
      hanMs: 8000,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ma}` },
      body: JSON.stringify({
        tenant: String(tenant || ""),
        kenh: tin.kenh, nguoi: tin.nguoi, chu: tin.chu, soAnh: tin.soAnh,
        maTin: tin.maTin, maHoiThoai: `${tin.kenh}:${tin.nguoi}`, luc: tin.luc
      })
    }))
    .then((tl) => { if (!tl.ok) ctx.cong.nhatKy.canhBao(`[hop-thu] bo nao tu choi tin: HTTP ${tl.status}`); })
    .catch((e) => ctx.cong.nhatKy.canhBao(`[hop-thu] khong day duoc tin sang bo nao: ${e?.message || e}`));
}

module.exports = {
  id: "hop-thu",
  ten: "Hộp thư đa kênh",
  mang: "chatbot",
  chay: "server-khach",
  phienBan: "0.1.0",
  canCong: ["kho", "nhatKy", "gio", "httpNgoai", "bus", "cauHinh"],

  suKien: {
    phat: [SU_KIEN.tin_nhan_den, SU_KIEN.tin_nhan_di],
    nghe: {}
  },

  // Bo nao goi hai dich vu nay qua API cua server khach (xem `duong` ben duoi).
  capDichVu: {
    /** Gui tin cho khach. Dung cho bo nao va cho nguoi that trong OMI. */
    "hop-thu.guiTin": async (ctx, { kenh = "facebook", nguoi, chu }) => {
      if (kenh !== "facebook") throw new Error(`Kenh "${kenh}" chua co o ban nay.`);
      const kq = await guiTinFacebook({
        httpNgoai: ctx.cong.httpNgoai,
        tokenTrang: ctx.cauHinh.tokenTrang,
        nguoi, chu
      });
      ctx.bus.phat(SU_KIEN.tin_nhan_di, { kenh, nguoi, chu, luc: ctx.cong.gio.bayGio().toISOString() });
      return kq;
    }
  },

  duong: [
    // Meta goi de xac nhan dia chi webhook. Thieu verify token = tu choi (fail-closed).
    {
      method: "GET", path: "/api/facebook/webhook", quyen: "cong-khai",
      viSaoCongKhai: "Meta goi tu may cua ho, khong mang ma cua shop. Tu bao ve bang verify token: sai la 403.",
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
      tay: nhanWebhook
    },

    // Desk keo tin ve (giu nguyen duong cu de ban dang chay khong gay khi chuyen sang).
    {
      method: "GET", path: "/api/facebook/webhook-inbox", quyen: "quan-tri",
      tay: async (ctx, yc) => {
        const so = (await soTin(ctx).doc(soMacDinh())) ?? soMacDinh();
        const tu = String(yc.truyVan.since ?? "");
        const gioiHan = Math.min(Number(yc.truyVan.limit ?? 100) || 100, GIU_TOI_DA);
        const events = so.events.filter((e) => !tu || e.eventId > tu).slice(0, gioiHan);
        return {
          ma: 200,
          tieuDe: { "Cache-Control": "no-store" },
          than: { ok: true, events, cursor: events.length ? events[events.length - 1].eventId : tu, updatedAt: so.updatedAt }
        };
      }
    },

    // Bo nao tren Xeon goi duong nay de tra loi khach.
    {
      method: "POST", path: "/api/hop-thu/gui", quyen: "dich-vu",
      tay: async (ctx, yc) => {
        const than = await yc.doc();
        try {
          const kq = await module.exports.capDichVu["hop-thu.guiTin"](ctx, than);
          return { ma: 200, than: { ok: true, ketQua: kq } };
        } catch (e) {
          ctx.cong.nhatKy.canhBao(`[hop-thu] gui tin that bai: ${e.message}`);
          return { ma: 502, than: { ok: false, error: "gui_that_bai", message: e.message } };
        }
      }
    }
  ],

  // Bot duoc doc hop thu, KHONG duoc tu y gui thay nguoi ban hang o day —
  // duong gui la dich vu co kiem quyen ben tren.
  congCuBot: [
    { ten: "doc_hop_thu", moTa: "Doc cac tin gan nhat cua mot khach", hieuUng: "doc" }
  ]
};
