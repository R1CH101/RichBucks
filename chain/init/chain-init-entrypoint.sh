#!/usr/bin/env bash
export PATH="/opt/besu/bin:/opt/java/openjdk/bin:${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"
export BESU_BIN="${BESU_BIN:-/opt/besu/bin/besu}"
exec /bin/bash /docker-init-network.sh
