#!/usr/bin/env bash
set -euo pipefail

BRANCH="hieusro-v150-fresh-server"
SRC_DIR="/opt/hieusro/src"
DEPLOY_DIR="$SRC_DIR/deploy/digitalocean"
LOCK_FILE="/var/lock/hieusro-update.lock"
LOG_FILE="/var/log/hieusro-update.log"
DEPLOYED_SHA_FILE="/opt/hieusro/.deployed-sha"

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
DEPLOYED_SHA="$(cat "$DEPLOYED_SHA_FILE" 2>/dev/null || true)"

if [ "$DEPLOYED_SHA" = "$REMOTE_SHA" ]; then
  exit 0
fi

{
  echo "[$(date -Is)] HieuSRO update needed: deployed=${DEPLOYED_SHA:-unknown} local=${LOCAL_SHA:0:8} remote=${REMOTE_SHA:0:8}"
  "$DEPLOY_DIR/update.sh"
  printf '%s\n' "$REMOTE_SHA" > "$DEPLOYED_SHA_FILE"
  echo "[$(date -Is)] HieuSRO update completed: ${REMOTE_SHA:0:8}."
} >>"$LOG_FILE" 2>&1
