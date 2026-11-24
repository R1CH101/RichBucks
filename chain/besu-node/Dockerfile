# Thin Besu wrapper so Coolify restores OUR entrypoint (not stock besu-entry.sh).
# Resolves bootnode DNS → IPv4 (Besu static-nodes / enode URLs reject hostnames).
ARG BESU_IMAGE_TAG=25.1.0
FROM hyperledger/besu:${BESU_IMAGE_TAG}

USER root
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       bind9-host \
       bash \
  && rm -rf /var/lib/apt/lists/*

COPY rb-besu-node-entry.sh /rb-besu-node-entry.sh
RUN sed -i 's/\r$//' /rb-besu-node-entry.sh \
  && chmod +x /rb-besu-node-entry.sh \
  && rm -f /opt/besu/bin/besu-entry.sh \
  && cp /rb-besu-node-entry.sh /opt/besu/bin/besu-entry.sh \
  && chmod +x /opt/besu/bin/besu-entry.sh

ENTRYPOINT ["/rb-besu-node-entry.sh"]
