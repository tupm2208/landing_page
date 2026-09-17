const loginForm = document.getElementById("partner-login-form");
const loginMessage = document.getElementById("message");

function setLoginMessage(text, isError = false) {
  if (!loginMessage) return;
  loginMessage.textContent = text || "";
  loginMessage.style.color = isError ? "#b91c1c" : "#23785b";
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button[type='submit']");
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/partner-portal/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        login: document.getElementById("partner-login-id")?.value || "",
        password: document.getElementById("partner-login-password")?.value || ""
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok || !payload.token) {
      throw new Error(payload.message || "Không đăng nhập được.");
    }
    sessionStorage.removeItem("partnerLoginMessage");
    location.replace(`/partner/${payload.token}`);
  } catch (error) {
    setLoginMessage(error.message || "Không đăng nhập được.", true);
  } finally {
    if (button) button.disabled = false;
  }
});

const loginNotice = sessionStorage.getItem("partnerLoginMessage") || "";
sessionStorage.removeItem("partnerLoginMessage");
if (loginNotice) setLoginMessage(loginNotice, true);
