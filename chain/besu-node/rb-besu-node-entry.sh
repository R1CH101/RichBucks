#!/usr/bin/env bash
# Validator / Besu node entrypoint (baked into image — survives Coolify ENTRYPOINT restore).
# - Strip Coolify BESU_VERSION (picocli maps it to boolean --version).
# - Besu static-nodes / enode URLs require a numeric IP, not Docker DNS names.
set -euo pipefail
unset BESU_VERSION || true

BOOT_HOST="${BOOTNODE_HOST:-validator-1}"
BOOT_PORT="${BOOTNODE_PORT:-30303}"

resolve_ip() {
  local host="$1"
  local ip=""
  if command -v getent >/dev/null 2>&1; then
    ip="$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1; exit}')"
  fi
  if [[ -z "$ip" ]] && command -v host >/dev/null 2>&1; then
    ip="$(host -t A "$host" 2>/dev/null | awk '/has address/{print $4; exit}')"
  fi
  if [[ -z "$ip" ]] && command -v dig >/dev/null 2>&1; then
    ip="$(dig +short A "$host" 2>/dev/null | head -1)"
  fi
  printf '%s' "$ip"
}

enode_node_id() {
  if [[ -f /network/bootnode.enode ]]; then
    local e
    e="$(tr -d '[:space:]' </network/bootnode.enode)"
    e="${e#enode://}"
    echo "${e%%@*}"
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
      echo "$pub"
      return 0
    fi
  fi
  return 1
}

build_boot_enode() {
  local id ip
  id="$(enode_node_id)" || return 1
  ip="$(resolve_ip "$BOOT_HOST")"
  if [[ -z "$ip" || ! "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "WARNING: cannot resolve $BOOT_HOST to IPv4 (got '${ip:-empty}')" >&2
    return 1
  fi
  echo "enode://${id}@${ip}:${BOOT_PORT}"
}

# Refresh this node's static-nodes.json with an IP-based enode (validators 2–4).
# Skip for validator-1 data path (bootnode itself).
refresh_static_nodes() {
  local data_path=""
  local a
  for a in "$@"; do
    case "$a" in
      --data-path=*) data_path="${a#--data-path=}" ;;
    esac
  done
  [[ -n "$data_path" ]] || return 0
  case "$data_path" in
    */validator-1/*|*/validator-1) 
      mkdir -p "$data_path"
      printf '[]\n' >"$data_path/static-nodes.json"
      return 0
      ;;
  esac
  local enode
  if ! enode="$(build_boot_enode)"; then
    echo "WARNING: leaving static-nodes unchanged (boot enode unavailable)" >&2
    return 0
  fi
  mkdir -p "$data_path"
  printf '["%s"]\n' "$enode" >"$data_path/static-nodes.json"
  echo "static-nodes → $enode"
}

refresh_static_nodes "$@"

# Also inject --bootnodes=<ip-enode> if missing/empty (belt and suspenders).
args=()
have_boot=0
for a in "$@"; do
  case "$a" in
    --bootnodes=|--bootnodes=*)
      val="${a#--bootnodes=}"
      if [[ -z "$val" ]]; then
        if b="$(build_boot_enode)"; then
          args+=("--bootnodes=$b")
          have_boot=1
        fi
      else
        # Rewrite hostname → IP if present
        if [[ "$val" == *"@${BOOT_HOST}:"* ]]; then
          if b="$(build_boot_enode)"; then
            args+=("--bootnodes=$b")
            have_boot=1
          else
            args+=("$a")
            have_boot=1
          fi
        else
          args+=("$a")
          have_boot=1
        fi
      fi
      ;;
    *) args+=("$a") ;;
  esac
done

# Validators 2–4: ensure bootnodes even if compose omitted the flag
if [[ "$have_boot" -eq 0 ]]; then
  data_hint="$*"
  if [[ "$data_hint" != *validator-1* ]]; then
    if b="$(build_boot_enode)"; then
      args+=("--bootnodes=$b")
    fi
  fi
fi

# Prefer real besu binary (we replaced besu-entry.sh with a copy of this script)
if [[ -x /opt/besu/bin/besu ]]; then
  exec /opt/besu/bin/besu "${args[@]}"
fi
exec besu "${args[@]}"
