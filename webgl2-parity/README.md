# HieuSRO original GPU → WebGL2 (strict parity, NOT RELEASED)

## User requirement
Use exactly the original HieuSRO GPU game experience: authentic retail Silkroad v1.150 title / CIF interface, player/monster models, assets, gameplay, inventory, skill trees, F10, Auto Train and GameWorld. This is **not** a new Babylon/HTML game. **No LIVE or prior Icons Preview service may be changed.**

## Source of truth
- Repository: `traanviet3010-ux/cloude`
- Baseline: `hieusro-auto-skill-icons-20261019` (do not overwrite).
- Isolated port branch: `hieusro-original-webgl2-parity`.
- Native OpenSRO engine commit: `4f6919d6900d169b89e75647e56c99ca8ebd5cfb`.
- Original 21K-line retail UI controller: `apps/client-next/src/engine/runtime/ui/ui.ts`.
- Original gameplay: `apps/client-next/src/engine/runtime/simulation/worker/`; DO NOT fork/reimplement this state machine.
- Original render interface: `apps/client-next/src/engine/contracts/runtime.ts` (`Renderer` interface).
- Native asset system: original SROPACK2, native mesh/material/animation/texture, original character resource tree.

## Implemented / verified building blocks — NOT yet connected to a full game loop

- `src/native-ui-commands.ts`: original OpenSRO `UiScene` to GL draw commands, supports glyph runs, clipping, tints, alpha test, UV transform; explicitly rejects not-yet-ported world labels/masks/portraits.
- `src/native-ui-webgl2.ts`: actual WebGL2 native UI shader, texture residency, LRU and GPU lifecycle; reads original `ImageBitmap`/`ImageData`/`NativeTexture` from OpenSRO.
- `src/native-texture.ts`: decode native BGRA8/BC1/BC2/BC3 fallback if S3TC isn't supported by iPhone Safari.
- `src/native-geometry.ts`: validates/authors original `Geometry` buffers as GL arrays; rejects unported materials, skins, draw instancing or dynamic streams rather than silently drawing fake substitutes.
- `src/clip-space.ts`: maps canonical OpenSRO WebGPU 0..1 clip depth to WebGL2 -1..1 while preserving camera perspective.
- `src/native-world-webgl2.ts`: renders the subset of original unlit static Geometry with bounded GPU memory and original camera, no fake terrain.
- `src/original-webgl2-compositor.ts`: original geometry + native UI on **one** WebGL2 canvas context. Now exposes callbacks compatible with the authentic `createFrontend()` / `createUi()` contracts: `adoptWorld`, `setWorldCamera`, `setWorldTexture`, `neededWorldTextures`, `worldStats`, `setUi`, `setUiTexture` and bounded `originalFrontendFrame()`.
- `src/original-ui-runtime-bridge.ts`: original `Renderer.setUi/setUiTexture` publication path, with no new HTML controls or synthetic character slots.
- `src/original-frontend-stage.ts`: consumes the real one-shot OpenSRO `WorldSceneLease`, carries the exact original group IDs/materials/UVs and defers scene publication until genuine required textures finish loading. Safe cancel/replacement with no premature `ready`.
- `src/original-world-textures.ts`: native Silkroad UV texture upload using BGRA/BC1/BC2/BC3 and S3TC/Safari fallback under memory budgets.
- `tests/original-frontend-flow.integration.mjs`: replays the actual pinned original frontend state machine, never a new login controller.
- `tests/original-frontend-stage.test.mjs`: lease identity, byte-budget, partial-load cancellation, real image dependency and no-fake-world-ready tests.
- `tests/native-compose-pixels.mjs`: Chromium WebGL2 pixel readback of original WorldSceneLease shape + native BGRA WorldTexture + original camera projection + original native UI compositor. This is a renderer integration test, not a live game login.
- Pure Node unit tests and Chromium software-WebGL2 pixel tests check scissor/tint/BCn/triangles/context composition. The strict TypeScript CI checks these against the exact original OpenSRO contracts after cloning the pinned engine.
- No deployment from this branch. No accounts, DB, shaders or UI on LIVE modified.

