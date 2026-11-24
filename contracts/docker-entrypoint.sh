#!/usr/bin/env bash
# One-shot: deploy RichBucks (or skip if /network/contract.address already has code).
set -euo pipefail

NETWORK_DIR="${NETWORK_DIR:-/network}"
RPC_URL="${RPC_URL:-http://validator-1:8545}"
export RPC_URL NETWORK_DIR
export CHAIN_ID="${CHAIN_ID:-88420}"

if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "DEPLOYER_PRIVATE_KEY is required for contract-deploy" >&2
  exit 1
fi

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

cd /app
# Persist OZ upgrades manifest across redeploys (needed for later UUPS upgrades)
mkdir -p "$NETWORK_DIR/openzeppelin"
rm -rf /app/.openzeppelin
ln -sfn "$NETWORK_DIR/openzeppelin" /app/.openzeppelin

exec npx hardhat run scripts/deploy.ts --network richbucks
