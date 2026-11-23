# RichBucks

Repository: https://github.com/R1CH101/RichBucks

**Full deploy walkthrough (Coolify, secrets, Teams, contract):** [guide.md](./guide.md)

Private zero-gas [Hyperledger Besu](https://github.com/hyperledger/besu) QBFT chain + **RichBucks (RB)** ERC-20 + Microsoft Teams custodial bot + admin UI.

**Internal joke token — no cash value, not redeemable.**

License: [AGPL-3.0-only](./LICENSE). Commercial use is allowed; modified versions (including network services) must provide complete corresponding source under AGPL.

## What’s in the box

| Path | Purpose |
|---|---|
| `chain/` | 4-validator Besu QBFT (chainId **88420**), public RPC proxy, coworker node image |
| `contracts/` | UUPS upgradeable RB token (0 decimals, unlimited supply by default, daily tip + proposer mint) |
| `bot/` | Teams bot: `/give` `/send` `/balance` `/leaderboard` `/export-wallet` |
| `admin/` | Username/password + TOTP 2FA admin (mint, params, join config) |

## Quick start (local)

### 1. Chain

```bash
cd chain
chmod +x scripts/*.sh
# optional: export DEPLOYER_ADDRESS=0xYourDeployer
./scripts/init-network.sh prod   # or: dev  (30s empty blocks for testing)
```

Start validators (set bootnode after first start — see below):

```bash
export BOOTNODE_ENODE=enode://...@validator-1:30303
docker compose up -d
```

Get the bootnode enode from validator-1 logs (`enode://…@…:30303`). For Docker DNS use host `validator-1` and port `30303`.

### 2. Contracts

```bash
cd contracts
npm install
npm test
# with chain RPC up and DEPLOYER_PRIVATE_KEY + RPC_URL in ../.env:
npm run deploy -- --network richbucks
```

Put `CONTRACT_ADDRESS` into `.env`.

### 3. Bot & admin

```bash
cp .env.example .env   # fill secrets
cd bot && npm install && npm run dev
cd admin && npm install && npm run dev
```

### Coolify

Use root `docker-compose.yml` (includes chain stack + bot + admin). Map domains:

- Admin → `:3000`
- Bot webhook → `:3978/api/messages`
- Public wallet RPC → chain `rpc-proxy` `:8549`

Secrets via Coolify env (never commit `.env`). Persist volumes for `chain/network/**/data` and `bot-wallets`.

### Coworker node (v1.1)

Public/coworker P2P is **off in v1** (no open 30303; use VPN later). Company validators peer only on the Docker network. The `chain/coworker` image remains for v1.1 + Tailscale/WireGuard.

### Teams

1. Azure Bot + App registration; set `MICROSOFT_APP_*` in env  
2. Edit `bot/teams-manifest/manifest.json` botId  
3. Add colour/outline icons; zip manifest; upload as custom app  
4. Add bot to the group chat  

## Token economics (v1)

- Treasury pre-mint **1,000,000** RB; `maxSupply` **0** = unlimited (optional finite cap via admin)  
- **0 decimals** (whole numbers only — bot, admin, MetaMask)  
- `/give` mints 1 RB to recipient + 1 RB to `block.coinbase` (proposer)  
- Welcome + admin mint (not from treasury); disable flags for a future public launch  
- Transfers free (gas price 0, no token fee)  

## CI

`.github/workflows/ci.yml` uses `runs-on: ubicloud-standard-*`. Install the [Ubicloud GitHub App](https://www.ubicloud.com/docs/github-actions-integration/quickstart) on the repo.

## Security

- Do not commit `chain/network/` keys, `.env`, or wallet SQLite  
- Keep validator QBFT RPC on the private Docker network; public RPC is rate-limited nginx → validator-1  
- `/export-wallet` is DM-only  
