#!/usr/bin/env bash
# Runs INSIDE the chain-init container. Writes genesis + validator keys into /network (named volume).
# Idempotent: if /network/genesis.json already exists, exit 0 without regenerating.
set -euo pipefail

PROFILE="${PROFILE:-prod}"
OUT="${NETWORK_DIR:-/network}"
CONFIG="${QBFT_CONFIG:-/qbft/qbftConfig.${PROFILE}.json}"
# Prefund the contract owner (Coolify often only sets TREASURY_ADDRESS)
DEPLOYER="${DEPLOYER_ADDRESS:-${TREASURY_ADDRESS:-}}"

if [[ ! -f "$CONFIG" ]]; then
  echo "Missing QBFT config: $CONFIG" >&2
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

if [[ -n "$DEPLOYER" ]]; then
  python3 - <<'PY' "$WORKDIR/qbftConfig.work.json" "$DEPLOYER"
import json, sys
path, addr = sys.argv[1], sys.argv[2].lower()
if not addr.startswith("0x"):
    addr = "0x" + addr
with open(path) as f:
    cfg = json.load(f)
cfg.setdefault("genesis", {}).setdefault("alloc", {})[addr] = {
    "balance": "0x152D02C7E14AF6800000"
}
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
print(f"Prefunded deployer {addr}")
PY
else
  echo "WARNING: DEPLOYER_ADDRESS/TREASURY_ADDRESS unset — genesis will not prefund a deployer." >&2
fi

# besu is on PATH in the official image
besu operator generate-blockchain-config \
  --config-file="$WORKDIR/qbftConfig.work.json" \
  --to="$WORKDIR/generated" \
  --private-key-file-name=key

cp "$WORKDIR/generated/genesis.json" "$OUT/genesis.json"

i=1
shopt -s nullglob
for keydir in "$WORKDIR"/generated/keys/0x*; do
  addr="$(basename "$keydir")"
  dest="$OUT/validator-$i/data"
  mkdir -p "$dest"
  cp "$keydir/key" "$dest/key"
  cp "$keydir/key.pub" "$dest/key.pub"
  echo "$addr" > "$OUT/validator-$i/address"
  echo "Validator $i => $addr"
  i=$((i + 1))
done
shopt -u nullglob

if [[ "$i" -ne 5 ]]; then
  echo "Expected 4 validator keys, got $((i - 1))" >&2
  exit 1
fi

python3 - <<'PY' "$OUT"
import json, pathlib, sys
out = pathlib.Path(sys.argv[1])
addrs = []
for n in range(1, 5):
    p = out / f"validator-{n}" / "address"
    addrs.append(p.read_text().strip())
(out / "validators.json").write_text(json.dumps({"validators": addrs}, indent=2) + "\n")
PY

rm -rf "$WORKDIR"
echo "Done. Genesis + keys written to $OUT (Docker volume)."
echo "Do not delete the chain-network volume unless you intend to wipe the chain."
