const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const root = __dirname;
const dataDir = path.join(root, ".data");
const configPath = path.join(dataDir, "config.json");
const claimsPath = path.join(dataDir, "claims.json");
const port = Number(process.env.PORT || 8080);
const sessions = new Map();
const maxJsonBytes = 5 * 1024 * 1024;

function envPaymentDestinations() {
  return {
    Base: cleanDestination(process.env.BASE_PAYMENT_DESTINATION || process.env.PAYMENT_DESTINATION_BASE),
    Solana: cleanDestination(process.env.SOLANA_PAYMENT_DESTINATION || process.env.PAYMENT_DESTINATION_SOLANA),
    Polygon: cleanDestination(process.env.POLYGON_PAYMENT_DESTINATION || process.env.PAYMENT_DESTINATION_POLYGON),
  };
}

function envAdminPassword() {
  const password = String(process.env.ADMIN_PASSWORD || "");
  return password.length >= 12 ? password : "";
}

const defaultConfig = {
  admin: null,
  paymentDestinations: envPaymentDestinations(),
};

const boardCols = 250;
const boardRows = 150;
const baseClaimCents = 10;
const railRates = {
  Base: {
    chain: "evm",
    symbol: "ETH",
    usd: 3500,
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  },
  Solana: {
    chain: "solana",
    symbol: "SOL",
    usd: 145,
    rpcUrl: process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com",
  },
  Polygon: {
    chain: "evm",
    symbol: "POL",
    usd: 0.72,
    rpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
  },
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function loadConfig() {
  ensureDataDir();
  const envDestinations = envPaymentDestinations();

  if (!fs.existsSync(configPath)) {
    saveConfig(defaultConfig);
    return JSON.parse(JSON.stringify(defaultConfig));
  }

  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const savedDestinations = saved.paymentDestinations || {};
  return {
    ...defaultConfig,
    ...saved,
    paymentDestinations: {
      Base: cleanDestination(savedDestinations.Base) || envDestinations.Base,
      Solana: cleanDestination(savedDestinations.Solana) || envDestinations.Solana,
      Polygon: cleanDestination(savedDestinations.Polygon) || envDestinations.Polygon,
    },
  };
}

function saveConfig(config) {
  ensureDataDir();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function loadClaims() {
  ensureDataDir();
  if (!fs.existsSync(claimsPath)) return { pixels: [], activity: [], freeUsers: [] };
  const saved = JSON.parse(fs.readFileSync(claimsPath, "utf8"));
  return {
    pixels: saved.pixels || [],
    activity: saved.activity || [],
    freeUsers: saved.freeUsers || [],
  };
}

function saveClaims(claims) {
  ensureDataDir();
  fs.writeFileSync(claimsPath, JSON.stringify(claims, null, 2));
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxJsonBytes) {
        settled = true;
        reject(new Error("Request body is too large. Try claiming fewer pixels at once."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (settled) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, admin) {
  if (!admin?.salt || !admin?.hash) return false;

  const hash = crypto.scryptSync(password, admin.salt, 64);
  const saved = Buffer.from(admin.hash, "hex");
  return saved.length === hash.length && crypto.timingSafeEqual(saved, hash);
}

function verifyAdminLogin(password, config) {
  const envPassword = envAdminPassword();
  if (envPassword && password === envPassword) return true;
  return verifyPassword(password, config.admin);
}

function hasAdmin(config) {
  return Boolean(config.admin || envAdminPassword());
}

function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + 1000 * 60 * 60 * 12);
  return token;
}

function isAuthed(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expiresAt = sessions.get(token);

  if (!expiresAt || expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }

  return true;
}

function publicConfig(config) {
  return {
    adminConfigured: hasAdmin(config),
    paymentDestinations: config.paymentDestinations,
    rpcUrls: {
      Solana: railRates.Solana.rpcUrl,
    },
  };
}

function cleanDestination(value) {
  return String(value || "").trim().slice(0, 120);
}

function walletKey(address) {
  return String(address || "").trim().toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAddress(address) {
  return String(address || "").trim();
}

function normalizeEvmAddress(address) {
  return normalizeAddress(address).toLowerCase();
}

function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || ""));
}

function keyFor(x, y) {
  return `${x}:${y}`;
}

function requiredCents(pixel) {
  return pixel ? Number(pixel.cents || 0) * 2 : baseClaimCents;
}

function weiForCents(cents, rail) {
  return BigInt(Math.ceil((cents / 100 / railRates[rail].usd) * 1e18));
}

function lamportsForCents(cents, rail) {
  return BigInt(Math.max(1, Math.ceil((cents / 100 / railRates[rail].usd) * 1_000_000_000)));
}

