#!/usr/bin/env bash
set -euo pipefail

BRANCH="hieusro-digitalocean"
SRC_DIR="/opt/hieusro/src"
DEPLOY_DIR="$SRC_DIR/deploy/digitalocean"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root." >&2
  exit 1
fi

"$DEPLOY_DIR/backup.sh"
git -C "$SRC_DIR" fetch origin "$BRANCH"
git -C "$SRC_DIR" checkout "$BRANCH"
git -C "$SRC_DIR" reset --hard "origin/$BRANCH"

DOCKERFILE="$SRC_DIR/server-build/Dockerfile.allinone"
sed -i 's/SRO_BUILD_JOBS=2/SRO_BUILD_JOBS=1/' "$DOCKERFILE"
sed -i 's#RUN corepack pnpm assets build world-outdoor#RUN NODE_OPTIONS="--max-old-space-size=3072" corepack pnpm assets build world-outdoor#' "$DOCKERFILE"
python3 "$DEPLOY_DIR/patch-mobile-dockerfile.py" "$DOCKERFILE"

cd "$DEPLOY_DIR"
docker compose --env-file .env -f compose.yml build
docker compose --env-file .env -f compose.yml up -d --remove-orphans

docker image prune -f >/dev/null 2>&1 || true
echo "HieuSRO updated to $(git -C "$SRC_DIR" rev-parse --short HEAD)."
