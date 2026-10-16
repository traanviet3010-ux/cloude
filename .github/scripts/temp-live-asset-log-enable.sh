#!/usr/bin/env bash
set -euo pipefail

DEPLOY=/opt/hieusro/src/deploy/digitalocean
cd "$DEPLOY"
DC=(docker compose --env-file .env -f compose.yml)

"${DC[@]}" ps game

"${DC[@]}" exec -T game python3 - <<'PY'
from pathlib import Path

config = Path('/opt/hieusro/runtime-nginx.conf')
backup = Path('/tmp/runtime-nginx.conf.before-temp-asset-log')
text = config.read_text()
begin = '# HIEUSRO TEMP ASSET LOG BEGIN 20261016'
end = '# HIEUSRO TEMP ASSET LOG END 20261016'

if begin in text or end in text:
    if begin in text and end in text and backup.exists():
        print('Temporary asset log block already present with rollback backup.')
        raise SystemExit(0)
    raise SystemExit('Refusing partial/unknown temporary log state')

backup.write_text(text)
block = r'''  # HIEUSRO TEMP ASSET LOG BEGIN 20261016
  map $uri $hieusro_temp_asset_log {
    default 0;
    ~^/assets/ 1;
  }

  log_format hieusro_temp_asset escape=json
    '{"ts":"$time_iso8601","method":"$request_method","uri":"$request_uri","status":$status,"bytes":$body_bytes_sent,"request_time":$request_time,"upstream_response_time":"$upstream_response_time","cache":"$upstream_cache_status","asset_source":"$sent_http_x_hieusro_asset_source","upstream_addr":"$upstream_addr","upstream_status":"$upstream_status","ua":"$http_user_agent"}';
  access_log /tmp/hieusro-asset-temp.log hieusro_temp_asset if=$hieusro_temp_asset_log;
  # HIEUSRO TEMP ASSET LOG END 20261016
'''
needle = 'http {\n'
if needle not in text:
    raise SystemExit('nginx http block not found')
config.write_text(text.replace(needle, needle + block, 1))
PY

echo '=== LOGGING-ONLY CONFIG DIFF ==='
"${DC[@]}" exec -T game sh -lc 'diff -u /tmp/runtime-nginx.conf.before-temp-asset-log /opt/hieusro/runtime-nginx.conf || true'

"${DC[@]}" exec -T game nginx -t -c /opt/hieusro/runtime-nginx.conf
"${DC[@]}" exec -T game nginx -c /opt/hieusro/runtime-nginx.conf -s reload
sleep 1

# Sanity request: prove the new access log is writing. It is removed from the
# capture immediately afterwards so the phone test starts from an empty log.
curl -k -fsS -o /dev/null --max-time 30 \
  'https://play.143-198-217-75.sslip.io/assets/packs/manifest.json'
sleep 1

"${DC[@]}" exec -T game sh -lc 'test -s /tmp/hieusro-asset-temp.log; tail -n 2 /tmp/hieusro-asset-temp.log'
"${DC[@]}" exec -T game sh -lc ': > /tmp/hieusro-asset-temp.log; date -u +%FT%TZ > /tmp/hieusro-asset-temp.start; printf "capture_start="; cat /tmp/hieusro-asset-temp.start'

# Confirm routing still answers from the same LIVE endpoints after graceful reload.
curl -k -fsS -o /dev/null --max-time 20 'https://play.143-198-217-75.sslip.io/'
curl -k -fsS -H 'X-OpenSRO-Protocol: 6' -o /tmp/hieusro-catalog-after-log.json --max-time 20 \
  'https://play.143-198-217-75.sslip.io/api/title/servers'
grep -q 'global-official' /tmp/hieusro-catalog-after-log.json

echo TEMP_ASSET_LOG_READY=1