async function rpcRequest(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok || body.error) {
      throw new Error(body.error?.message || "RPC request failed.");
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

function txHashAlreadyUsed(claims, txHash) {
  if (!txHash) return false;
  return (claims.activity || []).some((item) => item.txHash === txHash);
}

async function verifyEvmPayment({ rail, txHash, from, to, cents }) {
  const expectedWei = weiForCents(cents, rail);
  const rpcUrl = railRates[rail].rpcUrl;
  const expectedFrom = normalizeEvmAddress(from);
  const expectedTo = normalizeEvmAddress(to);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const [tx, receipt] = await Promise.all([
      rpcRequest(rpcUrl, { jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [txHash] }),
      rpcRequest(rpcUrl, { jsonrpc: "2.0", id: 2, method: "eth_getTransactionReceipt", params: [txHash] }),
    ]);

    if (tx && receipt) {
      const paidWei = BigInt(tx.value || "0x0");
      if (receipt.status !== "0x1") throw new Error("Transaction failed on-chain.");
      if (normalizeEvmAddress(tx.from) !== expectedFrom) throw new Error("Transaction sender does not match your wallet.");
      if (normalizeEvmAddress(tx.to) !== expectedTo) throw new Error("Transaction recipient does not match the admin destination.");
      if (paidWei < expectedWei) throw new Error("Transaction amount is too low for these pixels.");
      return;
    }

    await sleep(2500);
  }

  throw new Error("Transaction is not confirmed yet. Try again after it appears in the explorer.");
}

function accountKeyToString(account) {
  return typeof account === "string" ? account : account?.pubkey || "";
}

async function verifySolanaPayment({ rail, txHash, from, to, cents }) {
  const expectedLamports = lamportsForCents(cents, rail);
  const rpcUrl = railRates[rail].rpcUrl;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const tx = await rpcRequest(rpcUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [txHash, { commitment: "confirmed", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
    });

    if (tx) {
      if (tx.meta?.err) throw new Error("Transaction failed on-chain.");

      const accountKeys = tx.transaction?.message?.accountKeys || [];
      const signedByWallet = accountKeys.some((account) => accountKeyToString(account) === from && account.signer);
      if (!signedByWallet) throw new Error("Transaction signer does not match your wallet.");

      const instructions = tx.transaction?.message?.instructions || [];
      const paidLamports = instructions.reduce((sum, instruction) => {
        const parsed = instruction.parsed;
        if (instruction.program !== "system" || parsed?.type !== "transfer") return sum;
        if (parsed.info?.source !== from || parsed.info?.destination !== to) return sum;
        return sum + BigInt(parsed.info?.lamports || 0);
      }, 0n);

      if (paidLamports < expectedLamports) throw new Error("Transaction amount is too low for these pixels.");
      return;
    }

    await sleep(2500);
  }

  throw new Error("Transaction is not confirmed yet. Try again after it appears in the explorer.");
}

async function verifyPayment(details) {
  if (details.cents <= 0) return;
  if (!details.txHash) throw new Error("Transaction hash is required.");

  if (railRates[details.rail].chain === "evm") {
    await verifyEvmPayment(details);
    return;
  }

  await verifySolanaPayment(details);
}

function freeStatusFor(claims, address) {
  const key = walletKey(address);
  const index = claims.freeUsers.findIndex((user) => user.address === key);
  const user = index >= 0 ? claims.freeUsers[index] : null;

  return {
    eligible: Boolean(user),
    remaining: user ? Math.max(0, 5 - (user.used || 0)) : 0,
    used: user?.used || 0,
    position: index >= 0 ? index + 1 : null,
    remainingSpots: Math.max(0, 50 - claims.freeUsers.length),
  };
}

function leaderboardFor(claims) {
  const leaders = new Map();

  (claims.activity || []).forEach((item) => {
    const key = walletKey(item.ownerAddress || item.owner);
    if (!key) return;

    const current = leaders.get(key) || {
      address: item.ownerAddress || item.owner,
      handle: item.owner || "anonymous",
      paidCents: 0,
      pixels: 0,
      freePixels: 0,
    };

    current.pixels += 1;
    current.paidCents += Number(item.cents || 0);
    if (item.freeClaim) current.freePixels += 1;
    if (item.owner) current.handle = item.owner;
    leaders.set(key, current);
  });

  return [...leaders.values()]
    .sort((a, b) => b.paidCents - a.paidCents || b.pixels - a.pixels)
    .slice(0, 10);
}

