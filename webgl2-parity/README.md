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
