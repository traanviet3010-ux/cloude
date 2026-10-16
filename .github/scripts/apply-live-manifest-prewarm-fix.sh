#!/usr/bin/env bash
set -euo pipefail

LIVE='https://play.143-198-217-75.sslip.io'
ORIGIN='https://opensro.online'
DEPLOY=/opt/hieusro/src/deploy/digitalocean
STAMP=20261016-asset-cache-fix
BACKUP_DIR=/opt/hieusro/backups/$STAMP
cd "$DEPLOY"
GAME="$(docker compose --env-file .env -f compose.yml ps -q game)"
test -n "$GAME"
mkdir -p "$BACKUP_DIR"

# Durable rollback copy on the VPS host, plus an in-container copy for immediate rollback.
docker cp "$GAME":/opt/hieusro/runtime-nginx.conf "$BACKUP_DIR/runtime-nginx.conf.before"
docker exec "$GAME" sh -lc 'cp /opt/hieusro/runtime-nginx.conf /tmp/runtime-nginx.conf.before-manifest-prewarm-fix'
sha256sum "$BACKUP_DIR/runtime-nginx.conf.before"

auto_rollback() {
  rc=$?
  echo "FIX_FAILED rc=$rc - restoring original nginx config" >&2
  docker cp "$BACKUP_DIR/runtime-nginx.conf.before" "$GAME":/opt/hieusro/runtime-nginx.conf || true
  docker exec "$GAME" nginx -t -c /opt/hieusro/runtime-nginx.conf || true
  docker exec "$GAME" nginx -c /opt/hieusro/runtime-nginx.conf -s reload || true
  exit "$rc"
}
trap auto_rollback ERR

# Capture origin behavior before changing anything. This is also the authoritative startup list.
curl -fsS --connect-timeout 15 --max-time 120 -H 'Accept-Encoding: identity' \
  -D /tmp/origin-manifest-before.headers -o /tmp/origin-manifest-before.json \
  "$ORIGIN/assets/packs/manifest.json"
echo '=== ORIGIN MANIFEST CACHE HEADERS ==='
awk 'BEGIN{IGNORECASE=1} /^(HTTP\/|cache-control:|expires:|vary:|etag:|last-modified:|content-length:|accept-ranges:)/{print}' /tmp/origin-manifest-before.headers

python3 - <<'PY' >/tmp/startup-packs.tsv
import json
m=json.load(open('/tmp/origin-manifest-before.json','rb'))
for g in m.get('groups',[]):
    if g.get('load') != 'startup':
        continue
    for p in g.get('packs') or []:
        path=p.get('path')
        if path:
            print(f"{path}\t{int(p.get('bytes') or 0)}")
PY
STARTUP_COUNT=$(wc -l </tmp/startup-packs.tsv)
STARTUP_BYTES=$(awk -F '\t' '{s+=$2} END{printf "%.0f",s}' /tmp/startup-packs.tsv)
echo "STARTUP_COUNT=$STARTUP_COUNT STARTUP_BYTES=$STARTUP_BYTES"
test "$STARTUP_COUNT" -gt 0

SAMPLE_PACK=$(head -n1 /tmp/startup-packs.tsv | cut -f1)
echo "=== ORIGIN SAMPLE PACK RANGE HEADERS: $SAMPLE_PACK ==="
curl -fsS --connect-timeout 15 --max-time 120 -H 'Accept-Encoding: identity' -H 'Range: bytes=0-11' \
  -D /tmp/origin-pack-range.headers -o /dev/null "$ORIGIN$SAMPLE_PACK"
awk 'BEGIN{IGNORECASE=1} /^(HTTP\/|cache-control:|expires:|vary:|etag:|last-modified:|content-length:|content-range:|accept-ranges:)/{print}' /tmp/origin-pack-range.headers

