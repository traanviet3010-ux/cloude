#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="/opt/hieusro/src/deploy/digitalocean"
BACKUP_ROOT="/opt/hieusro/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/$STAMP"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root." >&2
  exit 1
fi

mkdir -p "$DEST"
cd "$DEPLOY_DIR"

# Flush Redis before copying its persisted data.
docker compose --env-file .env -f compose.yml exec -T redis redis-cli SAVE >/dev/null

docker compose --env-file .env -f compose.yml exec -T game \
  tar -C /data/state -czf - . > "$DEST/game-state.tgz"

docker compose --env-file .env -f compose.yml exec -T redis \
  tar -C /data -czf - . > "$DEST/redis-data.tgz"

cp .env "$DEST/server.env"
chmod 600 "$DEST/server.env"
sha256sum "$DEST"/*.tgz > "$DEST/SHA256SUMS"

# Keep the newest 14 local backups.
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr \
  | tail -n +15 \
  | cut -d' ' -f2- \
  | xargs -r rm -rf

echo "$DEST"
