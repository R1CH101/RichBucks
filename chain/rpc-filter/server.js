/**
 * Public JSON-RPC gateway — allowlist ETH/NET/WEB3 only (no QBFT/admin/debug).
 */
const express = require("express");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8549);
const UPSTREAM = process.env.UPSTREAM_RPC || "http://validator-1:8545";
const API_KEY = process.env.RPC_API_KEY || "";
/** Explicit opt-in only — default off so MetaMask can use the bare public URL. */
const REQUIRE_KEY = process.env.RPC_REQUIRE_API_KEY === "true";
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = Number(process.env.RPC_RATE_MAX || 120);

if (REQUIRE_KEY && (!API_KEY || API_KEY.length < 16)) {
  console.error("RPC_API_KEY required (min 16 chars) when RPC_REQUIRE_API_KEY=true");
  process.exit(1);
}

const ALLOWED = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_sendRawTransaction",
  "eth_syncing",
  "net_listening",
  "net_peerCount",
  "net_version",
  "web3_clientVersion",
  "web3_sha3",
]);

const hits = new Map();

function rateLimit(ip) {
  const now = Date.now();
  let bucket = hits.get(ip);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    hits.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count <= RATE_MAX;
}

function methodsOf(body) {
  const list = Array.isArray(body) ? body : [body];
  return list.map((x) => (x && typeof x.method === "string" ? x.method : ""));
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function apiKeyOk(req) {
  if (!REQUIRE_KEY) return true;
  const hdr = req.header("x-api-key") || "";
  const auth = (req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  const pathKey = (req.query.key || "").toString();
  return (
    timingSafeEqualStr(hdr, API_KEY) ||
    timingSafeEqualStr(auth, API_KEY) ||
    timingSafeEqualStr(pathKey, API_KEY)
  );
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.status(200).send("ok"));

app.post("/", async (req, res) => {
  const ip = req.ip || "unknown";
  if (!rateLimit(ip)) {
    return res.status(429).json({ jsonrpc: "2.0", error: { code: -32000, message: "rate limited" }, id: null });
  }

  if (!apiKeyOk(req)) {
    return res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "unauthorized" }, id: null });
  }

  const methods = methodsOf(req.body);
  for (const m of methods) {
    if (!ALLOWED.has(m)) {
      return res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32601, message: `method not allowed: ${m || "(missing)"}` },
        id: Array.isArray(req.body) ? null : req.body?.id ?? null,
      });
    }
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const text = await upstream.text();
    res.status(upstream.status).type("application/json").send(text);
  } catch (e) {
    console.error("upstream error", e);
    res.status(502).json({ jsonrpc: "2.0", error: { code: -32002, message: "upstream unavailable" }, id: null });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `rpc-filter on ${PORT} → ${UPSTREAM} (allowlist ETH/NET/WEB3, apiKey=${API_KEY ? "required" : "off"})`
  );
});
