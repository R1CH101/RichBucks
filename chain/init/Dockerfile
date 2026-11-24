# One-shot genesis + QBFT key generator → volume chain-network
# Build: context=./chain  dockerfile=init/Dockerfile
#
# IMPORTANT: Do NOT use hyperledger/besu as the final image. Its ENTRYPOINT is
# `besu`, and Coolify often applies compose `command` while keeping/restoring
# that entrypoint → `besu /docker-init-network.sh` → exit 2.
ARG BESU_VERSION=25.1.0
FROM hyperledger/besu:${BESU_VERSION} AS besu

FROM ubuntu:24.04
USER root

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openjdk-21-jre-headless \
    jq \
    ca-certificates \
    bash \
    findutils \
  && rm -rf /var/lib/apt/lists/*

COPY --from=besu /opt/besu /opt/besu
ENV PATH="/opt/besu/bin:${PATH}"

COPY qbftConfig.prod.json qbftConfig.dev.json /qbft/
COPY scripts/docker-init-network.sh /docker-init-network.sh

# Wrapper ignores any Coolify-injected CMD args; always runs init.
RUN sed -i 's/\r$//' /docker-init-network.sh \
  && chmod +x /docker-init-network.sh \
  && printf '%s\n' \
    '#!/bin/bash' \
    'exec /bin/bash /docker-init-network.sh' \
    > /chain-init-entrypoint.sh \
  && sed -i 's/\r$//' /chain-init-entrypoint.sh \
  && chmod +x /chain-init-entrypoint.sh \
  && which besu && which jq && which bash \
  && besu --version

ENV NETWORK_DIR=/network
ENV PROFILE=prod

ENTRYPOINT ["/chain-init-entrypoint.sh"]
