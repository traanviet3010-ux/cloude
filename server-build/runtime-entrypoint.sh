#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/hieusro/server
STATE_ROOT=${SRO_STATE_ROOT:-$ROOT/.state}
TOKEN_PATH="$STATE_ROOT/cluster/agent-provisioning-token"

if [ -n "${HIEUSRO_PROVISIONING_TOKEN:-}" ]; then
  if [ "${#HIEUSRO_PROVISIONING_TOKEN}" -lt 32 ]; then
    echo "HIEUSRO_PROVISIONING_TOKEN must be at least 32 characters" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$TOKEN_PATH")"
  printf '%s\n' "$HIEUSRO_PROVISIONING_TOKEN" > "$TOKEN_PATH"
  chmod 600 "$TOKEN_PATH"
  echo "Provisioning token prepared from Render secret"
fi

exec /opt/hieusro/runtime-start.sh