**Supported subset is still not an actual populated Constantinople scene, animated character dock or GameWorld login; advanced lit/animated textures, terrain, masks, skeletal actors and gameplay renderer paths remain blocked.** Never describe as a working login, native character viewer or playable MMORPG. The previous independent Babylon WebGL2 experiment is not the port source of truth.

## Remaining production-blocking work

All of the following MUST be fully ported and parity-tested with the old GPU branch:
1. Original retail title/background/animated 3D camera, character dock and portrait/doll targets.
2. Multi-stage texture/mask/font atlas/hit testing, item mall F10, inv/skill windows, all original HUD layers without pixel/layout differences.
3. Original terrain association layers and map mesh/texture LOD, BSR buildings, objects, water, day-night, fog, shadows and visual shaders.
4. Character model skinning (CPU fallback for WebGL2 compute limitation), mounts, pets, costumes/equipment sockets, all authentic animation/effect paths.
5. Native attack targeting, picking, damage presentation, particle VFX, server-driven NPC/monster/skill/loot UI.
6. **Use original** GameWorld WSS, login, character-create, world bootstrap, persistent sessions, simulation worker and auto-train; do not fake state or call a second backend.
7. Mobile Safari hardware tests for memory/thermal/white-screen/reload, WebGL2 context-loss restore, asset LRU, efficient cache and no unnecessary requests.
8. Full screenshot/interaction replay parity versus original GPU, plus protected real TEST server integration tests with a disposable account.
9. Release gate requiring successful evidence for every subsystem in `acceptance.json`.

## CI and release policy

`HieuSRO Original GPU to WebGL2 parity gate` compiles source using pinned original TypeScript and verifies original session/HUD were not modified. `HieuSRO Original WebGL2 pixel shader smoke` runs real Chromium GL pixel readbacks of original `UiScene` and a 3D mesh composite, not screenshot mockups.

Before deployment, `node webgl2-parity/scripts/release-gate.mjs` must pass. It currently **fails intentionally** because the port is unfinished. Do not switch Render/VPS branches to this code until all blockers are verified. No autonomous or background work is implied by this file.


## 2026-10-21 — native character pipeline progress (not yet playable)

- `src/original-character-cpu-skin.ts`: **reuses** OpenSRO's pinned `createCharacterPose` evaluator, original `CharacterPrimitive.inverseBind` and exactly four native weights/vertex; interpolates unaltered native clips/BAN-mapped channels on CPU for Safari WebGL2. No new game state or fabricated clip assets.
- `src/original-characters-webgl2.ts`: consumes original `CharacterModel` + actual `WorldTexture[]` + `CharacterActor` snapshots (pose, yaw, region, scale, clip). Renders only supported primitive/mode combinations; throws on cloth/attached/mounted/lit/advanced effect models until their original shaders have WebGL2 counterparts.
- `src/native-world-webgl2.ts`: in-place animated vertex updates via `gl.bufferSubData`, reducing GPU VAO/VBO recreation.
- `src/original-webgl2-compositor.ts`: now exports original renderer-shape `setCharacterModel` / `setCharacterActors` callbacks and includes the actor group stream in the same scene framebuffer and native CIF UI canvas.
- Node integration tests invoke the **real pinned OpenSRO pose** and assert native timeline positions, authored actor region placement, texture identity, cleanup and no repeated buffer creation.
- Chromium actual WebGL2 software rendering checks that a CPU-skinned model contract can draw on top of a real `WorldSceneLease` contract without losing original native UI. This test uses an authored minimal schema fixture, **not a real Silkroad client .bms/.bsk mesh**.
- Verified GitHub CI: <https://github.com/traanviet3010-ux/cloude/actions/runs/39545047173> (GL pixel smoke) and <https://github.com/traanviet3010-ux/cloude/actions/runs/39545047121> (pinned original-contract and CPU animation tests).

### Still blocking actual retail character-screen parity

Original animated/complex meshes can contain lit/shadow/multistage materials, cloth, instanced attachments, riding mounts and FX. Those currently fail closed rather than rendering approximate replacements; the original character dock's runtime adapter is not yet a full `Renderer` implementation. The backend login/character/transport GameWorld protocol remains in the untouched native engine but is **not yet playable with this new renderer**. iPhone Safari device-memory/context-loss testing is also outstanding. Do not change Render TEST/LIVE services based solely on these contract tests.


