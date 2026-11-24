#!/usr/bin/env bash
# Replaces /opt/besu/bin/besu in the chain-init image.
# Coolify often restores ENTRYPOINT besu / besu-entry.sh; bare calls must run init.
# Real CLI subcommands (operator, --version, --print-paths-and-exit, …) → besu.real.
set -euo pipefail
export PATH="/opt/besu/bin:${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"

if [[ $# -eq 0 ]]; then
  exec /bin/bash /docker-init-network.sh
fi

case "${1:-}" in
  /docker-init-network.sh|/chain-init-entrypoint.sh|*docker-init-network.sh|*chain-init-entrypoint.sh)
    exec /bin/bash /docker-init-network.sh
    ;;
esac

exec /opt/besu/bin/besu.real "$@"
