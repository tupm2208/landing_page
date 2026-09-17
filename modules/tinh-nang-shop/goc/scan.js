// scan.js — client quét tem nhập/kiểm kho. Chạy trên máy tính (localhost) và điện thoại
// (LAN qua HTTPS nội bộ + ADMIN_ACCESS_TOKEN). Rà camera liên tục: bỏ khung mờ, chỉ chốt
// khi 2 khung liên tiếp đọc trùng mã, bíp + rung khi vào phiên. Quy tắc nút: Đang.../Đã ✓.

(() => {
  const TOKEN_KEY = "toprunScanAdminToken";
  const IOS_HINT_KEY = "toprunScanIOSHintDone";
  const FRAME_INTERVAL_MS = 700;
  const CONFIRM_COOLDOWN_MS = 4000;
  const SHARPNESS_MIN = 12;

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    branches: [],
    branchId: "",
    mode: "import", // import | audit
    cameraOn: false,
    stream: null,
    loopId: 0,
    busy: false,
    awaitingCode: null, // kết quả đang chờ người quét chọn mã trong danh sách ứng viên
    lines: [], // {scanId, code, name, imageUrl, size, qty, salePrice, costPrice, listPrice, isNew, readCode, readSize}
    pending: null, // {code, size, hits}
    lastConfirm: { key: "", at: 0 },
    awaitingSize: null, // {scanId, code, name, imageUrl, options, knownProduct}
    audit: null, // {rows, branchId}
    editingIndex: -1
  };

  const $ = (id) => document.getElementById(id);
  const video = $("scan-video");
  const canvas = $("scan-canvas");

  // ===== API helper (đính token cho thiết bị ngoài localhost) =====

  async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (state.token) headers["X-TopRun-Admin-Token"] = state.token;
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      showTokenGate("Sales Desk từ chối mã truy cập. Kiểm tra ADMIN_ACCESS_TOKEN trong .env.");
      throw new Error(payload.message || "Chưa được phép truy cập.");
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.message || `Lỗi ${response.status}`);
    }
    return payload;
  }

  // ===== Nút bấm theo chuẩn Đang.../Đã ✓ =====

  async function runButtonTask(button, busyLabel, doneLabel, task) {
    if (button.disabled) return;
    const idleLabel = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
    try {
      await task();
      button.textContent = doneLabel;
      setTimeout(() => {
        button.textContent = idleLabel;
        button.disabled = false;
      }, 2500);
    } catch (error) {
      button.textContent = idleLabel;
      button.disabled = false;
      alert(error.message || "Thao tác thất bại.");
    }
  }

  // ===== Âm báo =====

  let audioContext = null;
  // iOS chi cho tao/chay AudioContext tu thao tac cham that cua nguoi dung. Phai mo khoa
  // ngay trong handler bam nut, neu doi den luc quet xong moi tao thi iPhone se im lang.
  function unlockAudio() {
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") audioContext.resume();
    } catch {}
  }

  function beep(freq = 880, duration = 0.12) {
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") audioContext.resume();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + duration);
    } catch {}
    if (navigator.vibrate) navigator.vibrate(80);
  }

  // ===== Khởi động =====

  function showTokenGate(message) {
    $("scan-token-gate").classList.remove("hidden");
    $("scan-main").classList.add("hidden");
    const error = $("scan-token-error");
    if (message) {
      error.textContent = message;
      error.classList.remove("hidden");
    } else {
      error.classList.add("hidden");
    }
    $("scan-status").textContent = "Cần mã truy cập.";
  }

  async function boot() {
    try {
      const payload = await api("/api/ready-stock/state");
      const ready = payload.readyStock || {};
      state.branches = (ready.branches || []).filter((branch) => branch.active !== false);
      $("scan-token-gate").classList.add("hidden");
      $("scan-main").classList.remove("hidden");
      $("scan-status").textContent = "Đã kết nối. Chọn chi nhánh rồi bật camera.";
      renderBranches();
      renderLines();
      loadLanHint();
      // iPhone/iPad mo qua LAN: chua tin cay chung chi thi camera chac chan bi chan,
      // hien huong dan truoc de anh khong bam nut roi moi gap loi.
      if (isIOS() && !localStorage.getItem(IOS_HINT_KEY) && !window.isSecureContext) showIOSHint();
    } catch (error) {
      if (!$("scan-token-gate").classList.contains("hidden")) return;
      showTokenGate(error.message);
    }
  }

  function renderBranches() {
    const select = $("scan-branch");
    select.innerHTML = state.branches
      .map((branch) => `<option value="${branch.id}">${escapeHTML(branch.name || branch.id)}</option>`)
      .join("");
    if (!state.branchId && state.branches.length) state.branchId = state.branches[0].id;
    select.value = state.branchId;
  }

  async function loadLanHint() {
    if (!["localhost", "127.0.0.1"].includes(location.hostname)) return;
    try {
      const info = await api("/api/scan-tem/lan-info");
      if (info.urls && info.urls.length) {
        const hint = $("scan-lan-hint");
        hint.textContent = `📱 Mở trên điện thoại (cùng Wi-Fi): ${info.urls.join("  hoặc  ")} — lần đầu bấm "Tiếp tục truy cập" ở cảnh báo chứng chỉ, rồi dán mã truy cập.`;
        hint.classList.remove("hidden");
      }
    } catch {}
  }

  // ===== Camera + vòng rà =====

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function cameraErrorMessage(error) {
    const name = String(error && error.name || "");
    if (!window.isSecureContext || !navigator.mediaDevices) {
      return isIOS()
        ? "iPhone chỉ cho mở camera khi chứng chỉ được tin cậy. Xem hướng dẫn cài chứng chỉ ở đầu trang, hoặc dùng nút \"Chụp / chọn ảnh\"."
        : "Trình duyệt chặn camera vì trang không chạy qua HTTPS. Mở bằng link https:// hiện ở cuối trang.";
    }
    if (name === "NotAllowedError") {
      return isIOS()
        ? "Anh đã từ chối quyền camera. Vào Cài đặt → Safari → Camera → chọn Hỏi/Cho phép, rồi tải lại trang."
        : "Trình duyệt đang chặn quyền camera. Bấm biểu tượng ổ khóa trên thanh địa chỉ → cho phép Camera → tải lại trang.";
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return "Không tìm thấy camera sau trên thiết bị này. Dùng nút \"Chụp / chọn ảnh\".";
    }
    if (name === "NotReadableError") {
      return "Camera đang bị ứng dụng khác chiếm. Đóng app camera/Zalo/Messenger rồi thử lại.";
    }
    return `Không bật được camera: ${error && error.message || name}. Dùng tạm nút "Chụp / chọn ảnh".`;
  }

  async function startCamera() {
    unlockAudio();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showIOSHint();
      alert(cameraErrorMessage({ name: "InsecureContext" }));
      return;
    }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      video.srcObject = state.stream;
      video.setAttribute("playsinline", "");
      await video.play();
      state.cameraOn = true;
      $("scan-camera-toggle").textContent = "Tắt camera";
      state.loopId = window.setInterval(captureLoop, FRAME_INTERVAL_MS);
      $("scan-status").textContent = "Camera đang bật — rà vào tem, máy tự bíp khi đọc chắc.";
    } catch (error) {
      if (isIOS()) showIOSHint();
      alert(cameraErrorMessage(error));
    }
  }

  function showIOSHint() {
    $("scan-ios-hint").classList.remove("hidden");
  }

  function stopCamera() {
    window.clearInterval(state.loopId);
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    state.cameraOn = false;
    video.srcObject = null;
    $("scan-camera-toggle").textContent = "Bật camera";
  }

  function frameToDataURL() {
    const width = Math.min(1280, video.videoWidth || 1280);
    const height = Math.round(width * (video.videoHeight || 720) / (video.videoWidth || 1280));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.72);
  }

  // Độ nét ước lượng bằng phương sai gradient trên bản thu nhỏ — khung mờ (đang lia tay) bị bỏ.
  function frameSharpness() {
    const sampleWidth = 160;
    const sampleHeight = Math.round(sampleWidth * (video.videoHeight || 720) / (video.videoWidth || 1280));
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, sampleWidth, sampleHeight);
    const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight);
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = 1; y < sampleHeight - 1; y += 2) {
      for (let x = 1; x < sampleWidth - 1; x += 2) {
        const i = (y * sampleWidth + x) * 4;
        const gray = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
        const right = 0.3 * data[i + 4] + 0.59 * data[i + 5] + 0.11 * data[i + 6];
        const down = 0.3 * data[i + sampleWidth * 4] + 0.59 * data[i + sampleWidth * 4 + 1] + 0.11 * data[i + sampleWidth * 4 + 2];
        const gradient = Math.abs(right - gray) + Math.abs(down - gray);
        sum += gradient;
        sumSq += gradient * gradient;
        count += 1;
      }
    }
    const mean = sum / count;
    return sumSq / count - mean * mean;
  }

  async function captureLoop() {
    if (!state.cameraOn || state.busy || state.awaitingSize || state.awaitingCode) return;
    if (!video.videoWidth) return;
    if (frameSharpness() < SHARPNESS_MIN) return;
    const dataURL = frameToDataURL();
    await analyzeImage(dataURL, { consensus: true });
  }

  async function analyzeImage(dataURL, { consensus }) {
    state.busy = true;
    try {
      const result = await api("/api/scan-tem/analyze", {
        method: "POST",
        body: JSON.stringify({
          imageBase64: dataURL,
          branchId: state.branchId,
          mode: state.mode
        })
      });
      handleAnalyzeResult(result, consensus);
    } catch (error) {
      $("scan-status").textContent = `Lỗi đọc tem: ${error.message}`;
    } finally {
      state.busy = false;
    }
  }

  function handleAnalyzeResult(result, consensus) {
    updateEngineNote(result);
    // Nhiều mã gần giống nhau: máy không đoán bừa mà hỏi người quét chọn.
    if (result.codeConfidence === "ambiguous" && (result.codeCandidates || []).length) {
      state.awaitingCode = result;
      renderCodeChooser(result);
      beep(440, 0.08);
      return;
    }
    // pattern_only = mã đúng dạng nhưng chưa có trên web (hàng mới về). Vẫn nhận, nhưng phải
    // qua đủ 2 khung trùng như mọi kết quả OCR, và dòng sẽ mang nhãn "Mã mới" để anh kiểm lại.
    const trusted = ["exact", "fuzzy", "pattern_only", "operator_choice"].includes(result.codeConfidence)
      || (result.engine !== "ocr" && result.code);
    if (!result.code || !trusted) {
      if (result.code) {
        $("scan-status").textContent = `Thấy mã nghi ngờ ${result.code} — rà chậm lại cho nét.`;
      }
      return;
    }
    const candidateKey = `${result.code}|${result.size || ""}`;
    if (consensus && result.engine === "ocr") {
      if (!state.pending || state.pending.key !== candidateKey) {
        state.pending = { key: candidateKey, hits: 1, result };
        $("scan-status").textContent = `Đang khớp ${result.code}${result.size ? ` size ${result.size}` : ""}... giữ máy thêm chút.`;
        return;
      }
      state.pending.hits += 1;
      if (state.pending.hits < 2) return;
    }
    state.pending = null;
    confirmScan(result);
  }

  function updateEngineNote(result) {
    const note = $("scan-engine-note");
    if (result.engine === "ocr") {
      note.textContent = `Đọc offline ${result.elapsedMs}ms`;
    } else if (result.engine === "gemini" || result.engine === "openai") {
      note.textContent = `AI dự phòng (${result.engine}) ${result.elapsedMs}ms`;
    }
    if (result.aiNote) note.textContent += ` — ${result.aiNote}`;
  }

  function confirmScan(result) {
    const now = Date.now();
    const key = `${result.code}|${result.size || ""}`;
    if (state.lastConfirm.key === key && now - state.lastConfirm.at < CONFIRM_COOLDOWN_MS) return;

    if (!result.size) {
      // Có mã nhưng chưa chốt được size -> hiện chip size cho người dùng bấm.
      state.awaitingSize = result;
      renderResultCard(result, { needSize: true });
      beep(440, 0.08);
      return;
    }
    state.lastConfirm = { key, at: now };
    addLine(result, result.size);
    renderResultCard(result, { needSize: false });
    flashCamera();
    beep();
  }

  function addLine(result, size) {
    const product = result.knownProduct;
    const priceRow = product ? (product.sizes || []).find((row) => normalizeSize(row.size) === normalizeSize(size)) : null;
    const existing = state.lines.find((line) => line.code === result.code && normalizeSize(line.size) === normalizeSize(size));
    if (existing) {
      existing.qty += 1;
    } else {
      state.lines.unshift({
        scanId: result.scanId,
        code: result.code,
        name: product ? product.name : "",
        imageUrl: product ? product.imageUrl : "",
        size,
        qty: 1,
        salePrice: priceRow ? priceRow.salePrice : 0,
        listPrice: priceRow ? priceRow.listPrice : 0,
        costPrice: 0,
        isNew: !product,
        readCode: result.code,
        readSize: result.size || ""
      });
    }
    renderLines();
    $("scan-status").textContent = `✓ ${result.code} size ${size} — tổng ${totalQty()} sản phẩm trong phiên.`;
  }

  function flashCamera() {
    const flash = $("scan-flash");
    flash.classList.remove("hidden");
    flash.style.animation = "none";
    void flash.offsetWidth;
    flash.style.animation = "";
    setTimeout(() => flash.classList.add("hidden"), 500);
  }

  // ===== Render =====

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function normalizeSize(value) {
    return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  }

  function money(value) {
    return Number(value || 0) ? Number(value).toLocaleString("vi-VN") + "đ" : "—";
  }

  function totalQty() {
    return state.lines.reduce((sum, line) => sum + line.qty, 0);
  }

  function renderResultCard(result, { needSize }) {
    const card = $("scan-result-card");
    const product = result.knownProduct;
    const image = product && product.imageUrl
      ? `<img src="${escapeHTML(product.imageUrl)}" alt="">`
      : `<img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">`;
    const title = product
      ? `<div class="result-code">${escapeHTML(result.code)}</div><div class="result-name">${escapeHTML(product.name)}</div>`
      : `<div class="result-code">${escapeHTML(result.code)} <span class="line-new-badge">Mã mới</span></div><div class="result-name">Chưa có trên web — kiểm tra kỹ rồi nhập kèm tên.</div>`;
    let body = "";
    if (needSize) {
      const options = (result.sizeOptions || []).slice(0, 18);
      body = `
        <div class="result-name">Chọn size ${options.length ? "(máy chưa chắc size trên tem)" : "thủ công"}:</div>
        <div class="size-chips">
          ${options.map((size) => `<button class="size-chip" data-size="${escapeHTML(size)}">${escapeHTML(size)}</button>`).join("")}
          <button class="size-chip" data-size="__manual">✏️ Nhập tay</button>
        </div>
      `;
    } else {
      body = `<div class="result-name">Size <b>${escapeHTML(result.size)}</b> · ${result.engine === "ocr" ? "đọc offline" : `AI ${escapeHTML(result.engine)}`}</div>`;
    }
    card.innerHTML = `${image}<div class="result-info">${title}${body}</div>`;
    card.classList.toggle("warn", needSize || !product);
    card.classList.remove("hidden");
    if (needSize) {
      card.querySelectorAll(".size-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          let size = chip.dataset.size;
          if (size === "__manual") {
            size = prompt("Nhập size trên tem:") || "";
            if (!size.trim()) return;
          }
          const pendingResult = state.awaitingSize;
          state.awaitingSize = null;
          state.lastConfirm = { key: `${pendingResult.code}|${size}`, at: Date.now() };
          if (normalizeSize(size) !== normalizeSize(pendingResult.size || "")) {
            api("/api/scan-tem/correction", {
              method: "POST",
              body: JSON.stringify({ scanId: pendingResult.scanId, code: pendingResult.code, size })
            }).catch(() => {});
          }
          addLine(pendingResult, size.trim());
          renderResultCard({ ...pendingResult, size: size.trim() }, { needSize: false });
          flashCamera();
          beep();
        });
      });
    }
  }

  function renderCodeChooser(result) {
    const card = $("scan-result-card");
    const candidates = result.codeCandidates || [];
    card.innerHTML = `
      <div class="result-info">
        <div class="result-code">Tem mờ — chọn đúng mã</div>
        <div class="result-name">Máy đọc được ${escapeHTML(result.rawTextPreview ? result.rawTextPreview.split(/\s+/).slice(0, 6).join(" ") : "")}… nhưng có ${candidates.length} mã gần giống.</div>
        <div class="size-chips">
          ${candidates.map((item) => `<button class="size-chip" data-code="${escapeHTML(item.code)}">${escapeHTML(item.code)}${item.name ? ` · ${escapeHTML(item.name.slice(0, 26))}` : ""}</button>`).join("")}
          <button class="size-chip" data-code="__skip">Bỏ qua, rà lại</button>
        </div>
      </div>
    `;
    card.classList.add("warn");
    card.classList.remove("hidden");
    card.querySelectorAll(".size-chip").forEach((chip) => {
      chip.addEventListener("click", async () => {
        const code = chip.dataset.code;
        state.awaitingCode = null;
        if (code === "__skip") {
          card.classList.add("hidden");
          return;
        }
        try {
          const payload = await api(`/api/scan-tem/product?code=${encodeURIComponent(code)}&branchId=${encodeURIComponent(state.branchId)}`);
          const chosen = { ...result, code, knownProduct: payload.knownProduct, codeConfidence: "operator_choice" };
          api("/api/scan-tem/correction", {
            method: "POST",
            body: JSON.stringify({ scanId: result.scanId, code, size: result.size || "" })
          }).catch(() => {});
          confirmScan(chosen);
        } catch (error) {
          alert(error.message || "Không lấy được thông tin mã đã chọn.");
        }
      });
    });
  }

  function renderLines() {
    const container = $("scan-lines");
    if (!state.lines.length) {
      container.innerHTML = `<p class="muted">Chưa có sản phẩm nào trong phiên. Rà camera vào tem để bắt đầu.</p>`;
    } else {
      container.innerHTML = state.lines.map((line, index) => `
        <div class="scan-line">
          ${line.imageUrl ? `<img src="${escapeHTML(line.imageUrl)}" alt="">` : `<img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">`}
          <div class="line-main">
            <div class="line-code">${escapeHTML(line.code)} · ${escapeHTML(line.size)}${line.isNew ? '<span class="line-new-badge">Mã mới</span>' : ""}</div>
            <div class="line-sub">${escapeHTML(line.name || "(chưa có tên)")} · giá bán ${money(line.salePrice)}</div>
          </div>
          <div class="line-qty">
            <button data-line-minus="${index}">−</button>
            <b>${line.qty}</b>
            <button data-line-plus="${index}">+</button>
          </div>
          <button class="ghost-button" data-line-edit="${index}">Sửa</button>
        </div>
      `).join("");
    }
    $("scan-import-total").textContent = state.lines.length
      ? `${state.lines.length} dòng · ${totalQty()} sản phẩm`
      : "";
    $("scan-import-submit").disabled = !state.lines.length || state.mode !== "import";
    container.querySelectorAll("[data-line-minus]").forEach((button) => {
      button.addEventListener("click", () => {
        const line = state.lines[Number(button.dataset.lineMinus)];
        line.qty -= 1;
        if (line.qty <= 0) state.lines.splice(state.lines.indexOf(line), 1);
        renderLines();
      });
    });
    container.querySelectorAll("[data-line-plus]").forEach((button) => {
      button.addEventListener("click", () => {
        state.lines[Number(button.dataset.linePlus)].qty += 1;
        renderLines();
      });
    });
    container.querySelectorAll("[data-line-edit]").forEach((button) => {
      button.addEventListener("click", () => openEditModal(Number(button.dataset.lineEdit)));
    });
  }

  // ===== Sửa dòng (sửa-là-học) =====

  function openEditModal(index) {
    const line = state.lines[index];
    if (!line) return;
    state.editingIndex = index;
    $("edit-code").value = line.code;
    $("edit-name").value = line.name || "";
    $("edit-size").value = line.size;
    $("edit-qty").value = line.qty;
    $("edit-sale").value = line.salePrice || "";
    $("edit-cost").value = line.costPrice || "";
    $("edit-list").value = line.listPrice || "";
    $("scan-edit-modal").classList.remove("hidden");
  }

  function closeEditModal() {
    state.editingIndex = -1;
    $("scan-edit-modal").classList.add("hidden");
  }

  function saveEditModal() {
    const line = state.lines[state.editingIndex];
    if (!line) return closeEditModal();
    const newCode = $("edit-code").value.trim().toUpperCase();
    const newSize = $("edit-size").value.trim();
    if (!newCode || !newSize) {
      alert("Cần đủ mã và size.");
      return;
    }
    const changed = newCode !== line.readCode || normalizeSize(newSize) !== normalizeSize(line.readSize);
    if (changed && line.scanId) {
      api("/api/scan-tem/correction", {
        method: "POST",
        body: JSON.stringify({ scanId: line.scanId, code: newCode, size: newSize })
      }).then((payload) => {
        if (payload.learned) $("scan-status").textContent = "🧠 Máy đã học lại vị trí đọc từ lần sửa này.";
      }).catch(() => {});
    }
    line.code = newCode;
    line.size = newSize;
    line.name = $("edit-name").value.trim();
    line.qty = Math.max(1, Math.trunc(Number($("edit-qty").value || 1)));
    line.salePrice = Math.max(0, Math.round(Number($("edit-sale").value || 0)));
    line.costPrice = Math.max(0, Math.round(Number($("edit-cost").value || 0)));
    line.listPrice = Math.max(0, Math.round(Number($("edit-list").value || 0)));
    closeEditModal();
    renderLines();
  }

  // ===== Ghi phiếu nhập =====

  async function submitImport() {
    const branch = state.branches.find((item) => item.id === state.branchId);
    const missingSale = state.lines.filter((line) => line.isNew && !line.salePrice);
    if (missingSale.length) {
      throw new Error(`Mã mới cần giá bán: ${missingSale.map((line) => line.code).join(", ")} (bấm Sửa để điền).`);
    }
    await api("/api/ready-stock/import", {
      method: "POST",
      body: JSON.stringify({
        note: `Quét tem nhập kho (${branch ? branch.name : state.branchId})`,
        lines: state.lines.map((line) => ({
          code: line.code,
          name: line.name,
          size: line.size,
          branchId: state.branchId,
          qty: line.qty,
          costPrice: line.costPrice,
          salePrice: line.salePrice,
          listPrice: line.listPrice
        }))
      })
    });
    state.lines = [];
    renderLines();
    $("scan-status").textContent = "✓ Đã ghi phiếu nhập. Tồn sẽ tự đẩy lên web sau vài giây.";
  }

  // ===== Kiểm kho =====

  async function runAudit() {
    const payload = await api("/api/ready-stock/state");
    const ready = payload.readyStock || {};
    const counted = new Map();
    state.lines.forEach((line) => {
      counted.set(`${line.code}|${normalizeSize(line.size)}`, {
        code: line.code, name: line.name, size: line.size,
        qty: (counted.get(`${line.code}|${normalizeSize(line.size)}`) || { qty: 0 }).qty + line.qty,
        salePrice: line.salePrice, isNew: line.isNew
      });
    });
    const systemRows = [];
    (ready.products || []).forEach((product) => {
      (product.variants || []).forEach((variant) => {
        if (String(variant.branchId).toLowerCase() !== state.branchId) return;
        systemRows.push({
          code: String(product.code).toUpperCase(),
          name: product.name || "",
          size: variant.size,
          systemQty: Math.max(0, Number(variant.qty || 0)),
          salePrice: Number(variant.salePrice || 0)
        });
      });
    });
    const includeUnscanned = $("scan-audit-full").checked;
    const rows = [];
    const seen = new Set();
    counted.forEach((entry, key) => {
      const systemRow = systemRows.find((row) => `${row.code}|${normalizeSize(row.size)}` === key);
      seen.add(key);
      rows.push({
        code: entry.code, name: entry.name || (systemRow ? systemRow.name : ""), size: entry.size,
        systemQty: systemRow ? systemRow.systemQty : 0,
        countedQty: entry.qty,
        delta: entry.qty - (systemRow ? systemRow.systemQty : 0),
        salePrice: entry.salePrice || (systemRow ? systemRow.salePrice : 0),
        isNew: entry.isNew && !systemRow
      });
    });
    if (includeUnscanned) {
      systemRows.forEach((row) => {
        const key = `${row.code}|${normalizeSize(row.size)}`;
        if (seen.has(key) || row.systemQty <= 0) return;
        rows.push({
          code: row.code, name: row.name, size: row.size,
          systemQty: row.systemQty, countedQty: 0, delta: -row.systemQty,
          salePrice: row.salePrice, isNew: false
        });
      });
    }
    rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.code.localeCompare(b.code));
    state.audit = { rows, branchId: state.branchId };
    renderAudit();
  }

  function renderAudit() {
    const { rows } = state.audit;
    const container = $("scan-audit-table");
    const diffRows = rows.filter((row) => row.delta !== 0);
    container.innerHTML = `
      <table>
        <thead><tr><th>Mã · size</th><th class="num">Hệ thống</th><th class="num">Đếm được</th><th class="num">Lệch</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td><b>${escapeHTML(row.code)}</b> · ${escapeHTML(row.size)}<br><span class="muted">${escapeHTML(row.name)}</span></td>
              <td class="num">${row.systemQty}</td>
              <td class="num">${row.countedQty}</td>
              <td class="num ${row.delta > 0 ? "delta-plus" : row.delta < 0 ? "delta-minus" : ""}">${row.delta > 0 ? "+" : ""}${row.delta}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    $("scan-audit-summary").textContent = diffRows.length
      ? `${diffRows.length} dòng lệch (${diffRows.filter((r) => r.delta > 0).length} thừa, ${diffRows.filter((r) => r.delta < 0).length} thiếu).`
      : "Khớp hoàn toàn — không cần điều chỉnh. 🎉";
    $("scan-audit-apply").disabled = !diffRows.length;
    $("scan-audit-result").classList.remove("hidden");
    $("scan-audit-result").scrollIntoView({ behavior: "smooth" });
  }

  async function applyAudit() {
    const diffRows = state.audit.rows.filter((row) => row.delta !== 0);
    if (!diffRows.length) return;
    if (!confirm(`Áp dụng ${diffRows.length} dòng điều chỉnh tồn cho chi nhánh này? Thao tác ghi sổ ADJUST và tự đồng bộ web.`)) {
      throw new Error("Đã hủy áp dụng.");
    }
    await api("/api/scan-tem/stocktake-apply", {
      method: "POST",
      body: JSON.stringify({
        branchId: state.audit.branchId,
        note: "Kiểm kho bằng quét tem",
        adjustments: diffRows.map((row) => ({
          code: row.code, name: row.name, size: row.size,
          delta: row.delta, salePrice: row.salePrice
        }))
      })
    });
    $("scan-audit-result").classList.add("hidden");
    state.audit = null;
    state.lines = [];
    renderLines();
    $("scan-status").textContent = "✓ Đã điều chỉnh tồn theo kiểm kê. Web sẽ cập nhật sau vài giây.";
  }

  // ===== Gắn sự kiện =====

  function setMode(mode) {
    state.mode = mode;
    $("mode-import").classList.toggle("active", mode === "import");
    $("mode-audit").classList.toggle("active", mode === "audit");
    $("scan-list-title").textContent = mode === "import" ? "Phiên nhập kho" : "Phiên kiểm kho (đếm thực tế)";
    $("scan-import-footer").classList.toggle("hidden", mode !== "import");
    $("scan-audit-footer").classList.toggle("hidden", mode !== "audit");
    $("scan-audit-result").classList.add("hidden");
    renderLines();
  }

  $("scan-token-save").addEventListener("click", () => {
    state.token = $("scan-token-input").value.trim();
    localStorage.setItem(TOKEN_KEY, state.token);
    boot();
  });
  $("scan-branch").addEventListener("change", (event) => {
    state.branchId = event.target.value;
  });
  $("mode-import").addEventListener("click", () => setMode("import"));
  $("mode-audit").addEventListener("click", () => setMode("audit"));
  $("scan-camera-toggle").addEventListener("click", () => {
    if (state.cameraOn) stopCamera();
    else startCamera();
  });
  $("scan-ios-hint-close").addEventListener("click", () => {
    $("scan-ios-hint").classList.add("hidden");
    localStorage.setItem(IOS_HINT_KEY, "1");
  });
  $("scan-file-input").addEventListener("change", async (event) => {
    unlockAudio();
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => analyzeImage(String(reader.result), { consensus: false });
    reader.readAsDataURL(file);
  });
  $("scan-clear").addEventListener("click", () => {
    if (state.lines.length && !confirm("Xóa toàn bộ phiên đang quét?")) return;
    state.lines = [];
    state.audit = null;
    state.awaitingSize = null;
    state.awaitingCode = null;
    $("scan-audit-result").classList.add("hidden");
    $("scan-result-card").classList.add("hidden");
    renderLines();
  });
  $("scan-import-submit").addEventListener("click", (event) => {
    runButtonTask(event.target, "Đang ghi phiếu...", "Đã ghi phiếu ✓", submitImport);
  });
  $("scan-audit-run").addEventListener("click", (event) => {
    runButtonTask(event.target, "Đang đối soát...", "Đã đối soát ✓", runAudit);
  });
  $("scan-audit-apply").addEventListener("click", (event) => {
    runButtonTask(event.target, "Đang điều chỉnh...", "Đã điều chỉnh ✓", applyAudit);
  });
  $("edit-cancel").addEventListener("click", closeEditModal);
  $("edit-save").addEventListener("click", saveEditModal);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.cameraOn) stopCamera();
  });

  if (!state.token && !["localhost", "127.0.0.1"].includes(location.hostname)) {
    showTokenGate("");
  } else {
    boot();
  }
})();
