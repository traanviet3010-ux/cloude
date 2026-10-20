# HieuSRO WebGL2 Client (Babylon.js)

An independent **real WebGL2 implementation**, not a WebGPU toggle. Branch: `hieusro-babylon-webgl2-client-20261020`.

## What works in this phase
- Babylon.js WebGL2 engine, orbit camera, touch/pointer controls, bounded devicePixelRatio on iOS, pagehide disposal.
- Real native iSRO v1.150 terrain height-field chunks (17x17 per 320-unit block) read from the existing checksum-verified SROPACK2 asset mirror. No SRWeb-owned models/texture/shaders copied.
- Discover `/assets/world/world-region-catalog.json`, choose authentic outdoor region, render nearest terrain cells and release distant meshes.
- Read SROPACK2 manifest and byte ranges (HTTP 206), validate member SHA-256, decode gzip, no 2 GB whole-pack downloads.
- Read native iSRO NTX terrain tiles (BGRA/BC1/BC2/BC3), decode selected mip and upload Babylon RawTexture; release textures on map change, with simple dominant-tile fallback (not full native multi-pass associations).
- Tested with Playwright Chromium WebGL2 against Render: 36 genuine terrain cells rendered, at least one native Silkroad tile material uploaded to GPU; temporary API 502 from upstream TEST remains possible.
- Same-origin Render proxy to independent HieuSRO TEST backend for real server list, login, character roster and GameWorld WS upgrade. Cookies and tokens remain origin-scoped; password wiped from form after request.
- Render service is separate; LIVE, previous Icons Preview and databases are not modified.

## Known, explicit limitations
- This phase is a **terrain viewer + login/roster integration**, not yet a fully playable MMO. Movement controls move camera, **not** an authoritative player. Do not claim combat, skills, inventory, auto-train, NPC, quest, character animation, PvP or GM UI have been ported.
- Complete native terrain multi-pass association blending, scenery meshes/materials, animated GLB instances, sky/water and skill effects are pending. Genuine native tile textures render in a first-pass dominant-texture mode; unsupported tiles fall back to checker.
- The upstream TEST backend is on Render Free and can cold-start; accounts are separate from LIVE and may not be persistent.
- Requires Safari supporting WebGL2. Actual iPhone memory stability must be measured on device.

## Running
`npm install && npm run dev` for local; `npm run build && npm start` for production. Proxy: `/api/`, `/shards/` -> HieuSRO isolated TEST; `/assets/packs/` -> checksum-verified HieuSRO CDN.

## Acceptance gates before advancing
1. Build with TypeScript strictness, HTTP health, JS bundle, manifest/counts, 206 headers, map catalog and UI.
2. Verify auth/roster with a throwaway TEST account; do not log credentials or tokens.
3. Render one genuine terrain region in Safari; verify no reload on 20-minute camera traversal.
4. Convert legal/authorized original Silkroad meshes/materials/animations and add world scene instancing with explicit GPU cleanup.
5. Port server-authoritative player simulation inputs, WebSocket scene/events, combat, skills and other gameplay with parity testing against Icons Preview.
6. Only then consider replacing any existing web game; LIVE must stay untouched.
