# One-shot genesis + QBFT key generator → volume chain-network
# Build: context=./chain  dockerfile=init/Dockerfile
#
# Final image is NOT hyperledger/besu. Coolify otherwise restores that image's
# ENTRYPOINT (`besu-entry.sh`) and chain-init exits 2 before our script runs.
FROM hyperledger/besu:25.1.0 AS besu

FROM eclipse-temurin:21-jre-jammy
USER root

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    jq \
    ca-certificates \
    bash \
    findutils \
  && rm -rf /var/lib/apt/lists/*

COPY --from=besu /opt/besu /opt/besu

COPY qbftConfig.prod.json qbftConfig.dev.json /qbft/
COPY scripts/docker-init-network.sh /docker-init-network.sh
COPY init/chain-init-entrypoint.sh /chain-init-entrypoint.sh

RUN sed -i 's/\r$//' /docker-init-network.sh /chain-init-entrypoint.sh \
  && chmod +x /docker-init-network.sh /chain-init-entrypoint.sh \
  && rm -f /opt/besu/bin/besu-entry.sh \
  && cp /chain-init-entrypoint.sh /opt/besu/bin/besu-entry.sh \
  && chmod +x /opt/besu/bin/besu-entry.sh \
  && test -x /opt/besu/bin/besu \
  && test -x /docker-init-network.sh \
  && test -x /chain-init-entrypoint.sh

ENV NETWORK_DIR=/network
ENV PROFILE=prod
ENV PATH="/opt/besu/bin:/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ENV BESU_BIN=/opt/besu/bin/besu

ENTRYPOINT ["/chain-init-entrypoint.sh"]
CMD []
