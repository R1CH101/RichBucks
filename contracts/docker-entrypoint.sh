#!/usr/bin/env bash
# One-shot: deploy RichBucks (or skip if /network/contract.address already has code).
set -euo pipefail

NETWORK_DIR="${NETWORK_DIR:-/network}"
RPC_URL="${RPC_URL:-http://validator-1:8545}"
export RPC_URL NETWORK_DIR
export CHAIN_ID="${CHAIN_ID:-88420}"

# Coolify / .env paste hygiene
if [[ -n "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  DEPLOYER_PRIVATE_KEY="$(printf '%s' "$DEPLOYER_PRIVATE_KEY" | tr -d '[:space:]"'"'"'')"
  export DEPLOYER_PRIVATE_KEY
fi

if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "DEPLOYER_PRIVATE_KEY is required for contract-deploy" >&2
  echo "Set it in Coolify env (same wallet as DEPLOYER_ADDRESS), then redeploy." >&2
  exit 1
fi

DEPLOYER_ADDR="$(node -e "const {Wallet}=require('ethers'); const k=process.env.DEPLOYER_PRIVATE_KEY; console.log(new Wallet(k.startsWith('0x')?k:'0x'+k).address)")"
echo "Deployer from key: $DEPLOYER_ADDR"

echo "Waiting for RPC at $RPC_URL ..."
ok=0
for _ in $(seq 1 90); do
  if node -e "
    fetch(process.env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]})})
      .then(r=>r.json()).then(j=>{ if(!j.result) process.exit(1); })
      .catch(()=>process.exit(1));
  "; then
    ok=1
    break
  fi
  sleep 2
done
if [[ "$ok" -ne 1 ]]; then
  echo "RPC not ready after waiting" >&2
  exit 1
fi
echo "RPC ready."

export ADDR="$DEPLOYER_ADDR"
BAL="$(node -e "
  fetch(process.env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getBalance',params:[process.env.ADDR,'latest']})})
    .then(r=>r.json()).then(j=>{ console.log(j.result||'0x0'); })
    .catch(()=>{ console.log('0x0'); process.exit(1); });
")"
echo "Deployer balance: $BAL"
if [[ "$BAL" == "0x0" || "$BAL" == "0x" ]]; then
  echo "WARNING: deployer has zero native balance." >&2
  echo "Genesis must prefund DEPLOYER_ADDRESS=$DEPLOYER_ADDR (set before first chain-init)." >&2
  echo "If the chain-network volume was created without that address, wipe it and redeploy (destroys chain state)." >&2
fi

cd /app
# Persist OZ upgrades manifest across redeploys (needed for later UUPS upgrades).
# Stale files here cause: InvalidDeployment / No contract at address (Removed from manifest)
mkdir -p "$NETWORK_DIR/openzeppelin"
rm -rf /app/.openzeppelin
ln -sfn "$NETWORK_DIR/openzeppelin" /app/.openzeppelin

# If we have no live proxy yet, drop any leftover OZ cache before Hardhat starts
# (in-process retry after InvalidDeployment is unreliable — Manifest stays loaded).
ADDR_FILE="$NETWORK_DIR/contract.address"
NEED_CLEAR=1
if [[ -f "$ADDR_FILE" ]]; then
  EXISTING="$(tr -d '[:space:]' <"$ADDR_FILE")"
  if [[ -n "$EXISTING" ]]; then
    export EXISTING
    CODE="$(node -e "
      fetch(process.env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getCode',params:[process.env.EXISTING,'latest']})})
        .then(r=>r.json()).then(j=>console.log(j.result||'0x'))
        .catch(()=>console.log('0x'));
    ")"
    if [[ -n "$CODE" && "$CODE" != "0x" && "$CODE" != "0x0" ]]; then
      NEED_CLEAR=0
      echo "Existing proxy $EXISTING has code — keeping OpenZeppelin manifest."
    fi
  fi
fi
if [[ "$NEED_CLEAR" -eq 1 ]]; then
  echo "No live proxy — clearing $NETWORK_DIR/openzeppelin before deploy."
  find "$NETWORK_DIR/openzeppelin" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi

exec npx hardhat run scripts/deploy.ts --network richbucks
