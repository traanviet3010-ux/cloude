#!/usr/bin/env bash
set -euo pipefail

BRANCH="hieusro-digitalocean"
SRC_DIR="/opt/hieusro/src"
DEPLOY_DIR="$SRC_DIR/deploy/digitalocean"
LOCK_FILE="/var/lock/hieusro-update.lock"
LOG_FILE="/var/log/hieusro-update.log"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

if [ ! -d "$SRC_DIR/.git" ]; then
  exit 0
fi

git -C "$SRC_DIR" fetch --quiet origin "$BRANCH"
LOCAL_SHA="$(git -C "$SRC_DIR" rev-parse HEAD)"
REMOTE_SHA="$(git -C "$SRC_DIR" rev-parse "origin/$BRANCH")"

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  exit 0
fi

{
  echo "[$(date -Is)] HieuSRO update detected: ${LOCAL_SHA:0:8} -> ${REMOTE_SHA:0:8}"
  "$DEPLOY_DIR/update.sh"
  echo "[$(date -Is)] HieuSRO update completed."
} >>"$LOG_FILE" 2>&1
