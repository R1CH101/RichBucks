# One-shot genesis + QBFT key generator → volume chain-network
# Build: context=./chain  dockerfile=init/Dockerfile
#
# Coolify often drops compose `entrypoint` and runs image ENTRYPOINT `besu`
# with compose `command` as args → exit 2. We wrap the besu binary so that
# path still runs init; real subcommands go to besu.real.
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
  && test -x /opt/besu/bin/besu.real \
  && test -x /opt/besu/bin/besu \
  && test -x /docker-init-network.sh

ENV NETWORK_DIR=/network
ENV PROFILE=prod

ENTRYPOINT ["/chain-init-entrypoint.sh"]
CMD []
