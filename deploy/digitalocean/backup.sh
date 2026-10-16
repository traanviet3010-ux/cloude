#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/opt/hieusro"
SRC_DIR="$ROOT_DIR/src"
DEPLOY_DIR="$SRC_DIR/deploy/digitalocean"
BACKUP_ROOT="$ROOT_DIR/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/$STAMP"
CONFIG_DEST="$DEST/config"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root." >&2
  exit 1
fi

mkdir -p "$CONFIG_DEST"
cd "$DEPLOY_DIR"

# Flush Redis before copying its persisted data.
docker compose --env-file .env -f compose.yml exec -T redis redis-cli SAVE >/dev/null

docker compose --env-file .env -f compose.yml exec -T game \
  tar -C /data/state -czf - . > "$DEST/game-state.tgz"

docker compose --env-file .env -f compose.yml exec -T redis \
  tar -C /data -czf - . > "$DEST/redis-data.tgz"

# Keep the exact deploy/runtime configuration used for this backup so routing
# and cache changes can be rolled back without reconstructing them by hand.
cp .env "$DEST/server.env"
cp "$DEPLOY_DIR/Caddyfile" "$CONFIG_DEST/Caddyfile"
cp "$DEPLOY_DIR/compose.yml" "$CONFIG_DEST/compose.yml"
cp "$SRC_DIR/server-build/runtime-nginx.conf" "$CONFIG_DEST/runtime-nginx.source.conf"
docker compose --env-file .env -f compose.yml exec -T game \
  cat /opt/hieusro/runtime-nginx.conf > "$CONFIG_DEST/runtime-nginx.deployed.conf" 2>/dev/null || true

chmod 600 "$DEST/server.env"
chmod 600 "$CONFIG_DEST"/* 2>/dev/null || true
(
  cd "$DEST"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

# Keep the newest 14 local backups.
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr \
  | tail -n +15 \
  | cut -d' ' -f2- \
  | xargs -r rm -rf

echo "$DEST"