## 2026-10-21 — source-parity lighting and live TEST asset inventory

The initial static unlit material-only renderer was extended to consume the pinned original OpenSRO native material policy for plain Lambert/ambient:
- `src/original-lighting.ts` extracts the original `worldEnvironment()` float block (diffuse=8, ambient=12, sun direction=84), defaults to the actual retail diagonal direction, and rejects corrupt values.
- `src/native-world-webgl2.ts` uses the native material's diffuse, ambient, `objectLight` and `unlit` distinctions in GLSL ES 3.00, with separate object-vertex and per-pixel paths. Uninitialized lighting is an explicit error for lit meshes.
- `src/original-frontend-stage.ts` retains the `WorldScene.environment` and admits supported lit scenes with actual normals and authored material colors.
- `src/original-webgl2-compositor.ts` computes the packed environment via the **original** `worldEnvironment()` on every frontend frame, not a fake flat-light profile.
- Plain lit skeletal characters use the same original CPU skinning and material route. Texture stage combiners, shaders with masks/reflection, terrain/lightmaps, waves, particle effects, advanced scene animation and mounted parts are not silently approximated.
- Pixel tests `native-lighting-pixels.mjs` verify original diagonal Lambert + ambient, facing/back-facing normals, a refused missing environment, and NOLIGHT preservation on actual WebGL2 pixels. `native-compose-pixels.mjs` verifies the lit stage and lit skinned character compose on one GL context.
- CI source-contract and browser pixel runs at commit `bed67b2c42c02129a1ec5a867ae730196c551b0e` both passed; later revisions require fresh CI evidence.

Read-only audit `hieusro-original-test-stage-audit.yml` checks actual Constantinople, character-select, and both race creation manifests from **isolated** Render TEST. These results are manifest availability only; they do NOT prove that native 3D bundle geometry or rendering, browser login, or gameplay works. Audit failures are surfaced and never patched with synthetic assets.

**Current release status: BLOCKED.** The new WebGL2 modules are not yet an implementation of every method in the pinned `Renderer` interface, are not wired into the original `startRuntime` game loop, and have not entered an authoritative GameWorld session. Never deploy or share a play URL until the original full frontend, runtime rendering, GameWorld interaction, and iPhone Safari acceptance tests pass.


### 2026-10-21 — loading stability correctness

- The original pinned `device/ui.ts` does **not** replace a missing CIF texture with solid color and does **not** abort the whole UI frame. It skips only the not-yet-resident draw and mask. The WebGL2 port now matches that behavior in `native-ui-webgl2.ts` (visible `missingQuads` statistic).
- Chromium pixel smoke tests confirm a missing retail CIF art source and a missing alpha mask hide ONLY their own quads while another loaded retail UI image keeps rendering. This prevents avoidable blank title frames while original asset loads complete.
- `original-frontend-stage.ts` and `native-world-webgl2.ts` now pin pending scene textures until atomic admission, preventing LRU from evicting earlier title/character images while the next ones load. Cancellation, errors and completed admission release the pin.
- Original GPU TypeScript contract CI and WebGL2 browser pixel runs validated the changes at commits `5dc70f8309d1d970cffd78ab8a24380de51c6d79` and `517e7c9054175a91c6ee9157e6361e5b31791bc5` respectively. This evidence verifies **local render subsystem correctness, not the game**.


## 2026-10-21 — authentic v1.150 asset recovery and original URL bridge

**Source discovery (read-only; no old server mutations):**
- The existing baseline Icons Preview TEST returned timeouts for Constantinople/character dock manifest, and HTTP 404 for EU/CH creation manifests via its upstream `opensro.online` proxy. This is a serving problem, not proof that licensed Silkroad source media is absent.
- The user's configured ISRO v1.150 Drive folder contains authentic `Media.pk2`, `Data.pk2`, `Map.pk2`, `Particles.pk2`, `Music.pk2`. Do not publish or expose these licensed binaries in GitHub.
- **Existing isolated static TEST SROPACK2 CDN** is preferable to rebuilding: v2 catalog holds 17 groups, 213 packs and 36,843 assets. The REAL original four `StageManifest` JSON documents were range-read, gzip-decoded and SHA-256 verified against its immutable catalog:
  - Constantinople: 14 native camera keys; `/assets/world/constantinople/region-694e.json` exists
  - Character dock: 2 native camera keys; `/assets/world/constantinople/region-6951.json` exists
  - EU creation: 1 native camera key; `/assets/world/constantinople/region-694f.json` exists
  - CH creation: 1 native camera key; `/assets/world/china/region-62a8.json` exists.
