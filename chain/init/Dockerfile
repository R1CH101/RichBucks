# One-shot genesis + QBFT key generator (writes into named volume chain-network)
# Build context: chain/  (docker compose: build.context: .  dockerfile: init/Dockerfile)
ARG BESU_VERSION=25.1.0
FROM hyperledger/besu:${BESU_VERSION}

USER root
# Besu images are Ubuntu-based; python used only to patch genesis alloc / write validators.json
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*

COPY qbftConfig.prod.json qbftConfig.dev.json /qbft/
COPY scripts/docker-init-network.sh /docker-init-network.sh
RUN chmod +x /docker-init-network.sh

ENV NETWORK_DIR=/network
ENV PROFILE=prod

ENTRYPOINT ["/bin/bash", "/docker-init-network.sh"]