cat >/tmp/patch-manifest-cache.py <<'PY'
from pathlib import Path
p=Path('/opt/hieusro/runtime-nginx.conf')
s=p.read_text()
marker='# HIEUSRO MANIFEST VPS CACHE 20261016'
if marker in s:
    print('manifest cache block already present')
    raise SystemExit(0)
if 'location = /assets/packs/manifest.json' in s:
    raise SystemExit('refusing to replace an unknown existing exact manifest location')
needle='    location /assets/ {\n'
if needle not in s:
    raise SystemExit('assets location insertion point not found')
block=r'''    # HIEUSRO MANIFEST VPS CACHE 20261016
    # opensro.online sends Cache-Control:no-cache for this 12.76 MB manifest.
    # Ignore that origin cache directive only for this exact URL; clients still
    # receive a short revalidatable 5-minute policy from HieuSRO.
    location = /assets/packs/manifest.json {
      proxy_pass https://opensro.online;
      proxy_http_version 1.1;
      proxy_ssl_server_name on;
      proxy_ssl_name opensro.online;
      proxy_set_header Host opensro.online;
      proxy_set_header Cookie "";
      proxy_set_header Accept-Encoding "";
      proxy_set_header X-Forwarded-Host $host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

      proxy_cache hieusro_assets;
      proxy_cache_methods GET HEAD;
      proxy_cache_key "https://opensro.online$request_uri";
      proxy_cache_lock on;
      proxy_cache_lock_timeout 20s;
      proxy_cache_background_update on;
      proxy_cache_revalidate on;
      proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
      proxy_cache_valid 200 5m;
      proxy_ignore_headers Set-Cookie Cache-Control Expires Vary;
      proxy_hide_header Set-Cookie;
      proxy_hide_header Cache-Control;

      add_header Cache-Control "public, max-age=300, must-revalidate" always;
      add_header Cross-Origin-Resource-Policy "same-origin" always;
      add_header X-Content-Type-Options "nosniff" always;
      add_header X-HieuSRO-Asset-Cache $upstream_cache_status always;
      add_header X-HieuSRO-Asset-Source "vps-mirror" always;
    }

'''
p.write_text(s.replace(needle, block+needle, 1))
PY

docker cp /tmp/patch-manifest-cache.py "$GAME":/tmp/patch-manifest-cache.py
docker exec "$GAME" python3 /tmp/patch-manifest-cache.py
docker cp "$GAME":/opt/hieusro/runtime-nginx.conf "$BACKUP_DIR/runtime-nginx.conf.after"

echo '=== NGINX CONFIG DIFF ==='
diff -u "$BACKUP_DIR/runtime-nginx.conf.before" "$BACKUP_DIR/runtime-nginx.conf.after" || true

# Required by owner: config test then graceful reload; never restart the container.
docker exec "$GAME" nginx -t -c /opt/hieusro/runtime-nginx.conf
docker exec "$GAME" nginx -c /opt/hieusro/runtime-nginx.conf -s reload
sleep 2

# Health sanity after graceful reload.
curl -k -fsS -o /dev/null --max-time 20 "$LIVE/"
curl -k -fsS -H 'X-OpenSRO-Protocol: 6' -o /tmp/catalog-after-cache-fix.json --max-time 20 "$LIVE/api/title/servers"
grep -q 'global-official' /tmp/catalog-after-cache-fix.json

# The first manifest may MISS, but the second must be a VPS HIT.
echo '=== MANIFEST VERIFY ==='
for n in 1 2; do
  curl -k -fsS --connect-timeout 15 --max-time 120 -H 'Accept-Encoding: identity' \
    -D "/tmp/manifest-fix-$n.headers" -o "/tmp/manifest-fix-$n.json" \
    -w "manifest pass=$n status=%{http_code} bytes=%{size_download} time=%{time_total}\n" \
    "$LIVE/assets/packs/manifest.json"
  awk 'BEGIN{IGNORECASE=1} /^(HTTP\/|x-hieusro-asset-cache:|x-hieusro-asset-source:|cache-control:|etag:|last-modified:|content-length:|vary:)/{print}' "/tmp/manifest-fix-$n.headers"
