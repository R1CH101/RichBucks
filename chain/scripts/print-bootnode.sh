#!/usr/bin/env bash
# Extract enode from validator-1 container logs and rewrite host for Docker DNS.
set -euo pipefail
CONTAINER="${1:-rb-validator-1}"
RAW=$(docker logs "$CONTAINER" 2>&1 | grep -oE 'enode://[0-9a-fA-F]+@[^ ]+' | tail -1 || true)
if [[ -z "$RAW" ]]; then
  echo "No enode found in logs for $CONTAINER yet. Is it running?" >&2
  exit 1
fi
# Peers on the compose network should dial validator-1:30303
echo "$RAW" | sed -E 's/@[^:]+:/@validator-1:/'
