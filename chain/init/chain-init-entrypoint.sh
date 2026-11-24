#!/usr/bin/env bash
# Always run as root-capable init; ignore Coolify-injected args.
export PATH="/opt/besu/bin:${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"
exec /bin/bash /docker-init-network.sh
