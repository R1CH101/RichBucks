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
import { clientIp, ipAllowed, isLoopback, parseAllowlist } from "./ipAllowlist";
import {
  TeamsAppsStore,
  nextPackageVersion,
  teamsConfigDir,
  teamsConfigSecret,
} from "./teamsAppsStore";
import { buildTeamsAppZip, buildTeamsManifest } from "./teamsPackage";
import { resolveContractAddress } from "./resolveContractAddress";
import { listWallets } from "./walletDirectory";

dotenv.config({ path: "../.env" });
dotenv.config();
const contractAddress = resolveContractAddress();
assertAdminSecrets();

const teamsSecret = teamsConfigSecret();
const teamsApps = new TeamsAppsStore(
  process.env.TEAMS_CONFIG_DIR || (isProduction() ? teamsConfigDir() : "./data/config"),
  teamsSecret || "dev-only-change-me-local-not-prod!!"
);
teamsApps.seedFromEnvIfEmpty();

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
const allowedIps = parseAllowlist(process.env.ADMIN_ALLOWED_IPS);
if (isProduction() && allowedIps.length === 0) {
  console.error(
    "ADMIN_ALLOWED_IPS is required in production (comma-separated IPs/CIDRs, e.g. 203.0.113.10,10.0.0.0/8)"
  );
  process.exit(1);
}

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
  const addr = contractAddress || process.env.CONTRACT_ADDRESS || "";
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

type Flash = { kind: "ok" | "err"; text: string };

function takeFlash(req: express.Request): Flash | null {
  const s = req.session as { flash?: Flash };
  const f = s.flash || null;
  if (s.flash) delete s.flash;
  return f;
}

function setFlash(req: express.Request, kind: "ok" | "err", text: string) {
  (req.session as { flash?: Flash }).flash = { kind, text };
}

function flashHtml(flash: Flash | null): string {
  if (!flash) return "";
  const cls = flash.kind === "ok" ? "toast ok" : "toast err-toast";
  return `<div class="${cls}" role="status">${escapeHtml(flash.text)}</div>
<script>setTimeout(()=>{const t=document.querySelector('.toast');if(t)t.remove()},5200)</script>`;
}

