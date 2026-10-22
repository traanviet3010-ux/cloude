/**
 * Reuse the REAL original Silkroad renderer and all of its public methods.
 * There is no duplicate login, scene, character, gameplay, picking or HUD
 * implementation in this adapter.
 *
 * The GL device/surface/frame must implement the EXISTING original internal
 * GPU contracts. The isolated WebGL2 pixel compositor does not yet satisfy
 * them, and must not be passed off as a playable renderer.
 */
import {createRenderer} from "@/engine/runtime/renderer/renderer";
import type {createDevice} from "@/engine/runtime/renderer/device/device";
import type {createSurface} from "@/engine/runtime/renderer/surface/surface";
import type {createFrame} from "@/engine/runtime/renderer/frame/frame";

/** Supply the true low-level WebGL2 backend as a single atomically owned set. */
export interface OriginalGraphicsBackendFactories {
 readonly device:typeof createDevice;
 readonly surface:typeof createSurface;
 readonly frame:typeof createFrame;
}

/**
 * RenderBackend remains typed as EXACTLY the native createRenderer() API.
 * It can be passed to the TEST-only original startRuntime(..., renderBackend)
 * seam created by attach-original-runtime-renderer.mjs.
 *
 * Calling startRuntime still creates the original assets, simulation worker,
 * UI, frontend, input, presentation and authoritative game session owners.
 */
export function bindOriginalGraphicsBackend(
  backend:OriginalGraphicsBackendFactories
):typeof createRenderer {
  if(!backend?.device||!backend?.surface||!backend?.frame)
    throw Error("Native WebGL2 device, surface and frame must be complete");
  return (canvas,random,sound,diagnostics)=>
    createRenderer(canvas,random,sound,diagnostics,
      backend.device,backend.surface,backend.frame);
}
