const canvas = document.querySelector("#pixelCanvas");
const ctx = canvas.getContext("2d");
const wrap = document.querySelector(".canvas-wrap");

const selectedPixelEl = document.querySelector("#selectedPixel");
const pixelPreview = document.querySelector("#pixelPreview");
const priceUsdEl = document.querySelector("#priceUsd");
const priceCryptoEl = document.querySelector("#priceCrypto");
const currentOwnerEl = document.querySelector("#currentOwner");
const lastPaidEl = document.querySelector("#lastPaid");
const claimButton = document.querySelector("#claimButton");
const addToBatchButton = document.querySelector("#addToBatch");
const clearBatchButton = document.querySelector("#clearBatch");
const batchCountEl = document.querySelector("#batchCount");
const batchTotalEl = document.querySelector("#batchTotal");
const colorPicker = document.querySelector("#colorPicker");
const hexColorInput = document.querySelector("#hexColorInput");
const handleInput = document.querySelector("#handleInput");
const paymentWalletInput = document.querySelector("#paymentWalletInput");
const activityList = document.querySelector("#activityList");
const claimedCountEl = document.querySelector("#claimedCount");
const volumeTotalEl = document.querySelector("#volumeTotal");
const zoomValueEl = document.querySelector("#zoomValue");
const zoomSlider = document.querySelector("#zoomSlider");
const toast = document.querySelector("#toast");
const emptyHint = document.querySelector("#emptyHint");
const connectWalletButton = document.querySelector("#connectWallet");
const walletIdEl = document.querySelector("#walletId");
const walletAddressEl = document.querySelector("#walletAddress");
const walletNetworkEl = document.querySelector("#walletNetwork");
const adminPanel = document.querySelector("#adminPanel");
const clearBoardButton = document.querySelector("#clearBoard");
const turnOffAdminButton = document.querySelector("#turnOffAdmin");
const adminOwnerInput = document.querySelector("#adminOwnerInput");
const adminAddressInput = document.querySelector("#adminAddressInput");
const adminValueInput = document.querySelector("#adminValueInput");
const adminCountsVolume = document.querySelector("#adminCountsVolume");
const adminDragPaint = document.querySelector("#adminDragPaint");
const paymentDestinationEl = document.querySelector("#paymentDestination");
const freeStatusEl = document.querySelector("#freeStatus");
const freeDetailEl = document.querySelector("#freeDetail");
const leaderboardList = document.querySelector("#leaderboardList");

const board = {
  cols: 250,
  rows: 150,
  cell: 20,
  selected: null,
  cart: new Map(),
  dragging: false,
  rail: "Base",
  zoom: 1,
  pixels: new Map(),
  activity: [],
  leaderboard: [],
  freeStatus: {
    eligible: false,
    remaining: 0,
    used: 0,
    position: null,
    remainingSpots: 50,
  },
  config: {
    paymentDestinations: {
      Base: "",
      Solana: "",
      Polygon: "",
    },
    rpcUrls: {
      Solana: "https://solana-rpc.publicnode.com",
    },
  },
  adminToken: localStorage.getItem("cent-canvas-admin-token") || "",
  admin: false,
};

const storageKey = "cent-canvas-state";
const baseClaimCents = 10;
const maxAdminBatchPixels = 1200;
const usingFilePage = window.location.protocol === "file:";

const railRates = {
  Base: { symbol: "ETH", usd: 3500, chainId: "0x2105", explorer: "https://basescan.org/tx/" },
  Solana: { symbol: "SOL", usd: 145, explorer: "https://solscan.io/tx/" },
  Polygon: { symbol: "POL", usd: 0.72, chainId: "0x89", explorer: "https://polygonscan.com/tx/" },
};

function keyFor(x, y) {
  return `${x}:${y}`;
}

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function adminValueCents() {
  const dollars = Number(adminValueInput?.value || 0);
  return Math.max(0, Math.round(dollars * 100));
}

function requiredCents(pixel) {
  return pixel ? pixel.cents * 2 : baseClaimCents;
}

function cryptoPrice(cents) {
  const rate = railRates[board.rail];
  const amount = cents / 100 / rate.usd;
  const decimals = amount < 0.001 ? 6 : 4;
  return `${amount.toFixed(decimals)} ${rate.symbol}`;
}

function explorerUrl(rail, txHash) {
  if (!txHash) return "";
  return `${railRates[rail]?.explorer || ""}${txHash}`;
}

function cartItems() {
  return [...board.cart.values()];
}

