#!/usr/bin/env bash
set -euo pipefail

: "${JOIN_API_KEY:?JOIN_API_KEY is required}"
: "${JOIN_URL:?JOIN_URL is required (e.g. https://admin.richbucks.xyz/join/config)}"
: "${BOOTNODE_ENODE:?BOOTNODE_ENODE is required}"

DATA_DIR="${DATA_DIR:-/data}"
GENESIS_PATH="${GENESIS_PATH:-/data/genesis.json}"
# RPC stays loopback-only inside the container (docker maps 127.0.0.1:8545 on host).
RPC_HTTP_HOST="${RPC_HTTP_HOST:-127.0.0.1}"
HOST_ALLOWLIST="${HOST_ALLOWLIST:-localhost,127.0.0.1}"
# P2P listen — keep on 0.0.0.0 for VPN; do NOT publish 30303 on a public firewall.
P2P_HOST="${P2P_HOST:-0.0.0.0}"

mkdir -p "$DATA_DIR"

echo "Fetching network config..."
HTTP_CODE=$(curl -sS -o /tmp/join.json -w "%{http_code}" \
  -H "Authorization: Bearer ${JOIN_API_KEY}" \
  "${JOIN_URL}")
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Join failed HTTP $HTTP_CODE" >&2
  cat /tmp/join.json >&2 || true
  exit 1
fi

# Expected JSON: { "genesis": {...}, "bootnodes": ["enode://..."] }
python3 - <<'PY'
import json, pathlib
j = json.load(open("/tmp/join.json"))
pathlib.Path("/data/genesis.json").write_text(json.dumps(j["genesis"], indent=2))
boots = j.get("bootnodes") or []
pathlib.Path("/data/bootnodes.txt").write_text(",".join(boots))
print("genesis + bootnodes written")
PY

BOOTS="$(cat /data/bootnodes.txt)"
if [[ -z "$BOOTS" ]]; then
  BOOTS="$BOOTNODE_ENODE"
fi

# Generate node key on first run
if [[ ! -f "$DATA_DIR/key" ]]; then
  echo "No node key yet — Besu will create one on start; record address for admin vote-in."
fi

exec besu \
  --data-path="$DATA_DIR" \
  --genesis-file="$GENESIS_PATH" \
  --bootnodes="$BOOTS" \
  --min-gas-price=0 \
  --rpc-http-enabled \
  --rpc-http-host="$RPC_HTTP_HOST" \
  --rpc-http-port=8545 \
  --rpc-http-api=ETH,NET,WEB3 \
  --host-allowlist="$HOST_ALLOWLIST" \
  --p2p-port=30303 \
  --p2p-host="$P2P_HOST" \
  --nat-method=NONE \
  --profile=ENTERPRISE \
  "$@"
