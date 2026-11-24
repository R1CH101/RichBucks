#!/usr/bin/env bash
# Runs INSIDE chain-init. Writes genesis + validator keys into /network (named volume).
# Idempotent when genesis + validator-1 key already exist.
set -euo pipefail

export PATH="/opt/besu/bin:${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"
BESU_BIN="${BESU_BIN:-/opt/besu/bin/besu.real}"
if [[ ! -x "$BESU_BIN" ]]; then
  BESU_BIN="$(command -v besu.real 2>/dev/null || command -v besu || true)"
fi

OUT="${NETWORK_DIR:-/network}"
mkdir -p "$OUT" || true
# Coolify/besu-entry.sh may re-exec as user `besu`; ensure volume is writable
if [[ "$(id -u)" -eq 0 ]]; then
  chmod -R a+rwX "$OUT" 2>/dev/null || true
fi

LOG="$OUT/chain-init.log"
# Logging must never abort init (permission issues on leftover volumes)
if touch "$LOG" 2>/dev/null; then
  exec > >(tee -a "$LOG") 2>&1
else
  echo "WARNING: cannot write $LOG — logging to stdout only" >&2
fi

echo "==== chain-init begin pid=$$ uid=$(id -u) ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) ===="
echo "args: $*"
echo "profile=${PROFILE:-} network_dir=$OUT deployer_set=${DEPLOYER_ADDRESS:+yes} treasury_set=${TREASURY_ADDRESS:+yes}"
echo "besu_bin=$BESU_BIN path=$PATH"

PROFILE="${PROFILE:-prod}"
CONFIG="${QBFT_CONFIG:-/qbft/qbftConfig.${PROFILE}.json}"
DEPLOYER="${DEPLOYER_ADDRESS:-${TREASURY_ADDRESS:-}}"
DEPLOYER="$(printf '%s' "$DEPLOYER" | tr -d '[:space:]"'"'"'')"

echo "jq=$(command -v jq || echo MISSING) bash=$BASH_VERSION"
echo "config=$CONFIG out=$OUT"

if [[ ! -x "$BESU_BIN" ]]; then
  echo "Besu binary not found/executable: $BESU_BIN" >&2
  ls -la /opt/besu/bin >&2 || true
  exit 1
fi

if [[ ! -f "$CONFIG" ]]; then
  echo "Missing QBFT config: $CONFIG" >&2
  ls -la /qbft >&2 || true
  exit 1
fi

if [[ -f "$OUT/genesis.json" && -f "$OUT/validator-1/data/key" ]]; then
  echo "Network already initialized at $OUT — skipping."
  echo "==== chain-init success (idempotent) ===="
  exit 0
fi

# Heal partial volume from a previous failed init
if [[ -f "$OUT/genesis.json" || -d "$OUT/validator-1" || -d "$OUT/.generate" ]]; then
  echo "Partial/incomplete network state detected — clearing $OUT for a clean init."
  find "$OUT" -mindepth 1 -maxdepth 1 ! -name 'chain-init.log' -exec rm -rf {} +
fi

echo "Generating blockchain config (profile=$PROFILE) ..."
WORKDIR="$OUT/.generate"
mkdir -p "$WORKDIR"
cp "$CONFIG" "$WORKDIR/qbftConfig.work.json"

if [[ -n "$DEPLOYER" ]]; then
  ADDR="$(printf '%s' "$DEPLOYER" | tr '[:upper:]' '[:lower:]')"
  if [[ "$ADDR" != 0x* ]]; then
    ADDR="0x${ADDR}"
  fi
  if [[ "$ADDR" =~ ^0x[0-9a-f]{40}$ ]]; then
    tmp="${WORKDIR}/qbftConfig.work.json.tmp"
    jq --arg addr "$ADDR" \
      '.genesis.alloc[$addr] = {"balance":"0x152D02C7E14AF6800000"}' \
      "$WORKDIR/qbftConfig.work.json" > "$tmp"
    mv "$tmp" "$WORKDIR/qbftConfig.work.json"
    echo "Prefunded deployer $ADDR"
  else
    echo "WARNING: DEPLOYER_ADDRESS/TREASURY_ADDRESS not a valid 20-byte hex address ($DEPLOYER) — skipping prefund." >&2
  fi
else
  echo "WARNING: DEPLOYER_ADDRESS/TREASURY_ADDRESS unset — genesis will not prefund a deployer." >&2
fi

set -x
"$BESU_BIN" operator generate-blockchain-config \
  --config-file="$WORKDIR/qbftConfig.work.json" \
  --to="$WORKDIR/generated" \
  --private-key-file-name=key
set +x

if [[ ! -f "$WORKDIR/generated/genesis.json" ]]; then
  echo "besu did not write genesis.json" >&2
  ls -laR "$WORKDIR" >&2 || true
  exit 1
fi

cp "$WORKDIR/generated/genesis.json" "$OUT/genesis.json"

mapfile -t KEYDIRS < <(find "$WORKDIR/generated/keys" -mindepth 1 -maxdepth 1 -type d -name '0x*' | sort)
COUNT="${#KEYDIRS[@]}"
if [[ "$COUNT" -ne 4 ]]; then
  echo "Expected 4 validator keys, got ${COUNT}" >&2
  ls -laR "$WORKDIR/generated/keys" >&2 || true
  exit 1
fi

i=1
VALIDATORS_JSON='{"validators":['
first=1
for keydir in "${KEYDIRS[@]}"; do
  addr="$(basename "$keydir")"
  dest="$OUT/validator-$i/data"
  mkdir -p "$dest"
  cp "$keydir/key" "$dest/key"
  cp "$keydir/key.pub" "$dest/key.pub"
  echo "$addr" > "$OUT/validator-$i/address"
  echo "Validator $i => $addr"
  if [[ "$first" -eq 1 ]]; then
    first=0
  else
    VALIDATORS_JSON+=','
  fi
  VALIDATORS_JSON+="\"${addr}\""
  i=$((i + 1))
done
VALIDATORS_JSON+=']}'
echo "$VALIDATORS_JSON" | jq . > "$OUT/validators.json"

# Validators run as user besu
if [[ "$(id -u)" -eq 0 ]]; then
  chmod -R a+rwX "$OUT" 2>/dev/null || true
fi

rm -rf "$WORKDIR"
echo "Done. Genesis + keys written to $OUT (Docker volume)."
echo "==== chain-init success ===="