done
cmp /tmp/manifest-fix-1.json /tmp/manifest-fix-2.json
grep -qi '^x-hieusro-asset-cache: HIT' /tmp/manifest-fix-2.headers

echo '=== PREWARM ALL STARTUP PACKS (FULL FILES) ==='
WARMED=0
while IFS=$'\t' read -r path expected; do
  test -n "$path" || continue
  h=/tmp/prewarm.headers
  m=/tmp/prewarm.meta
  rm -f "$h" "$m"
  curl -k -fsS --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 300 \
    -H 'Accept-Encoding: identity' -D "$h" -o /dev/null \
    -w '%{http_code}\t%{size_download}\t%{time_total}\n' \
    "$LIVE$path" >"$m"
  IFS=$'\t' read -r code got secs <"$m"
  cache=$(awk 'BEGIN{IGNORECASE=1} /^x-hieusro-asset-cache:/{gsub("\\r",""); print $2}' "$h" | tail -n1)
  source=$(awk 'BEGIN{IGNORECASE=1} /^x-hieusro-asset-source:/{gsub("\\r",""); print $2}' "$h" | tail -n1)
  echo "PREWARM path=$path expected=$expected status=$code bytes=$got seconds=$secs cache=${cache:--} source=${source:--}"
  test "$code" = 200
  test "$got" = "$expected"

  # Prove the browser-style 12-byte probe is now local. We check twice; second must HIT.
  for pass in 1 2; do
    rh=/tmp/range-verify.headers
    rm -f "$rh"
    rmeta=$(curl -k -fsS --connect-timeout 15 --max-time 60 -H 'Accept-Encoding: identity' -H 'Range: bytes=0-11' \
      -D "$rh" -o /dev/null -w '%{http_code}\t%{size_download}\t%{time_total}' "$LIVE$path")
    rcache=$(awk 'BEGIN{IGNORECASE=1} /^x-hieusro-asset-cache:/{gsub("\\r",""); print $2}' "$rh" | tail -n1)
    echo "RANGE_VERIFY pass=$pass path=$path meta=$rmeta cache=${rcache:--}"
    if [ "$pass" = 2 ]; then
      grep -qi '^x-hieusro-asset-cache: HIT' "$rh"
    fi
  done
  WARMED=$((WARMED+1))
done </tmp/startup-packs.tsv

test "$WARMED" = "$STARTUP_COUNT"

echo '=== FINAL MANIFEST HIT ==='
curl -k -fsS --connect-timeout 15 --max-time 120 -H 'Accept-Encoding: identity' \
  -D /tmp/manifest-final.headers -o /dev/null \
  -w 'manifest_final status=%{http_code} bytes=%{size_download} time=%{time_total}\n' \
  "$LIVE/assets/packs/manifest.json"
awk 'BEGIN{IGNORECASE=1} /^(HTTP\/|x-hieusro-asset-cache:|x-hieusro-asset-source:|cache-control:|content-length:)/{print}' /tmp/manifest-final.headers
grep -qi '^x-hieusro-asset-cache: HIT' /tmp/manifest-final.headers

echo '=== CACHE DISK AFTER PREWARM ==='
docker exec "$GAME" sh -lc 'du -sh /var/cache/hieusro-assets; find /var/cache/hieusro-assets -type f | wc -l'

# Preserve rollback config on host; clean only transient patch/helper files.
docker exec "$GAME" rm -f /tmp/patch-manifest-cache.py
rm -f /tmp/patch-manifest-cache.py
trap - ERR

echo "ROLLBACK_CONFIG=$BACKUP_DIR/runtime-nginx.conf.before"
echo "MANIFEST_CACHE_FIX_OK=1 STARTUP_PREWARM_OK=1 STARTUP_COUNT=$STARTUP_COUNT STARTUP_BYTES=$STARTUP_BYTES"
