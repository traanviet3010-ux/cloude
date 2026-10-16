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

# Do not prewarm until the local Nginx/runtime is actually ready. A prewarm
# failure is non-fatal because Nginx still falls back to opensro.online, but
# it is logged loudly so the mirror can be repaired without taking LIVE down.
ready=0
for attempt in $(seq 1 180); do
  if docker compose --env-file .env -f compose.yml exec -T game \
      curl -fsS http://127.0.0.1:10000/healthz >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [ "$ready" = 1 ]; then
  if docker compose --env-file .env -f compose.yml exec -T game \
      python /opt/hieusro/prewarm-assets.py; then
    echo "HieuSRO asset mirror prewarm verified."
  else
    echo "WARNING: asset mirror prewarm failed; upstream fallback remains active." >&2
  fi
  docker compose --env-file .env -f compose.yml exec -T game \
    sh -lc 'du -sh /var/cache/hieusro-assets 2>/dev/null || true'
else
  echo "WARNING: runtime did not become ready before prewarm window; upstream fallback remains active." >&2
fi

docker image prune -f >/dev/null 2>&1 || true
echo "HieuSRO updated to $(git -C "$SRC_DIR" rev-parse --short HEAD)."
