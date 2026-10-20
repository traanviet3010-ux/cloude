# HieuSRO Icons Preview — SRWeb-informed Safari staging

## Status
STAGED ONLY. This branch has not been deployed onto the current Icons Preview TEST service.
Source target: `hieusro-auto-skill-icons-20261019` (separate Render all-in-one client + Agent + GameWorld + GM).
Source of architectural insights: provided SRWeb HAR; SRWeb uses Babylon.js/WebGL-first and per-cell/terrain data requests. This patch **does NOT port Babylon.js/WebGL**, reimplement SRWeb, or use its proprietary models/shaders. The renderer remains the pinned OpenSRO WebGPU engine. Fully converting the renderer requires a separate funded workstream and end-to-end game feature parity testing.

## Changes built and verified in the staging branch
- Route only `/assets/packs/*` through the verified 213-pack Render CDN; leave `/api`, `/shards`, `/gm`, localization and native skill icon paths unchanged.
- Strip cookies and Authorization/Origin/Referer on outbound pack CDN reads; force identity so Content-Range bytes stay correct.
- Serve original OpenSRO UI images locally from 5 verified, hashed SROPACK2 packs (3 groups, ~4177 UI assets), preserving original case-sensitive filenames and SHA-256.
- On iOS only, cap physical viewport DPR at 1.5 without changing CSS/layout hit targets.
- Keep a 24 MiB Range-block LRU (rather than NO cache) to reduce repeat downloads, with no oversized block pinned. Cap pack read parallelism to 2, keep the main/worker request protocol capacity at 4.
- Spread world GPU staging uploads at 2 MiB per frame on iOS. Desktop uses the original sizes and frame behavior.

## Test evidence
- GitHub Actions `Validate Icons Preview SRWeb-inspired mobile staging`: passed. OpenSRO exact commit pinned and HieuSRO Auto Train patch applied first; 5 new mobile invariants passed, Vite production client build succeeded, five UI packs passed integrity verification, 4177 UI files extracted.
- This is NOT a real-device Safari/WebGPU, account, GameWorld or GM regression test. Do not report full game parity or runtime stability until those acceptance gates are actually executed.

## Deployment guard (important)
Icons Preview is a Render **Free** all-in-one service. Its container stores accounts and shard authority data at `/opt/hieusro/server/.state/` (`accounts.db`, shard states, etc.). There is no verified persistent disk/backup in the connected Render service metadata. **Redeploying or replacing its image can discard this state.**
Do not merge this branch into `hieusro-auto-skill-icons-20261019`, change Render's source branch, or trigger a deployment until an independent state backup and restore drill succeeds or the operator explicitly accepts resetting all Icons Preview TEST state.
Any change to a LIVE server, LIVE shard, LIVE characters, or production database is prohibited.

## Acceptance gates before and after Icons Preview promotion
1. Confirm isolated, restorable backup of all `.state` accounts and shard authority; separately snapshot current Render service/image/commit.
2. Verify new static UI: `logo-big.png`, `nowloading.png`, localized login and skill-picker icons all HTTP 200 with correct MIME.
3. Verify full manifest hash equals source, 213 pack paths, HTTP 206 for first and middle Range, correct Content-Range and Cache-Control.
4. Verify title/server list, account registration/sign-in, roster/character creation/select, enter-world, walking, monster combat, skills, auto-train, drops, map change, and logout/relogin with **throwaway test account only**.
5. Verify layout, button hit boxes, landscape/orientation, GM read-only views, and HTTP/WebSocket pathways.
6. On actual iPhone Safari: test 5 consecutive cold loads, 20 minutes play, map transition, background/foreground, temperature/reload, memory/device-lost logs; compare to previous Preview baseline.
7. Revert to pinned preview commit if any critical feature fails; restore backed-up state when required.

## Next development work (not implemented by this PR)
- Build actual WebGL2 renderer or Babylon adapter, port shaders/materials/VAT/particles, and test PC/mobile gameplay parity.
- Implement owner-safe GPU resource disposal and per-scene residency tracking with real device memory pressure diagnostics.
- Move from map-file dependencies to per-cell spatial indexes. Must be generated from the authorized iSRO asset source and verified against server collisions, NPC and pathfinding.
- Benchmark ASTC usage and worker decoding on Safari, and test CDN caching/HTTP3 without assuming Render behaves like SRWeb Cloudflare.
