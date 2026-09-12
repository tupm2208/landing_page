const statusBox = document.getElementById("auth-status");
const message = document.getElementById("auth-message");
const authTitle = document.getElementById("auth-title");
const authIntro = document.getElementById("auth-intro");
const forms = Array.from(document.querySelectorAll(".account-form[data-panel]"));
const profilePanel = document.getElementById("profile-panel");
const profileName = document.getElementById("profile-name");
const profileEmail = document.getElementById("profile-email");
const resetToken = new URLSearchParams(window.location.search).get("reset") || "";
const verifyToken = new URLSearchParams(window.location.search).get("verify") || "";

const viewCopy = {
  login: {
    title: "Đăng nhập tài khoản",
    intro: "Đăng nhập để xem lịch sử đơn hàng, trạng thái xử lý, tracking và hành trình đơn của bạn."
  },
  register: {
    title: "Đăng ký tài khoản",
    intro: "Tạo tài khoản bằng tên đăng nhập và email để có thể khôi phục mật khẩu khi cần."
  },
  forgot: {
    title: "Quên mật khẩu",
    intro: "Nhập email đã đăng ký để nhận link đặt lại mật khẩu."
  },
  reset: {
    title: "Đặt lại mật khẩu",
    intro: "Tạo mật khẩu mới cho tài khoản TopRun của bạn."
  }
};

initAccount();

async function initAccount() {
  bindViews();
  bindForms();
  if (resetToken) showView("reset");
  if (verifyToken) await verifyPendingChange();
  await loadMe();
}

function bindViews() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });
}

function bindForms() {
  document.getElementById("register-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    if (!data.username || !data.email) {
      message.textContent = "Vui lòng nhập tên đăng nhập và email.";
      return;
    }
    if (data.password !== data.confirmPassword) {
      message.textContent = "Mật khẩu xác nhận chưa khớp.";
      return;
    }
    const result = await postJSON("/api/account/register", data);
    handleAuthResult(result, "Đã tạo tài khoản.");
  });

  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await postJSON("/api/account/login", formData(event.currentTarget));
    handleAuthResult(result, "Đã đăng nhập.");
  });

  document.getElementById("forgot-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await postJSON("/api/account/forgot-password", formData(event.currentTarget));
    message.textContent = result.message || (result.ok ? "Đã gửi yêu cầu." : "Chưa gửi được yêu cầu.");
  });

  document.getElementById("reset-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    data.token = resetToken;
    const result = await postJSON("/api/account/reset-password", data);
    message.textContent = result.message || (result.ok ? "Đã đặt lại mật khẩu." : "Chưa đặt lại được mật khẩu.");
    if (result.ok) {
      history.replaceState({}, "", "/account.html");
      showView("login");
    }
  });

  document.getElementById("logout-button").addEventListener("click", async () => {
    await postJSON("/api/account/logout", {});
    renderProfile(null);
    showView("login");
    message.textContent = "Đã đăng xuất.";
  });
}

async function loadMe() {
  const result = await fetch("/api/account/me", { credentials: "same-origin" }).then((res) => res.json()).catch(() => null);
  renderProfile(result?.customer || null);
}

async function verifyPendingChange() {
  const result = await postJSON("/api/account/verify-change", { token: verifyToken });
  message.textContent = result.message || (result.ok ? "Đã xác thực thay đổi." : "Link xác thực không hợp lệ.");
  history.replaceState({}, "", "/account.html");
}

function handleAuthResult(result, successMessage) {
  if (!result?.ok) {
    message.textContent = result?.message || "Thao tác chưa thành công.";
    return;
  }
  renderProfile(result.customer);
  message.textContent = successMessage;
}

function renderProfile(customer) {
  if (!customer) {
    statusBox.textContent = "Bạn chưa đăng nhập.";
    profilePanel.hidden = true;
    return;
  }
  statusBox.textContent = "Bạn đang đăng nhập.";
  profileName.textContent = customer.username || customer.name || "Tài khoản TopRun";
  profileEmail.textContent = customer.email || customer.phone || "";
  profilePanel.hidden = false;
  forms.forEach((form) => { form.hidden = true; });
}

function showView(view) {
  const nextView = view || "login";
  const copy = viewCopy[nextView] || viewCopy.login;
  authTitle.textContent = copy.title;
  authIntro.textContent = copy.intro;
  forms.forEach((form) => {
    form.hidden = form.dataset.panel !== nextView;
  });
  profilePanel.hidden = true;
  message.textContent = "";
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function postJSON(url, data) {
  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok && payload.ok !== false, ...payload };
  } catch {
    return { ok: false, message: "Không kết nối được máy chủ." };
  }
}
