#!/usr/bin/env bash
# Print validator-1 bootnode for Docker DNS: enode://…@validator-1:30303
#
# Does NOT scrape logs (Besu often never prints enode://, and Coolify renames
# containers). Prefers /network/bootnode.enode, else derives from key.pub.
set -euo pipefail

HOST="${BOOTNODE_HOST:-validator-1}"
PORT="${BOOTNODE_PORT:-30303}"

enode_from_pub_file() {
  local pubfile="$1"
  [[ -f "$pubfile" ]] || return 1
  local pub
  pub="$(tr -d '[:space:]' <"$pubfile")"
  pub="${pub#0x}"
  if [[ ${#pub} -eq 130 && "${pub:0:2}" == "04" ]]; then
    pub="${pub:2}"
  fi
  if [[ ${#pub} -ne 128 ]]; then
    echo "Unexpected key.pub length ${#pub} (want 128 hex chars) in $pubfile" >&2
    return 1
  fi
  echo "enode://${pub}@${HOST}:${PORT}"
}

# --- 1) Local network dir (laptop / bind-mount) ---
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for candidate in \
  "${NETWORK_DIR:-}" \
  "$ROOT/network" \
  /network
do
  [[ -n "$candidate" ]] || continue
  if [[ -f "$candidate/bootnode.enode" ]]; then
    tr -d '[:space:]' <"$candidate/bootnode.enode"
    echo
    exit 0
  fi
  if [[ -f "$candidate/validator-1/data/key.pub" ]]; then
    enode_from_pub_file "$candidate/validator-1/data/key.pub"
    exit 0
  fi
done

# --- 2) Running Docker container that mounts chain-network ---
if command -v docker >/dev/null 2>&1; then
  CID=""
  for pat in "name=rb-validator-1" "name=validator-1" "name=chain-init"; do
    CID="$(docker ps -aqf "$pat" 2>/dev/null | head -1 || true)"
    [[ -n "$CID" ]] && break
  done
  # Coolify often prefixes: *validator-1*
  if [[ -z "$CID" ]]; then
    CID="$(docker ps -a --format '{{.ID}} {{.Names}}' 2>/dev/null | awk '/validator-1/ {print $1; exit}' || true)"
  fi

  if [[ -n "$CID" ]]; then
    if docker exec "$CID" test -f /network/bootnode.enode 2>/dev/null; then
      docker exec "$CID" sh -c "tr -d '[:space:]' </network/bootnode.enode"
      echo
      exit 0
    fi
    if docker exec "$CID" test -f /network/validator-1/data/key.pub 2>/dev/null; then
      PUB="$(docker exec "$CID" sh -c "tr -d '[:space:]' </network/validator-1/data/key.pub")"
      PUB="${PUB#0x}"
      if [[ ${#PUB} -eq 130 && "${PUB:0:2}" == "04" ]]; then
        PUB="${PUB:2}"
      fi
      if [[ ${#PUB} -eq 128 ]]; then
        echo "enode://${PUB}@${HOST}:${PORT}"
        exit 0
      fi
      echo "Got key.pub from $CID but length ${#PUB} is not 128 hex chars" >&2
    fi
  fi
fi

cat >&2 <<'EOF'
Could not find bootnode.

Need either:
  - /network/bootnode.enode (written by chain-init), or
  - /network/validator-1/data/key.pub on the chain-network volume

On the VPS / Coolify terminal:
  docker ps -a --format '{{.Names}}' | grep -i validator-1
  docker exec <that-name> cat /network/validator-1/data/key.pub

If key.pub is missing, chain-init never finished — check that service's logs.
EOF
exit 1
