// TopRun Address Kit - BO CHON DIA CHI DUNG CHUNG toan he thong (landing toprun/dasbui + Sales Desk).
// Chuan UI: go ten de loc -> bam chon tu danh muc (khong chap nhan tu viet), match khong dau + alias,
// ho tro 2 he dia chi (legacy 3 cap tinh/quan/phuong va two_tier 2 cap tinh/phuong).
// Moi noi can dia chi CHI goi TopRunAddressKit.bindAddressSelectors(form, options) hoac attachAddressFields();
// sua hanh vi dia chi = sua duy nhat file nay. CSS tu tiem, khong can them vao styles.css.
(function (global) {
  "use strict";
  if (global.TopRunAddressKit) return;

  var ADMIN_PREFIX_RE = /^(tinh|thanh pho|tp|quan|huyen|thi xa|phuong|xa|thi tran|dac khu)\s+/;

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripAdminPrefix(normalized) {
    return String(normalized || "").replace(ADMIN_PREFIX_RE, "").trim();
  }

  function optionKeys(option) {
    if (!option) return [];
    if (option.__kitKeys) return option.__kitKeys;
    var names = [option.name, option.FullName]
      .concat(Array.isArray(option.aliases) ? option.aliases : [])
      .filter(Boolean);
    var keys = [];
    for (var i = 0; i < names.length; i += 1) {
      var norm = normalizeText(names[i]);
      if (norm && keys.indexOf(norm) < 0) keys.push(norm);
      var stripped = stripAdminPrefix(norm);
      if (stripped && keys.indexOf(stripped) < 0) keys.push(stripped);
    }
    try { Object.defineProperty(option, "__kitKeys", { value: keys, enumerable: false }); } catch (e) { /* option dong bang */ }
    return keys;
  }

  function scoreOption(option, queryNorm, queryStripped) {
    var keys = optionKeys(option);
    var best = 0;
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      var score = 0;
      if (key === queryNorm || key === queryStripped) score = 4;
      else if (key.indexOf(queryNorm) === 0 || (queryStripped && key.indexOf(queryStripped) === 0)) score = 3;
      else if (key.indexOf(" " + queryNorm) >= 0 || (queryStripped && key.indexOf(" " + queryStripped) >= 0)) score = 2;
      else if (key.indexOf(queryNorm) >= 0 || (queryStripped && key.indexOf(queryStripped) >= 0)) score = 1;
      if (score > best) best = score;
      if (best === 4) break;
    }
    return best;
  }

  function searchOptions(options, query, limit) {
    var list = Array.isArray(options) ? options : [];
    var max = Number(limit || 12);
    var queryNorm = normalizeText(query);
    if (!queryNorm) return list.slice(0, max);
    var queryStripped = stripAdminPrefix(queryNorm);
    var scored = [];
    for (var i = 0; i < list.length; i += 1) {
      var score = scoreOption(list[i], queryNorm, queryStripped);
      if (score > 0) scored.push({ option: list[i], score: score, index: i });
    }
    scored.sort(function (a, b) { return b.score - a.score || a.index - b.index; });
    return scored.slice(0, max).map(function (row) { return row.option; });
  }

  function findOption(options, value) {
    var list = Array.isArray(options) ? options : [];
    var queryNorm = normalizeText(value);
    if (!queryNorm) return null;
    var queryStripped = stripAdminPrefix(queryNorm);
    var candidate = null;
    var candidates = 0;
    for (var i = 0; i < list.length; i += 1) {
      var score = scoreOption(list[i], queryNorm, queryStripped);
      if (score === 4) return list[i];
      if (score >= 3) { candidate = candidate || list[i]; candidates += 1; }
    }
    return candidates === 1 ? candidate : null;
  }

  function displayName(option) {
    return String((option && (option.name || option.FullName)) || "");
  }

  function childDistricts(province) {
    return (province && (province.districts || province.Districts)) || [];
  }

  function childWards(node) {
    return (node && (node.wards || node.Wards)) || [];
  }

  function injectStylesOnce() {
    if (document.getElementById("addr-kit-style")) return;
    var style = document.createElement("style");
    style.id = "addr-kit-style";
    style.textContent = [
      ".addr-kit-wrap{position:relative}",
      ".addr-kit-suggest{position:absolute;z-index:9999;left:0;right:0;top:100%;margin-top:2px;background:#fff;border:1px solid #cfd8dc;border-radius:8px;box-shadow:0 8px 20px rgba(15,23,42,.14);max-height:240px;overflow-y:auto;display:none}",
      ".addr-kit-suggest.open{display:block}",
      ".addr-kit-suggest button{display:block;width:100%;text-align:left;padding:8px 12px;border:0;background:transparent;font:inherit;cursor:pointer}",
      ".addr-kit-suggest button:hover,.addr-kit-suggest button.active{background:#eef4ff}",
      ".addr-kit-suggest .addr-kit-empty{padding:8px 12px;color:#78909c;font-size:.9em}",
      "input.addr-kit-invalid{border-color:#e53935 !important;background:#fff6f6}",
      "@media (prefers-color-scheme: dark){.addr-kit-suggest{background:#1f2937;border-color:#374151;color:#e5e7eb}.addr-kit-suggest button:hover,.addr-kit-suggest button.active{background:#374151}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  // Gan search-select vao MOT o input. getOptions() tra mang [{name, aliases?...}].
  function attachField(config) {
    var input = config && config.input;
    if (!input || input.__addrKitAttached) return null;
    input.__addrKitAttached = true;
    injectStylesOnce();
    input.setAttribute("autocomplete", "off");
    input.removeAttribute("list");

    var wrap = document.createElement("div");
    wrap.className = "addr-kit-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var panel = document.createElement("div");
    panel.className = "addr-kit-suggest";
    wrap.appendChild(panel);

    var activeIndex = -1;
    var currentOptions = [];

    function close() {
      panel.classList.remove("open");
      activeIndex = -1;
    }

    function pick(option) {
      input.value = displayName(option);
      input.classList.remove("addr-kit-invalid");
      close();
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if (typeof config.onPick === "function") config.onPick(option);
    }

    function renderPanel() {
      currentOptions = searchOptions(config.getOptions(), input.value, config.limit || 12);
      if (!currentOptions.length) {
        panel.innerHTML = '<div class="addr-kit-empty">' + (config.emptyText || "Không tìm thấy — kiểm tra lại chính tả") + "</div>";
      } else {
        panel.innerHTML = currentOptions.map(function (option, index) {
          return '<button type="button" data-addr-kit-index="' + index + '"' + (index === activeIndex ? ' class="active"' : "") + ">"
            + displayName(option).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            + "</button>";
        }).join("");
      }
      panel.classList.add("open");
    }

    panel.addEventListener("mousedown", function (event) {
      var button = event.target.closest ? event.target.closest("[data-addr-kit-index]") : null;
      if (!button) return;
      event.preventDefault();
      pick(currentOptions[Number(button.getAttribute("data-addr-kit-index"))]);
    });

    input.addEventListener("focus", renderPanel);
    input.addEventListener("input", function () {
      activeIndex = -1;
      input.classList.remove("addr-kit-invalid");
      renderPanel();
    });
    input.addEventListener("keydown", function (event) {
      if (!panel.classList.contains("open")) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        var delta = event.key === "ArrowDown" ? 1 : -1;
        activeIndex = Math.max(0, Math.min(currentOptions.length - 1, activeIndex + delta));
        renderPanel();
      } else if (event.key === "Enter") {
        if (activeIndex >= 0 && currentOptions[activeIndex]) {
          event.preventDefault();
          pick(currentOptions[activeIndex]);
        } else if (currentOptions.length === 1) {
          event.preventDefault();
          pick(currentOptions[0]);
        }
      } else if (event.key === "Escape") {
        close();
      }
    });
    input.addEventListener("blur", function () {
      setTimeout(function () {
        close();
        if (!input.value.trim()) { input.classList.remove("addr-kit-invalid"); return; }
        var matched = findOption(config.getOptions(), input.value);
        if (matched) {
          // Phai dung displayName(): dataset Desk 2 cap chi co FullName, khong co .name -
          // gan matched.name truc tiep se do chuoi "undefined" vao o input.
          if (input.value !== displayName(matched)) {
            input.value = displayName(matched);
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
          input.classList.remove("addr-kit-invalid");
        } else {
          // Khong khop danh muc: danh dau do de bat buoc CHON tu danh sach, khong tu viet.
          input.classList.add("addr-kit-invalid");
        }
      }, 150);
    });

    return { refresh: renderPanel, close: close };
  }

  // Bo 3 o lien hoan tinh/quan/phuong (an quan khi two_tier). Tra ve api {refresh, validate, selection}.
  function attachAddressFields(config) {
    var provinceInput = config.provinceInput;
    var districtInput = config.districtInput;
    var wardInput = config.wardInput;
    var getScheme = config.getScheme || function () { return "legacy"; };
    var datasets = config.datasets || {};

    function provinces() {
      var rows = getScheme() === "two_tier"
        ? (typeof datasets.twoTier === "function" ? datasets.twoTier() : datasets.twoTier)
        : (typeof datasets.legacy === "function" ? datasets.legacy() : datasets.legacy);
      return Array.isArray(rows) ? rows : [];
    }

    function selectedProvince() {
      return findOption(provinces(), provinceInput ? provinceInput.value : "");
    }

    function selectedDistrict() {
      var province = selectedProvince();
      return province ? findOption(childDistricts(province), districtInput ? districtInput.value : "") : null;
    }

    function wardOptions() {
      var province = selectedProvince();
      if (!province) return [];
      if (getScheme() === "two_tier") return childWards(province);
      var district = selectedDistrict();
      return district ? childWards(district) : [];
    }

    function clearInput(input) {
      if (input && input.value) {
        input.value = "";
        input.classList.remove("addr-kit-invalid");
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (input) {
        input.classList.remove("addr-kit-invalid");
      }
    }

    if (provinceInput) {
      attachField({
        input: provinceInput,
        getOptions: provinces,
        emptyText: config.emptyText,
        onPick: function () {
          clearInput(districtInput);
          clearInput(wardInput);
        }
      });
    }
    if (districtInput) {
      attachField({
        input: districtInput,
        getOptions: function () { var p = selectedProvince(); return p ? childDistricts(p) : []; },
        emptyText: config.emptyText,
        onPick: function () { clearInput(wardInput); }
      });
    }
    if (wardInput) {
      attachField({
        input: wardInput,
        getOptions: wardOptions,
        emptyText: config.emptyText
      });
    }

    function validate() {
      var scheme = getScheme();
      var missing = [];
      var province = selectedProvince();
      if (!province) missing.push("Tỉnh/TP");
      if (scheme !== "two_tier") {
        if (!selectedDistrict()) missing.push("Quận/Huyện");
      }
      var ward = findOption(wardOptions(), wardInput ? wardInput.value : "");
      if (!ward) missing.push("Phường/Xã");
      return { ok: missing.length === 0, missing: missing };
    }

    function selection() {
      var scheme = getScheme();
      var province = selectedProvince();
      var district = scheme === "two_tier" ? null : selectedDistrict();
      var ward = findOption(wardOptions(), wardInput ? wardInput.value : "");
      return {
        scheme: scheme,
        province: province || null,
        district: district || null,
        ward: ward || null,
        provinceName: province ? displayName(province) : (provinceInput ? provinceInput.value.trim() : ""),
        districtName: scheme === "two_tier" ? "" : (district ? displayName(district) : (districtInput ? districtInput.value.trim() : "")),
        wardName: ward ? displayName(ward) : (wardInput ? wardInput.value.trim() : "")
      };
    }

    function refresh() {
      [provinceInput, districtInput, wardInput].forEach(function (input) {
        if (input) input.classList.remove("addr-kit-invalid");
      });
    }

    return { validate: validate, selection: selection, refresh: refresh, provinces: provinces };
  }

  // ===== Phan danh rieng cho LANDING (toprun.site / dasbui.vn) =====
  // Thay the toan bo bindAddressSelectors ban sao trong app.js/product.js/mobile-v1.js:
  // giu nguyen contract cu (hidden addressScheme, radio 2 he, an label Huyen, clientOrderId do file goi tu them).

  function fetchJSONCached(url, cacheKey) {
    if (Array.isArray(global[cacheKey])) return Promise.resolve(global[cacheKey]);
    var promiseKey = cacheKey + "Promise";
    if (!global[promiseKey]) {
      global[promiseKey] = fetch(url).then(function (response) {
        return response.ok ? response.json() : [];
      }).then(function (payload) {
        global[cacheKey] = Array.isArray(payload) ? payload : [];
        return global[cacheKey];
      }).catch(function () {
        global[cacheKey] = [];
        return global[cacheKey];
      });
    }
    return global[promiseKey];
  }

  function loadLandingUnitsLegacy() {
    return fetchJSONCached("/assets/admin-units-v1.json?v=20260620", "__toprunAdminUnits");
  }

  function loadLandingUnitsV2() {
    return fetchJSONCached("/assets/admin-units-v2.json?v=20260801", "__toprunAdminUnitsV2");
  }

  function bindAddressSelectors(form, options) {
    if (!form || form.__addrKitBound) return;
    form.__addrKitBound = true;
    var settings = options || {};
    var allowTwoTier = settings.allowTwoTier !== false;

    Promise.all([loadLandingUnitsLegacy(), allowTwoTier ? loadLandingUnitsV2() : Promise.resolve([])]).then(function (loaded) {
      var unitsLegacy = loaded[0] || [];
      var unitsV2 = loaded[1] || [];
      var provinceInput = form.querySelector('[name="province"]');
      var districtInput = form.querySelector('[name="district"]');
      var wardInput = form.querySelector('[name="ward"]');
      if (!provinceInput || !wardInput) return;

      var schemeInput = form.querySelector('input[name="addressScheme"]');
      if (!schemeInput) {
        schemeInput = document.createElement("input");
        schemeInput.type = "hidden";
        schemeInput.name = "addressScheme";
        schemeInput.value = "legacy";
        form.appendChild(schemeInput);
      }

      var provinceLabel = provinceInput.closest("label");
      var districtLabel = districtInput ? districtInput.closest("label") : null;

      // Radio chon he: giu markup/class cu (.address-scheme-row) de CSS 2 he hien co van an.
      if (allowTwoTier && unitsV2.length && provinceLabel && !form.querySelector(".address-scheme-row")) {
        var schemeRow = document.createElement("div");
        schemeRow.className = "address-scheme-row";
        schemeRow.style.cssText = "display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:6px 10px;";
        schemeRow.innerHTML = '<span>Kiểu địa chỉ:</span>'
          + '<label style="display:flex;gap:6px;align-items:center;margin:0"><input type="radio" name="addrKitScheme" value="legacy" checked> 3 cấp (cũ)</label>'
          + '<label style="display:flex;gap:6px;align-items:center;margin:0"><input type="radio" name="addrKitScheme" value="two_tier"> 2 cấp (mới)</label>';
        provinceLabel.before(schemeRow);
        schemeRow.querySelectorAll('input[name="addrKitScheme"]').forEach(function (radio) {
          radio.addEventListener("change", function () {
            schemeInput.value = radio.value === "two_tier" ? "two_tier" : "legacy";
            applyScheme(true);
          });
        });
      }

      function isTwoTier() {
        return schemeInput.value === "two_tier";
      }

      var api = attachAddressFields({
        provinceInput: provinceInput,
        districtInput: districtInput,
        wardInput: wardInput,
        getScheme: function () { return isTwoTier() ? "two_tier" : "legacy"; },
        datasets: {
          legacy: function () { return unitsLegacy; },
          twoTier: function () { return unitsV2; }
        }
      });

      function applyScheme(clearValues) {
        form.setAttribute("data-address-scheme", isTwoTier() ? "two_tier" : "legacy");
        if (clearValues) {
          [provinceInput, districtInput, wardInput].forEach(function (input) {
            if (input) { input.value = ""; input.classList.remove("addr-kit-invalid"); }
          });
        }
        if (districtLabel) districtLabel.hidden = isTwoTier();
        if (districtInput) districtInput.required = !isTwoTier();
        provinceInput.placeholder = isTwoTier() ? "Tìm Tỉnh/TP (34 tỉnh mới)" : "Tìm Tỉnh/TP";
        wardInput.placeholder = "Tìm Phường/Xã";
        if (districtInput) districtInput.placeholder = "Tìm Quận/Huyện";
        api.refresh();
      }

      applyScheme(false);
      form.__addrKitApi = api;
      if (typeof settings.onReady === "function") settings.onReady(api);
    });
  }

  // Site dasbui goi qua alias DasbuiAddressKit (khong lo thuong hieu TopRun trong code goi) —
  // van la CUNG MOT bo kit, file copy y het giua 3 repo, dinh nghia alias o cuoi file.
  global.TopRunAddressKit = {
    version: "20260808-3",
    normalizeText: normalizeText,
    searchOptions: searchOptions,
    findOption: findOption,
    attachField: attachField,
    attachAddressFields: attachAddressFields,
    bindAddressSelectors: bindAddressSelectors,
    loadLandingUnitsLegacy: loadLandingUnitsLegacy,
    loadLandingUnitsV2: loadLandingUnitsV2
  };
  global.DasbuiAddressKit = global.TopRunAddressKit;
})(typeof window !== "undefined" ? window : this);
