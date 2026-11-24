# RichBucks setup guide

End-to-end guide to deploy RichBucks on a VPS (Coolify): private Besu chain, RichBucks (RB) token, Microsoft Teams bot, admin UI, and the Teams app package (manifest + icons).

Repo: https://github.com/R1CH101/RichBucks

---

## What you will end up with

| Piece | Example public URL |
|---|---|
| Admin UI | `https://admin.richbucks.xyz` |
| Teams bot webhook | `https://bot.richbucks.xyz/api/messages` |
| Public wallet RPC | `https://rpc.richbucks.xyz` |
| 4 Besu validators + bot + admin | Private Docker network on the VPS |

Suggested order:

1. Domains + Coolify project  
2. Generate secrets and deployer key  
3. Init Besu network on the VPS  
4. Deploy compose stack  
5. Deploy RichBucks contract  
6. Azure Bot + Teams app  
7. Smoke-test commands  
8. (Optional) Ubicloud CI + coworker nodes  

---

## 0. Prerequisites

- A VPS with Docker (Coolify installed is ideal)
- A domain (or subdomains) pointing at the VPS
- Access to Microsoft 365 / Entra as admin (you are IT)
- Node.js 22+ only if you run contract tests locally (Coolify deploys the token via `contract-deploy`)
- GitHub account `R1CH101` (repo already public)

Clone on the VPS or let Coolify pull the repo:

```bash
git clone https://github.com/R1CH101/RichBucks.git
cd RichBucks
cp .env.example .env
```

---

## 1. Domains / Coolify routing (richbucks.xyz)

Domain: **richbucks.xyz** (Cloudflare). Suggested DNS records → VPS IP:

| Hostname | Proxy | Purpose |
|---|---|---|
| `admin.richbucks.xyz` | Proxied (orange) | Admin UI HTTPS |
| `bot.richbucks.xyz` | Proxied (orange) | Teams webhook HTTPS |
| `rpc.richbucks.xyz` | Proxied (orange) | Public JSON-RPC HTTPS |

**Public / coworker P2P: disabled for v1** (no `p2p.richbucks.xyz`, do not open port 30303 on the firewall). The four **company validators still peer inside Docker** via auto bootnode `…@validator-1:30303` on the private compose network (no public VPS IP).

**v1.1:** Tailscale / WireGuard (or similar) so coworkers can run nodes without publishing the VPS IP on `richbucks.xyz`.

Coolify / reverse-proxy map:

| Host | Proxies to | Path |
|---|---|---|
| `admin.richbucks.xyz` | `admin:3000` | `/` |
| `bot.richbucks.xyz` | `bot:3978` | `/` (Teams needs `/api/messages`) |
| `rpc.richbucks.xyz` | `rpc-filter` → Coolify Domains `https://rpc.richbucks.xyz:8549` | `/` |

`rpc-filter`, `bot`, and `admin` are in the **root** compose so Coolify lists them for Domains. Use the container port in the Domains field (`:3978`, `:3000`, `:8549`); visitors still use normal HTTPS. Prefer `expose` over host `ports:`.

Keep validator RPC (`8545`) **off** the public internet. Only `rpc-filter` is proxied (ETH/NET/WEB3 allowlist — **no QBFT**). Cloudflare SSL: **Full (strict)**. Pass `RPC_API_KEY` as `x-api-key` / Bearer on public RPC.

After contract deploy, set a **separate** `WELCOME_MINTER_PRIVATE_KEY` for the bot and call `setWelcomeMinter(minterAddress)` from the owner key (admin) so the bot cannot upgrade the contract.

Set in Coolify / `.env`:

```env
PUBLIC_RPC_URL=https://rpc.richbucks.xyz
```

---

## 2. Environment variables and secrets

Copy `.env.example` → `.env` (or Coolify “Environment Variables”). **Never commit `.env`.**

Below: meaning, example shape, and how to generate / obtain each value.

### 2.1 Chain / RPC

