import express from "express";
import session from "cookie-session";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import * as dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { assertAdminSecrets, isProduction } from "./secrets";

dotenv.config({ path: "../.env" });
dotenv.config();
assertAdminSecrets();

const port = Number(process.env.ADMIN_PORT || 3000);
const username = process.env.ADMIN_USERNAME || "admin";
const passwordHash =
  process.env.ADMIN_PASSWORD_HASH ||
  bcrypt.hashSync(process.env.ADMIN_PASSWORD || "change-me", 10);

if (isProduction() && !process.env.ADMIN_TOTP_SECRET) {
  console.error("ADMIN_TOTP_SECRET is required in production");
  process.exit(1);
}
const totpSecret = process.env.ADMIN_TOTP_SECRET || authenticator.generateSecret();
const sessionSecret = process.env.SESSION_SECRET || "dev-session-secret-local-only!!";
const joinApiKey = process.env.NODE_JOIN_API_KEY || "";
const cookieSecure =
  process.env.COOKIE_SECURE === "true" ||
  (isProduction() && process.env.COOKIE_SECURE !== "false");

const ABI = [
  "function totalSupply() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function dailyAllowance() view returns (uint256)",
  "function verifierReward() view returns (uint256)",
  "function welcomeAmount() view returns (uint256)",
  "function welcomeMintEnabled() view returns (bool)",
  "function adminMintEnabled() view returns (bool)",
  "function dailyTipEnabled() view returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function mintAdmin(address to, uint256 amount)",
  "function setDailyAllowance(uint256)",
  "function setVerifierReward(uint256)",
  "function setMaxSupply(uint256)",
  "function setWelcomeAmount(uint256)",
  "function setWelcomeMintEnabled(bool)",
  "function setAdminMintEnabled(bool)",
  "function setDailyTipEnabled(bool)",
  "function setTimezoneOffsetSeconds(int64)",
  "function setWelcomeMinter(address)",
] as const;

function getOwner() {
  const rpc = process.env.RPC_URL || "http://127.0.0.1:8545";
  const key = process.env.DEPLOYER_PRIVATE_KEY || "";
  const addr = process.env.CONTRACT_ADDRESS || "";
  if (!key || !addr) return null;
  const provider = new JsonRpcProvider(rpc);
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  const wallet = new Wallet(normalized, provider);
  const token = new Contract(addr, ABI, wallet);
  return { provider, wallet, token };
}

const loginAttempts = new Map<string, { count: number; start: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 8;

function rateLimitLogin(ip: string): boolean {
  const now = Date.now();
  let b = loginAttempts.get(ip);
  if (!b || now - b.start > LOGIN_WINDOW_MS) {
    b = { count: 0, start: now };
    loginAttempts.set(ip, b);
  }
  b.count += 1;
  return b.count <= LOGIN_MAX;
}

function csrfToken(req: express.Request): string {
  const s = req.session as { csrf?: string };
  if (!s.csrf) s.csrf = crypto.randomBytes(24).toString("hex");
  return s.csrf;
}

function requireCsrf(req: express.Request, res: express.Response, next: express.NextFunction) {
  const expected = (req.session as { csrf?: string }).csrf;
  const got = String(req.body?._csrf || req.header("x-csrf-token") || "");
  if (!expected || !got || expected.length !== got.length) {
    return res.status(403).send(layout("Forbidden", `<p class="err">Invalid CSRF token.</p>`));
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(403).send(layout("Forbidden", `<p class="err">Invalid CSRF token.</p>`));
  }
  return next();
}

function csrfField(req: express.Request): string {
  return `<input type="hidden" name="_csrf" value="${csrfToken(req)}" />`;
}

const app = express();
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    name: "rb_admin",
    keys: [sessionSecret],
    maxAge: 12 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "strict",
    secure: cookieSecure,
  })
);

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if ((req.session as { authed?: boolean })?.authed) return next();
  return res.redirect("/login");
}

