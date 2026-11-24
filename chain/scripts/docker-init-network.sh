#!/usr/bin/env bash
# Runs INSIDE chain-init. Writes genesis + validator keys into /network (named volume).
# Idempotent when genesis + validator-1 key already exist.
set -euo pipefail

PROFILE="${PROFILE:-prod}"
OUT="${NETWORK_DIR:-/network}"
CONFIG="${QBFT_CONFIG:-/qbft/qbftConfig.${PROFILE}.json}"
DEPLOYER="${DEPLOYER_ADDRESS:-${TREASURY_ADDRESS:-}}"

echo "chain-init starting (profile=${PROFILE}, out=${OUT})"
echo "besu=$(command -v besu || true) jq=$(command -v jq || true)"

if [[ ! -f "$CONFIG" ]]; then
  echo "Missing QBFT config: $CONFIG" >&2
  ls -la /qbft >&2 || true
  exit 1
fi

mkdir -p "$OUT"

if [[ -f "$OUT/genesis.json" && -f "$OUT/validator-1/data/key" ]]; then
  echo "Network already initialized at $OUT — skipping."
  exit 0
fi

if [[ -f "$OUT/genesis.json" ]]; then
  echo "Partial network state at $OUT (genesis present, keys missing). Refusing to clobber." >&2
  echo "Delete the chain-network volume to regenerate." >&2
  exit 1
fi

echo "Generating blockchain config (profile=$PROFILE) ..."
WORKDIR="$OUT/.generate"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"

cp "$CONFIG" "$WORKDIR/qbftConfig.work.json"

if [[ -n "${DEPLOYER}" ]]; then
  ADDR="$(echo "$DEPLOYER" | tr '[:upper:]' '[:lower:]')"
  if [[ "$ADDR" != 0x* ]]; then
    ADDR="0x${ADDR}"
  fi
  if [[ ! "$ADDR" =~ ^0x[0-9a-f]{40}$ ]]; then
    echo "DEPLOYER_ADDRESS/TREASURY_ADDRESS is not a 20-byte hex address: $DEPLOYER" >&2
    exit 1
  fi
  tmp="${WORKDIR}/qbftConfig.work.json.tmp"
  jq --arg addr "$ADDR" \
    '.genesis.alloc[$addr] = {"balance":"0x152D02C7E14AF6800000"}' \
    "$WORKDIR/qbftConfig.work.json" > "$tmp"
  mv "$tmp" "$WORKDIR/qbftConfig.work.json"
  echo "Prefunded deployer $ADDR"
else
  echo "WARNING: DEPLOYER_ADDRESS/TREASURY_ADDRESS unset — genesis will not prefund a deployer." >&2
fi

besu operator generate-blockchain-config \
  --config-file="$WORKDIR/qbftConfig.work.json" \
  --to="$WORKDIR/generated" \
  --private-key-file-name=key

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

rm -rf "$WORKDIR"
echo "Done. Genesis + keys written to $OUT (Docker volume)."
echo "Do not delete the chain-network volume unless you intend to wipe the chain."