| Variable | Example | How to get it |
|---|---|---|
| `CHAIN_ID` | `88420` | Fixed for RichBucks — leave as-is |
| `RPC_URL` | `http://validator-1:8545` | Internal Docker DNS. From a laptop tunnel use `http://127.0.0.1:8545` |
| `PUBLIC_RPC_URL` | `https://rpc.richbucks.xyz` | Your public HTTPS RPC hostname |
| `BESU_IMAGE_TAG` | `25.1.0` | Pin Besu image tag (never use env name `BESU_VERSION`) |
| `EMPTY_BLOCK_PERIOD_SECONDS` | `3600` | Prod heartbeat. Dev genesis uses `30` via `init-network.sh dev` |
| `BOOTNODE_ENODE` | *(leave empty)* | Optional override. Peers auto-load `enode://…@validator-1:30303` from `/network/bootnode.enode` (or `key.pub`) on the chain volume |

**Bootnode (usually automatic)**

chain-init writes `/network/bootnode.enode` from validator-1’s `key.pub`. Validators 2–4 fill an empty `--bootnodes=` from that file — **no Coolify paste required**.

To print it (debug / coworker VPN later):

```bash
# On the VPS / Coolify terminal (needs docker + running validator-1):
./chain/scripts/print-bootnode.sh
# or:
docker exec rb-validator-1 cat /network/bootnode.enode
# Coolify may rename the container — find it:
docker ps -a --format '{{.Names}}' | grep -i validator-1
```

Do **not** scrape `docker logs` for `enode://` — Besu often never prints it.

---

### 2.2 Deployer / contract owner

| Variable | Example | How to get it |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | `0x…` 64 hex chars | Generate a fresh key — **this is the contract owner** |
| `TREASURY_ADDRESS` | `0x…` | Often same as deployer address; or a separate company wallet |
| `CONTRACT_ADDRESS` | *(leave empty)* | Optional. **`contract-deploy`** writes `/network/contract.address` after validator-1 is up |
| `DEPLOYER_ADDRESS` | `0x…` | Public address of the deployer key (for genesis prefund) |

**Generate a deployer key (ethers / cast / openssl)**

```bash
# Option A — Node one-liner (from contracts/ after npm install)
node -e "const {Wallet}=require('ethers'); const w=Wallet.createRandom(); console.log('address', w.address); console.log('key', w.privateKey);"
```

```bash
# Option B — OpenSSL-ish random 32 bytes as hex (then derive address with ethers)
openssl rand -hex 32
# prefix with 0x when storing as DEPLOYER_PRIVATE_KEY
```

Save the address as `TREASURY_ADDRESS` (unless you want a different treasury).  
**Back this key up offline.** It controls mint, upgrades, and tip parameters.

---

### 2.3 Custodial wallets (Teams users)

| Variable | Example | How to get it |
|---|---|---|
| `WALLET_ENCRYPTION_KEY` | long random string or 64 hex chars | Encrypts Teams users’ private keys at rest (AES-256-GCM) |
| `WALLET_DB_PATH` | `/data/wallets.sqlite` | Path inside the bot container; keep on a **persistent volume** |
| `WELCOME_PACK_RB` | `10` | Documented default; on-chain amount is set via admin / contract `welcomeAmount` |

**Generate `WALLET_ENCRYPTION_KEY`**

```bash
openssl rand -hex 32
```

If you lose this key, existing custodial wallets in SQLite **cannot** be decrypted. Back it up.

---

### 2.4 Microsoft Teams bot

RichBucks accepts **multiple single-tenant** Azure Bot / app registrations (e.g. personal Entra + company Entra) on the same messaging URL. Configure extras in **Admin → Teams apps** (encrypted on the `app-config` volume). Env vars bootstrap the first app.