function purchaseItems() {
  if (board.cart.size) return cartItems();
  return board.selected ? [board.selected] : [];
}

function itemCents(item) {
  const pixel = board.pixels.get(keyFor(item.x, item.y));
  return board.admin ? adminValueCents() : requiredCents(pixel);
}

function pricedPurchase(items = purchaseItems()) {
  let freeRemaining = board.freeStatus.remaining || 0;

  return items.map((item) => {
    const pixel = board.pixels.get(keyFor(item.x, item.y));
    const freeClaim = !pixel && freeRemaining > 0;
    if (freeClaim) freeRemaining -= 1;

    return {
      ...item,
      cents: freeClaim ? 0 : itemCents(item),
      freeClaim,
    };
  });
}

function purchaseTotalCents(items = purchaseItems()) {
  return pricedPurchase(items).reduce((sum, item) => sum + item.cents, 0);
}

function cryptoAmount(cents) {
  const rate = railRates[board.rail];
  return cents / 100 / rate.usd;
}

function shortAddress(address) {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function paymentDestination() {
  return board.config.paymentDestinations[board.rail] || "";
}

function backendUrl() {
  return "http://localhost:8080/";
}

function backendRequiredMessage() {
  return `Open ${backendUrl()} instead of this file page before verifying payment.`;
}

function shortDestination(destination) {
  if (!destination) return "Destination not set";
  if (destination.length <= 16) return destination;
  return `${destination.slice(0, 8)}...${destination.slice(-6)}`;
}

async function loadBackendConfig() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) throw new Error("Config unavailable.");

    const config = await response.json();
    board.config.paymentDestinations = {
      ...board.config.paymentDestinations,
      ...(config.paymentDestinations || {}),
    };
    board.config.rpcUrls = {
      ...board.config.rpcUrls,
      ...(config.rpcUrls || {}),
    };
  } catch {
    showToast("Backend config unavailable. Start the Node server for payments.");
  }
}

async function loadAdminSession() {
  board.adminToken = localStorage.getItem("cent-canvas-admin-token") || "";
  if (!board.adminToken) {
    board.admin = false;
    return;
  }

  try {
    const response = await fetch("/api/admin/config", {
      cache: "no-store",
      headers: { authorization: `Bearer ${board.adminToken}` },
    });
    if (!response.ok) throw new Error("Admin session expired.");
    board.admin = true;
  } catch {
    board.admin = false;
    board.adminToken = "";
    localStorage.removeItem("cent-canvas-admin-token");
  }
}

async function loadLeaderboard() {
  try {
    const response = await fetch("/api/leaderboard", { cache: "no-store" });
    if (!response.ok) throw new Error("Leaderboard unavailable.");
    const payload = await response.json();
    board.leaderboard = payload.leaders || [];
  } catch {
    board.leaderboard = [];
  }
}

function paymentWallet() {
  return paymentWalletInput.value.trim();
}

