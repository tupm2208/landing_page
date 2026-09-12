// NOI CHUYEN VOI META GRAPH API — doc chu ky, doc tin, gui tin.
//
// Tep nay KHONG tu goi mang: no nhan `httpNgoai` tu ngoai vao. Nho vay bai kiem tra chay
// het duong gui tin ma khong goi Meta that mot lan nao.
//
// Khac biet so voi ban dang chay: landing hom nay chi la HOP THU TRUNG CHUYEN (khong giu
// APP_SECRET, khong tu tra loi; Desk moi verify chu ky va tra loi). Anh Dung chot 12/09:
// server cua khach se TU tra loi bang Graph API. Nen o day co them phan verify HMAC va gui
// tin — nhung van giu duoc che do trung chuyen cu: khong co APP_SECRET thi hanh xu y het
// ban dang chay (chi kiem hinh dang, khong tu tra loi).

"use strict";

const crypto = require("crypto");

const PHIEN_BAN_GRAPH = "v21.0";

/**
 * Kiem chu ky X-Hub-Signature-256 tren RAW BYTE (khong phai tren JSON da doc lai —
 * doc lai roi JSON.stringify la doi byte, chu ky se khong bao gio khop).
 */
function chuKyDung(rawBody, chuKy, appSecret) {
  const s = String(chuKy || "").trim();
  if (!s.startsWith("sha256=") || !appSecret) return false;
  const nhan = Buffer.from(s.slice("sha256=".length), "hex");
  const tinh = crypto.createHmac("sha256", appSecret).update(rawBody).digest();
  if (nhan.length !== tinh.length) return false;
  return crypto.timingSafeEqual(nhan, tinh);
}

/**
 * Boc tin nhan tu goi webhook cua Meta.
 * Chi lay thu dung duoc; goi la cua trang khac hay khong phai tin nhan thi bo qua.
 */
function bocTinNhan(goi) {
  const ra = [];
  if (!goi || goi.object !== "page" || !Array.isArray(goi.entry)) return ra;
  for (const e of goi.entry) {
    const trang = String(e?.id ?? "");
    for (const m of e?.messaging ?? []) {
      const nguoi = String(m?.sender?.id ?? "");
      // Tin do CHINH TRANG gui di (echo) — khong duoc coi la khach nhan tin, neu khong
      // bot se tra loi chinh no va thanh vong lap.
      if (!nguoi || nguoi === trang || m?.message?.is_echo) continue;
      const chu = String(m?.message?.text ?? "").trim();
      const anh = (m?.message?.attachments ?? []).filter((a) => a?.type === "image").length;
      if (!chu && anh === 0) continue;
      ra.push({
        kenh: "facebook",
        trang,
        nguoi,
        maTin: String(m?.message?.mid ?? ""),
        chu,
        soAnh: anh,
        luc: new Date(Number(m?.timestamp ?? Date.now())).toISOString()
      });
    }
  }
  return ra;
}

/** Gui mot tin cho khach qua Graph API. Nem khi Meta tra loi that bai. */
async function guiTinFacebook({ httpNgoai, tokenTrang, nguoi, chu, phienBan = PHIEN_BAN_GRAPH }) {
  if (!tokenTrang) throw new Error("Chua co token trang — khong gui tin duoc.");
  if (!nguoi) throw new Error("Thieu nguoi nhan.");
  const noiDung = String(chu ?? "").trim();
  if (!noiDung) throw new Error("Tin rong — khong gui.");

  const url = `https://graph.facebook.com/${phienBan}/me/messages?access_token=${encodeURIComponent(tokenTrang)}`;
  const tl = await httpNgoai.goi(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: nguoi }, messaging_type: "RESPONSE", message: { text: noiDung } })
  });
  if (!tl.ok) {
    const chiTiet = await tl.text().catch(() => "");
    throw new Error(`Meta tu choi gui tin (${tl.status}): ${chiTiet.slice(0, 300)}`);
  }
  return tl.json();
}

module.exports = { chuKyDung, bocTinNhan, guiTinFacebook, PHIEN_BAN_GRAPH };
