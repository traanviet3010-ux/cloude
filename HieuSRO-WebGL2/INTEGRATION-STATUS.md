# HieuSRO Babylon WebGL2 — Verified integration inventory (2026-10-20)

Target branch: `hieusro-babylon-webgl2-client-20261020`  
Render TEST: https://hieusro-babylon-webgl2-test.onrender.com/  
Pinned native authority: `opensro-dev/opensro@4f6919d6900d169b89e75647e56c99ca8ebd5cfb`.  
**Never deploy to LIVE or modify previous Icons Preview.** TEST accounts and world data are separate and may be ephemeral.

## What is genuinely implemented

| Subsystem | Status | Files / server integration | Honest boundary |
|---|---|---|---|
| WebGL2 scene, camera, iOS scale | Implemented | `src/world.ts` | Safari device stress test not completed |
| Native Silkroad terrain | Implemented | `src/world.ts`, `src/pack.ts` | Height data is real; incomplete texture blending |
| SROPACK2 asset lookup, 206 range, SHA-256 | Implemented | `src/pack.ts` | No LRU cache or asset bundling beyond existing SROPACK2 |
| NTX tile textures BGRA/BC1/BC2/BC3 | Partial | `src/native-texture.ts`, `src/world.ts` | Dominant tile only, RGBA decompression expands GPU memory |
| Login/server-list API | Implemented | `src/backend.ts`, `src/main.ts` | Requires live isolated TEST backend |
| Real character roster/create APIs | Implemented | `src/characters.ts`, `src/main.ts` | Character visuals not yet rendered |
| WebSocket reverse proxy | Implemented | `server.mjs` under `/shards/` | Gateway support is not a gameplay client |
| GameWorld two-ticket protocol v2 admission | Added, build-tested | `src/gameworld.ts`, `tests/gameworld.test.mjs` | Explicit user-invoked handshake probe; exits on valid bootstrap; not an active MMO session |
| Real-time gameplay snapshots, entities, movement | Not integrated | Needs native OpenSRO world decoder + Babylon transforms | Do not send WorldReady until this exists |
| Authorized native SRO character 3D mesh + skeleton | Not integrated | Build conversion pipeline and Babylon mesh loader | No procedural stand-ins represented as Silkroad originals |
| Character animations (idle/walk/run/attack/skills) | Not integrated | Need native animation conversion, skinned mesh, rig mapping | |
| Character equipment, weapon, avatar mesh | Not integrated | Real roster `visualLoadout` + native item refs/catalog | Do not invent models |
| Monster/NPC appearances and interactions | Not integrated | Native entity snapshots, object refs, AI state, interaction API | Server remains authoritative |
| Combat and skills/buffs | Not integrated | OpenSRO native packet protocol, skill refs and animation events | No client damage/EXP/drop authority |
| Inventory, equipment slots, shop/F10, quest | Not integrated | Server world bootstrap/events & UI protocols | |
| Auto Train | Existing in older client/server components, NOT ported | `server-build/hieusro-auto-train.ts` (not Babylon import) | Never claim this feature is working in WebGL2 |
| Other player avatars, parties, guilds, chat | Not integrated | Live world entity stream and UI components | |
| Audio, particles, effects | Not integrated | Native sound/effect extraction and playback lifecycle | |
| Ping, reconnect, session resume | Not integrated into Babylon gameplay | Follow pinned native transport owner | Probe is deliberately one-shot |
| GPU memory budget, device-loss recovery | Partial | `src/world.ts` | Tile-count cap is not a true byte-budget LRU |

## Native WebSocket protocol, no fake game state

Reference: `apps/client-next/src/engine/runtime/simulation/worker/network/codec/codec.ts`,
`.../session/http/http.ts`, `.../session/world/world.ts` from pinned OpenSRO.

1. User logs in with isolated title API: `POST /api/title/login`.
2. Roster: `GET /api/character/list` with session bearer.
3. Transport admission: `POST /api/auth/transport-token`.
4. WebSocket: `wss://<babylon-test-origin>/shards/<server-id>/transport/ws`.
5. Binary `HELLO` opcode 1, validate `WELCOME` opcode 2.
6. Per-character ticket: `POST /api/auth/enterworld-token`.
7. Binary `ENTER_WORLD` opcode 6, validate result opcode 7 and bootstrap v1/v2.
8. **Probe ends here.** Never send `WorldReady` (0x3012) until world references, native entity snapshots, renderer and reliable authoritative movement have been ported.

A TEST player must explicitly click the admission action. Authentication secrets/tickets are kept in local variables and are not printed or persisted.

## Development order — no shortcuts

- P0: Verify Render deploy of latest commit; test title, roster, and GameWorld admission with a throwaway TEST account. Record only anonymized operation status; never log token or password.
- P1: Parse native world v2 bootstrap, fetch `/transport/references/<sha>.json`, validate sizes and hashes; read native spawn, region, actors and equipment.
- P2: Convert authorized native Silkroad mesh / skeleton / animation to Babylon-compatible geometry (or GLB where legal); equip actual character slots from server loadout.
- P3: Maintain persistent socket & receipt-bound authoritative movement; use server state to move one rendered character. Test disconnect/reconnect before combat.
- P4: Spawn authentic NPCs/monsters/players, native combat and skill events, inventory and item actions.
- P5: Auto Train, quest, F10, social, effects/audio; then comprehensive iPhone Safari GPU memory, thermal and reload stress tests.

## Acceptance checks

`npm run build`, `npm run test`, GitHub Actions `hieusro-webgl2-build.yml`.
Existing public Render smoke workflow already verifies Babylon terrain and genuine textures; the admission probe needs a separate authenticated, **manual TEST** smoke with disposable credentials. Successful static CI or TCP WebSocket upgrade must never be labelled 'playable MMORPG' or 'server-authoritative gameplay working'.
