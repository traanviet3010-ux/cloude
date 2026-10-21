# HieuSRO GPU → WebGL2: reconnect the existing game; do not rebuild it

**Decision 2026-10-22:** The old HieuSRO GPU game is the product baseline, not a visual reference. Preserve original artwork, all original GUI, flow, animations, world data, gameplay and servers. Only change the graphics implementation at a bounded interface.

## Confirmed source/build topology

- Existing HieuSRO GPU branch `hieusro-auto-skill-icons-20261019` owns its Render/Docker deployment wrapper and game-specific patches; it does **not** vendor the whole client source.
- Its `server-build/Dockerfile.auto-icons-preview` clones `opensro-dev/opensro`, pins `4f6919d6900d169b89e75647e56c99ca8ebd5cfb`, applies HieuSRO modifications, and calls `pnpm --filter @sro/client-next build`.
- Pinned native client `apps/client-next/src/engine/runtime/runtime.ts` already starts `createAssets`, `createSimulationHost`, `createRenderer`, `createFrontend`, `createUi`, animation, audio, input and presentation owners. It carries the real intro→login→roster→character-create→world session flow.
- The original native renderer is defined in `apps/client-next/src/engine/runtime/renderer/renderer.ts`, with the `Renderer` interface at `apps/client-next/src/engine/contracts/runtime.ts`. Low-level WebGPU is in `runtime/renderer/device/*`, `surface/*`, `frame/*`. The active engine currently uses WebGPU shaders/resources/compute.
- The existing isolated TEST SROPACK2 CDN contains the genuine intro, dock, Europe and China scene manifests and region bundles. This is not missing source art.

## Required direct reconnect approach

1. **Clone the exact old HieuSRO GPU build pipeline into an isolated TEST target**, with the same original source commit and same game-specific patches, WITHOUT overwriting any old deployed service, GAMEWORLD, account or character data.
2. **Keep the entire original `startRuntime` and all its owners.** No new HTML login, no synthetic `UiScene`, no new `WorldScene`, no authored character models/animations. Keep `createFrontend`, `createUi`, `createAssets`, `createSimulationHost`, `createWorldRenderer` and the native world/gameplay/picking math.
3. Introduce a tiny **graphics-backend selection seam** in a TEST copy of the original client. When WebGL2 is selected, substitute a conforming graphics backend while keeping the full existing `Renderer` API and runtime lifecycle. Build the adapter from pinned native contracts and fail closed for unsupported functions; do not declare playable with stub methods.
4. Port **only low-level WebGPU-only work** necessary to provide that original contract: device buffers/textures, render passes/pipeline state, native shader material semantics, UI render, skeletal/particle GPU presentation, readback and surface. WebGPU-specific storage/compute features require an equivalent CPU/GL fallback; a WebGPU `GPUDevice` cannot be passed unchanged to WebGL2.
5. Route the original `/assets/*` requests to the verified SROPACK2 TEST CDN and leave all authoritative Agent/GameWorld/session APIs in the native runtime.
6. Keep the existing `webgl2-parity/src/*` experiments strictly as porting utilities and regression tests; **they are not a replacement game client**, and passing their local GL pixel tests alone does not prove integration or playability.
7. Release only if browser automation exercises the **unmodified original frontend**: original 3D intro, original login, authenticated character selection, creating a character, entering an authoritative GameWorld, walking, interacting and playing combat/skills, followed by Safari iPhone memory/context-loss acceptance. Never share a public game URL before that end-to-end proof.

## Invariants for pull requests and deployment

- Protected: LIVE, all original Icons Preview services, their branches, accounts, inventories and data stores.
- Never edit the original gameplay, map and GUI sources merely to satisfy a WebGL2 shim.
- On failure of a graphics feature, report the exact original unsupported pass; never replace it with a hand-drawn asset, flat placeholder or custom interface.
- CI must separately prove (A) source/runtime ownership retained, (B) WebGL2 API parity with the original renderer contract, (C) the actual full original client built using the adapter, and (D) authenticated browser gameplay. Current status: **(A) partially proven, (B) incomplete, (C) NOT built, (D) NOT tested.**