function layout(title: string, body: string, flash: Flash | null = null) {
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
  .toast { margin: 0 0 1rem; padding: 0.75rem 1rem; border-radius: 10px; border: 1px solid #2a3a30; animation: toast-in .25s ease-out; }
  .toast.ok { background: #163526; border-color: #2f6b4a; color: #c8efd8; }
  .toast.err-toast { background: #2a1616; border-color: #6b2f2f; color: #f0c8c8; }
  @keyframes toast-in { from { opacity:0; transform: translateY(-6px); } to { opacity:1; transform:none; } }
</style></head>
<body><main>
${flashHtml(flash)}
${body}
<p class="muted" style="margin-top:2rem">RichBucks admin · AGPL-3.0</p>
</main></body></html>`;
}

function walletDbPath(): string {
  return process.env.WALLET_DB_PATH || "./data/wallets.sqlite";
}

/** Block non-allowlisted clients before session/login (loopback /health exempt for Coolify). */
app.use((req, res, next) => {
  if (allowedIps.length === 0) return next(); // dev: unrestricted
  const ip = clientIp(req);
  if (req.path === "/health" && isLoopback(req.ip || ip)) return next();
  if (ipAllowed(ip, allowedIps)) return next();
  console.warn(`admin IP denied: ${ip} ${req.method} ${req.path}`);
  return res.status(403).send(layout("Forbidden", `<p class="err">Access denied from this network.</p>`));
});

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
  const ip = clientIp(req) || "unknown";
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
  // Rotate session payload on login (new CSRF + auth flag)
  const s = req.session as { authed?: boolean; csrf?: string } | null;
  if (s) {
    for (const k of Object.keys(s)) delete (s as Record<string, unknown>)[k];
    s.authed = true;
    s.csrf = crypto.randomBytes(24).toString("hex");
  }
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
      `<nav><a href="/">Dashboard</a><a href="/mint">Mint</a><a href="/teams-apps">Teams apps</a>
      <form style="display:inline" method="post" action="/logout">${csrfField(req)}<button type="submit">Log out</button></form></nav>
      <h1>Dashboard</h1>
      <p class="sub">Sole admin surface — Teams has no /admin. Deployer key stays here; bot uses welcome minter only. Add each Entra tenant's bot under Teams apps.</p>
      <div class="card">${stats}</div>
      ${tipFlags}
      <div class="card">
        <h2>Public RPC</h2>
        <p class="muted">${process.env.PUBLIC_RPC_URL || "Set PUBLIC_RPC_URL"} · chainId 88420 · token ${contractAddress || process.env.CONTRACT_ADDRESS || "unset"}</p>
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
  const flash = takeFlash(req);
  const users = listWallets(walletDbPath());
  const options = users.length
    ? [
        `<option value="">— Select a Teams user —</option>`,
        ...users.map((u) => {
          const label = [
            u.displayName,
            u.email ? `<${u.email}>` : null,
            u.address.slice(0, 10) + "…",
          ]
            .filter(Boolean)
            .join(" · ");
          return `<option value="${escapeHtml(u.address)}">${escapeHtml(label)}</option>`;
        }),
      ].join("")
    : `<option value="">No bot users yet — someone must message RichBucks first</option>`;

  res.send(
    layout(
      "Mint",
      `<nav><a href="/">Dashboard</a><a href="/mint">Mint</a><a href="/teams-apps">Teams apps</a></nav>
      <h1>Admin mint</h1>
      <p class="sub">Pick a user who has already talked to the bot, or paste a raw 0x address.</p>
      <form method="post" action="/mint" class="card" id="mint-form">
        ${csrfField(req)}
        <label>Teams user</label>
        <select name="user" id="mint-user" ${users.length ? "" : "disabled"}>
          ${options}
        </select>
        <label>Or address (0x…)</label>
        <input name="to" id="mint-to" placeholder="0x…" autocomplete="off" />
        <label>Amount (whole RB, max 100000 per tx)</label>
        <input name="amount" pattern="\\d+" required />
        <button type="submit">Mint</button>
      </form>
      <script>
        (function(){
          var sel=document.getElementById('mint-user');
          var to=document.getElementById('mint-to');
          if(!sel||!to) return;
          sel.addEventListener('change', function(){
            if(sel.value) to.value = sel.value;
          });
        })();
      </script>`,
      flash
    )
  );
});

app.post("/mint", requireAuth, requireCsrf, async (req, res) => {
  const ctx = getOwner();
  if (!ctx) {
    setFlash(req, "err", "Chain not configured (RPC / contract / deployer key).");
    return res.redirect("/mint");
  }
  const to = String(req.body.to || req.body.user || "").trim();
  let amount: bigint;
  try {
    amount = BigInt(String(req.body.amount || "0"));
  } catch {
    setFlash(req, "err", "Invalid amount.");
    return res.redirect("/mint");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(to) || amount <= 0n || amount > 100000n) {
    setFlash(req, "err", "Pick a user or enter a valid 0x address and amount (1–100000).");
    return res.redirect("/mint");
  }
  try {
    const tx = await ctx.token.mintAdmin(to, amount, { gasPrice: 0n });
    await tx.wait();
    setFlash(req, "ok", `Minted ${amount.toString()} RB to ${to}. Tx ${tx.hash}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    setFlash(req, "err", `Mint failed: ${msg}`);
  }
  res.redirect("/mint");
});

app.get("/teams-apps", requireAuth, (req, res) => {
  const apps = teamsApps.listPublic();
  const botHost =
    process.env.BOT_PUBLIC_HOST ||
    (() => {
      try {
        return new URL(process.env.PUBLIC_BOT_URL || "https://bot.richbucks.xyz").hostname;
      } catch {
        return "bot.richbucks.xyz";
      }
    })();
  const flash = takeFlash(req);
  const rows = apps.length
    ? apps
        .map((a) => {
          const last = a.packageVersion || "—";
          const next = nextPackageVersion(a.packageVersion);
          const pkgId = a.packageId || a.appId;
          return `<tr>
          <td>
            <div>${escapeHtml(a.label)}</div>
            <div class="muted" style="margin-top:0.35rem;font-size:0.8rem">App ID<br/><code>${escapeHtml(a.appId)}</code></div>
          </td>
          <td>
            <div><strong>v${escapeHtml(String(last))}</strong></div>
            <div class="muted">next zip → <code>v${escapeHtml(next)}</code></div>
            <div class="muted" style="margin-top:0.35rem;font-size:0.8rem">Package id (manifest)<br/><code>${escapeHtml(pkgId)}</code></div>
            <form method="post" action="/teams-apps/package-meta" style="margin-top:0.5rem">
              ${csrfField(req)}
              <input type="hidden" name="id" value="${escapeHtml(a.id)}" />
              <label style="margin-top:0.35rem">Match existing Teams catalog GUID</label>
              <input name="packageId" value="${escapeHtml(pkgId)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
              <label>Baseline version (optional)</label>
              <input name="packageVersion" value="${escapeHtml(a.packageVersion || "")}" placeholder="1.0.0" />
              <button type="submit" style="margin-top:0.5rem;padding:0.4rem 0.7rem;font-size:0.85rem">Save package id</button>
            </form>
          </td>
          <td style="white-space:nowrap">
            <a class="btn" style="margin-top:0;padding:0.4rem 0.7rem;font-size:0.85rem" href="/teams-apps/${escapeHtml(a.id)}/package.zip">Download zip (bumps version)</a>
            <a class="btn" style="margin-top:0;padding:0.4rem 0.7rem;font-size:0.85rem;background:#2a3a30;color:var(--text)" href="/teams-apps/${escapeHtml(a.id)}/manifest.json">manifest.json</a>
            <form method="post" action="/teams-apps/delete" style="display:inline">
              ${csrfField(req)}
              <input type="hidden" name="id" value="${escapeHtml(a.id)}" />
              <button type="submit" onclick="return confirm('Remove this Teams app?')">Delete</button>
            </form>
          </td>
        </tr>`;
        })
        .join("")
    : `<tr><td colspan="3" class="muted">No apps yet — add your personal and/or company bot registrations below.</td></tr>`;

  res.send(
    layout(
      "Teams apps",
      `<nav><a href="/">Dashboard</a><a href="/mint">Mint</a><a href="/teams-apps">Teams apps</a></nav>
      <h1>Teams apps</h1>
      <p class="sub">Each single-tenant Azure Bot / app registration that should hit this RichBucks bot. Same messaging URL for all: <code>https://${escapeHtml(botHost)}/api/messages</code>. Passwords are stored encrypted; never shown again after save.</p>
      <div class="card">
        <h2>Teams app package</h2>
        <p class="muted">Download bumps <code>manifest.version</code> every time (zip filename + app full name include it). Teams Admin → Manage apps must show that same version after upload.</p>
        <p class="muted"><strong>Important:</strong> package <code>id</code> must match the app already in your Teams catalog (copy GUID from Manage apps). If it doesn’t, upload creates a second RichBucks instead of updating group-chat scopes.</p>
        <p class="muted">Azure messaging endpoint: <code>https://${escapeHtml(botHost)}/api/messages</code>. Group chat: update existing org app → accept Update → Add to a chat / <code>@RichBucks</code>.</p>
      </div>
      <div class="card">
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
          <thead><tr>
            <th align="left">App</th><th align="left">Package</th><th align="left">Download</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <form method="post" action="/teams-apps" class="card">
        ${csrfField(req)}
        <h2>Add app</h2>
        <label>Label</label><input name="label" placeholder="Company" required />
        <label>Application (client) ID</label><input name="appId" required />
        <label>Client secret</label><input name="appPassword" type="password" required autocomplete="new-password" />
        <label>Directory (tenant) ID</label><input name="tenantId" required />
        <button type="submit">Save app</button>
      </form>`,
      flash
    )
  );
});

app.post("/teams-apps/package-meta", requireAuth, requireCsrf, (req, res) => {
  try {
    teamsApps.setPackageMeta(String(req.body.id || ""), {
      packageId: String(req.body.packageId || ""),
      packageVersion: String(req.body.packageVersion || ""),
    });
    setFlash(req, "ok", "Package id / baseline version saved. Download zip next — version will bump from that baseline.");
    res.redirect("/teams-apps");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    setFlash(req, "err", msg);
    res.redirect("/teams-apps");
  }
});

app.get("/teams-apps/:id/package.zip", requireAuth, async (req, res) => {
  const app = teamsApps.getById(String(req.params.id || ""));
  if (!app) return res.status(404).send(layout("Teams apps", `<p class="err">App not found.</p>`));
  try {
    const { packageId, packageVersion } = teamsApps.bumpPackage(app.id);
    const { zip, filename } = await buildTeamsAppZip(
      {
        id: app.id,
        label: app.label,
        appId: app.appId,
        tenantId: app.tenantId,
        createdAt: app.createdAt,
        packageId,
        packageVersion,
      },
      { packageId, version: packageVersion }
    );
    setFlash(req, "ok", `Packaged v${packageVersion} — upload this zip in Teams Admin and confirm that version shows on RichBucks.`);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-RichBucks-Package-Version", packageVersion);
    res.send(zip);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).send(layout("Teams apps", `<p class="err">${escapeHtml(msg)}</p><a class="btn" href="/teams-apps">Back</a>`));
  }
});

app.get("/teams-apps/:id/manifest.json", requireAuth, (req, res) => {
  const app = teamsApps.getById(String(req.params.id || ""));
  if (!app) return res.status(404).json({ error: "not found" });
  let packageId = app.packageId || app.appId;
  let packageVersion = app.packageVersion || "1.0.0";
  try {
    const bumped = teamsApps.bumpPackage(app.id);
    packageId = bumped.packageId;
    packageVersion = bumped.packageVersion;
  } catch {
    /* keep defaults */
  }
  const manifest = buildTeamsManifest(
    {
      id: app.id,
      label: app.label,
      appId: app.appId,
      tenantId: app.tenantId,
      createdAt: app.createdAt,
      packageId,
      packageVersion,
    },
    { packageId, version: packageVersion }
  );
  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="manifest-${(app.label || "app").replace(/[^a-zA-Z0-9._-]+/g, "-")}.json"`
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(JSON.stringify(manifest, null, 2));
});

app.post("/teams-apps", requireAuth, requireCsrf, (req, res) => {
  try {
    teamsApps.upsert({
      label: String(req.body.label || ""),
      appId: String(req.body.appId || ""),
      appPassword: String(req.body.appPassword || ""),
      tenantId: String(req.body.tenantId || ""),
    });
    res.redirect("/teams-apps");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).send(layout("Teams apps", `<p class="err">${escapeHtml(msg)}</p><a class="btn" href="/teams-apps">Back</a>`));
  }
});

app.post("/teams-apps/delete", requireAuth, requireCsrf, (req, res) => {
  teamsApps.delete(String(req.body.id || ""));
  res.redirect("/teams-apps");
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const joinHits = new Map<string, { count: number; start: number }>();
const joinFailHits = new Map<string, { count: number; start: number }>();
const joinEnabled = process.env.JOIN_ENABLED === "true";

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function rateBucket(
  map: Map<string, { count: number; start: number }>,
  key: string,
  windowMs: number,
  max: number
): boolean {
  const now = Date.now();
  let bucket = map.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    map.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

/**
 * Coworker node join — genesis + bootnodes.
 * Disabled unless JOIN_ENABLED=true. Still behind ADMIN_ALLOWED_IPS + Bearer key.
 * Stricter rate limits; failed auth counts separately to slow brute force.
 */
app.get("/join/config", (req, res) => {
  if (!joinEnabled) return res.status(503).json({ error: "join disabled" });
  if (!joinApiKey) return res.status(503).json({ error: "join disabled" });

  const ip = clientIp(req) || "unknown";
  if (!rateBucket(joinHits, ip, 60_000, 5)) {
    return res.status(429).json({ error: "rate limited" });
  }

  const auth = req.header("authorization") || "";
  const key = auth.replace(/^Bearer\s+/i, "");
  if (!key || !timingSafeEqualStr(key, joinApiKey)) {
    if (!rateBucket(joinFailHits, ip, 15 * 60_000, 10)) {
      return res.status(429).json({ error: "rate limited" });
    }
    return res.status(401).json({ error: "unauthorized" });
  }

  const genesisPath =
    process.env.GENESIS_PATH || path.join(__dirname, "../../chain/network/genesis.json");
  if (!fs.existsSync(genesisPath)) {
    return res.status(503).json({ error: "genesis not available on this host" });
  }
  const genesis = JSON.parse(fs.readFileSync(genesisPath, "utf8"));
  // Return only what a node needs — no extra host metadata
  const bootnodes = (process.env.BOOTNODE_ENODE || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  res.setHeader("Cache-Control", "no-store");
  res.json({ genesis, bootnodes });
});

app.listen(port, () => {
  console.log(
    `RichBucks admin on ${port} (secureCookie=${cookieSecure}, ipAllowlist=${allowedIps.length ? allowedIps.length + " rules" : "off"})`
  );
});
