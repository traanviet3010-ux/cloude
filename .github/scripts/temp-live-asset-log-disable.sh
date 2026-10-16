#!/usr/bin/env bash
set -euo pipefail

DEPLOY=/opt/hieusro/src/deploy/digitalocean
cd "$DEPLOY"
DC=(docker compose --env-file .env -f compose.yml)
GAME="$(${DC[@]} ps -q game)"
test -n "$GAME"

# Restore the exact nginx config captured before the temporary logging block.
${DC[@]} exec -T game sh -lc '
  set -e
  test -f /tmp/runtime-nginx.conf.before-temp-asset-log
  cp /tmp/runtime-nginx.conf.before-temp-asset-log /opt/hieusro/runtime-nginx.conf
  nginx -t -c /opt/hieusro/runtime-nginx.conf
  nginx -c /opt/hieusro/runtime-nginx.conf -s reload
' </dev/null
sleep 1

# Verify the temporary marker is gone and LIVE endpoints still respond.
if ${DC[@]} exec -T game sh -lc "grep -q 'HIEUSRO TEMP ASSET LOG BEGIN 20261016' /opt/hieusro/runtime-nginx.conf" </dev/null; then
  echo 'TEMP_LOG_MARKER_STILL_PRESENT=1' >&2
  exit 1
fi

curl -k -fsS -o /dev/null --max-time 20 'https://play.143-198-217-75.sslip.io/'
curl -k -fsS -H 'X-OpenSRO-Protocol: 6' -o /tmp/hieusro-catalog-after-temp-log.json --max-time 20 \
  'https://play.143-198-217-75.sslip.io/api/title/servers'
grep -q 'global-official' /tmp/hieusro-catalog-after-temp-log.json

# Remove only temporary measurement files after the original config is active.
${DC[@]} exec -T game sh -lc 'rm -f /tmp/hieusro-asset-temp.log /tmp/hieusro-asset-temp.start /tmp/runtime-nginx.conf.before-temp-asset-log' </dev/null

echo TEMP_ASSET_LOG_DISABLED=1
