// DOC/GHI HANG HOA TREN BANG — lop dich giua bang MySQL va hinh dang mon ma phan con lai
// cua module dang dung (`chuan-hoa.js` khong doi mot dong).
//
// Ba nguon hang — hang nha, chien dich doi tac, hang co san — deu la DONG trong cung bang
// `hang_kho_bien_the`, chi khac cot `nguon`. Vi vay khong con ham "gop" nao ca: doc ra la
// da gop san. Dong bo mot nguon chi dung toi dong cua chinh nguon do.

"use strict";

const { chuanHoaMon, maBienThe, thuTuKho, khoaKho, soDuongDauTien, danhSachChuoi } = require("./chuan-hoa");

const B_MON = "hang_kho_mon";
const B_BIEN_THE = "hang_kho_bien_the";
const B_CHAN = "hang_kho_ma_chan";
const B_GIU = "hang_kho_giu_cho";

const NGUON = { nha: "own", chienDich: "campaign", coSan: "ready" };

function gioMySQL(d) {
  return new Date(d).toISOString().slice(0, 23).replace("T", " ");
}

function doc(chu, macDinh) {
  if (chu === null || chu === undefined || chu === "") return macDinh;
  try { return JSON.parse(chu); } catch { return macDinh; }
}

/** Mot mon da chuan hoa -> hai nhom dong de ghi xuong bang. */
function monThanhDong(mon, nguon, luc) {
  const dongMon = {
    ma: mon.code,
    ma_goc: mon.originalCode || mon.code,
    ten: mon.name,
    hang: mon.brand || "",
    loai: mon.productKind || "",
    nhom: mon.category || "",
    gioi_tinh: mon.gender || "",
    duong_dan: mon.slug || "",
    gia_niem_yet: mon.listPrice || 0,
    phan_tram_giam: mon.discountPercent || 0,
    trang_thai: mon.status || "orderable",
    vi_sao_an: mon.hiddenReason || "",
    anh_dai_dien: mon.thumbnailImage || "",
    anh_lon: mon.highImage || "",
    anh_khac_json: JSON.stringify(mon.galleryImages ?? []),
    mo_ta_ngan: mon.shortDescription || "",
    mo_ta: mon.description || "",
    uu_tien_kho_json: JSON.stringify(danhSachChuoi(mon.warehousePriorityIds)),
    nguon,
    ten_nguon: mon.sourceName || "",
    sua_luc: luc
  };

  const dongBienThe = (Array.isArray(mon.sizes) ? mon.sizes : []).map((d) => {
    const maKho = String(d.warehouseId || "").trim() || khoaKho(d.warehouse || d.warehouseName);
    return {
      ma_bien_the: maBienThe(mon, d),
      ma_mon: mon.code,
      size: String(d.size || "").trim(),
      ma_kho: maKho,
      ton: Math.max(0, Math.trunc(Number(d.qty ?? d.available ?? d.stockQty ?? 0))),
      gia: soDuongDauTien(d.suggestedPrice, d.salePrice, d.sellPrice, d.price),
      gia_niem_yet: soDuongDauTien(d.listPrice, d.originalPrice, mon.listPrice),
      thu_tu_kho: Math.min(thuTuKho(mon, d), 2147483647),
      nguon,
      ma_chien_dich: String(d.campaignId || mon.campaignId || "").trim(),
      ma_dong_doi_tac: String(d.partnerCampaignLineId || "").trim(),
      sua_luc: luc
    };
  }).filter((d) => d.size !== "");

  return { dongMon, dongBienThe };
}