async function refreshFreeStatus() {
  const wallet = paymentWallet();
  if (!wallet) {
    board.freeStatus = { eligible: false, remaining: 0, used: 0, position: null, remainingSpots: board.freeStatus.remainingSpots || 50 };
    render();
    return;
  }

  try {
    const response = await fetch(`/api/free-status?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Free pass unavailable.");
    const status = await response.json();
    board.freeStatus = !status.eligible && status.remainingSpots > 0
      ? { ...status, eligible: true, remaining: 5, used: 0, position: null }
      : status;
  } catch {
    board.freeStatus = { eligible: false, remaining: 0, used: 0, position: null, remainingSpots: 0 };
  }

  render();
}

function setRail(rail) {
  board.rail = rail;
  board.cart.clear();
  document.querySelectorAll(".segment").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.rail === rail);
  });
  updateDetails();
}

function selectedKey() {
  if (!board.selected) return "";
  return keyFor(board.selected.x, board.selected.y);
}

function addCellToBatch(cell, force = false) {
  if (!cell) return;
  const key = keyFor(cell.x, cell.y);
  if (board.cart.has(key)) {
    if (!force) board.cart.delete(key);
  } else {
    board.cart.set(key, { ...cell });
  }
}

function addSelectedToBatch() {
  if (!board.selected) return;

  addCellToBatch(board.selected);
  render();
}

function clearBatch() {
  board.cart.clear();
  render();
}

function updateBatch() {
  const count = board.cart.size;
  const total = purchaseTotalCents(cartItems());

  batchCountEl.textContent = `${count} ${count === 1 ? "pixel" : "pixels"}`;
  batchTotalEl.textContent = `${money(total)} total`;
  addToBatchButton.disabled = !board.selected;
  addToBatchButton.textContent = board.cart.has(selectedKey()) ? "Remove" : "Add";
  clearBatchButton.disabled = count === 0;
}

function updateLeaderboard() {
  leaderboardList.innerHTML = "";

  if (!board.leaderboard.length) {
    const li = document.createElement("li");
    li.innerHTML = "<span><strong>No claims yet</strong>Be first on the board.</span><b>$0.00</b>";
    leaderboardList.append(li);
    return;
  }

  board.leaderboard.forEach((leader, index) => {
    const li = document.createElement("li");
    const dot = document.createElement("i");
    const text = document.createElement("span");
    const title = document.createElement("strong");
    const score = document.createElement("b");

    dot.setAttribute("aria-hidden", "true");
    dot.textContent = String(index + 1);
    title.textContent = leader.handle || shortAddress(leader.address);
    text.append(title, `${leader.pixels} pixels · ${leader.freePixels || 0} free`);
    score.textContent = money(leader.paidCents || 0);
    li.append(dot, text, score);
    leaderboardList.append(li);
  });
}

function normalizeHex(value) {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null;
}

function syncColor(value) {
  const color = normalizeHex(value);

  if (!color) {
    hexColorInput.classList.add("is-invalid");
    return false;
  }

  colorPicker.value = color;
  hexColorInput.value = color;
  hexColorInput.classList.remove("is-invalid");
  document.querySelectorAll(".swatch").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.color.toLowerCase() === color);
  });
  updateDetails();
  return true;
}

function saveBoard() {
  const state = {
    pixels: [...board.pixels.entries()],
    activity: board.activity.slice(0, 40),
  };
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function loadBoard() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;

    const state = JSON.parse(raw);
    board.pixels = new Map(state.pixels || []);
    board.activity = state.activity || [];
  } catch {
    localStorage.removeItem(storageKey);
  }
}

async function loadBackendClaims() {
  try {
    const response = await fetch("/api/claims", { cache: "no-store" });
    if (!response.ok) throw new Error("Claims unavailable.");

    const state = await response.json();
    board.pixels = new Map(state.pixels || []);
    board.activity = state.activity || [];
    saveBoard();
  } catch {
    loadBoard();
  }
}

async function saveClaimsToBackend(pixels, activity) {
  const isAdminChange = activity.some((item) => item.admin);
  const response = await fetch(isAdminChange ? "/api/admin/claims" : "/api/claims", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(isAdminChange ? { authorization: `Bearer ${board.adminToken}` } : {}),
    },
    body: JSON.stringify({ pixels, activity }),
  });
  const state = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(state.error || "Could not save claims to backend.");

  board.pixels = new Map(state.pixels || []);
  board.activity = state.activity || [];
  saveBoard();
}

async function savePublicClaimToBackend(payload) {
  const response = await fetch("/api/claims", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const state = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(state.error || "Payment could not be verified.");

  board.pixels = new Map(state.pixels || []);
  board.activity = state.activity || [];
  saveBoard();
}

function renderWallet() {
  const wallet = paymentWallet();

  walletIdEl.textContent = board.admin ? "Admin mode" : "Manual payment";
  walletAddressEl.textContent = board.admin ? "Admin mode" : wallet ? shortAddress(wallet) : "Paste sender wallet";
  walletNetworkEl.textContent = board.admin ? "Backend admin" : "Verified by transaction";
  connectWalletButton.classList.add("is-connected");
  connectWalletButton.setAttribute("aria-label", "Manual payment verification");
  adminPanel.hidden = !board.admin;
  canvas.classList.toggle("is-painting", dragPaintEnabled());
}

function renderFreeStatus() {
  if (!paymentWallet()) {
    freeStatusEl.textContent = "Enter wallet";
    freeDetailEl.textContent = `First 50 payment wallets get 5 free first-claim pixels. ${board.freeStatus.remainingSpots} spots left.`;
    return;
  }

  if (board.freeStatus.eligible) {
    freeStatusEl.textContent = `${board.freeStatus.remaining} free left`;
    freeDetailEl.textContent = board.freeStatus.position
      ? `You are launch wallet #${board.freeStatus.position}. Free pixels only apply to unclaimed squares.`
      : "This wallet can still claim launch-pass pixels.";
    return;
  }

  freeStatusEl.textContent = "Free spots filled";
  freeDetailEl.textContent = "Paid claims are still open at $0.10 per first claim.";
}

function paintBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  board.pixels.forEach((pixel, key) => {
    const [x, y] = key.split(":").map(Number);
    ctx.fillStyle = pixel.color;
    ctx.fillRect(x * board.cell, y * board.cell, board.cell, board.cell);
  });

  ctx.strokeStyle = "#d9e1ea";
  ctx.lineWidth = 1;
  for (let x = 0; x <= board.cols; x += 1) {
    ctx.beginPath();
    ctx.moveTo(x * board.cell + 0.5, 0);
    ctx.lineTo(x * board.cell + 0.5, canvas.height);
    ctx.stroke();
  }

  for (let y = 0; y <= board.rows; y += 1) {
    ctx.beginPath();
    ctx.moveTo(0, y * board.cell + 0.5);
    ctx.lineTo(canvas.width, y * board.cell + 0.5);
    ctx.stroke();
  }

  if (board.selected) {
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      board.selected.x * board.cell + 1.5,
      board.selected.y * board.cell + 1.5,
      board.cell - 3,
      board.cell - 3,
    );
  }

  board.cart.forEach((item) => {
    ctx.strokeStyle = "#f6b13d";
    ctx.lineWidth = 3;
    ctx.strokeRect(
      item.x * board.cell + 3.5,
      item.y * board.cell + 3.5,
      board.cell - 7,
      board.cell - 7,
    );
  });
}

