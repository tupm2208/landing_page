// size-chart-kit.js - Bang quy doi size giay theo tung hang (copy Y HET o TopRun + Dasbui).
// Quy tac 2026-08-13: ket qua quy doi CHI dung cho bo loc va bang tra cuu hien thi.
// Size goc cua hang la su that duy nhat tren san pham / don hang / day mua doi tac;
// cam ghi size da quy doi vao don. Quy doi sai => toi da chi lech ket qua loc.
// Gioi tinh: campaign khong co field gender nhung TEN san pham co ("Giay Chay Bo Nu
// HOKA...") -> inferShoeGender() suy tu ten. Nhan don "US 6" tren hang NU dung bang
// womenRows (US nu lech US nam 1-1.5 size). Nhan doi "US 10/11" (nam/nu cung doi
// giay unisex) luon lay ve NAM (so dau tien) tren bang nam - EU van dung vat ly.
// Mizuno/Puma ghi nhan UK: UK->EU khong phan biet gioi tinh nen dung chung bang.
(function (root) {
  "use strict";

  // Bang size tung hang - doi chieu trang chinh hang + RunRepeat/GetSize 2026-08-12.
  // rows = bang NAM; womenRows = bang NU (chi can cho hang ghi nhan US tren hang nu).
  // eu de dang CHUOI de khop nguyen van voi size EU adidas trong kho ("44", "42 2/3").
  const BRAND_SHOE_CHARTS = {
    adidas: {
      label: "adidas",
      rows: [
        { us: 4, uk: 3.5, eu: "36" },
        { us: 4.5, uk: 4, eu: "36 2/3" },
        { us: 5, uk: 4.5, eu: "37 1/3" },
        { us: 5.5, uk: 5, eu: "38" },
        { us: 6, uk: 5.5, eu: "38 2/3" },
        { us: 6.5, uk: 6, eu: "39 1/3" },
        { us: 7, uk: 6.5, eu: "40" },
        { us: 7.5, uk: 7, eu: "40 2/3" },
        { us: 8, uk: 7.5, eu: "41 1/3" },
        { us: 8.5, uk: 8, eu: "42" },
        { us: 9, uk: 8.5, eu: "42 2/3" },
        { us: 9.5, uk: 9, eu: "43 1/3" },
        { us: 10, uk: 9.5, eu: "44" },
        { us: 10.5, uk: 10, eu: "44 2/3" },
        { us: 11, uk: 10.5, eu: "45 1/3" },
        { us: 11.5, uk: 11, eu: "46" },
        { us: 12, uk: 11.5, eu: "46 2/3" },
        { us: 12.5, uk: 12, eu: "47 1/3" },
        { us: 13, uk: 12.5, eu: "48" },
        { us: 13.5, uk: 13, eu: "48 2/3" },
        { us: 14, uk: 13.5, eu: "49 1/3" }
      ]
    },
    hoka: {
      // HOKA dung he EU chia 1/3 giong adidas (nguon: hoka.com sizing information).
      label: "HOKA",
      rows: [
        { us: 5, eu: "37 1/3" },
        { us: 5.5, eu: "38" },
        { us: 6, eu: "38 2/3" },
        { us: 6.5, eu: "39 1/3" },
        { us: 7, eu: "40" },
        { us: 7.5, eu: "40 2/3" },
        { us: 8, eu: "41 1/3" },
        { us: 8.5, eu: "42" },
        { us: 9, eu: "42 2/3" },
        { us: 9.5, eu: "43 1/3" },
        { us: 10, eu: "44" },
        { us: 10.5, eu: "44 2/3" },
        { us: 11, eu: "45 1/3" },
        { us: 11.5, eu: "46" },
        { us: 12, eu: "46 2/3" },
        { us: 12.5, eu: "47 1/3" },
        { us: 13, eu: "48" },
        { us: 14, eu: "49 1/3" }
      ],
      womenRows: [
        { us: 5, eu: "36" },
        { us: 5.5, eu: "36 2/3" },
        { us: 6, eu: "37 1/3" },
        { us: 6.5, eu: "38" },
        { us: 7, eu: "38 2/3" },
        { us: 7.5, eu: "39 1/3" },
        { us: 8, eu: "40" },
        { us: 8.5, eu: "40 2/3" },
        { us: 9, eu: "41 1/3" },
        { us: 9.5, eu: "42" },
        { us: 10, eu: "42 2/3" },
        { us: 10.5, eu: "43 1/3" },
        { us: 11, eu: "44" }
      ]
    },
    nike: {
      label: "Nike",
      rows: [
        { us: 6, uk: 5.5, eu: "38.5" },
        { us: 6.5, uk: 6, eu: "39" },
        { us: 7, uk: 6, eu: "40" },
        { us: 7.5, uk: 6.5, eu: "40.5" },
        { us: 8, uk: 7, eu: "41" },
        { us: 8.5, uk: 7.5, eu: "42" },
        { us: 9, uk: 8, eu: "42.5" },
        { us: 9.5, uk: 8.5, eu: "43" },
        { us: 10, uk: 9, eu: "44" },
        { us: 10.5, uk: 9.5, eu: "44.5" },
        { us: 11, uk: 10, eu: "45" },
        { us: 11.5, uk: 10.5, eu: "45.5" },
        { us: 12, uk: 11, eu: "46" },
        { us: 12.5, uk: 11.5, eu: "47" },
        { us: 13, uk: 12, eu: "47.5" },
        { us: 14, uk: 13, eu: "48.5" },
        { us: 15, uk: 14, eu: "49.5" }
      ]
    },
    asics: {
      label: "ASICS",
      rows: [
        { us: 7, uk: 6, eu: "40" },
        { us: 7.5, uk: 6.5, eu: "40.5" },
        { us: 8, uk: 7, eu: "41.5" },
        { us: 8.5, uk: 7.5, eu: "42" },
        { us: 9, uk: 8, eu: "42.5" },
        { us: 9.5, uk: 8.5, eu: "43.5" },
        { us: 10, uk: 9, eu: "44" },
        { us: 10.5, uk: 9.5, eu: "44.5" },
        { us: 11, uk: 10, eu: "45" },
        { us: 11.5, uk: 10.5, eu: "46" },
        { us: 12, uk: 11, eu: "46.5" },
        { us: 12.5, uk: 11.5, eu: "47" },
        { us: 13, uk: 12, eu: "48" },
        { us: 14, uk: 13, eu: "49" }
      ]
    },
    mizuno: {
      label: "Mizuno",
      rows: [
        { us: 6, uk: 5, eu: "38" },
        { us: 6.5, uk: 5.5, eu: "38.5" },
        { us: 7, uk: 6, eu: "39" },
        { us: 7.5, uk: 6.5, eu: "40" },
        { us: 8, uk: 7, eu: "40.5" },
        { us: 8.5, uk: 7.5, eu: "41" },
        { us: 9, uk: 8, eu: "42" },
        { us: 9.5, uk: 8.5, eu: "42.5" },
        { us: 10, uk: 9, eu: "43" },
        { us: 10.5, uk: 9.5, eu: "44" },
        { us: 11, uk: 10, eu: "44.5" },
        { us: 11.5, uk: 10.5, eu: "45" },
        { us: 12, uk: 11, eu: "46" },
        { us: 12.5, uk: 11.5, eu: "46.5" },
        { us: 13, uk: 12, eu: "47" }
      ]
    },
    puma: {
      label: "PUMA",
      rows: [
        { us: 4.5, uk: 3.5, eu: "36" },
        { us: 5, uk: 4, eu: "37" },
        { us: 5.5, uk: 4.5, eu: "37.5" },
        { us: 6, uk: 5, eu: "38" },
        { us: 6.5, uk: 5.5, eu: "38.5" },
        { us: 7, uk: 6, eu: "39" },
        { us: 7.5, uk: 6.5, eu: "40" },
        { us: 8, uk: 7, eu: "40.5" },
        { us: 8.5, uk: 7.5, eu: "41" },
        { us: 9, uk: 8, eu: "42" },
        { us: 9.5, uk: 8.5, eu: "42.5" },
        { us: 10, uk: 9, eu: "43" },
        { us: 10.5, uk: 9.5, eu: "44" },
        { us: 11, uk: 10, eu: "44.5" },
        { us: 11.5, uk: 10.5, eu: "45" },
        { us: 12, uk: 11, eu: "46" },
        { us: 13, uk: 12, eu: "47" }
      ]
    },
    "under armour": {
      label: "Under Armour",
      rows: [
        { us: 5, uk: 4, eu: "37.5" },
        { us: 5.5, uk: 4.5, eu: "38" },
        { us: 6, uk: 5, eu: "38.5" },
        { us: 6.5, uk: 5.5, eu: "39" },
        { us: 7, uk: 6, eu: "40" },
        { us: 7.5, uk: 6.5, eu: "40.5" },
        { us: 8, uk: 7, eu: "41" },
        { us: 8.5, uk: 7.5, eu: "42" },
        { us: 9, uk: 8, eu: "42.5" },
        { us: 9.5, uk: 8.5, eu: "43" },
        { us: 10, uk: 9, eu: "44" },
        { us: 10.5, uk: 9.5, eu: "44.5" },
        { us: 11, uk: 10, eu: "45" },
        { us: 11.5, uk: 10.5, eu: "45.5" },
        { us: 12, uk: 11, eu: "46" },
        { us: 12.5, uk: 11.5, eu: "47" },
        { us: 13, uk: 12, eu: "47.5" },
        { us: 13.5, uk: 12.5, eu: "48" },
        { us: 14, uk: 13, eu: "48.5" },
        { us: 15, uk: 14, eu: "49.5" },
        { us: 16, uk: 15, eu: "50.5" }
      ],
      womenRows: [
        { us: 5, eu: "35.5" },
        { us: 5.5, eu: "36" },
        { us: 6, eu: "36.5" },
        { us: 6.5, eu: "37" },
        { us: 7, eu: "38" },
        { us: 7.5, eu: "38.5" },
        { us: 8, eu: "39" },
        { us: 8.5, eu: "40" },
        { us: 9, eu: "40.5" },
        { us: 9.5, eu: "41" },
        { us: 10, eu: "42" },
        { us: 10.5, eu: "42.5" },
        { us: 11, eu: "43" }
      ]
    },
    columbia: {
      label: "Columbia",
      rows: [
        { us: 5, uk: 4, eu: "38" },
        { us: 5.5, uk: 4.5, eu: "38.5" },
        { us: 6, uk: 5, eu: "39" },
        { us: 6.5, uk: 5.5, eu: "39.5" },
        { us: 7, uk: 6, eu: "40" },
        { us: 7.5, uk: 6.5, eu: "40.5" },
        { us: 8, uk: 7, eu: "41" },
        { us: 8.5, uk: 7.5, eu: "41.5" },
        { us: 9, uk: 8, eu: "42" },
        { us: 9.5, uk: 8.5, eu: "42.5" },
        { us: 10, uk: 9, eu: "43" },
        { us: 10.5, uk: 9.5, eu: "43.5" },
        { us: 11, uk: 10, eu: "44" },
        { us: 11.5, uk: 10.5, eu: "44.5" },
        { us: 12, uk: 11, eu: "45" },
        { us: 13, uk: 12, eu: "46" },
        { us: 14, uk: 13, eu: "47" },
        { us: 15, uk: 14, eu: "48" }
      ],
      womenRows: [
        { us: 5, eu: "36" },
        { us: 5.5, eu: "36.5" },
        { us: 6, eu: "37" },
        { us: 6.5, eu: "37.5" },
        { us: 7, eu: "38" },
        { us: 7.5, eu: "38.5" },
        { us: 8, eu: "39" },
        { us: 8.5, eu: "39.5" },
        { us: 9, eu: "40" },
        { us: 9.5, eu: "40.5" },
        { us: 10, eu: "41" },
        { us: 11, eu: "42" },
        { us: 12, eu: "43" }
      ]
    }
  };

  const BRAND_ALIASES = {
    "hoka one one": "hoka",
    ua: "under armour",
    underarmour: "under armour",
    "columbia sportswear": "columbia"
  };

  function chartKey(brand) {
    const key = String(brand || "").trim().toLowerCase();
    if (!key) return "";
    if (BRAND_SHOE_CHARTS[key]) return key;
    return BRAND_ALIASES[key] || "";
  }

  // "US 10" / "us10.5" / "UK 8" / "US 10/11" (nhan doi -> lay ve nam, dual=true)
  function parseShoeSizeLabel(label) {
    const text = String(label || "").trim().toUpperCase();
    const match = text.match(/^(US|UK)\s*(\d{1,2}(?:[.,]5)?)(\s*\/\s*\d{1,2}(?:[.,]5)?)?$/);
    if (!match) return null;
    return { system: match[1].toLowerCase(), value: Number(match[2].replace(",", ".")), dual: Boolean(match[3]) };
  }

  function isConvertibleShoeLabel(label) {
    return Boolean(parseShoeSizeLabel(label));
  }

  // Suy gioi tinh cho viec chon bang: field gender truoc, thieu thi doc TEN san pham
  // ("Giay Chay Bo Nu HOKA..."). Unisex/Nam/khong ro -> thang NAM (nhan doi lay ve nam).
  function inferShoeGender(item = {}) {
    const gender = String(item.gender || item._gender || "").trim().toUpperCase();
    if (gender === "WO" || gender === "WOMEN" || gender === "FEMALE" || gender === "NU" || gender === "NỮ") return "women";
    if (gender === "ME" || gender === "MEN" || gender === "MALE" || gender === "NAM" || gender === "UN" || gender === "UNISEX") return "men";
    const name = String(item.name || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
    if (/unisex/.test(name)) return "men";
    if (/(^|[^a-z])(nu|women|woman|wmns|female)([^a-z]|$)/.test(name)) return "women";
    return "men";
  }

  // Quy doi nhan US/UK ve size EU chuan de LOC. Tra "" neu khong phai nhan US/UK
  // hoac hang chua co bang -> noi goi giu nguyen nhan goc.
  // gender="women": nhan DON tra bang nu (womenRows); nhan DOI van la ve nam nen
  // luon tra bang nam. Hang khong co womenRows (Mizuno/Puma nhan UK dung chung
  // 2 gioi) -> roi ve bang nam.
  function euFilterSize(brand, label, gender) {
    const parsed = parseShoeSizeLabel(label);
    if (!parsed) return "";
    const key = chartKey(brand);
    if (!key) return "";
    const chart = BRAND_SHOE_CHARTS[key];
    const useWomen = gender === "women" && !parsed.dual && Array.isArray(chart.womenRows);
    const rows = useWomen ? chart.womenRows : chart.rows;
    const row = rows.find((entry) => Number(entry[parsed.system]) === parsed.value);
    return row ? String(row.eu) : "";
  }

  function sizeChartForBrand(brand) {
    const key = chartKey(brand);
    if (!key) return null;
    const chart = BRAND_SHOE_CHARTS[key];
    return {
      key,
      label: chart.label,
      rows: chart.rows.map((row) => ({ ...row })),
      womenRows: Array.isArray(chart.womenRows) ? chart.womenRows.map((row) => ({ ...row })) : null
    };
  }

  // ===== Modal "Xem bang quy doi size" (style inline de khong dung styles.css) =====
  const MODAL_ID = "size-chart-kit-modal";

  function closeSizeChartModal() {
    if (typeof document === "undefined") return;
    document.getElementById(MODAL_ID)?.remove();
  }

  function escapeText(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function chartTableHTML(rows, genderTag) {
    const columns = [
      { field: "eu", title: "EU" },
      { field: "us", title: `US (${genderTag})` },
      { field: "uk", title: `UK (${genderTag})` }
    ].filter((column) => rows.some((row) => row[column.field] !== undefined && row[column.field] !== ""));
    const headHTML = columns.map((column) => `<th style="padding:6px 14px;border-bottom:1px solid #e3e3e3;text-align:center;font-size:13px;color:#666;">${escapeText(column.title)}</th>`).join("");
    const rowsHTML = rows.map((row) => `
      <tr>${columns.map((column) => `<td style="padding:5px 14px;border-bottom:1px solid #f1f1f1;text-align:center;font-size:14px;">${escapeText(row[column.field] ?? "")}</td>`).join("")}</tr>
    `).join("");
    return `<table style="border-collapse:collapse;width:100%;"><thead><tr>${headHTML}</tr></thead><tbody>${rowsHTML}</tbody></table>`;
  }

  // options.gender="women": dua bang NU len truoc (san pham nu xem ngay bang cua minh).
  function openSizeChartModal(brand, options = {}) {
    if (typeof document === "undefined") return;
    const chart = sizeChartForBrand(brand);
    if (!chart) return;
    closeSizeChartModal();
    const sections = [{ title: "Nam / Unisex", html: chartTableHTML(chart.rows, "nam") }];
    if (chart.womenRows) {
      const womenSection = { title: "Nữ", html: chartTableHTML(chart.womenRows, "nữ") };
      if (options.gender === "women") sections.unshift(womenSection);
      else sections.push(womenSection);
    }
    const bodyHTML = sections.map((section) => `
      <div style="padding:0 0 6px;">
        ${sections.length > 1 ? `<div style="padding:10px 14px 4px;font-weight:600;font-size:13px;color:#444;">${escapeText(section.title)}</div>` : ""}
        ${section.html}
      </div>
    `).join("");
    const overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `Bảng size ${chart.label}`);
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(15,15,15,.55);display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
      <div style="background:#fff;color:#1c1c1c;border-radius:14px;max-width:420px;width:100%;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 18px 50px rgba(0,0,0,.3);">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #ececec;">
          <strong style="font-size:16px;">Bảng size ${escapeText(chart.label)}</strong>
          <button type="button" data-size-chart-close style="background:none;border:none;font-size:22px;line-height:1;cursor:pointer;color:#888;padding:2px 6px;">×</button>
        </div>
        <div style="overflow:auto;padding:4px 4px 0;">
          ${bodyHTML}
        </div>
        <p style="margin:0;padding:10px 18px 14px;font-size:12px;color:#777;">Size trên sản phẩm là size gốc của ${escapeText(chart.label)}. Quy đổi EU chỉ để tham khảo khi lọc/chọn size.</p>
      </div>
    `;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-size-chart-close]")) closeSizeChartModal();
    });
    document.addEventListener("keydown", function onKey(event) {
      if (event.key === "Escape") {
        closeSizeChartModal();
        document.removeEventListener("keydown", onKey);
      }
    });
    document.body.appendChild(overlay);
  }

  const kit = {
    BRAND_SHOE_CHARTS,
    chartKey,
    parseShoeSizeLabel,
    isConvertibleShoeLabel,
    inferShoeGender,
    euFilterSize,
    sizeChartForBrand,
    openSizeChartModal,
    closeSizeChartModal
  };

  root.SizeChartKit = kit;
  if (typeof module !== "undefined" && module.exports) module.exports = kit;
})(typeof window !== "undefined" ? window : globalThis);