/** Dong bang -> hinh dang mon ma `banCongKhai` va cac dich vu dang doc. */
function dongThanhMon(dongMon, cacBienThe, dangGiu = new Map()) {
  return {
    code: dongMon.ma,
    originalCode: dongMon.ma_goc || dongMon.ma,
    name: dongMon.ten,
    source: dongMon.nguon === NGUON.nha ? "own" : "partner",
    sourceName: dongMon.ten_nguon || "",
    brand: dongMon.hang || "",
    productKind: dongMon.loai || "",
    category: dongMon.nhom || "",
    gender: dongMon.gioi_tinh || "",
    slug: dongMon.duong_dan || "",
    listPrice: Number(dongMon.gia_niem_yet || 0),
    discountPercent: Number(dongMon.phan_tram_giam || 0),
    saleRatio: Number(dongMon.phan_tram_giam || 0) / 100,
    status: dongMon.trang_thai || "orderable",
    hiddenReason: dongMon.vi_sao_an || "",
    thumbnailImage: dongMon.anh_dai_dien || "",
    highImage: dongMon.anh_lon || "",
    galleryImages: doc(dongMon.anh_khac_json, []),
    shortDescription: dongMon.mo_ta_ngan || "",
    description: dongMon.mo_ta || "",
    warehousePriorityIds: doc(dongMon.uu_tien_kho_json, []),
    partnerCampaign: dongMon.nguon === NGUON.chienDich,
    // Gia mon = gia NHO NHAT trong cac bien the con hang (giu dung luat ban dang chay).
    price: (() => {
      const gia = cacBienThe.filter((d) => Number(d.ton || 0) > 0).map((d) => Number(d.gia || 0)).filter((g) => g > 0);
      const moi = cacBienThe.map((d) => Number(d.gia || 0)).filter((g) => g > 0);
      return gia.length ? Math.min(...gia) : (moi.length ? Math.min(...moi) : 0);
    })(),
    get suggestedPrice() { return this.price; },
    get salePrice() { return this.price; },
    sizes: cacBienThe.map((d) => ({
      variantId: d.ma_bien_the,
      size: d.size,
      // Tru so dang bi giu cho: hang da co nguoi giu thi khach sau khong duoc thay la con.
      qty: Math.max(0, Number(d.ton || 0) - (dangGiu.get(d.ma_bien_the) ?? 0)),
      price: Number(d.gia || 0),
      listPrice: Number(d.gia_niem_yet || 0),
      warehouseId: d.ma_kho || "",
      warehouse: d.ma_kho || "",
      selectionRank: Number(d.thu_tu_kho ?? 2147483647),
      ...(d.nguon === NGUON.coSan ? { stockMode: "ready" } : {}),
      partnerCampaignLineId: d.ma_dong_doi_tac || ""
    }))
  };
}

