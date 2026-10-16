#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: patch-mobile-dockerfile.py <Dockerfile.allinone>")

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")

world_build = 'RUN NODE_OPTIONS="--max-old-space-size=3072" corepack pnpm assets build world-outdoor'
build_anchor = "RUN corepack pnpm assets doctor\n" + world_build
build_replacement = f"""RUN corepack pnpm assets doctor

# HieuSRO mobile test: build the browser client from the exact same pinned
# OpenSRO commit as the server, after lowering iOS asset concurrency. Desktop
# keeps upstream capacity while iPhone/iPad use two foreground transactions.
COPY patch-mobile-client.py /tmp/patch-mobile-client.py
RUN python /tmp/patch-mobile-client.py /src/opensro \\
 && corepack pnpm --filter @sro/client-next build

{world_build}"""
if build_anchor not in text:
    raise SystemExit("mobile client build anchor changed")
text = text.replace(build_anchor, build_replacement, 1)

start_marker = "# Snapshot the already-verified client build once into this paid image."
end_marker = "    grep -q 'bootstrap-BE_ylLXC.js' /opt/hieusro/client-edge/public/index.html\n"
start = text.find(start_marker)
if start < 0:
    raise SystemExit("legacy client snapshot block start not found")
end_at = text.find(end_marker, start)
if end_at < 0:
    raise SystemExit("legacy client snapshot block end not found")
end = end_at + len(end_marker)

replacement = """# Serve a client compiled from the same pinned OpenSRO source as this server.
# This removes the older frozen Render snapshot and keeps the asset worker,
# server protocol and release checks on one commit for the mobile test.
COPY prepare-hieusro-client.py /tmp/prepare-hieusro-client.py
COPY --from=builder /src/opensro/apps/client-next/temp/artifacts/dist /opt/hieusro/client-edge/public
RUN set -eux; \\
    cp /opt/hieusro/client-edge/hieusro-language.js /opt/hieusro/client-edge/public/hieusro-language.js; \\
    cp /opt/hieusro/client-edge/hieusro-mobile-runtime.js /opt/hieusro/client-edge/public/hieusro-mobile-runtime.js; \\
    python /tmp/prepare-hieusro-client.py /opt/hieusro/client-edge/public/index.html; \\
    test -s /opt/hieusro/client-edge/public/index.html; \\
    test -s /opt/hieusro/client-edge/public/viewer.html; \\
    grep -q 'hieusro-mobile-runtime.js' /opt/hieusro/client-edge/public/index.html; \\
    grep -q 'hieusro-language.js' /opt/hieusro/client-edge/public/index.html
"""
text = text[:start] + replacement + text[end:]

# Install the asset prewarmer into the runtime image and create the Nginx cache
# directory with the same ownership the Debian nginx workers use. The named
# Docker volume inherits these permissions on first mount.
asset_anchor = "COPY allinone-start.sh /opt/hieusro/allinone-start.sh\n"
asset_replacement = asset_anchor + """COPY prewarm-assets.py /opt/hieusro/prewarm-assets.py
RUN mkdir -p /var/cache/hieusro-assets \\
 && chown -R www-data:www-data /var/cache/hieusro-assets \\
 && chmod +x /opt/hieusro/prewarm-assets.py
"""
if asset_anchor not in text:
    raise SystemExit("asset mirror runtime anchor changed")
text = text.replace(asset_anchor, asset_replacement, 1)

path.write_text(text, encoding="utf-8")
print("Patched Dockerfile: pinned mobile client + persistent asset mirror prewarmer")
