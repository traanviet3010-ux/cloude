# HieuSRO Asset CDN — Render TEST

This is a separate, inactive CDN candidate for the original OpenSRO v1.150 SROPACK2 pack paths. It does not modify production, game state, or any VPS configuration.

## Git source
Repository: traanviet3010-ux/Free
Branch: hieusro-asset-mirror-20261020

For Render Static Site configure:
- Build: python3 -u ops/asset-mirror/build_render_static.py
- Publish path: render-asset-public
- Auto-deploy: off initially
- Environment: ASSET_MIRROR_MODE=smoke for the first deploy, then full only after a successful smoke test.
- No DB, persistent disk, runtime instance or Docker image needed.

The builder downloads from https://opensro.online/assets/packs/manifest.json, verifies byte counts and SHA-256, then stages the original .bin paths without checking the asset bytes into GitHub.

## Smoke test (default)
The script validates the entire source manifest, downloads only the smallest referenced pack, and publishes mirror-status.json and the sample pack. It deliberately DOES NOT publish manifest.json, because the catalogue would be incomplete.

Read the deployed /mirror-status.json for sample_path. Request the original sample with Range: bytes=0-15. Require HTTP 206 and correct Content-Range and 16-byte payload. HTTP 200 on a Range request does not pass. Test on actual Render edge, not against local Python HTTP server.

## Full mirror
Change ASSET_MIRROR_MODE to full only after the smoke gate and confirming Render can deploy about 2.04GB. The build verifies all manifest-referenced packs before publishing its complete /assets/packs/manifest.json. Rebuilds will download source again unless a separate durable cache is supplied. Verify mirror-status.json confirms phase=full and ready_for_client=true with 213 packs. Then inspect several packs per group over Range and compare manifest+pack SHA-256.

## Important operational gates
- Render Static Site is publicly reachable. Ensure the project may redistribute these game assets.
- Render global CDN can be a suitable asset host, but byte-range 206 behavior and total publish-size limits are NOT assumed: test on the real endpoint.
- Immutable hash-named packs should use long-lived cache headers; manifest short or no-cache.
- Byte-range binary responses must not be content-transformed by HTTP compression.
- Configure CORS for the Mobile Lite TEST origin if browser access is cross-origin.
- Do not change LIVE, DNS, Caddy, game services, VPS SSH or databases. Change only Mobile Lite TEST after full success.
