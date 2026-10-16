#!/usr/bin/env bash
set -euo pipefail

LIVE='https://play.143-198-217-75.sslip.io'
ORIGIN='https://opensro.online'
DEPLOY=/opt/hieusro/src/deploy/digitalocean
cd "$DEPLOY"
GAME="$(docker compose --env-file .env -f compose.yml ps -q game)"
test -n "$GAME"

printf '%s\n' '=== CURRENT NGINX CACHE CONFIG ==='
docker exec "$GAME" sh -lc "grep -nE 'proxy_cache_path|location @asset_upstream|proxy_cache |proxy_cache_key|proxy_cache_valid|proxy_ignore_headers|proxy_hide_header|proxy_set_header Accept-Encoding|proxy_cache_revalidate|proxy_cache_lock|proxy_cache_background_update' /opt/hieusro/runtime-nginx.conf"

printf '%s\n' '=== CACHE DISK ==='
docker exec "$GAME" sh -lc "du -sh /var/cache/hieusro-assets 2>/dev/null || true; find /var/cache/hieusro-assets -type f 2>/dev/null | wc -l || true"

printf '%s\n' '=== ORIGIN MANIFEST FULL GET ==='
curl -fsS --connect-timeout 15 --max-time 120 -H 'Accept-Encoding: identity' \
  -D /tmp/origin-manifest.headers -o /tmp/origin-manifest.json \
  -w 'origin_manifest status=%{http_code} bytes=%{size_download} time=%{time_total}\n' \
  "$ORIGIN/assets/packs/manifest.json"
awk 'BEGIN{IGNORECASE=1} /^(HTTP\/|cache-control:|expires:|vary:|set-cookie:|etag:|last-modified:|content-length:|content-type:|accept-ranges:|age:)/{print}' /tmp/origin-manifest.headers
sha256sum /tmp/origin-manifest.json

printf '%s\n' '=== ORIGIN MANIFEST RANGE 0-11 ==='
curl -fsS --connect-timeout 15 --max-time 120 -H 'Accept-Encoding: identity' -H 'Range: bytes=0-11' \
  -D /tmp/origin-manifest-range.headers -o /tmp/origin-manifest-range.bin \
  -w 'origin_manifest_range status=%{http_code} bytes=%{size_download} time=%{time_total}\n' \
  "$ORIGIN/assets/packs/manifest.json"
awk 'BEGIN{IGNORECASE=1} /^(HTTP\/|cache-control:|expires:|vary:|set-cookie:|etag:|last-modified:|content-length:|content-range:|content-type:|accept-ranges:|age:)/{print}' /tmp/origin-manifest-range.headers

printf '%s\n' '=== MANIFEST STRUCTURE / STARTUP PACKS ==='
python3 - <<'PY'
import json
p='/tmp/origin-manifest.json'
d=json.load(open(p,'rb'))
groups=d.get('groups',[])
all_packs=[]
startup=[]
for g in groups:
    packs=g.get('packs') or []
    for x in packs:
        all_packs.append((g.get('name'),g.get('load'),x))
        if g.get('load')=='startup': startup.append((g.get('name'),x))
print('groups=',len(groups))
print('all_packs=',len(all_packs),'all_bytes=',sum(int(x.get('bytes') or 0) for _,_,x in all_packs))
print('startup_groups=',sum(1 for g in groups if g.get('load')=='startup'))
print('startup_packs=',len(startup),'startup_bytes=',sum(int(x.get('bytes') or 0) for _,x in startup))
for i,(g,x) in enumerate(startup[:20],1):
    print(f'startup_{i:02d} group={g} bytes={x.get("bytes",0)} path={x.get("path")}')
with open('/tmp/startup-pack-paths.txt','w') as f:
    for g,x in startup:
        if x.get('path'): f.write(x['path']+'\n')
PY

printf '%s\n' '=== LIVE MANIFEST TWO PASSES ==='
for n in 1 2; do
  curl -k -fsS --connect-timeout 15 --max-time 120 -H 'Accept-Encoding: identity' \
    -D "/tmp/live-manifest-$n.headers" -o /dev/null \
    -w "live_manifest pass=$n status=%{http_code} bytes=%{size_download} time=%{time_total}\n" \
    "$LIVE/assets/packs/manifest.json"
  awk 'BEGIN{IGNORECASE=1} /^(HTTP\/|x-hieusro-asset-cache:|x-hieusro-asset-source:|cache-control:|etag:|last-modified:|content-length:|age:|vary:)/{print}' "/tmp/live-manifest-$n.headers"
done

printf '%s\n' '=== LIVE RANGE SAMPLE TWO PASSES ==='
head -n 5 /tmp/startup-pack-paths.txt | while IFS= read -r p; do
  test -n "$p" || continue
  echo "PACK=$p"
  for n in 1 2; do
    curl -k -fsS --connect-timeout 15 --max-time 120 -H 'Accept-Encoding: identity' -H 'Range: bytes=0-11' \
      -D "/tmp/live-range-$n.headers" -o /dev/null \
      -w "range pass=$n status=%{http_code} bytes=%{size_download} time=%{time_total}\n" \
      "$LIVE$p"
    awk 'BEGIN{IGNORECASE=1} /^(HTTP\/|x-hieusro-asset-cache:|x-hieusro-asset-source:|cache-control:|etag:|last-modified:|content-length:|content-range:|age:|vary:)/{print}' "/tmp/live-range-$n.headers"
  done
done

printf '%s\n' '=== CACHE FILE CONTAINING MANIFEST URL (IF ANY) ==='
docker exec "$GAME" sh -lc "grep -aRl --include='*' 'https://opensro.online/assets/packs/manifest.json' /var/cache/hieusro-assets 2>/dev/null | head -n 10 || true"

echo DIAG_MANIFEST_CACHE_DONE=1
