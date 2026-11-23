# RichBucks setup guide

End-to-end guide to deploy RichBucks on a VPS (Coolify), wire Microsoft Teams, deploy the token contract, and optionally onboard coworker nodes.

**Internal joke token — no cash value, not redeemable.**

Repo: https://github.com/R1CH101/RichBucks

---

## What you will end up with

| Piece | Example public URL |
|---|---|
| Admin UI | `https://admin.richbucks.example` |
| Teams bot webhook | `https://bot.richbucks.example/api/messages` |
| Public wallet RPC | `https://rpc.richbucks.example` |
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
- Node.js 22+ on a laptop **or** on the VPS (for contract deploy)
- GitHub account `R1CH101` (repo already public)

Clone on the VPS or let Coolify pull the repo:

```bash
git clone https://github.com/R1CH101/RichBucks.git
cd RichBucks
cp .env.example .env
```

---

## 1. Domains / Coolify routing

Create three HTTPS hosts (Coolify “Services” or reverse-proxy labels):

| Host | Proxies to | Path |
|---|---|---|
| `admin.yourdomain` | `admin:3000` | `/` |
| `bot.yourdomain` | `bot:3978` | `/` (Teams needs `/api/messages`) |
| `rpc.yourdomain` | `rpc-proxy:80` (compose port `8549:80`) | `/` |

Keep validator RPC (`8545`) **off** the public internet except via `rpc-proxy`.

Set in Coolify / `.env`:

```env
PUBLIC_RPC_URL=https://rpc.yourdomain
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
| `PUBLIC_RPC_URL` | `https://rpc.yourdomain` | Your public HTTPS RPC hostname |
| `BESU_VERSION` | `25.1.0` | Pin; match `chain/docker-compose.yml` |
| `EMPTY_BLOCK_PERIOD_SECONDS` | `3600` | Prod heartbeat. Dev genesis uses `30` via `init-network.sh dev` |
| `BOOTNODE_ENODE` | `enode://abc…@validator-1:30303` | After validator-1 is up: `./chain/scripts/print-bootnode.sh` (rewrites host to `validator-1`) |

**Getting `BOOTNODE_ENODE`**

```bash
# with rb-validator-1 running:
./chain/scripts/print-bootnode.sh
# → enode://<64 hex pubkey>@validator-1:30303
```

Paste into Coolify, then restart validators 2–4 (or the whole stack) so peers can dial the bootnode.

---

### 2.2 Deployer / contract owner

| Variable | Example | How to get it |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | `0x…` 64 hex chars | Generate a fresh key — **this is the contract owner** |
| `TREASURY_ADDRESS` | `0x…` | Often same as deployer address; or a separate company wallet |
| `CONTRACT_ADDRESS` | `0x…` | Filled **after** `npm run deploy` (section 5) |
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

| Variable | Example | How to get it |
|---|---|---|
| `MICROSOFT_APP_ID` | GUID | Azure Bot / App registration **Application (client) ID** |
| `MICROSOFT_APP_PASSWORD` | `~` secret string | App registration **client secret** value |
| `MICROSOFT_APP_TENANT_ID` | GUID | Your Entra **Directory (tenant) ID** (single-tenant) |
| `BOT_PORT` | `3978` | Leave default unless you change compose |

#### How to create the Azure Bot (step by step)

