# One-shot genesis + QBFT key generator → volume chain-network
# Build: context=./chain  dockerfile=init/Dockerfile
#
# Coolify often drops compose `entrypoint` and runs the image ENTRYPOINT (`besu`)
# with compose `command` as args → `besu /docker-init-network.sh` → exit 2.
# We keep the official Besu image (Java + binaries) and wrap `besu` so:
#   - `besu` / `besu /docker-init-network.sh` → run our init script
#   - `besu operator …` / other real subcommands → real Besu CLI
ARG BESU_VERSION=25.1.0
FROM hyperledger/besu:${BESU_VERSION}

USER root

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends jq ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && which jq && which bash

COPY qbftConfig.prod.json qbftConfig.dev.json /qbft/
COPY scripts/docker-init-network.sh /docker-init-network.sh

RUN sed -i 's/\r$//' /docker-init-network.sh \
  && chmod +x /docker-init-network.sh \
  && mv /opt/besu/bin/besu /opt/besu/bin/besu.real \
  && printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    '# Coolify-proof dispatcher: bare/script invocations run chain-init;' \
    '# real Besu subcommands go to besu.real.' \
    'if [[ $# -eq 0 \
      || "${1:-}" == /docker-init-network.sh \
      || "${1:-}" == /chain-init-entrypoint.sh \
      || "${1:-}" == *docker-init-network.sh ]]; then' \
    '  exec /bin/bash /docker-init-network.sh' \
    'fi' \
    'exec /opt/besu/bin/besu.real "$@"' \
    > /opt/besu/bin/besu \
  && chmod +x /opt/besu/bin/besu \
  && printf '%s\n' \
    '#!/usr/bin/env bash' \
    'exec /bin/bash /docker-init-network.sh' \
    > /chain-init-entrypoint.sh \
  && sed -i 's/\r$//' /chain-init-entrypoint.sh \
  && chmod +x /chain-init-entrypoint.sh \
  && /opt/besu/bin/besu.real --version

ENV NETWORK_DIR=/network
ENV PROFILE=prod

# Prefer our wrapper; if Coolify restores ENTRYPOINT to `besu`, the dispatcher above still runs init.
ENTRYPOINT ["/chain-init-entrypoint.sh"]
CMD []
