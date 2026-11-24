# One-shot genesis + QBFT key generator → volume chain-network
# Build: context=./chain  dockerfile=init/Dockerfile
ARG BESU_VERSION=25.1.0
FROM hyperledger/besu:${BESU_VERSION}

USER root

# Besu image is Ubuntu; install jq for genesis prefund (no Python required)
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends jq ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && which besu && which jq && which bash

COPY qbftConfig.prod.json qbftConfig.dev.json /qbft/
COPY scripts/docker-init-network.sh /docker-init-network.sh
# Normalize line endings if the build host is Windows
RUN sed -i 's/\r$//' /docker-init-network.sh && chmod +x /docker-init-network.sh

ENV NETWORK_DIR=/network
ENV PROFILE=prod

ENTRYPOINT ["/bin/bash", "/docker-init-network.sh"]