function taoKhoHang(ctx) {
  const kho = ctx.cong.kho;
  const bayGio = () => gioMySQL(ctx.cong.gio.bayGio());

  /** Tong dang giu cho theo bien the (phieu con han). */
  async function dangGiuTheoBienThe(maBienTheList = null) {
    const dieuKien = { het_han_luc: { ">": bayGio() } };
    if (maBienTheList) dieuKien.ma_bien_the = maBienTheList;
    const dong = await kho.bang(B_GIU).tim({ dieuKien });
    const m = new Map();
    for (const d of dong) m.set(d.ma_bien_the, (m.get(d.ma_bien_the) ?? 0) + Number(d.so_luong || 0));
    return m;
  }

  async function maBiChan() {
    const tuCauHinh = [
      ...(Array.isArray(ctx.cauHinh.maChanSan) ? ctx.cauHinh.maChanSan : []),
      ...String(ctx.cauHinh.maChanThem || "").split(",")
    ].map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
    const dong = await kho.bang(B_CHAN).tim({});
    return new Set([...tuCauHinh, ...dong.map((d) => String(d.ma || "").toLowerCase())]);
  }

  /** Doc mot mon (ban trong nha). `null` neu khong co hoac bi chan. */
  async function docMon(khoaTim) {
    const chu = String(khoaTim || "").trim();
    if (!chu) return null;
    let dongMon = await kho.bang(B_MON).mot({ ma: chu });
    if (!dongMon) dongMon = await kho.bang(B_MON).mot({ duong_dan: chu.toLowerCase() });
    if (!dongMon) return null;
    if ((await maBiChan()).has(String(dongMon.ma).toLowerCase())) return null;

    const bienThe = await kho.bang(B_BIEN_THE).tim({ dieuKien: { ma_mon: dongMon.ma }, sapXep: ["gia asc", "thu_tu_kho asc"] });
    return dongThanhMon(dongMon, bienThe, await dangGiuTheoBienThe(bienThe.map((d) => d.ma_bien_the)));
  }

  /**
   * Tim mon theo ma hoac ten — mot cau lenh, khong nap ca danh muc.
   * Ma dung truoc, roi ma bat dau bang, roi ten chua tu khoa.
   */
  async function timMon(tuKhoa, gioiHan = 10) {
    const chu = String(tuKhoa || "").trim();
    // Khong co tu khoa = ca danh muc (web ban hang can). Van co tran: 2.314 ma la mot goi
    // lon, va khong co tran thi mot ngay nao do danh muc lon len va khong ai nhan ra.
    if (!chu) return docTatCa(Number(gioiHan) || 5000);
    const n = Math.min(Math.max(1, Number(gioiHan) || 10), 50);
    const [dong] = await kho.cauLenh(
      `SELECT *,
              CASE WHEN LOWER(ma) = LOWER(?) THEN 100
                   WHEN LOWER(ma) LIKE CONCAT(LOWER(?), '%') THEN 80
                   WHEN LOWER(ten) LIKE CONCAT('%', LOWER(?), '%') THEN 60
                   ELSE 0 END AS diem
         FROM ${B_MON}
        HAVING diem > 0
        ORDER BY diem DESC, ten ASC
        LIMIT ?`,
      [chu, chu, chu, n]
    );
    const cacMaChan = await maBiChan();
    const giu = await dangGiuTheoBienThe();
    const ra = [];
    for (const dm of dong) {
      if (cacMaChan.has(String(dm.ma).toLowerCase())) continue;
      const bt = await kho.bang(B_BIEN_THE).tim({ dieuKien: { ma_mon: dm.ma }, sapXep: ["gia asc", "thu_tu_kho asc"] });
      ra.push(dongThanhMon(dm, bt, giu));
    }
    return ra;
  }

  /** Ca danh muc (da bo ma bi chan, da tru cho giu). Co tran de khong bao gio tra vo han. */
  async function docTatCa(gioiHan = 5000) {
    const n = Math.min(Math.max(1, Number(gioiHan) || 5000), 20000);
    const dongMon = await kho.bang(B_MON).tim({ sapXep: "ten asc", gioiHan: n });
    if (dongMon.length === 0) return [];

    const cacMaChan = await maBiChan();
    const giu = await dangGiuTheoBienThe();
    // Mot cau lenh lay het bien the cua tung ay mon — khong hoi vong tung mon mot.
    const bienThe = await kho.bang(B_BIEN_THE).tim({
      dieuKien: { ma_mon: dongMon.map((d) => d.ma) },
      sapXep: ["gia asc", "thu_tu_kho asc"]
    });
    const theoMon = new Map();
    for (const d of bienThe) {
      if (!theoMon.has(d.ma_mon)) theoMon.set(d.ma_mon, []);
      theoMon.get(d.ma_mon).push(d);
    }
    return dongMon
      .filter((dm) => !cacMaChan.has(String(dm.ma).toLowerCase()))
      .map((dm) => dongThanhMon(dm, theoMon.get(dm.ma) ?? [], giu));
  }

  /** Cac dong con hang cua mot mon, da tru so dang giu cho. */
  async function tonCuaMon(ma, size = "") {
    const mon = await docMon(ma);
    if (!mon) return null;
    const muon = String(size || "").trim().toLowerCase();
    const cacDong = mon.sizes
      .filter((d) => Number(d.qty || 0) > 0)
      .filter((d) => !muon || String(d.size).toLowerCase() === muon)
      .map((d) => ({
        maBienThe: d.variantId, size: d.size, soLuong: Number(d.qty || 0),
        gia: Number(d.price || 0), maKho: d.warehouseId, thuTu: Number(d.selectionRank ?? 2147483647)
      }))
      .sort((a, b) => (a.gia || Number.MAX_SAFE_INTEGER) - (b.gia || Number.MAX_SAFE_INTEGER) || a.thuTu - b.thuTu);
    return { ma: mon.code, ten: mon.name, cacDong };
  }

  /**
   * Thay TOAN BO hang cua mot nguon. Trong MOT giao dich: hong giua chung thi danh muc cu
   * con nguyen, khong bao gio co trang thai "mat nua danh muc".
   */
  async function thayNguon(nguon, cacMonTho) {
    const luc = bayGio();
    const cacMaChan = await maBiChan();
    const mon = (Array.isArray(cacMonTho) ? cacMonTho : [])
      .map(chuanHoaMon).filter(Boolean)
      // Chan ma o dau GHI, khong chi o dau doc.
      .filter((m) => !cacMaChan.has(String(m.code).toLowerCase())
        && !cacMaChan.has(String(m.originalCode || "").toLowerCase()));

    const dongMon = [];
    // Ma bien the = bam(ma mon + kho + size). Hai dong cung bo ba do ra CUNG mot ma — o ban
    // tep chung song chung nen khong ai thay, o bang thi trung khoa chinh va CA DOT DAY
    // DANH MUC HONG. Mot dong du lieu xau khong duoc phep giet ca danh muc.
    // Xu: giu dong GIA THAP hon (gia mon von la gia nho nhat), va GHI CANH BAO de nguoi
    // van hanh biet ma sua nguon.
    const theoMa = new Map();
    const trung = [];
    for (const m of mon) {
      const x = monThanhDong(m, nguon, luc);
      dongMon.push(x.dongMon);
      for (const d of x.dongBienThe) {
        const cu2 = theoMa.get(d.ma_bien_the);
        if (!cu2) { theoMa.set(d.ma_bien_the, d); continue; }
        trung.push(`${d.ma_mon} size ${d.size} kho ${d.ma_kho}`);
        if (Number(d.gia || 0) > 0 && (Number(cu2.gia || 0) === 0 || Number(d.gia) < Number(cu2.gia))) {
          theoMa.set(d.ma_bien_the, d);
        }
      }
    }
    const dongBienThe = [...theoMa.values()];
    if (trung.length > 0) {
      ctx.cong.nhatKy.canhBao(
        `[hang-kho] ${trung.length} dong bi trung (cung mon + size + kho), da giu dong gia thap hon: ` +
        `${trung.slice(0, 5).join("; ")}${trung.length > 5 ? "..." : ""}`
      );
    }

    await kho.giaoDich(async (trong) => {
      await trong.bang(B_BIEN_THE).xoa({ nguon });
      await trong.bang(B_MON).xoa({ nguon });
      if (dongMon.length) await trong.bang(B_MON).themNhieu(dongMon);
      if (dongBienThe.length) await trong.bang(B_BIEN_THE).themNhieu(dongBienThe);
    });

    return { soMon: dongMon.length, soBienThe: dongBienThe.length, biBo: (cacMonTho?.length ?? 0) - dongMon.length };
  }

  return {
    NGUON, B_MON, B_BIEN_THE, B_CHAN, B_GIU,
    docMon, timMon, docTatCa, tonCuaMon, thayNguon, maBiChan, dangGiuTheoBienThe, bayGio,
    bang: (ten) => kho.bang(ten),
    giaoDich: (viec) => kho.giaoDich(viec)
  };
}

module.exports = { taoKhoHang, monThanhDong, dongThanhMon, NGUON, B_MON, B_BIEN_THE, B_CHAN, B_GIU, gioMySQL };
