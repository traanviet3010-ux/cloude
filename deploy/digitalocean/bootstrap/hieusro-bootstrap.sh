#!/usr/bin/env bash
set -euo pipefail

LOG=/var/log/hieusro-bootstrap.log
DONE=/var/lib/hieusro-bootstrap.complete
INSTALL=/root/hieusro-install.sh
URL=https://raw.githubusercontent.com/traanviet3010-ux/cloude/hieusro-v150-fresh-server/deploy/digitalocean/install.sh

exec >>"$LOG" 2>&1

echo "[$(date -Is)] HieuSRO fresh v1.150 bootstrap starting"
if [ -f "$DONE" ]; then
  echo "[$(date -Is)] bootstrap already completed"
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive

for attempt in $(seq 1 60); do
  if curl -fsSL --connect-timeout 10 --max-time 60 "$URL" -o "$INSTALL"; then
    break
  fi
  echo "[$(date -Is)] waiting for network/GitHub (attempt $attempt/60)"
  sleep 10
done

if [ ! -s "$INSTALL" ]; then
  echo "[$(date -Is)] could not download HieuSRO fresh installer" >&2
  exit 1
fi

chmod 700 "$INSTALL"
"$INSTALL"
touch "$DONE"
systemctl disable hieusro-bootstrap.service || true

echo "[$(date -Is)] HieuSRO fresh v1.150 bootstrap completed"
