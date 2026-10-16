#!/usr/bin/env python3
import json
import sys
from collections import Counter
from datetime import datetime

path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/hieusro-asset-temp.log'
rows = []
bad_json = 0
with open(path, 'r', encoding='utf-8', errors='replace') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            bad_json += 1
            continue
        try:
            r['_rt'] = float(r.get('request_time') or 0)
        except Exception:
            r['_rt'] = 0.0
        urt = r.get('upstream_response_time')
        try:
            r['_urt'] = float(urt) if urt not in (None, '', '-') else 0.0
        except Exception:
            r['_urt'] = 0.0
        try:
            r['_bytes'] = int(r.get('bytes') or 0)
        except Exception:
            r['_bytes'] = 0
        rows.append(r)

all_rows = rows
iphone_rows = [r for r in rows if 'iPhone' in (r.get('ua') or '') or 'iPad' in (r.get('ua') or '')]
rows = iphone_rows if iphone_rows else rows
scope = 'ios-only' if iphone_rows else 'all-traffic-fallback'

print(f'CAPTURE_SCOPE={scope}')
print(f'RAW_REQUESTS={len(all_rows)}')
print(f'SELECTED_REQUESTS={len(rows)}')
print(f'BAD_JSON_LINES={bad_json}')

if not rows:
    print('NO_REQUESTS=1')
    raise SystemExit(0)

def pct(a, b):
    return (100.0 * a / b) if b else 0.0

def origin_contact(r):
    addr = (r.get('upstream_addr') or '')
    # A non-local upstream with a measured upstream response time means this request
    # actually waited on the external origin rather than being served from proxy cache.
    return r.get('_urt', 0) > 0 and addr not in ('', '-') and not addr.startswith('127.0.0.1:')

def node_edge(r):
    return (r.get('upstream_addr') or '').startswith('127.0.0.1:8795')

n = len(rows)
total_bytes = sum(r['_bytes'] for r in rows)
total_rt = sum(r['_rt'] for r in rows)
origin = [r for r in rows if origin_contact(r)]
node = [r for r in rows if node_edge(r)]
origin_bytes = sum(r['_bytes'] for r in origin)
origin_rt = sum(r['_rt'] for r in origin)
origin_urt = sum(r['_urt'] for r in origin)

print(f'TOTAL_REQUESTS={n}')
print(f'TOTAL_BYTES={total_bytes}')
print(f'TOTAL_MB_DECIMAL={total_bytes/1_000_000:.3f}')
print(f'TOTAL_MIB={total_bytes/1048576:.3f}')
print(f'SUM_REQUEST_TIME_S={total_rt:.3f}')
print(f'ORIGIN_REQUESTS={len(origin)}')
print(f'ORIGIN_REQUEST_PCT={pct(len(origin), n):.2f}')
print(f'ORIGIN_BYTES={origin_bytes}')
print(f'ORIGIN_MB_DECIMAL={origin_bytes/1_000_000:.3f}')
print(f'ORIGIN_BYTE_PCT={pct(origin_bytes, total_bytes):.2f}')
print(f'ORIGIN_SUM_REQUEST_TIME_S={origin_rt:.3f}')
print(f'ORIGIN_SUM_UPSTREAM_TIME_S={origin_urt:.3f}')
print(f'ORIGIN_REQUEST_TIME_PCT={pct(origin_rt, total_rt):.2f}')
print(f'NODE_EDGE_REQUESTS={len(node)}')
print(f'NODE_EDGE_SUM_REQUEST_TIME_S={sum(r["_rt"] for r in node):.3f}')

# Capture wall-clock span from nginx ISO timestamps.
times = []
for r in rows:
    try:
        times.append(datetime.fromisoformat((r.get('ts') or '').replace('Z', '+00:00')))
    except Exception:
        pass
if times:
    span = (max(times) - min(times)).total_seconds()
    print(f'FIRST_TS={min(times).isoformat()}')
    print(f'LAST_TS={max(times).isoformat()}')
    print(f'WALL_SPAN_S={span:.3f}')

for label, key in [('STATUS', 'status'), ('CACHE', 'cache'), ('SOURCE', 'asset_source'), ('UPSTREAM_ADDR', 'upstream_addr')]:
    c = Counter(str(r.get(key) if r.get(key) not in (None, '') else '-') for r in rows)
    print(label + '_COUNTS=' + json.dumps(c, ensure_ascii=False, sort_keys=True))

ua = Counter((r.get('ua') or '-') for r in all_rows)
print('UA_COUNTS=' + json.dumps(ua, ensure_ascii=False))

errors = [r for r in rows if int(r.get('status') or 0) not in (200, 206, 304)]
print(f'ERROR_OR_ABORT_REQUESTS={len(errors)}')
for i, r in enumerate(sorted(errors, key=lambda x: x['_rt'], reverse=True)[:50], 1):
    print('ERROR%02d status=%s bytes=%d rt=%.3f urt=%.3f cache=%s source=%s upstream=%s uri=%s' % (
        i, r.get('status'), r['_bytes'], r['_rt'], r['_urt'], r.get('cache') or '-',
        r.get('asset_source') or '-', r.get('upstream_addr') or '-', r.get('uri') or '-'))

print('TOP20_SLOWEST_BEGIN')
for i, r in enumerate(sorted(rows, key=lambda x: x['_rt'], reverse=True)[:20], 1):
    print('SLOW%02d status=%s bytes=%d rt=%.3f urt=%.3f cache=%s source=%s upstream=%s uri=%s' % (
        i, r.get('status'), r['_bytes'], r['_rt'], r['_urt'], r.get('cache') or '-',
        r.get('asset_source') or '-', r.get('upstream_addr') or '-', r.get('uri') or '-'))
print('TOP20_SLOWEST_END')

print('TOP20_LARGEST_BEGIN')
for i, r in enumerate(sorted(rows, key=lambda x: x['_bytes'], reverse=True)[:20], 1):
    print('LARGE%02d status=%s bytes=%d rt=%.3f urt=%.3f cache=%s source=%s upstream=%s uri=%s' % (
        i, r.get('status'), r['_bytes'], r['_rt'], r['_urt'], r.get('cache') or '-',
        r.get('asset_source') or '-', r.get('upstream_addr') or '-', r.get('uri') or '-'))
print('TOP20_LARGEST_END')
