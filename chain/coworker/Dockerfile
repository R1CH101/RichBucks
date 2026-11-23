# Public coworker / optional validator node — keep under ~1GB RAM
ARG BESU_VERSION=25.1.0
FROM hyperledger/besu:${BESU_VERSION}

USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV JAVA_OPTS="-Xmx512m" \
    BESU_MIN_GAS_PRICE=0 \
    MEM_LIMIT_HINT=1g

EXPOSE 8545 30303
VOLUME ["/data"]

ENTRYPOINT ["/entrypoint.sh"]
