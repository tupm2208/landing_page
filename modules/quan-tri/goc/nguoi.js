/*
 * nguoi.js — the owner's "People & devices" screen of the web admin (16/09/2026).
 * Builds every row with DOM nodes and textContent: names and device labels come from people typing.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const ROLE_LABEL = { "chu-shop": "Chủ shop", "nhan-vien": "Nhân viên" };
  const DEVICE_LABEL = { pending: "Chờ duyệt", approved: "Đã duyệt", blocked: "Đã chặn" };

  function show(text, isError) {
    const box = $("#message");
    box.textContent = text || "";
    box.hidden = !text;
    box.classList.toggle("error", Boolean(isError));
  }

  async function api(path, body) {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) { location.replace("/admin-login"); throw new Error("Phiên đăng nhập đã hết."); }
    if (!response.ok || payload.ok === false) throw new Error(payload.message || payload.error || `Máy chủ trả mã ${response.status}`);
    return payload;
  }

  function cell(row, text, className) {
    const td = document.createElement("td");
    td.textContent = text == null ? "" : String(text);
    if (className) td.className = className;
    row.appendChild(td);
    return td;
  }

  function button(label, onClick, primary = false) {
    const b = document.createElement("button");
    b.type = "button";
    if (!primary) b.className = "small";
    b.textContent = label;
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { await onClick(); } catch (e) { show(e.message, true); } finally { b.disabled = false; }
    });
    return b;
  }

  let people = [];

  async function loadPeople() {
    const payload = await api("/api/admin/nguoi");
    people = payload.nguoi || [];
    const body = $("#people-rows");
    body.replaceChildren();
    for (const person of people) {
      const row = document.createElement("tr");
      cell(row, person.login);
      cell(row, person.name);
      cell(row, ROLE_LABEL[person.role] || person.role);
      cell(row, person.active ? "Đang dùng" : "Tạm khoá", person.active ? "status-approved" : "status-blocked");
      const actions = cell(row, "");
      const wrap = document.createElement("div");
      wrap.className = "people-actions";
      wrap.appendChild(button("Sửa", () => {
        const form = $("#person-form");
        form.dangNhap.value = person.login;
        form.ten.value = person.name;
        form.vai.value = person.role;
        form.matKhau.value = "";
        form.dangNhap.focus();
      }));
      wrap.appendChild(button(person.active ? "Tạm khoá" : "Mở lại", async () => {
        await api("/api/admin/nguoi", { dangNhap: person.login, dangBat: !person.active });
        show(person.active ? `Đã khoá ${person.login}; mọi phiên của tài khoản đã kết thúc.` : `Đã mở lại ${person.login}.`);
        await loadPeople();
      }));
      actions.appendChild(wrap);
      body.appendChild(row);
    }
  }

  async function loadDevices() {
    const payload = await api("/api/admin/devices");
    const body = $("#device-rows");
    body.replaceChildren();
    const devices = (payload.data && payload.data.devices) || [];
    if (!devices.length) {
      const row = document.createElement("tr");
      cell(row, "Chưa có máy nào.").colSpan = 5;
      body.appendChild(row);
    }
    for (const device of devices) {
      const row = document.createElement("tr");
      cell(row, device.login || device.personId);
      cell(row, `${device.name || "(không tên)"} · ${device.id}`);
      cell(row, device.lastSeen ? new Date(device.lastSeen).toLocaleString("vi-VN") : "");
      cell(row, DEVICE_LABEL[device.status] || device.status, `status-${device.status}`);
      const actions = cell(row, "");
      const wrap = document.createElement("div");
      wrap.className = "people-actions";
      const set = (status, done) => async () => {
        await api("/api/admin/devices", { maNguoi: device.personId, deviceId: device.id, status });
        show(done);
        await loadDevices();
      };
      if (device.status !== "approved") wrap.appendChild(button("Duyệt", set("approved", "Đã duyệt máy."), true));
      if (device.status !== "blocked") wrap.appendChild(button("Chặn", set("blocked", "Đã chặn máy; phiên trên máy đó đã kết thúc.")));
      wrap.appendChild(button("Xoá", async () => {
        if (!window.confirm("Xoá máy này khỏi danh sách? Lần sau đăng nhập từ máy đó sẽ phải duyệt lại.")) return;
        await set("deleted", "Đã xoá máy.")();
      }));
      actions.appendChild(wrap);
      body.appendChild(row);
    }
  }

  $("#person-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = { dangNhap: form.dangNhap.value.trim().toLowerCase(), ten: form.ten.value.trim(), vai: form.vai.value };
    if (form.matKhau.value) body.matKhau = form.matKhau.value;
    try {
      const saved = await api("/api/admin/nguoi", body);
      show(saved.taoMoi ? `Đã tạo tài khoản ${body.dangNhap}. Máy đầu tiên người đó đăng nhập sẽ chờ bạn duyệt ở dưới.` : `Đã lưu ${body.dangNhap}.`);
      form.reset();
      await loadPeople();
    } catch (e) {
      show(e.message, true);
    }
  });

  $("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const r = await api("/api/admin/password-reset", { currentPassword: form.currentPassword.value, password: form.password.value });
      show(r.message || "Đã đổi mật khẩu.");
      form.reset();
    } catch (e) {
      show(e.message, true);
    }
  });

  (async () => {
    try {
      const me = await api("/api/admin/me");
      $("#who").textContent = `— ${me.admin.login} (${ROLE_LABEL[me.admin.role] || me.admin.role})`;
      if (!me.admin.laChuShop) {
        $("#people-panel").hidden = true;
        $("#devices-panel").hidden = true;
        show("Tài khoản nhân viên chỉ đổi được mật khẩu của chính mình.");
        return;
      }
      await Promise.all([loadPeople(), loadDevices()]);
    } catch (e) {
      show(e.message, true);
    }
  })();
})();