1. [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**  
   - Name: `RichBucks`  
   - Supported account types: **Accounts in this organizational directory only** (single tenant)  
   - Redirect URI: skip for now  
2. Copy **Application (client) ID** → `MICROSOFT_APP_ID`  
3. Copy **Directory (tenant) ID** → `MICROSOFT_APP_TENANT_ID`  
4. **Certificates & secrets** → **New client secret** → copy the **Value** once → `MICROSOFT_APP_PASSWORD`  
5. Create an **Azure Bot** resource (Bot Services):  
   - Type: Multi Tenant or Single Tenant matching the app  
   - Link the App ID above  
6. Azure Bot → **Configuration** → **Messaging endpoint**:  
   `https://bot.yourdomain/api/messages`  
7. Azure Bot → **Channels** → enable **Microsoft Teams**  
8. Under the App registration, API permissions typically include what the Bot channel configures; grant admin consent if prompted  

#### Teams app package

1. Edit `bot/teams-manifest/manifest.json`:  
   - Set `bots[0].botId` (and `id` if you use a new GUID) to `MICROSOFT_APP_ID`  
2. Add icons (required by Teams):  
   - `color.png` — 192×192  
   - `outline.png` — 32×32 transparent  
3. Zip at the **root** of the zip: `manifest.json`, `color.png`, `outline.png`  
4. Teams Admin Center → **Teams apps** → **Manage apps** → **Upload** (or sideload in a team for testing)  
5. Add **RichBucks** to your main group chat  

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

Open `https://admin.yourdomain/login`, enter username / password / 6-digit TOTP.

---

### 2.6 Coworker node join + RPC

| Variable | Example | How to get it |
|---|---|---|
| `NODE_JOIN_API_KEY` | random token | Shared secret coworkers pass as `Authorization: Bearer …` |
| `JOIN_URL` | `https://admin.yourdomain/join/config` | Used on **coworker** machines (not the VPS `.env` name for admin) |
| `RPC_API_KEY` | optional | Reserved for path-keyed public RPC; nginx v1 rate-limits without requiring it |
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
PUBLIC_RPC_URL=https://rpc.yourdomain
BESU_VERSION=25.1.0

DEPLOYER_PRIVATE_KEY=0x1111111111111111111111111111111111111111111111111111111111111111
TREASURY_ADDRESS=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
CONTRACT_ADDRESS=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

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
SHOW_METAMASK_CARD=false
COOKIE_SECURE=true

NODE_JOIN_API_KEY=coworker-join-token-change-me
BOOTNODE_ENODE=enode://abcd…@validator-1:30303

GHCR_OWNER=r1ch101
TAG=latest
```

Replace every placeholder before production.

---

## 3. Initialize the Besu network (once)

On the VPS, with Docker available:

```bash
cd chain
chmod +x scripts/*.sh

# Prefund deployer so tooling can send zero-gas txs
export DEPLOYER_ADDRESS=0xYourDeployerAddress
./scripts/init-network.sh prod
```

This creates `chain/network/` (gitignored):

- `genesis.json`
- `validator-1` … `validator-4` keys under `data/`

**Do not commit or share these keys.**

Dev / acceptance (30s empty blocks):

```bash
./scripts/init-network.sh dev
```

---

## 4. Deploy the Docker stack (Coolify)

### Option A — Coolify from GitHub

1. New resource → **Docker Compose** → connect `R1CH101/RichBucks`  
2. Compose file: `docker-compose.yml` (includes `chain/docker-compose.yml`)  
3. Paste all env vars from section 2  
4. Persistent storage:  
   - `./chain/network` (or bind-mount the initialized network dir)  
   - volume `bot-wallets`  
5. Deploy  

**Compose note:** root compose uses Compose `include` (Docker Compose **2.20+**). Coolify hosts with older Compose should upgrade Docker Compose or merge the chain services into one file.

### Option B — SSH on the VPS

```bash
# After init-network.sh and .env are ready:
export BOOTNODE_ENODE=enode://…@validator-1:30303   # can start empty first
docker compose up -d validator-1
./chain/scripts/print-bootnode.sh
# set BOOTNODE_ENODE in .env
docker compose up -d
```

Check:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://127.0.0.1:8545
```

---

## 5. Deploy the RichBucks contract

From a machine that can reach RPC (SSH tunnel is fine):

```bash
# tunnel example:
ssh -L 8545:127.0.0.1:8545 user@vps

cd contracts
npm install
# .env in repo root with:
#   RPC_URL=http://127.0.0.1:8545
#   DEPLOYER_PRIVATE_KEY=0x…
#   TREASURY_ADDRESS=0x…
npm test
npm run deploy -- --network richbucks
```

Copy the printed **proxy address** into Coolify:

```env
CONTRACT_ADDRESS=0x…
```

Redeploy / restart **bot** and **admin** so they pick it up.

---

## 6. Teams smoke test

In a **1:1** chat with RichBucks:

| Command | Expect |
|---|---|
| `/help` | Command list |
| `/balance` | Balance + address (DM) |
| `/export-wallet` | Adaptive card with private key |

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

## 9. Coworker validator / node

On their machine:

```bash
cd chain/coworker
cat > .env <<EOF
JOIN_API_KEY=<same as NODE_JOIN_API_KEY>
JOIN_URL=https://admin.yourdomain/join/config
BOOTNODE_ENODE=<publicly reachable enode or VPN enode>
GHCR_OWNER=r1ch101
TAG=latest
EOF
docker compose up -d
```

Notes:

- Image aims for **≤1 GB RAM** (`-Xmx512m`)  
- Node must reach your bootnode (VPN, public P2P port, or Magic Container later)  
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
   - RPC URL: `https://rpc.yourdomain`  
   - Chain ID: `88420`  
   - Currency symbol: `GAS` (native; still free)  
3. Import token: `CONTRACT_ADDRESS`, symbol `RB`, **0 decimals**  
4. Or `/export-wallet` in DM and import the private key  

---

## 11. Backups

| Data | Where | Action |
|---|---|---|
| Besu chain + validator keys | `chain/network/` | Encrypted offsite backup |
| Custodial wallets DB | `bot-wallets` volume / `WALLET_DB_PATH` | Daily backup |
| `WALLET_ENCRYPTION_KEY` + `DEPLOYER_PRIVATE_KEY` | Password manager | Critical |
| `ADMIN_TOTP_SECRET` | Password manager | Or users lose 2FA |

---

## 12. Troubleshooting

| Symptom | Check |
|---|---|
| Validators not peering | `BOOTNODE_ENODE` host must be `validator-1` on Docker network; restart peers |
| No blocks when idle | Expected up to ~1h in prod; send a tip/tx or use `init-network.sh dev` |
| Bot 401 from Teams | App ID/secret/tenant; messaging endpoint HTTPS; Teams channel enabled |
| `/balance` DM fails | Bot must be allowed to create 1:1 chats; user has app installed; try DM the bot first |
| Contract deploy fails | Prefunded `DEPLOYER_ADDRESS` in genesis; `RPC_URL` reachable; key matches address |
| Welcome mint fails | `CONTRACT_ADDRESS` set; deployer is owner; `welcomeMintEnabled` true |
| Admin login fails | TOTP time sync; `ADMIN_TOTP_SECRET` matches the QR you scanned |

---

## 13. Security reminders

- Public repo is fine; **secrets and `chain/network/` keys are not**  
- Do not expose QBFT admin RPC on the public internet  
- `/export-wallet` is DM-only by design  
- Rotate Teams client secret periodically in Entra  
- AGPL-3.0: if you modify and offer the service, publish corresponding source  

---

## Quick command cheat sheet

```bash
# Init chain (VPS)
cd chain && DEPLOYER_ADDRESS=0x… ./scripts/init-network.sh prod

# Bootnode
./scripts/print-bootnode.sh

# Stack
cd .. && docker compose up -d

# Contract
cd contracts && npm i && npm run deploy -- --network richbucks

# Add coworker validator
./chain/scripts/add-validator.sh 0x…
```

When in doubt: chain healthy → contract address in env → bot webhook green in Azure → Teams app in the group chat.