function mergeClaimChanges(saved, body) {
  const pixelMap = new Map(saved.pixels || []);
  const pixels = Array.isArray(body.pixels) ? body.pixels : [];
  const incomingActivity = Array.isArray(body.activity) ? body.activity : [];

  if (pixels.length > 1500) {
    throw new Error("Admin batch is too large. Claim 1,500 pixels or fewer at once.");
  }

  pixels.forEach(([key, pixel]) => {
    if (typeof key === "string" && pixel && typeof pixel === "object") {
      pixelMap.set(key, pixel);
    }
  });

  const activity = [...incomingActivity, ...(saved.activity || [])].slice(0, 200);
  incomingActivity.forEach((item) => {
    if (!item.freeClaim) return;
    const address = walletKey(item.ownerAddress);
    const user = saved.freeUsers.find((entry) => entry.address === address);
    if (user) user.used = Math.min(5, (user.used || 0) + 1);
  });

  return { pixels: [...pixelMap.entries()], activity, freeUsers: saved.freeUsers || [] };
}

function preparePublicClaim(saved, body, config) {
  const rail = String(body.rail || "");
  const railConfig = railRates[rail];
  const ownerAddress = normalizeAddress(body.ownerAddress);
  const owner = String(body.owner || "anonymous").trim().slice(0, 18) || "anonymous";
  const color = String(body.color || "").trim().toLowerCase();
  const txHash = String(body.txHash || "").trim();
  const paymentDestination = cleanDestination(config.paymentDestinations[rail]);
  const pixelMap = new Map(saved.pixels || []);
  const items = Array.isArray(body.items) ? body.items.slice(0, 500) : [];

  if (!railConfig) throw new Error("Unsupported payment rail.");
  if (!ownerAddress) throw new Error("Wallet address is required.");
  if (!isHexColor(color)) throw new Error("Use a valid hex color.");
  if (!items.length) throw new Error("Choose at least one pixel.");

  if (txHashAlreadyUsed(saved, txHash)) throw new Error("That transaction hash has already been used.");

  const unique = new Map();
  items.forEach((item) => {
    const x = Number(item?.x);
    const y = Number(item?.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= boardCols || y >= boardRows) {
      throw new Error("Pixel coordinates are outside the board.");
    }
    unique.set(keyFor(x, y), { x, y });
  });

  const address = walletKey(ownerAddress);
  let user = (saved.freeUsers || []).find((entry) => entry.address === address);
  if (!user && (saved.freeUsers || []).length < 50) {
    user = { address, used: 0, createdAt: new Date().toISOString() };
    saved.freeUsers.push(user);
  }

  let freeRemaining = user ? Math.max(0, 5 - (user.used || 0)) : 0;
  let totalCents = 0;
  const batchId = crypto.randomBytes(4).toString("hex").toUpperCase();
  const changedPixels = [];
  const newActivity = [];
  let usedFreePixels = 0;

  [...unique.values()].forEach(({ x, y }) => {
    const key = keyFor(x, y);
    const previous = pixelMap.get(key);
    const freeClaim = !previous && freeRemaining > 0;
    if (freeClaim) {
      freeRemaining -= 1;
      usedFreePixels += 1;
    }

    const cents = freeClaim ? 0 : requiredCents(previous);
    totalCents += cents;

    const shared = {
      color,
      owner,
      ownerAddress,
      cents,
      displayCents: cents,
      rail,
      paymentDestination: cents > 0 ? paymentDestination : "",
      admin: false,
      syntheticClaim: false,
      countsVolume: true,
      freeClaim,
      txHash: cents > 0 ? txHash : "",
      batchId,
    };

    const pixel = { ...shared };
    const activityItem = {
      x,
      y,
      ...shared,
      action: freeClaim ? "used a launch pass" : previous ? `took it from ${previous.owner}` : `minted on ${rail}`,
    };

    pixelMap.set(key, pixel);
    changedPixels.push([key, pixel]);
    newActivity.push(activityItem);
  });

  if (totalCents > 0 && !txHash) throw new Error("Transaction hash is required for paid pixels.");
  if (totalCents > 0 && !paymentDestination) throw new Error(`${rail} payment destination is not set.`);
  if (user && usedFreePixels) user.used = Math.min(5, (user.used || 0) + usedFreePixels);

  return {
    next: {
      pixels: [...pixelMap.entries()],
      activity: [...newActivity, ...(saved.activity || [])].slice(0, 200),
      freeUsers: saved.freeUsers || [],
    },
    verification: {
      rail,
      txHash,
      from: ownerAddress,
      to: paymentDestination,
      cents: totalCents,
    },
    newActivity,
    user,
  };
}

