const form = document.getElementById("admin-login-form");
const message = document.getElementById("login-message");
const adminDeviceKey = "toprun_admin_device_id";
const adminDeviceNameKey = "toprun_admin_device_name";

function adminDeviceId() {
  let id = localStorage.getItem(adminDeviceKey);
  if (!id) {
    id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `adm-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(adminDeviceKey, id);
  }
  return id;
}

function adminDeviceName() {
  let name = localStorage.getItem(adminDeviceNameKey);
  if (!name) {
    const platform = navigator.platform || "Thiet bi";
    const browser = (navigator.userAgent || "").split(" ").slice(0, 4).join(" ");
    name = `${platform} - ${browser}`.slice(0, 120);
    localStorage.setItem(adminDeviceNameKey, name);
  }
  return name;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.hidden = true;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        login: document.getElementById("admin-login").value,
        password: document.getElementById("admin-password").value,
        deviceId: adminDeviceId(),
        deviceName: adminDeviceName()
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (payload.error === "device_not_approved" || payload.error === "device_blocked") {
      const device = payload.device || {};
      const code = device.id ? ` Ma thiet bi: ${device.id}` : "";
      throw new Error(`${payload.message || "Thiet bi chua duoc cap quyen."}${code}`);
    }
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Khong dang nhap duoc.");
    location.replace("/admin");
  } catch (error) {
    message.textContent = error.message || "Khong dang nhap duoc.";
    message.hidden = false;
  } finally {
    button.disabled = false;
  }
});
