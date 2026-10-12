# OpenSRO Mobile Test Edge

Temporary deployment wrapper for testing the OpenSRO browser client from `opensro-dev/opensro` against the public OpenSRO runtime endpoints.

## What this does

- Builds the OpenSRO browser client from a pinned upstream commit.
- Serves the built client from this service.
- Proxies `/assets/*` to `https://opensro.online` so the browser can use the published runtime asset packs.
- Proxies `/api/*` and `/shards/*` (including WebSocket upgrade) to the public OpenSRO edge for a same-origin test session.

This is a test/development wrapper, not an independent OpenSRO game server. A self-hosted server still requires its own licensed v1.150-derived server game data.

## Deploy

Render Blueprint is provided in `render.yaml`. The service uses the included Dockerfile.

## Licensing

OpenSRO source is AGPL-3.0-or-later. This wrapper does not vendor the upstream source or retail Silkroad media; it builds from the pinned public OpenSRO source and proxies published runtime endpoints for testing. Review OpenSRO's `LICENSE` and `NOTICE.md` before any production deployment.
