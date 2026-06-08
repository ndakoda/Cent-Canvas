const walletAddressEl = document.querySelector("#adminWalletAddress");
const walletNetworkEl = document.querySelector("#adminWalletNetwork");
const authTitle = document.querySelector("#authTitle");
const authDescription = document.querySelector("#authDescription");
const adminPassword = document.querySelector("#adminPassword");
const adminAuthButton = document.querySelector("#adminAuthButton");
const adminStatus = document.querySelector("#adminStatus");
const adminStatusText = document.querySelector("#adminStatusText");
const paymentForm = document.querySelector("#paymentForm");
const baseDestination = document.querySelector("#baseDestination");
const solanaDestination = document.querySelector("#solanaDestination");
const polygonDestination = document.querySelector("#polygonDestination");
const toast = document.querySelector("#toast");

const state = {
  token: localStorage.getItem("cent-canvas-admin-token") || "",
  configured: false,
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function fillPaymentForm(config) {
  const destinations = config.paymentDestinations || {};
  baseDestination.value = destinations.Base || "";
  solanaDestination.value = destinations.Solana || "";
  polygonDestination.value = destinations.Polygon || "";
}

function renderAuth(config) {
  state.configured = Boolean(config.adminConfigured);
  authTitle.textContent = state.configured ? "Admin login" : "Create admin password";
  authDescription.textContent = state.configured
    ? "Enter the backend admin password to manage payment destinations."
    : "Create the first backend admin password. Use at least 12 characters.";
  adminAuthButton.textContent = state.configured ? "Log in" : "Create secure admin";
}

function renderAdmin(active) {
  adminStatus.hidden = !active;
  paymentForm.hidden = !active;
  walletAddressEl.textContent = active ? "Backend session" : "Not logged in";
  walletNetworkEl.textContent = active ? "Authenticated" : "Required";
  adminStatusText.textContent = active ? "Backend admin session active" : "No admin session";
}

async function loadPublicConfig() {
  const config = await api("/api/config", { method: "GET", headers: {} });
  renderAuth(config);
  fillPaymentForm(config);
}

async function loadAdminConfig() {
  if (!state.token) {
    renderAdmin(false);
    return;
  }

  try {
    const config = await api("/api/admin/config", { method: "GET" });
    renderAuth(config);
    fillPaymentForm(config);
    renderAdmin(true);
  } catch {
    localStorage.removeItem("cent-canvas-admin-token");
    state.token = "";
    renderAdmin(false);
  }
}

async function authenticate() {
  const password = adminPassword.value;
  const endpoint = state.configured ? "/api/admin/login" : "/api/admin/setup";

  try {
    const payload = await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ password }),
      headers: {},
    });
    state.token = payload.token;
    localStorage.setItem("cent-canvas-admin-token", state.token);
    adminPassword.value = "";
    renderAuth(payload.config);
    fillPaymentForm(payload.config);
    renderAdmin(true);
    showToast(state.configured ? "Logged in." : "Admin password created.");
  } catch (error) {
    showToast(error.message);
  }
}

async function savePaymentDestinations(event) {
  event.preventDefault();

  try {
    const payload = await api("/api/admin/payment-destinations", {
      method: "PUT",
      body: JSON.stringify({
        paymentDestinations: {
          Base: baseDestination.value,
          Solana: solanaDestination.value,
          Polygon: polygonDestination.value,
        },
      }),
    });
    fillPaymentForm(payload);
    showToast("Payment destinations saved.");
  } catch (error) {
    showToast(error.message);
  }
}

adminAuthButton.addEventListener("click", authenticate);
paymentForm.addEventListener("submit", savePaymentDestinations);

loadPublicConfig().then(loadAdminConfig).catch((error) => showToast(error.message));
