const loginSection = document.getElementById("ctv-login-section");
const forgotSection = document.getElementById("ctv-forgot-section");
const resetSection = document.getElementById("ctv-reset-section");
const message = document.getElementById("ctv-login-message");
const resetToken = new URLSearchParams(location.search).get("reset") || "";

if (resetToken) showSection(resetSection);
else verifySession();

document.getElementById("ctv-forgot-open")?.addEventListener("click", () => showSection(forgotSection));
document.getElementById("ctv-login-open")?.addEventListener("click", () => showSection(loginSection));
document.getElementById("ctv-login-form")?.addEventListener("submit", submitLogin);
document.getElementById("ctv-forgot-form")?.addEventListener("submit", submitForgot);
document.getElementById("ctv-reset-form")?.addEventListener("submit", submitReset);

async function verifySession() {
  try {
    const response = await fetch("/api/ctv/me", { credentials: "same-origin", cache: "no-store" });
    if (response.ok) location.replace("/ctv-account");
  } catch {}
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await submit(form, "/api/ctv/login", Object.fromEntries(new FormData(form)), () => {
    clearCtvMeCache();
    location.replace("/ctv-account");
  });
}

// Cache trang thai CTV (app.js/product.js/mobile-v1.js) co TTL 10 phut; phai xoa ngay khi
// dang nhap/doi mat khau de badge + ?ref hien lien, khong cho het TTL.
function clearCtvMeCache() {
  try { sessionStorage.removeItem("ctv_me_cache"); } catch {}
}

async function submitForgot(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await submit(form, "/api/ctv/forgot-password", Object.fromEntries(new FormData(form)));
}

async function submitReset(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await submit(form, "/api/ctv/reset-password", { token: resetToken, password: new FormData(form).get("password") }, () => {
    clearCtvMeCache();
    history.replaceState({}, "", "/ctv-login");
    showSection(loginSection);
  });
}

async function submit(form, url, body, onSuccess) {
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  showMessage("Dang xu ly...");
  try {
    const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Khong thuc hien duoc.");
    showMessage(payload.message || "Thanh cong.");
    onSuccess?.();
  } catch (error) {
    showMessage(error.message || "Khong thuc hien duoc.", true);
  } finally {
    button.disabled = false;
  }
}

function showSection(section) {
  [loginSection, forgotSection, resetSection].forEach((item) => { item.hidden = item !== section; });
  message.hidden = true;
}

function showMessage(text, isError = false) {
  message.hidden = false;
  message.textContent = text;
  message.classList.toggle("is-error", isError);
}
