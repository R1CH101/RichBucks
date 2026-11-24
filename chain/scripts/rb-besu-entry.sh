#!/usr/bin/env bash
# Wrapper for stock Besu containers.
# - Coolify injects BESU_VERSION → Besu picocli treats it as --version (boolean).
# - Empty --bootnodes= → derive from /network/bootnode.enode or validator-1 key.pub.
set -euo pipefail
unset BESU_VERSION || true

resolve_boot() {
  if [[ -f /network/bootnode.enode ]]; then
    tr -d '[:space:]' </network/bootnode.enode
    return 0
  fi
  if [[ -f /network/validator-1/data/key.pub ]]; then
    local pub
    pub="$(tr -d '[:space:]' </network/validator-1/data/key.pub)"
    pub="${pub#0x}"
    if [[ ${#pub} -eq 130 && "${pub:0:2}" == "04" ]]; then
      pub="${pub:2}"
    fi
    if [[ ${#pub} -eq 128 ]]; then
      echo "enode://${pub}@validator-1:30303"
      return 0
    fi
  fi
  return 1
}

args=()
for a in "$@"; do
  case "$a" in
    --bootnodes=)
      if b="$(resolve_boot)"; then args+=("--bootnodes=$b"); fi
      ;;
    --bootnodes=*)
      val="${a#--bootnodes=}"
      if [[ -z "$val" ]]; then
        if b="$(resolve_boot)"; then args+=("--bootnodes=$b"); fi
      else
        args+=("$a")
      fi
      ;;
    *) args+=("$a") ;;
  esac
done

exec /opt/besu/bin/besu-entry.sh "${args[@]}"