async function handleApi(req, res, url) {
  const config = loadConfig();

  try {
    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, publicConfig(config));
    }

    if (req.method === "GET" && url.pathname === "/api/claims") {
      return sendJson(res, 200, loadClaims());
    }

    if (req.method === "GET" && url.pathname === "/api/leaderboard") {
      return sendJson(res, 200, { leaders: leaderboardFor(loadClaims()) });
    }

    if (req.method === "GET" && url.pathname === "/api/solana/blockhash") {
      const blockhash = await rpcRequest(railRates.Solana.rpcUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "getLatestBlockhash",
        params: [{ commitment: "confirmed" }],
      });
      return sendJson(res, 200, blockhash?.value || blockhash);
    }

    if (req.method === "GET" && url.pathname === "/api/free-status") {
      return sendJson(res, 200, freeStatusFor(loadClaims(), url.searchParams.get("wallet")));
    }

    if (req.method === "POST" && url.pathname === "/api/free-register") {
      const { wallet } = await readJson(req);
      const claims = loadClaims();
      const address = walletKey(wallet);

      if (!address) return sendJson(res, 400, { error: "Wallet is required." });

      let status = freeStatusFor(claims, address);
      if (!status.eligible) {
        if (claims.freeUsers.length >= 50) return sendJson(res, 200, status);

        claims.freeUsers.push({ address, used: 0, createdAt: new Date().toISOString() });
        saveClaims(claims);
        status = freeStatusFor(claims, address);
      }

      return sendJson(res, 200, status);
    }

    if (req.method === "POST" && url.pathname === "/api/claims") {
      const body = await readJson(req);
      const saved = loadClaims();
      const prepared = preparePublicClaim(saved, body, config);
      await verifyPayment(prepared.verification);
      saveClaims(prepared.next);
      return sendJson(res, 200, prepared.next);
    }

    if (req.method === "POST" && url.pathname === "/api/admin/setup") {
      if (hasAdmin(config)) return sendJson(res, 409, { error: "Admin is already configured." });

      const { password } = await readJson(req);
      if (typeof password !== "string" || password.length < 12) {
        return sendJson(res, 400, { error: "Use an admin password with at least 12 characters." });
      }

      config.admin = hashPassword(password);
      saveConfig(config);
      return sendJson(res, 200, { token: createSession(), config: publicConfig(config) });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/login") {
      const { password } = await readJson(req);
      if (!verifyAdminLogin(String(password || ""), config)) {
        return sendJson(res, 401, { error: "Admin login failed." });
      }

      return sendJson(res, 200, { token: createSession(), config: publicConfig(config) });
    }

    if (url.pathname.startsWith("/api/admin/")) {
      if (!isAuthed(req)) return sendJson(res, 401, { error: "Admin session required." });

      if (req.method === "GET" && url.pathname === "/api/admin/config") {
        return sendJson(res, 200, publicConfig(config));
      }

      if (req.method === "POST" && url.pathname === "/api/admin/claims") {
        const body = await readJson(req);
        const saved = loadClaims();
        const next = mergeClaimChanges(saved, body);
        saveClaims(next);
        return sendJson(res, 200, next);
      }

      if (req.method === "POST" && url.pathname === "/api/admin/clear-board") {
        const saved = loadClaims();
        const activity = [
          {
            x: 0,
            y: 0,
            color: "#ffffff",
            owner: "admin",
            ownerAddress: "backend-admin",
            cents: 0,
            rail: "Admin",
            admin: true,
            txHash: `admin-clear-${Date.now()}`,
            action: "cleared the board",
          },
          ...(saved.activity || []),
        ].slice(0, 200);
        const next = { pixels: [], activity, freeUsers: saved.freeUsers || [] };
        saveClaims(next);
        return sendJson(res, 200, next);
      }

      if (req.method === "PUT" && url.pathname === "/api/admin/payment-destinations") {
        const { paymentDestinations = {} } = await readJson(req);
        config.paymentDestinations = {
          Base: cleanDestination(paymentDestinations.Base),
          Solana: cleanDestination(paymentDestinations.Solana),
          Polygon: cleanDestination(paymentDestinations.Polygon),
        };
        saveConfig(config);
        return sendJson(res, 200, publicConfig(config));
      }
    }

    return sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Request failed." });
  }
}

function serveStatic(req, res, url) {
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requestPath));

  if (!filePath.startsWith(root) || filePath.startsWith(dataDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }

  serveStatic(req, res, url);
});

server.listen(port, () => {
  console.log(`Cent Canvas backend running at http://localhost:${port}`);
});
