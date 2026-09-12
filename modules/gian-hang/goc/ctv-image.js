(function () {
  const ACCENT = [255, 112, 34];
  let account = null;

  window.CtvImage = { init };

  async function init(product, images) {
    if (!product || !Array.isArray(images) || !images.length) return;
    try {
      const response = await fetch("/api/ctv/me", { credentials: "same-origin", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) return;
      account = payload.data;
      mount(product, images);
    } catch {}
  }

  function mount(product, images) {
    const host = document.querySelector(".product-detail-info") || document.getElementById("product-page");
    if (!host || document.getElementById("ctv-download-trigger")) return;
    host.insertAdjacentHTML("beforeend", `
      <button class="ctv-download-trigger is-visible" id="ctv-download-trigger" type="button">Tai anh</button>
      <section class="ctv-download-panel" id="ctv-download-panel" hidden aria-modal="true" role="dialog" aria-label="Tai anh san pham">
        <div class="ctv-download-dialog">
          <div class="ctv-download-head"><div><strong>Tai anh dang bai</strong><p>Chon tung anh; tren dien thoai bam "Luu anh" o bang chia se de anh vao thang album may.</p></div><button id="ctv-download-close" type="button" aria-label="Dong">x</button></div>
          ${account.allowNoLogo ? '<label class="ctv-download-options"><input id="ctv-no-logo" type="checkbox"> Anh sach khong logo</label>' : ""}
          <div class="ctv-download-grid">${images.map((src, index) => `
            <article class="ctv-download-item"><img src="${escapeHtml(src)}" alt="Anh ${index + 1}" loading="lazy"><button type="button" data-ctv-download="${index}">Tai anh ${String(index + 1).padStart(2, "0")}</button></article>
          `).join("")}</div>
        </div>
      </section>`);
    const panel = document.getElementById("ctv-download-panel");
    document.getElementById("ctv-download-trigger").addEventListener("click", () => { panel.hidden = false; });
    document.getElementById("ctv-download-close").addEventListener("click", () => { panel.hidden = true; });
    panel.addEventListener("click", (event) => { if (event.target === panel) panel.hidden = true; });
    panel.querySelectorAll("[data-ctv-download]").forEach((button) => button.addEventListener("click", () => downloadOne(product, images, Number(button.dataset.ctvDownload), button)));
  }

  async function downloadOne(product, images, index, button) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Dang render...";
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const source = await loadImage(images[index]);
      const logoDisabled = Boolean(account.allowNoLogo && document.getElementById("ctv-no-logo")?.checked);
      const canvas = await renderCard(source, product, logoDisabled);
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Khong tao duoc JPG.")), "image/jpeg", 0.92));
      const fileName = `${safeFileName(product.code || product.productCode || "product")}-${String(index + 1).padStart(2, "0")}.jpg`;
      const outcome = await deliverImage(blob, fileName);
      if (outcome === "cancelled") { button.textContent = originalText; return; }
      fetch("/api/ctv/download-log", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productCode: product.code || product.productCode, imageIndex: index + 1 })
      }).catch(() => {});
      button.textContent = outcome === "shared" ? "Da luu anh ✓" : "Da tai ✓";
      setTimeout(() => { button.textContent = originalText; }, 1400);
    } catch (error) {
      button.textContent = error.message || "Tai that bai";
      setTimeout(() => { button.textContent = originalText; }, 2200);
    } finally {
      button.disabled = false;
    }
  }

  // Tren dien thoai uu tien Web Share API (share sheet co "Luu anh" -> anh vao thang album/Photos,
  // CTV xem duoc ngay trong thu vien anh); huy share sheet = "cancelled" (khong ghi log tai).
  // May khong ho tro (desktop...) thi fallback tai file JPG nhu cu.
  async function deliverImage(blob, fileName) {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile && typeof File === "function" && navigator.share) {
      const file = new File([blob], fileName, { type: "image/jpeg" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: fileName });
          return "shared";
        } catch (error) {
          if (error?.name === "AbortError") return "cancelled";
          // NotAllowedError (het luot thao tac nguoi dung) hoac loi khac -> roi xuong tai file.
        }
      }
    }
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
    return "downloaded";
  }

  async function renderCard(source, product, noLogo) {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 1000;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const background = cornerAverage(source);
    ctx.fillStyle = rgb(background);
    ctx.fillRect(0, 0, 1000, 1000);
    const scale = Math.min(1000 / source.naturalWidth, 1000 / source.naturalHeight);
    const width = source.naturalWidth * scale;
    const height = source.naturalHeight * scale;
    ctx.drawImage(source, (1000 - width) / 2, (1000 - height) / 2, width, height);

    const code = String(product.code || product.productCode || "").trim().toUpperCase();
    const model = String(product.name || product.productName || product.modelName || "").trim().toUpperCase();
    const title = `${model} ${code}`.trim();
    let titleSize = 25;
    ctx.font = `700 ${titleSize}px CtvSans`;
    while (ctx.measureText(title).width > 884 && titleSize > 16) { titleSize -= 1; ctx.font = `700 ${titleSize}px CtvSans`; }
    const titleWidth = ctx.measureText(title).width;
    const titleBox = { x: 1000 - 56 - titleWidth, y: 20, w: titleWidth, h: titleSize * 1.25 };
    drawContrastText(ctx, title, titleBox.x, titleBox.y, `700 ${titleSize}px CtvSans`, titleBox, 2);

    const salePrice = liveSalePrice(product);
    const saleText = formatPrice(salePrice);
    ctx.font = "900 70px CtvCondensed";
    const saleWidth = ctx.measureText(saleText).width;
    const saleY = titleBox.y + titleBox.h + 8;
    const saleBox = { x: 1000 - 58 - saleWidth, y: saleY, w: saleWidth, h: 82 };
    drawSaleText(ctx, saleText, saleBox);

    const listPrice = liveListPrice(product);
    let blockBottom = saleBox.y + saleBox.h;
    if (listPrice > 0) {
      const listText = formatPrice(listPrice);
      // Gia niem yet to hon 30% (27 -> 35px); khoang trong toi gia sale giam ~70% (day chu 70px + 5px thay vi day box 82 + 6px).
      ctx.font = "900 35px CtvSans";
      const listWidth = ctx.measureText(listText).width;
      const listBox = { x: 1000 - 58 - listWidth, y: saleBox.y + 75, w: listWidth, h: 44 };
      const colors = contrastColors(ctx, listBox, 8);
      drawStrokedText(ctx, listText, listBox.x, listBox.y, "900 35px CtvSans", colors.fill, colors.stroke, 2);
      const strikeY = listBox.y + 18;
      ctx.strokeStyle = colors.stroke; ctx.lineWidth = 4; line(ctx, listBox.x - 4, strikeY, listBox.x + listBox.w + 4, strikeY);
      ctx.strokeStyle = colors.fill; ctx.lineWidth = 2; line(ctx, listBox.x - 4, strikeY - 1, listBox.x + listBox.w + 4, strikeY - 1);
      blockBottom = listBox.y + listBox.h;
    }

    const sizes = availableSizes(product);
    if (sizes.length) {
      const wrapped = fitWrappedLines(ctx, `Size: ${sizes.join(" ")}`, 884, 22, 14, 3, "CtvSans");
      const lineHeight = wrapped.size + 7;
      const widths = wrapped.lines.map((text) => { ctx.font = `900 ${wrapped.size}px CtvSans`; return ctx.measureText(text).width; });
      const box = { x: 1000 - 58 - Math.max(...widths), y: blockBottom + 15, w: Math.max(...widths), h: wrapped.lines.length * lineHeight };
      const colors = contrastColors(ctx, box, 8);
      wrapped.lines.forEach((text, lineIndex) => {
        const x = 1000 - 58 - widths[lineIndex];
        drawStrokedText(ctx, text, x, box.y + lineIndex * lineHeight, `900 ${wrapped.size}px CtvSans`, colors.fill, colors.stroke, 2);
      });
    }

    const notes = noteLines(product);
    if (notes.length) drawNotes(ctx, notes);
    if (!noLogo) {
      const logo = await loadImage("/assets/ctv-logo.png");
      // Logo to gap 1.5 lan (hop 145x60 -> 217.5x90).
      const scaleLogo = Math.min(217.5 / logo.naturalWidth, 90 / logo.naturalHeight);
      const lw = logo.naturalWidth * scaleLogo;
      const lh = logo.naturalHeight * scaleLogo;
      ctx.drawImage(logo, 18 + (217.5 - lw) / 2, 18 + (90 - lh) / 2, lw, lh);
    }
    return canvas;
  }

  function drawNotes(ctx, rawLines) {
    let size = 24;
    let lines = rawLines.map((line) => line.startsWith("-") ? line : `- ${line}`);
    while (size > 14) {
      ctx.font = `700 ${size}px CtvSans`;
      const maxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
      const gap = Math.max(4, size * .22);
      if (maxWidth <= 900 && lines.length * size + (lines.length - 1) * gap <= 120) break;
      size -= 1;
    }
    ctx.font = `700 ${size}px CtvSans`;
    const gap = Math.max(4, size * .22);
    const totalHeight = lines.length * size + (lines.length - 1) * gap;
    const y = 1000 - totalHeight - 30;
    const widths = lines.map((line) => ctx.measureText(line).width);
    const box = { x: (1000 - Math.max(...widths)) / 2, y, w: Math.max(...widths), h: totalHeight };
    const colors = contrastColors(ctx, box, 18);
    ctx.fillStyle = colors.fill === "#fff" ? "rgba(0,0,0,.337)" : "rgba(255,255,255,.431)";
    roundedRect(ctx, box.x - 18, box.y - 18, box.w + 36, box.h + 36, 10);
    ctx.fill();
    lines.forEach((text, index) => drawStrokedText(ctx, text, (1000 - widths[index]) / 2, y + index * (size + gap), `700 ${size}px CtvSans`, colors.fill, colors.stroke, 2));
  }

  function cornerAverage(image) {
    const sample = document.createElement("canvas"); sample.width = 200; sample.height = 200;
    const ctx = sample.getContext("2d", { willReadFrequently: true }); ctx.drawImage(image, 0, 0, 200, 200);
    const data = ctx.getImageData(0, 0, 200, 200).data;
    const points = [[0, 0], [199, 0], [0, 199], [199, 199]];
    return [0, 1, 2].map((channel) => Math.round(points.reduce((sum, point) => sum + data[(point[1] * 200 + point[0]) * 4 + channel], 0) / 4));
  }

  function contrastColors(ctx, box, pad) {
    const bg = averageRegion(ctx, box, pad);
    return contrast([255,255,255], bg) >= contrast([24,24,24], bg) ? { fill: "#fff", stroke: "#181818" } : { fill: "#181818", stroke: "#fff" };
  }

  function drawContrastText(ctx, text, x, y, font, box, stroke) {
    const colors = contrastColors(ctx, box, 10); drawStrokedText(ctx, text, x, y, font, colors.fill, colors.stroke, stroke);
  }

  function drawSaleText(ctx, text, box) {
    const bg = averageRegion(ctx, box, 8);
    const darkStroke = contrast([18,18,18], bg) >= contrast([255,255,255], bg);
    let fill = ACCENT;
    if (contrast(fill, bg) < 3) fill = darkStroke ? [245,92,18] : [255,132,48];
    drawStrokedText(ctx, text, box.x, box.y, "900 70px CtvCondensed", rgb(fill), darkStroke ? "#121212" : "#fff", 3);
  }

  function drawStrokedText(ctx, text, x, y, font, fill, stroke, width) {
    ctx.save(); ctx.font = font; ctx.textBaseline = "top"; ctx.lineJoin = "round"; ctx.strokeStyle = stroke; ctx.lineWidth = width * 2; ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y); ctx.restore();
  }

  function averageRegion(ctx, box, pad) {
    const x = Math.max(0, Math.floor(box.x - pad)); const y = Math.max(0, Math.floor(box.y - pad));
    const w = Math.max(1, Math.min(1000 - x, Math.ceil(box.w + pad * 2))); const h = Math.max(1, Math.min(1000 - y, Math.ceil(box.h + pad * 2)));
    const data = ctx.getImageData(x, y, w, h).data; const sums = [0,0,0]; const step = Math.max(4, Math.floor(data.length / 16000 / 4) * 4);
    let count = 0; for (let i = 0; i < data.length; i += step) { sums[0] += data[i]; sums[1] += data[i+1]; sums[2] += data[i+2]; count += 1; }
    return sums.map((value) => value / count);
  }

  function contrast(a, b) { const l1 = luminance(a); const l2 = luminance(b); return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05); }
  function luminance(rgbValue) { return rgbValue.map((v) => v/255 <= .03928 ? v/255/12.92 : Math.pow((v/255+.055)/1.055,2.4)).reduce((sum,v,index) => sum + v * [.2126,.7152,.0722][index],0); }
  function rgb(value) { return `rgb(${value.map((part) => Math.round(part)).join(",")})`; }
  function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
  function roundedRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x,y,w,h,r) : ctx.rect(x,y,w,h); }

  function fitWrappedLines(ctx, text, maxWidth, startSize, minSize, maxLines, family) {
    for (let size = startSize; size >= minSize; size -= 1) {
      ctx.font = `900 ${size}px ${family}`;
      const words = text.split(/\s+/); const lines = [];
      for (const word of words) { const candidate = lines.length ? `${lines[lines.length-1]} ${word}` : word; if (!lines.length || ctx.measureText(candidate).width <= maxWidth) { if (!lines.length) lines.push(word); else lines[lines.length-1] = candidate; } else lines.push(word); }
      if (lines.length <= maxLines) return { size, lines };
    }
    return { size: minSize, lines: [text.slice(0, 90), text.slice(90, 180), text.slice(180, 270)].filter(Boolean) };
  }

  function liveSalePrice(product) { const rows = Array.isArray(product.sizes) ? product.sizes.filter((row) => Number(row.qty || 0) > 0) : []; const prices = rows.map((row) => positive(row.suggestedPrice,row.salePrice,row.sellPrice,row.price)).filter(Boolean); return prices.length ? Math.min(...prices) : positive(product.suggestedPrice,product.salePrice,product.sellPrice,product.price); }
  function liveListPrice(product) { return positive(product.listPrice, product.originalPrice); }
  function availableSizes(product) { return [...new Set((Array.isArray(product.sizes) ? product.sizes : []).filter((row) => Number(row.qty || 0) > 0).map((row) => String(row.size || "").trim()).filter(Boolean))]; }
  function noteLines(product) { const value = product.socialNote || product.note || product.policy || ""; return (Array.isArray(value) ? value : String(value).split(/\r?\n/)).map((line) => String(line).trim()).filter(Boolean).slice(0, 5); }
  function positive(...values) { for (const value of values) { const number = Number(value); if (Number.isFinite(number) && number > 0) return number; } return 0; }
  function formatPrice(value) { return `${Math.round(Number(value || 0)).toLocaleString("vi-VN")}d`; }
  function safeFileName(value) { return String(value || "product").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "product"; }
  function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char])); }
  function loadImage(src) { return new Promise((resolve, reject) => { const image = new Image(); image.crossOrigin = "anonymous"; image.onload = () => resolve(image); image.onerror = () => reject(new Error("Khong tai duoc anh nguon.")); image.src = src; }); }
})();
