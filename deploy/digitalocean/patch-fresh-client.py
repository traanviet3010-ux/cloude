#!/usr/bin/env python3
from pathlib import Path
import sys

path = Path(sys.argv[1])
s = path.read_text(encoding='utf-8')

build_anchor = 'FROM python:3.12-slim-bookworm AS runtime\n'
if 'HIEUSRO_FRESH_PURE_CLIENT_BUILD' not in s:
    if build_anchor not in s:
        raise SystemExit('runtime stage anchor not found')
    s = s.replace(
        build_anchor,
        'RUN corepack pnpm --filter @sro/client-next build # HIEUSRO_FRESH_PURE_CLIENT_BUILD\n\n' + build_anchor,
        1,
    )

start = '# Snapshot the already-verified client build once into this paid image.'
end = '# Run the standalone GM web safely under /gm/ on the shared public hostname.'
if start in s:
    a = s.index(start)
    b = s.index(end, a)
    replacement = '''# Fresh server isolation: serve the client built directly from the exact\n# OPEN_SRO_COMMIT above. Never reuse the legacy Render/static client snapshot.\nCOPY --from=builder /src/opensro/apps/client-next/temp/artifacts/dist /opt/hieusro/client-edge/public\nRUN test -s /opt/hieusro/client-edge/public/index.html \\\n && test -s /opt/hieusro/client-edge/public/viewer.html \\\n && find /opt/hieusro/client-edge/public/assets -maxdepth 1 -type f -name '*.js' -print -quit | grep -q .\n\n'''
    s = s[:a] + replacement + s[b:]
elif 'Never reuse the legacy Render/static client snapshot.' not in s:
    raise SystemExit('legacy client snapshot block not found')

if 'CLIENT_SNAPSHOT_ORIGIN=https://hieusro-private-client-test.onrender.com' in s:
    s = s.replace('ARG CLIENT_SNAPSHOT_ORIGIN=https://hieusro-private-client-test.onrender.com\n', '')

path.write_text(s, encoding='utf-8')
print('fresh pinned client Dockerfile patch applied')