function updateDetails() {
  const selected = board.selected;
  const pixel = selected ? board.pixels.get(keyFor(selected.x, selected.y)) : null;
  const items = purchaseItems();
  const cents = items.length > 1 ? purchaseTotalCents(items) : requiredCents(pixel);

  selectedPixelEl.textContent = selected ? `(${selected.x + 1}, ${selected.y + 1})` : "None";
  pixelPreview.style.background = selected ? colorPicker.value : "";
  priceUsdEl.textContent = money(cents);
  priceCryptoEl.textContent = cryptoPrice(cents);
  paymentDestinationEl.textContent = shortDestination(paymentDestination());
  currentOwnerEl.textContent = pixel ? pixel.owner : "Unclaimed";
  lastPaidEl.textContent = pixel ? money(pixel.cents) : "$0.00";
  const needsPaidVerification = !board.admin && purchaseTotalCents(items) > 0;
  claimButton.disabled =
    usingFilePage ||
    !items.length ||
    (!board.admin && !paymentWallet()) ||
    (needsPaidVerification && !paymentDestination());

  if (usingFilePage) {
    claimButton.textContent = "Open localhost server first";
  } else if (needsPaidVerification && !paymentDestination()) {
    claimButton.textContent = `${board.rail} destination not set`;
  } else if (!board.admin && !paymentWallet()) {
    claimButton.textContent = "Enter sender wallet";
  } else if (!items.length) {
    claimButton.textContent = "Choose a pixel";
  } else if (board.admin) {
    claimButton.textContent = items.length > 1 ? `Admin claim ${items.length}` : pixel ? "Admin overtake" : "Admin claim";
  } else {
    claimButton.textContent = cents > 0 ? "Verify payment and claim" : "Claim free pixels";
  }
}

function updateStats() {
  const claimed = board.pixels.size;
  const volume = board.activity.reduce((sum, item) => sum + item.cents, 0);
  claimedCountEl.textContent = claimed.toLocaleString();
  volumeTotalEl.textContent = money(volume);
  emptyHint.style.display = claimed ? "none" : "grid";
}

