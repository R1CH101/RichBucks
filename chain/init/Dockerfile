# One-shot genesis + QBFT key generator → volume chain-network
# Build: context=./chain  dockerfile=init/Dockerfile
#
# Coolify often restores the stock Besu ENTRYPOINT (`besu-entry.sh`) and/or
# runs `besu` with our script as args. We replace BOTH entrypoints and wrap
# the besu binary so every Coolify path runs init.
FROM hyperledger/besu:25.1.0

USER root

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends jq ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && which jq && which bash

COPY qbftConfig.prod.json qbftConfig.dev.json /qbft/
COPY scripts/docker-init-network.sh /docker-init-network.sh
COPY init/besu-dispatcher.sh /opt/besu/bin/besu.dispatcher
COPY init/chain-init-entrypoint.sh /chain-init-entrypoint.sh

RUN sed -i 's/\r$//' /docker-init-network.sh /opt/besu/bin/besu.dispatcher /chain-init-entrypoint.sh \
  && chmod +x /docker-init-network.sh /opt/besu/bin/besu.dispatcher /chain-init-entrypoint.sh \
  && mv /opt/besu/bin/besu /opt/besu/bin/besu.real \
  && cp /opt/besu/bin/besu.dispatcher /opt/besu/bin/besu \
  && chmod +x /opt/besu/bin/besu /opt/besu/bin/besu.real \
  && mv /opt/besu/bin/besu-entry.sh /opt/besu/bin/besu-entry.sh.real \
  && cp /chain-init-entrypoint.sh /opt/besu/bin/besu-entry.sh \
  && chmod +x /opt/besu/bin/besu-entry.sh \
  && test -x /opt/besu/bin/besu.real \
  && test -x /opt/besu/bin/besu \
  && test -x /opt/besu/bin/besu-entry.sh \
  && test -x /docker-init-network.sh \
  && test -x /chain-init-entrypoint.sh

ENV NETWORK_DIR=/network
ENV PROFILE=prod
ENV PATH="/opt/besu/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Stock image uses besu-entry.sh; we replaced that file AND set this explicitly.
ENTRYPOINT ["/chain-init-entrypoint.sh"]
CMD []