function layout(title: string, body: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} · RichBucks Admin</title>
<style>
  :root { --bg:#0f1410; --panel:#1a221c; --text:#e8f0ea; --muted:#9bb0a2; --accent:#3d9b6a; --danger:#c45c5c; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: "Segoe UI", system-ui, sans-serif; background:linear-gradient(160deg,#0f1410,#152018 40%,#101610); color:var(--text); min-height:100vh; }
  main { max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
  .sub { color: var(--muted); margin-bottom: 1.5rem; }
  .card { background: var(--panel); border: 1px solid #2a3a30; border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; }
  label { display:block; font-size: 0.85rem; color: var(--muted); margin: 0.75rem 0 0.25rem; }
  input, select { width: 100%; padding: 0.6rem 0.7rem; border-radius: 8px; border: 1px solid #33443a; background:#0f1612; color:var(--text); }
  button, .btn { display:inline-block; margin-top: 1rem; background: var(--accent); color:#04140c; border:0; border-radius: 8px; padding: 0.65rem 1rem; font-weight: 650; cursor:pointer; text-decoration:none; }
  .row { display:grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap: 0.75rem; }
  .stat { font-size: 1.4rem; font-weight: 700; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .err { color: var(--danger); }
  nav a { color: var(--accent); margin-right: 1rem; }
</style></head>
<body><main>
${body}
<p class="muted" style="margin-top:2rem">RichBucks admin · internal joke token · no cash value · AGPL-3.0</p>
</main></body></html>`;
}

app.get("/health", (_req, res) => res.send("ok"));

app.get("/login", (req, res) => {
  res.send(
    layout(
      "Login",
      `<h1>RichBucks Admin</h1>
      <p class="sub">Username + password + 2FA (TOTP). Set ADMIN_TOTP_SECRET in Coolify before first login.</p>
      <div class="card">
        <form method="post" action="/login">
          ${csrfField(req)}
          <label>Username</label><input name="username" autocomplete="username" required />
          <label>Password</label><input name="password" type="password" autocomplete="current-password" required />
          <label>2FA code</label><input name="otp" inputmode="numeric" autocomplete="one-time-code" required />
          <button type="submit">Sign in</button>
        </form>
      </div>`
    )
  );
});

app.post("/login", requireCsrf, (req, res) => {
  const ip = req.ip || "unknown";
  if (!rateLimitLogin(ip)) {
    return res
      .status(429)
      .send(layout("Login", `<p class="err">Too many attempts. Try again later.</p>`));
  }

  const { username: u, password, otp } = req.body;
  const userOk = u === username;
  const passOk = bcrypt.compareSync(password || "", passwordHash);
  const otpOk = authenticator.check(otp || "", totpSecret);
  if (!userOk || !passOk || !otpOk) {
    return res
      .status(401)
      .send(
        layout(
          "Login",
          `<p class="err">Invalid credentials.</p><a class="btn" href="/login">Try again</a>`
        )
      );
  }
  // Regenerate CSRF + mark authed
  (req.session as { authed?: boolean; csrf?: string }).csrf = crypto.randomBytes(24).toString("hex");
  (req.session as { authed?: boolean }).authed = true;
  res.redirect("/");
});

app.post("/logout", requireAuth, requireCsrf, (req, res) => {
  req.session = null;
  res.redirect("/login");
});

app.get("/", requireAuth, async (req, res) => {
  const ctx = getOwner();
  let stats = "Configure RPC_URL, CONTRACT_ADDRESS, DEPLOYER_PRIVATE_KEY";
  let tipFlags = "";
  if (ctx) {
    try {
      const [supply, max, daily, ver, welcome, wEn, aEn, tEn] = await Promise.all([
        ctx.token.totalSupply(),
        ctx.token.maxSupply(),
        ctx.token.dailyAllowance(),
        ctx.token.verifierReward(),
        ctx.token.welcomeAmount(),
        ctx.token.welcomeMintEnabled(),
        ctx.token.adminMintEnabled(),
        ctx.token.dailyTipEnabled(),
      ]);
      let block = "?";
      try {
        block = (await ctx.provider.getBlockNumber()).toString();
      } catch {
        /* ignore */
      }
      stats = `
        <div class="row">
          <div><div class="muted">Supply</div><div class="stat">${supply}</div></div>
          <div><div class="muted">Max</div><div class="stat">${max}</div></div>
          <div><div class="muted">Daily tip</div><div class="stat">${daily}</div></div>
          <div><div class="muted">Verifier</div><div class="stat">${ver}</div></div>
          <div><div class="muted">Welcome</div><div class="stat">${welcome}</div></div>
          <div><div class="muted">Block</div><div class="stat">${block}</div></div>
        </div>
        <p class="muted">welcomeMint=${wEn} · adminMint=${aEn} · dailyTip=${tEn} · showMetamask=${process.env.SHOW_METAMASK_CARD}</p>`;
      tipFlags = `
        <form method="post" action="/settings" class="card">
          ${csrfField(req)}
          <h2>Parameters</h2>
          <label>Daily allowance (max 100 via UI)</label><input name="dailyAllowance" value="${daily}" />
          <label>Verifier reward (max 100 via UI)</label><input name="verifierReward" value="${ver}" />
          <label>Welcome amount (max 1000 via UI)</label><input name="welcomeAmount" value="${welcome}" />
          <label>Max supply (0 = unlimited)</label><input name="maxSupply" value="${max}" />
          <label>Timezone offset seconds (0=UTC/GMT, 3600=BST)</label><input name="tz" value="0" />
          <label><input type="checkbox" name="welcomeMintEnabled" ${wEn ? "checked" : ""}/> Welcome mint enabled</label>
          <label><input type="checkbox" name="adminMintEnabled" ${aEn ? "checked" : ""}/> Admin mint enabled</label>
          <label><input type="checkbox" name="dailyTipEnabled" ${tEn ? "checked" : ""}/> Daily tips enabled</label>
          <button type="submit">Save on-chain settings</button>
        </form>`;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      stats = `<p class="err">${msg}</p>`;
    }
  }

  res.send(
    layout(
      "Dashboard",
      `<nav><a href="/">Dashboard</a><a href="/mint">Mint</a>
      <form style="display:inline" method="post" action="/logout">${csrfField(req)}<button type="submit">Log out</button></form></nav>
      <h1>Dashboard</h1>
      <p class="sub">Sole admin surface — Teams has no /admin. Deployer key stays here; bot uses welcome minter only.</p>
      <div class="card">${stats}</div>
      ${tipFlags}
      <div class="card">
        <h2>Public RPC</h2>
        <p class="muted">${process.env.PUBLIC_RPC_URL || "Set PUBLIC_RPC_URL"} · chainId 88420 · token ${process.env.CONTRACT_ADDRESS || "unset"}</p>
      </div>`
    )
  );
});

app.post("/settings", requireAuth, requireCsrf, async (req, res) => {
  const ctx = getOwner();
  if (!ctx) return res.status(500).send("chain not configured");
  const b = req.body;
  const daily = BigInt(b.dailyAllowance || "0");
  const ver = BigInt(b.verifierReward || "0");
  const welcome = BigInt(b.welcomeAmount || "0");
  if (daily > 100n || ver > 100n || welcome > 1000n) {
    return res.status(400).send(layout("Settings", `<p class="err">Parameter above UI safety cap.</p>`));
  }
  const txs = [
    ctx.token.setDailyAllowance(daily, { gasPrice: 0n }),
    ctx.token.setVerifierReward(ver, { gasPrice: 0n }),
    ctx.token.setWelcomeAmount(welcome, { gasPrice: 0n }),
    ctx.token.setMaxSupply(BigInt(b.maxSupply || "0"), { gasPrice: 0n }),
    ctx.token.setTimezoneOffsetSeconds(BigInt(b.tz || "0"), { gasPrice: 0n }),
    ctx.token.setWelcomeMintEnabled(b.welcomeMintEnabled === "on", { gasPrice: 0n }),
    ctx.token.setAdminMintEnabled(b.adminMintEnabled === "on", { gasPrice: 0n }),
    ctx.token.setDailyTipEnabled(b.dailyTipEnabled === "on", { gasPrice: 0n }),
  ];
  for (const p of txs) await (await p).wait();
  res.redirect("/");
});

app.get("/mint", requireAuth, (req, res) => {
  res.send(
    layout(
      "Mint",
      `<nav><a href="/">Dashboard</a></nav>
      <h1>Admin mint</h1>
      <form method="post" action="/mint" class="card">
        ${csrfField(req)}
        <label>Address (0x…)</label><input name="to" required />
        <label>Amount (whole RB, max 100000 per tx via UI)</label><input name="amount" pattern="\\d+" required />
        <button type="submit">Mint</button>
      </form>`
    )
  );
});

app.post("/mint", requireAuth, requireCsrf, async (req, res) => {
  const ctx = getOwner();
  if (!ctx) return res.status(500).send("chain not configured");
  const to = String(req.body.to || "");
  const amount = BigInt(String(req.body.amount || "0"));
  if (!/^0x[a-fA-F0-9]{40}$/.test(to) || amount <= 0n || amount > 100000n) {
    return res.status(400).send(layout("Mint", `<p class="err">Invalid address or amount</p>`));
  }
  const tx = await ctx.token.mintAdmin(to, amount, { gasPrice: 0n });
  await tx.wait();
  res.redirect("/mint");
});

const joinHits = new Map<string, { count: number; start: number }>();

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Coworker node join — genesis + bootnodes behind API key (v1.1 / VPN). */
app.get("/join/config", (req, res) => {
  const ip = req.ip || "unknown";
  const now = Date.now();
  let bucket = joinHits.get(ip);
  if (!bucket || now - bucket.start > 60_000) {
    bucket = { start: now, count: 0 };
    joinHits.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > 30) return res.status(429).json({ error: "rate limited" });

  if (!joinApiKey) return res.status(503).json({ error: "join disabled" });
  const auth = req.header("authorization") || "";
  const key = auth.replace(/^Bearer\s+/i, "");
  if (!key || !timingSafeEqualStr(key, joinApiKey)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const genesisPath =
    process.env.GENESIS_PATH || path.join(__dirname, "../../chain/network/genesis.json");
  if (!fs.existsSync(genesisPath)) {
    return res.status(503).json({ error: "genesis not available on this host" });
  }
  const genesis = JSON.parse(fs.readFileSync(genesisPath, "utf8"));
  const bootnodes = (process.env.BOOTNODE_ENODE || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  res.json({ genesis, bootnodes });
});

app.listen(port, () => {
  console.log(`RichBucks admin on ${port} (secureCookie=${cookieSecure})`);
});
