#!/usr/bin/env bash
# Generate QBFT keys + genesis. Run once before first compose up (or as Coolify one-shot).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${1:-prod}"
BESU_IMAGE="${BESU_IMAGE:-hyperledger/besu:25.1.0}"
CONFIG="$ROOT/qbftConfig.${PROFILE}.json"
OUT="$ROOT/network"

if [[ ! -f "$CONFIG" ]]; then
  echo "Missing config: $CONFIG" >&2
  exit 1
fi

if [[ -f "$OUT/genesis.json" ]]; then
  echo "Network already initialized at $OUT (delete to regenerate)."
  exit 0
fi

echo "Generating blockchain config (profile=$PROFILE) with $BESU_IMAGE ..."
rm -rf "$OUT"
mkdir -p "$OUT"

# Optional deployer prefund: if DEPLOYER_ADDRESS set, patch alloc before generate
TMP_CONFIG="$OUT/qbftConfig.work.json"
cp "$CONFIG" "$TMP_CONFIG"

if [[ -n "${DEPLOYER_ADDRESS:-}" ]]; then
  python3 - <<'PY' "$TMP_CONFIG" "$DEPLOYER_ADDRESS"
import json, sys
path, addr = sys.argv[1], sys.argv[2].lower()
if not addr.startswith("0x"):
    addr = "0x" + addr
with open(path) as f:
    cfg = json.load(f)
# Huge native balance (gas is free; buffer for tooling)
cfg["genesis"]["alloc"][addr] = {"balance": "0x152D02C7E14AF6800000"}
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
print(f"Prefunded deployer {addr}")
PY
fi

docker run --rm \
  -v "$ROOT:/work" \
  -w /work \
  "$BESU_IMAGE" \
  operator generate-blockchain-config \
  --config-file="/work/network/qbftConfig.work.json" \
  --to="/work/network/generated" \
  --private-key-file-name=key

cp "$OUT/generated/genesis.json" "$OUT/genesis.json"

i=1
for keydir in "$OUT"/generated/keys/0x*; do
  addr="$(basename "$keydir")"
  dest="$OUT/validator-$i"
  mkdir -p "$dest/data"
  cp "$keydir/key" "$dest/data/key"
  cp "$keydir/key.pub" "$dest/data/key.pub"
  echo "$addr" > "$dest/address"
  echo "Validator $i => $addr"
  i=$((i + 1))
done

# Persist public validator list for docs/admin
python3 - <<'PY' "$OUT"
import json, pathlib, sys
out = pathlib.Path(sys.argv[1])
addrs = []
for i in range(1, 5):
    p = out / f"validator-{i}" / "address"
    if p.exists():
        addrs.append(p.read_text().strip())
(out / "validators.json").write_text(json.dumps({"validators": addrs}, indent=2) + "\n")

# Docker-DNS bootnode for validators 2–4 (no log scrape)
pubfile = out / "validator-1" / "data" / "key.pub"
if pubfile.exists():
    pub = pubfile.read_text().strip().removeprefix("0x")
    if len(pub) == 130 and pub.startswith("04"):
        pub = pub[2:]
    if len(pub) == 128:
        enode = f"enode://{pub}@validator-1:30303"
        (out / "bootnode.enode").write_text(enode + "\n")
        print(f"Wrote bootnode.enode → {enode}")
    else:
        print(f"WARNING: key.pub length {len(pub)} — skip bootnode.enode", file=sys.stderr)
PY

echo "Done. Genesis: $OUT/genesis.json"
echo "Mount validator-N/data into Besu containers. Do not commit $OUT to git."
