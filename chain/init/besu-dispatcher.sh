#!/usr/bin/env bash
# Replaces /opt/besu/bin/besu in the chain-init image.
# Coolify often runs ENTRYPOINT `besu` with our script as args (exit 2).
# Bare/script invocations → chain-init; real CLI subcommands → besu.real.
set -euo pipefail
if [[ $# -eq 0 \
  || "${1:-}" == /docker-init-network.sh \
  || "${1:-}" == /chain-init-entrypoint.sh \
  || "${1:-}" == *docker-init-network.sh ]]; then
  exec /bin/bash /docker-init-network.sh
fi
exec /opt/besu/bin/besu.real "$@"