| Variable | Example | How to get it |
|---|---|---|
| `MICROSOFT_APP_ID` | GUID | Azure Bot / App registration **Application (client) ID** (bootstrap) |
| `MICROSOFT_APP_PASSWORD` | `~` secret string | App registration **client secret** value |
| `MICROSOFT_APP_TENANT_ID` | GUID | That app’s Entra **Directory (tenant) ID** |
| `TEAMS_CONFIG_KEY` | same as wallet key OK | Encrypts the shared Teams-apps registry; defaults to `WALLET_ENCRYPTION_KEY` |
| `TEAMS_CONFIG_DIR` | `/config` | Path to `app-config` volume inside bot/admin |
| `BOT_PORT` | `3978` | Leave default unless you change compose |

**Personal tenant + company coworkers:** register a Single Tenant bot in **each** Entra directory, set both messaging endpoints to `https://bot.richbucks.xyz/api/messages`, then add the company app under Admin → Teams apps (or bootstrap env with one and add the other in the UI). Install each Teams package in its own tenant.

#### How to create the Azure Bot (step by step)

Do this **once per Entra tenant** that should use RichBucks (e.g. personal test tenant and company tenant). Azure no longer offers new multi-tenant bots — use **Single Tenant** each time.

1. Open the [Azure Portal](https://portal.azure.com) **signed into the correct directory** (top-right directory switcher).  
2. **Microsoft Entra ID** → **App registrations** → **New registration**  
   - Name: `RichBucks`  
   - Supported account types: **Accounts in this organizational directory only** (single tenant)  
   - Redirect URI: leave blank  
3. Overview → copy **Application (client) ID** → `MICROSOFT_APP_ID` (or Admin → Teams apps)  
4. Overview → copy **Directory (tenant) ID** → `MICROSOFT_APP_TENANT_ID`  
5. **Certificates & secrets** → **New client secret** → copy the **Value** immediately (shown once) → `MICROSOFT_APP_PASSWORD`  
6. Create an **Azure Bot** resource (**Azure AI Bot Service** / Bot Services):  
   - Create new  
   - **Type of App:** Single Tenant  
   - **Microsoft App ID:** the Application (client) ID from step 3  
   - **MSI resource ID:** leave blank  
   - Display name: `RichBucks`  
7. Azure Bot → **Configuration** → **Messaging endpoint**:  
   `https://bot.richbucks.xyz/api/messages`  
   (same URL for every tenant’s bot — Coolify bot service)  
8. **Apply** / Save  
9. Azure Bot → **Channels** → **Microsoft Teams** → enable / apply  
10. If prompted on the App registration, grant **admin consent** for the Teams channel permissions  

Repeat for the company directory, then add that second app under **Admin → Teams apps** (or set company credentials as the Coolify bootstrap env).

#### Teams app package (detailed)

Repo folder: [`bot/teams-manifest/`](./bot/teams-manifest/) — includes `manifest.json`, `color.png` (192×192), and `outline.png` (32×32 white-on-transparent).

**1. Customise the manifest**

Edit `bot/teams-manifest/manifest.json`:

| Field | What to set |
|---|---|
| `id` | A new random GUID for this package (or reuse one GUID per tenant package) |
| `bots[0].botId` | **Exactly** the Application (client) ID for **this** tenant’s app registration |
| `developer.websiteUrl` / privacy / terms | Your URLs (defaults point at `richbucks.xyz`) |
| `validDomains` | Optional; can leave `[]` when only using the bot webhook on Coolify |
| `version` | Bump (`1.0.1`, …) whenever you re-upload |

If you ship **two** tenants, build **two** zip packages (different `botId` / usually different `id`).

**2. Icons (already in repo)**

| File | Size | Rules |
|---|---|---|
| `color.png` | 192×192 | Full-colour app icon (included) |
| `outline.png` | 32×32 | White glyph, **transparent** background (included) |

Do not put logos in JPEG form; Teams rejects missing/wrong-size icons.

**3. Build the zip (preferred: Admin UI)**

In **Admin → Teams apps**, click **Download zip** on the row for that Azure app. The zip already contains:

- `manifest.json` with `bots[0].botId` = that app’s client ID (fresh package `id` each download)  
- `color.png` (192×192) and `outline.png` (32×32)  

Or build manually from the repo (files at zip **root**, not in a subfolder):

```bash
cd bot/teams-manifest
# Edit manifest.json botId / id first
# Windows PowerShell:
Compress-Archive -Path manifest.json,color.png,outline.png -DestinationPath RichBucks-teams.zip -Force

# macOS / Linux:
zip -j RichBucks-teams.zip manifest.json color.png outline.png
```

**4. Upload**

- **Company / production:** [Teams Admin Center](https://admin.teams.microsoft.com) → **Teams apps** → **Manage apps** → **Upload** → select the zip → allow for your org / specific users.  
- **Sideload (dev):** Teams desktop → **Apps** → **Manage your apps** → **Upload a custom app** (requires org policy allowing sideloading).

**5. Add to the chat**

1. Open the target group chat or team.  
2. **Apps** / **+** → find **RichBucks** → **Add**.  
3. Confirm the bot can post in that chat.  

**6. Verify Azure ↔ Teams**

1. From Teams, send `/help` in a 1:1 with RichBucks.  
2. Coolify **bot** logs should show a processed activity (no 401).  
3. If 401 / unauthorized: App ID/secret/tenant mismatch, or the app isn’t listed under Admin → Teams apps / bootstrap env.  
4. If the bot never receives traffic: messaging endpoint URL, Cloudflare SSL Full (strict), or Coolify domain not bound to `bot:3978`.

---


### 2.5 Admin UI

| Variable | Example | How to get it |
|---|---|---|
| `ADMIN_PORT` | `3000` | Default |
| `ADMIN_USERNAME` | `admin` | Pick a username |
| `ADMIN_PASSWORD` | strong password | Your login password (prefer hash — see below) |
| `ADMIN_PASSWORD_HASH` | `$2a$10$…` | Optional bcrypt hash; if set, used instead of plain password |
| `ADMIN_TOTP_SECRET` | Base32 e.g. `JBSWY3DPEHPK3PXP` | 2FA secret for Google Authenticator / Authy |
| `SESSION_SECRET` | long random | Signs admin cookies |
| `ADMIN_ALLOWED_IPS` | `203.0.113.10,10.0.0.0/8` | **Required in production.** Comma-separated IPs/CIDRs; others get 403. Loopback `/health` still works for Coolify. |
| `ADMIN_TRUST_CLOUDFLARE` | `true` | Use `CF-Connecting-IP` for allowlisting when orange-cloud is on |
| `SHOW_METAMASK_CARD` | `false` | `true` adds RPC/token hint on `/balance` DMs; toggle via Coolify + bot restart |
| `COOKIE_SECURE` | `true` | Set `true` behind HTTPS |
| `GENESIS_PATH` | `/config/genesis.json` | Set in compose for `/join/config` |

**Generate secrets**

```bash
# Session cookie secret
openssl rand -hex 32

# TOTP secret (Base32) — or let admin boot once, copy the printed secret, then set ADMIN_TOTP_SECRET and restart
# Example using Node otplib after: cd admin && npm install
node -e "console.log(require('otplib').authenticator.generateSecret())"

# Optional password hash (bcrypt)
node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD', 10))"
```

Open `https://admin.richbucks.xyz/login`, enter username / password / 6-digit TOTP.

**IP allowlist:** set `ADMIN_ALLOWED_IPS` to your office/home public IP(s) or CIDRs. Requests from elsewhere get HTTP 403 before login. Coolify container healthchecks to `127.0.0.1` still work. With Cloudflare orange-cloud, set `ADMIN_TRUST_CLOUDFLARE=true` so allowlisting uses `CF-Connecting-IP` (your real browser IP). Do not enable that flag if traffic does not go through Cloudflare — clients could spoof the header.

---

### 2.6 Coworker node join + RPC

| Variable | Example | How to get it |
|---|---|---|
| `JOIN_ENABLED` | `false` | Set `true` only when onboarding coworker nodes (v1.1 / VPN) |
| `NODE_JOIN_API_KEY` | random token | Required when `JOIN_ENABLED=true`. Bearer secret for `/join/config` |
| `JOIN_URL` | `https://admin.richbucks.xyz/join/config` | Used on **coworker** machines (not the VPS `.env` name for admin) |
| `RPC_API_KEY` | `openssl rand -hex 24` | **Required in production.** Public rpc-filter rejects requests without `x-api-key` / Bearer / `?key=` |
| `RPC_REQUIRE_API_KEY` | `true` | Default true in compose; set false only for local experiments |
| `GHCR_OWNER` | `r1ch101` | Lowercase GitHub owner for image names |
| `TAG` | `latest` | Image tag Coolify pulls |

```bash
openssl rand -hex 24   # NODE_JOIN_API_KEY
```

---

### 2.7 Example filled `.env` (fake values)

```env
CHAIN_ID=88420
RPC_URL=http://validator-1:8545
PUBLIC_RPC_URL=https://rpc.richbucks.xyz
BESU_IMAGE_TAG=25.1.0

DEPLOYER_PRIVATE_KEY=0x1111111111111111111111111111111111111111111111111111111111111111
DEPLOYER_ADDRESS=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
TREASURY_ADDRESS=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
CONTRACT_ADDRESS=   # leave empty — contract-deploy writes /network/contract.address

WALLET_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
WALLET_DB_PATH=/data/wallets.sqlite

MICROSOFT_APP_ID=00000000-0000-0000-0000-000000000001
MICROSOFT_APP_PASSWORD=your-client-secret-value
MICROSOFT_APP_TENANT_ID=00000000-0000-0000-0000-000000000002
BOT_PORT=3978

ADMIN_USERNAME=admin
ADMIN_PASSWORD=use-a-long-unique-password
ADMIN_TOTP_SECRET=JBSWY3DPEHPK3PXP
SESSION_SECRET=fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
ADMIN_ALLOWED_IPS=203.0.113.10
ADMIN_TRUST_CLOUDFLARE=true
RPC_API_KEY=replace-with-openssl-rand-hex-24
WELCOME_MINTER_PRIVATE_KEY=0x2222222222222222222222222222222222222222222222222222222222222222
SHOW_METAMASK_CARD=false
COOKIE_SECURE=true

JOIN_ENABLED=false
NODE_JOIN_API_KEY=coworker-join-token-change-me
BOOTNODE_ENODE=   # leave empty — auto from chain volume

GHCR_OWNER=r1ch101
TAG=latest
```

Replace every placeholder before production.

---

## 3. Initialize the Besu network (once — in Docker)

You do **not** need to SSH and run init or contract deploy by hand for Coolify.

**`chain-init`** (before RPC exists):

1. Writes `genesis.json` + 4 validator keys + `bootnode.enode` into **`chain-network`**  
2. Prefunds `DEPLOYER_ADDRESS` (falls back to `TREASURY_ADDRESS`)  
3. Exits; later redeploys **reuse** the volume and skip regeneration  

**`contract-deploy`** (after validator-1 is healthy):

1. Deploys the RichBucks UUPS proxy (idempotent if `/network/contract.address` already has code)  
2. Calls `setWelcomeMinter` when `WELCOME_MINTER_PRIVATE_KEY` (or `_ADDRESS`) is set  
3. Writes `/network/contract.address` — bot/admin read it (no Coolify `CONTRACT_ADDRESS` paste)

Set in Coolify before first deploy:

```env
DEPLOYER_ADDRESS=0xYourDeployerAddress
DEPLOYER_PRIVATE_KEY=0x…
WELCOME_MINTER_PRIVATE_KEY=0x…   # separate from deployer
# or TREASURY_ADDRESS=… (same address as deployer is fine)
```

**Persistent volumes** (Docker-managed; survive redeploys):

| Volume | Contents |
|--------|----------|
| `…_chain-network` | Genesis, validator keys, Besu data, `bootnode.enode`, `contract.address` |
| `…_bot-wallets` | Custodial Teams wallet SQLite |

Do **not** delete `chain-network` unless you intend to wipe the chain. Validator keys never leave the volume / never go in git.

Optional local/dev (host bind layout under `chain/network/`):

```bash
cd chain
export DEPLOYER_ADDRESS=0xYourDeployerAddress
./scripts/init-network.sh prod   # or: ./scripts/init-network.sh dev
```

---

## 4. Deploy the Docker stack (Coolify)

### Option A — Coolify from GitHub

1. New resource → **Docker Compose** → connect `R1CH101/RichBucks`  
2. Compose file: root `docker-compose.yml` (single file — chain + bot + admin + rpc-filter)  
3. Paste all env vars from section 2 (include `DEPLOYER_ADDRESS`)  
4. Persistent storage: keep named volumes **`chain-network`**, **`bot-wallets`**, and **`app-config`** (Coolify usually keeps Compose volumes — do not wipe on redeploy)  
5. Deploy — `chain-init` runs automatically  

**Compose note:** everything Coolify needs is in the root compose. `chain/docker-compose.yml` remains for chain-only local use.

### Option B — SSH on the VPS

```bash
# chain-init writes bootnode.enode; peers auto-resolve (BOOTNODE_ENODE can stay empty)
docker compose up -d
./chain/scripts/print-bootnode.sh   # optional debug
```

Check:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://127.0.0.1:8545
```

---

## 5. Deploy the RichBucks contract

**Coolify / compose:** automatic via the **`contract-deploy`** one-shot (see section 3). Leave `CONTRACT_ADDRESS` empty. Check logs:

```bash
docker logs rb-contract-deploy
# → RichBucks proxy: 0x…
docker exec rb-validator-1 cat /network/contract.address
```

**Laptop / local only** (optional — tests or a chain without the compose job):

```bash
cd contracts && npm i && npm test
# RPC_URL + DEPLOYER_PRIVATE_KEY in ../.env
npm run deploy -- --network richbucks
```

---

## 6. Teams smoke test

In a **1:1** chat with RichBucks:

| Command | Expect |
|---|---|
| `/help` | Command list |
| `/balance` | Balance + address (DM) |
| `/export-wallet CONFIRM` | DM-only; confirmation + 1/hour cooldown; adaptive card with private key |

In the **group** chat:

| Command | Expect |
|---|---|
| `/give @Colleague nice one` | Public tip confirmation; mint 1 RB |
| `/send @Colleague 5` | Transfer if sender has balance |
| `/leaderboard` | Public board |
| `/balance` | “Sent your balance in a DM” + private details |

First interaction creates a custodial wallet and mints the welcome pack (if welcome mint is enabled).

---

## 7. Admin UI checklist

1. Login with user / password / TOTP  
2. Confirm supply **1000000**, max **0** (unlimited), block number moving when txs occur  
3. **Mint** a test amount to an address if needed  
4. Adjust daily tip / verifier reward / kill switches for welcome & admin mint  
5. Set timezone offset for “day” boundary (`0` = UTC/GMT, `3600` ≈ BST)  

---

## 8. GitHub Actions (Ubicloud) → GHCR

1. [Ubicloud](https://www.ubicloud.com/docs/github-actions-integration/quickstart) → connect GitHub → install app on `R1CH101/RichBucks`  
2. Push to `main` runs `.github/workflows/ci.yml` on `ubicloud-standard-*`  
3. Publishes:  
   - `ghcr.io/r1ch101/bot`  
   - `ghcr.io/r1ch101/admin`  
   - `ghcr.io/r1ch101/coworker-node`  

Coolify can pull these instead of building on the VPS (`GHCR_OWNER=r1ch101`).

Package visibility: GitHub → Packages → each image → allow public pull if coworkers need `docker pull` without auth.

---

## 9. Coworker validator / node (v1.1)

**Skipped in v1.** Company validators on the VPS are enough. When you add VPN:

On their machine:

On the **VPS** admin `.env`, set `JOIN_ENABLED=true` and a strong `NODE_JOIN_API_KEY`, then restart admin.

```bash
cd chain/coworker
cat > .env <<EOF
JOIN_API_KEY=<same as NODE_JOIN_API_KEY>
JOIN_URL=https://admin.richbucks.xyz/join/config
BOOTNODE_ENODE=<VPN enode — never a public VPS IP in v1>
GHCR_OWNER=r1ch101
TAG=latest
# Bind P2P to your Tailscale/WireGuard IP (required for peering)
COWORKER_P2P_BIND=100.x.x.x
EOF
docker compose up -d
```

Notes:

- Image aims for **≤1 GB RAM** (`-Xmx512m`)  
- RPC is **127.0.0.1 only** (SSH tunnel / local MetaMask); host-allowlist is localhost  
- P2P defaults to host loopback — set `COWORKER_P2P_BIND` to the VPN address; do **not** publish 30303 on the public internet  
- Node must reach your bootnode over VPN  

- To **earn tip proposer rewards**, vote them in:

```bash
export RPC_URLS="http://127.0.0.1:8545"
export DEPLOYER_PRIVATE_KEY=0x…
./chain/scripts/add-validator.sh 0xCoworkerNodeAddress
```

RPC-only nodes sync but do **not** earn proposer RB.

---

## 10. MetaMask (optional)

1. Admin: set `SHOW_METAMASK_CARD=true`, restart bot  
2. Network:  
   - RPC URL: `https://rpc.richbucks.xyz`  
   - Chain ID: `88420`  
   - Currency symbol: `GAS` (native; still free)  
3. Import token: address from `/network/contract.address`, symbol `RB`, **0 decimals**  
4. Or `/export-wallet` in DM and import the private key  

---

## 11. Backups

| Data | Where | Action |
|---|---|---|
| Besu chain + validator keys | Docker volume `chain-network` | Encrypted offsite backup / volume snapshot |
| Custodial wallets DB | `bot-wallets` volume / `WALLET_DB_PATH` | Daily backup |
| `WALLET_ENCRYPTION_KEY` + `DEPLOYER_PRIVATE_KEY` | Password manager | Critical |
| `ADMIN_TOTP_SECRET` | Password manager | Or users lose 2FA |

---

## 12. Troubleshooting

| Symptom | Check |
|---|---|
| Validators not peering | Confirm `/network/bootnode.enode` exists (`print-bootnode.sh`); host must be `validator-1`; restart peers |
| No blocks when idle | Expected up to ~1h in prod; send a tip/tx or use `init-network.sh dev` |
| Bot 401 from Teams | App ID/secret/tenant; messaging endpoint HTTPS; Teams channel enabled |
| `/balance` DM fails | Bot must be allowed to create 1:1 chats; user has app installed; try DM the bot first |
| Contract deploy fails | Prefunded `DEPLOYER_ADDRESS` in genesis; `RPC_URL` reachable; key matches address |
| Welcome mint fails | `/network/contract.address` present; `setWelcomeMinter` done; `welcomeMintEnabled` true |
| Admin login fails | TOTP time sync; `ADMIN_TOTP_SECRET` matches the QR you scanned |

---

## 13. Security reminders

- Public repo is fine; **secrets and validator keys in `chain-network` are not**  
- Do not expose QBFT admin RPC on the public internet  
- `/export-wallet CONFIRM` is DM-only, confirmation required, once per hour  
- Coworker RPC binds loopback only; P2P defaults to `127.0.0.1` — set `COWORKER_P2P_BIND` to your VPN IP when ready  

- Rotate Teams client secret periodically in Entra  
- AGPL-3.0: if you modify and offer the service, publish corresponding source  

---

## Quick command cheat sheet

```bash
# Coolify: set DEPLOYER_ADDRESS + DEPLOYER_PRIVATE_KEY (+ WELCOME_MINTER_*) then deploy.
# chain-init → validators → contract-deploy → bot/admin (automatic).

# Bootnode / contract address (debug)
./chain/scripts/print-bootnode.sh
docker exec rb-validator-1 cat /network/contract.address

# Add coworker validator
./chain/scripts/add-validator.sh 0x…
```

When in doubt: validators healthy → `contract-deploy` exited 0 → bot webhook green in Azure → Teams app in the group chat.