function updateActivity() {
  activityList.innerHTML = "";
  board.activity.slice(0, 7).forEach((item) => {
    const li = document.createElement("li");
    const dot = document.createElement("i");
    const text = document.createElement("span");
    const title = document.createElement("strong");
    const price = document.createElement("b");

    li.style.setProperty("--claim-color", item.color);
    dot.setAttribute("aria-hidden", "true");
    title.textContent = `${item.owner} claimed (${item.x + 1}, ${item.y + 1})`;
    text.append(title, item.action);
    if (item.txHash) {
      const link = document.createElement("a");
      link.href = explorerUrl(item.rail, item.txHash);
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "View transaction";
      text.append(" ", link);
    }
    price.textContent = money(item.cents);
    li.append(dot, text, price);
    activityList.append(li);
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function render() {
  paintBoard();
  renderWallet();
  renderFreeStatus();
  updateDetails();
  updateBatch();
  updateStats();
  updateActivity();
  updateLeaderboard();
}

function selectCell(event) {
  const cell = cellFromEvent(event);

  if (!cell) return;
  board.selected = cell;
  render();
}

function cellFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / (board.cell * board.zoom));
  const y = Math.floor((event.clientY - rect.top) / (board.cell * board.zoom));

  if (x < 0 || y < 0 || x >= board.cols || y >= board.rows) return null;
  return { x, y };
}

function dragPaintEnabled() {
  return board.admin && adminDragPaint.checked;
}

function startDragPaint(event) {
  if (!dragPaintEnabled()) return;

  event.preventDefault();
  board.dragging = true;
  const cell = cellFromEvent(event);
  if (!cell) return;
  board.selected = cell;
  addCellToBatch(cell, true);
  render();
}

function moveDragPaint(event) {
  if (!board.dragging || !dragPaintEnabled()) return;

  const cell = cellFromEvent(event);
  if (!cell) return;
  board.selected = cell;
  addCellToBatch(cell, true);
  render();
}

function stopDragPaint() {
  board.dragging = false;
}

async function claimSelected() {
  const items = purchaseItems();
  if (!items.length) return;
  if (usingFilePage && !board.admin) {
    showToast(backendRequiredMessage());
    return;
  }
  if (board.admin && items.length > maxAdminBatchPixels) {
    showToast(`Admin batch is ${items.length} pixels. Claim ${maxAdminBatchPixels} or fewer at once.`);
    return;
  }
  if (!board.admin && !paymentWallet()) {
    showToast("Enter the wallet/address you paid from.");
    return;
  }
  if (!board.admin && !paymentDestination()) {
    showToast(`Admin needs to set a ${board.rail} payment destination first.`);
    return;
  }

  claimButton.disabled = true;
  claimButton.textContent = "Scanning for payment...";

  try {
    const pricedItems = pricedPurchase(items);
    const totalCents = pricedItems.reduce((sum, item) => sum + item.cents, 0);
    const owner = board.admin ? adminOwnerInput.value.trim() || "featured" : handleInput.value.trim() || "anonymous";
    const ownerAddress = board.admin ? adminAddressInput.value.trim() || "featured-wallet" : paymentWallet();
    const batchId = crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase().padStart(8, "0");

    if (!board.admin) {
      claimButton.textContent = totalCents > 0 ? "Scanning blockchain..." : "Claiming free pixels...";
      await savePublicClaimToBackend({
        items: pricedItems.map(({ x, y }) => ({ x, y })),
        color: colorPicker.value,
        owner,
        ownerAddress,
        rail: board.rail,
      });
      board.cart.clear();
      showToast(`${items.length} ${items.length === 1 ? "pixel" : "pixels"} confirmed: ${money(totalCents)}`);
      await refreshFreeStatus();
      await loadLeaderboard();
      return;
    }

    const txHash = `admin-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16)}`;
    const changedPixels = [];
    const newActivity = [];

    pricedItems.forEach(({ x, y, cents, freeClaim }) => {
      const key = keyFor(x, y);
      const previous = board.pixels.get(key);

      const pixel = {
        color: colorPicker.value,
        owner,
        ownerAddress,
        cents: !adminCountsVolume.checked ? 0 : cents,
        displayCents: cents,
        rail: board.rail,
        paymentDestination: "",
        admin: true,
        syntheticClaim: true,
        countsVolume: adminCountsVolume.checked,
        freeClaim,
        txHash,
        batchId,
      };

      const activityItem = {
        x,
        y,
        color: colorPicker.value,
        owner,
        ownerAddress,
        cents: !adminCountsVolume.checked ? 0 : cents,
        displayCents: cents,
        rail: board.rail,
        paymentDestination: "",
        admin: true,
        syntheticClaim: true,
        countsVolume: adminCountsVolume.checked,
        freeClaim,
        txHash,
        batchId,
        action: previous ? `featured over ${previous.owner}` : "featured by admin",
      };

      board.pixels.set(key, pixel);
      board.activity.unshift(activityItem);
      changedPixels.push([key, pixel]);
      newActivity.push(activityItem);
    });

    board.cart.clear();
    showToast(`${items.length} ${items.length === 1 ? "pixel" : "pixels"} confirmed: ${money(totalCents)} - ${txHash}`);
    await saveClaimsToBackend(changedPixels, newActivity);
    await refreshFreeStatus();
    await loadLeaderboard();
  } catch (error) {
    showToast(error?.message || "Payment was cancelled.");
    saveBoard();
  } finally {
    render();
  }
}

function clearBoard() {
  if (!board.admin) return;

  fetch("/api/admin/clear-board", {
    method: "POST",
    headers: { authorization: `Bearer ${board.adminToken}` },
  })
    .then((response) => {
      if (!response.ok) throw new Error("Admin session required.");
      return response.json();
    })
    .then((state) => {
      board.pixels = new Map(state.pixels || []);
      board.activity = state.activity || [];
      saveBoard();
      return loadLeaderboard();
    })
    .then(() => {
      render();
      showToast("Board cleared.");
    })
    .catch((error) => showToast(error.message));
}

function turnOffAdminMode() {
  board.admin = false;
  board.adminToken = "";
  board.cart.clear();
  board.dragging = false;
  localStorage.removeItem("cent-canvas-admin-token");
  render();
  showToast("Admin mode turned off.");
}

function setZoom(value) {
  board.zoom = Math.min(2.2, Math.max(0.4, value));
  canvas.style.transform = `scale(${board.zoom})`;
  canvas.style.marginRight = `${canvas.width * (board.zoom - 1)}px`;
  canvas.style.marginBottom = `${canvas.height * (board.zoom - 1)}px`;
  zoomSlider.value = Math.round(board.zoom * 100);
  zoomValueEl.textContent = `${Math.round(board.zoom * 100)}%`;
}

function centerCanvas() {
  wrap.scrollTo({
    left: (wrap.scrollWidth - wrap.clientWidth) / 2,
    top: (wrap.scrollHeight - wrap.clientHeight) / 2,
    behavior: "smooth",
  });
}

function seedBoard() {
  if (board.pixels.size) {
    showToast("The board already has claims.");
    return;
  }

  const samples = [
    [8, 9, "#1f8fff", "lena", 10],
    [9, 9, "#1f8fff", "lena", 10],
    [10, 9, "#19b27b", "mika", 20],
    [38, 21, "#f6b13d", "vault", 40],
    [39, 21, "#ef4f6f", "neon", 80],
    [54, 32, "#111827", "cipher", 160],
  ];

  samples.forEach(([x, y, color, owner, cents]) => {
    board.pixels.set(keyFor(x, y), { color, owner, cents, rail: board.rail, hash: "seed" });
    board.activity.unshift({ x, y, color, owner, cents, action: `minted on ${board.rail}` });
  });

  showToast("Board seeded with example claims.");
  saveBoard();
  render();
}

canvas.addEventListener("click", selectCell);
canvas.addEventListener("pointerdown", startDragPaint);
canvas.addEventListener("pointermove", moveDragPaint);
window.addEventListener("pointerup", stopDragPaint);
claimButton.addEventListener("click", claimSelected);
addToBatchButton.addEventListener("click", addSelectedToBatch);
clearBatchButton.addEventListener("click", clearBatch);
paymentWalletInput.addEventListener("input", () => {
  window.clearTimeout(refreshFreeStatus.timer);
  refreshFreeStatus.timer = window.setTimeout(refreshFreeStatus, 350);
  render();
});
colorPicker.addEventListener("input", () => syncColor(colorPicker.value));
hexColorInput.addEventListener("input", () => syncColor(hexColorInput.value));
hexColorInput.addEventListener("blur", () => {
  if (!syncColor(hexColorInput.value)) {
    hexColorInput.value = colorPicker.value;
    hexColorInput.classList.remove("is-invalid");
  }
});

document.querySelectorAll(".swatch").forEach((swatch) => {
  swatch.addEventListener("click", () => {
    syncColor(swatch.dataset.color);
  });
});

document.querySelector(".swatch").classList.add("is-active");

document.querySelectorAll(".segment").forEach((segment) => {
  segment.addEventListener("click", () => {
    setRail(segment.dataset.rail);
  });
});

document.querySelector("#zoomOut").addEventListener("click", () => setZoom(board.zoom - 0.1));
document.querySelector("#zoomIn").addEventListener("click", () => setZoom(board.zoom + 0.1));
zoomSlider.addEventListener("input", () => setZoom(Number(zoomSlider.value) / 100));
document.querySelector("#centerCanvas").addEventListener("click", centerCanvas);
document.querySelector("#seedBoard").addEventListener("click", seedBoard);
clearBoardButton.addEventListener("click", clearBoard);
turnOffAdminButton.addEventListener("click", turnOffAdminMode);

Promise.all([loadBackendConfig(), loadBackendClaims(), loadLeaderboard(), loadAdminSession()]).finally(() => {
  setZoom(1);
  render();
  requestAnimationFrame(centerCanvas);
});
