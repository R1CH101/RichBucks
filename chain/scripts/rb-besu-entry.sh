#!/usr/bin/env bash
# Wrapper for stock Besu containers. Coolify injects a project env whose name
# collides with Besu's boolean --version flag; strip it before exec.
set -euo pipefail
unset BESU_VERSION || true
exec /opt/besu/bin/besu-entry.sh "$@"