- `server/native-pack-reader.mjs` reads the verified original member bytes via CDN HTTP/206 Range, checks file lengths and SHA256, handles compression and bounded LRU. No game art is generated.
- `server/native-asset-handler.mjs` serves the original retail `/assets/*` URLs, retaining ETag, HTTP Range, HEAD and MIME semantics while refusing to proxy `/api` or `/shards` requests.
- The read-only GitHub-hosted integration smoke for all FOUR real scene GET routes, real bundle references, response bytes, HTTP Range/ETag and fail-closed missing assets passed. This is an asset HTTP pipeline test and **NOT a playable WebGL2 game, complete world asset admission or GameWorld authorization test**.
- `scripts/rebuild-original-v150-assets-test.sh` is an **optional, not-yet-run** fallback that uses the upstream pinned OpenSRO `pnpm assets prepare; pnpm assets doctor; pnpm assets build full` from a disposable licensed PK2 copy and verifies all four stage outputs. Existing TEST CDN already contains the four stage resources, so rebuilding would be unnecessary unless real-world bundle validation later exposes a missing source.

**Remaining before user-facing game URL:** Mount asset bridge on a separately verified TEST client runtime; implement remaining original `Renderer` interface (including terrain/multistage shaders/sky/particles/portrait, full native character assembly, picking), use untouched `startRuntime` and original WSS GameWorld state machine, then perform real TEST login/character-create/world-entry and iPhone hardware acceptance. `acceptance.json.releaseEligible` remains false. Never switch the old Icons Preview/LIVE routes to this branch.


## 2026-10-21 — authentic client WorldScene (not a synthetic geometry test)

Read-only GitHub Actions used the exact pinned original `createWorldDecoder()`, fetching precompiled binary-safe region JSON from the isolated TEST SROPACK2 CDN. The original CPU decoder successfully produced fully populated `WorldScene` objects for ALL four retail frontend scenes:

| Native scene | Decoded GPU groups | Triangles | Distinct image dependencies | Groups with original instance matrices |
| --- | ---: | ---: | ---: | ---: |
| Intro Constantinople, 0x694e | 1536 | 2,072,067 | 463 | 1536 |
| Character select, 0x6951 | 794 | 687,447 | 249 | 794 |
| EU creation, 0x694f | 961 | 795,632 | 429 | 961 |
| CH creation, 0x62a8 | 967 | 724,372 | 381 | 967 |

Original native material/environment, terrain, sky, water, lightmaps, cloth, navmesh survived the decode. The China region decoder reported two unimplemented waterfall texture-animation warnings which must not be ignored for full visual parity.

**Critical blocker identified on genuine scenes:** Previous GL path had rejected all native `geometry.instances`, which every decoded world group owns. `native-geometry.ts` and `native-world-webgl2.ts` now validate and upload actual column-major placement matrices and render through GLSL ES 3.00 instanced attributes (4..7) with `gl.drawElementsInstanced`; no mesh duplication/recreation. Browser pixel readback confirms both exact original matrix translations and proper triangle counts, and pinned OpenSRO TypeScript CI passed.

**Still not visually supported as a whole scene:** Despite decoder success, the production WebGL2 stage fail-closed audit currently admits 0 of 1536 intro groups. Source shows 916 groups with world visibility/fading, 110 terrain range groups, 638 advanced material/water/sky/lightmap groups (overlap permitted). All 4 scenes currently have 0 full-stage groups admitted. This is expected because current stage guards require original fade/visibility handling, terrain association LOD, water/sky/lightmaps, shader multi-stages and cloth before release. Adding instancing alone does not satisfy these. Thus no public play link or deployment is permitted.

Exact data source: the user's existing TEST SROPACK2 CDN with 213 packs, 36,843 real assets, source SHA-256 verification. No source images/PK2/game art have been committed to GitHub. Original GPU runtime/GameWorld and LIVE are untouched.
