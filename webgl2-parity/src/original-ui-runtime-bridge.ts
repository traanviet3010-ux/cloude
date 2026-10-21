/**
 * Original HieuSRO UI bridge: connect the EXISTING createUi() outputs from
 * apps/client-next/src/engine/runtime/ui/ui.ts directly to the WebGL2 renderer.
 *
 * This is deliberately not a replacement for createUi(), title.ts, platform
 * input, account auth, character flow or OpenSRO GameWorld. They remain
 * the exact original implementation. Only the GPU consumer changes.
 */
import type { UiScene } from "@/engine/contracts/ui";
import type { UiTexture } from "@/engine/contracts/texture";
import type { Renderer } from "@/engine/contracts/runtime";

type UiConsumer = {
  setTexture(id: string, image: ImageBitmap | ImageData |
    import("@/engine/contracts/texture").NativeTexture | null): void;
  draw(scene: UiScene, clearBackground?: boolean): void;
  stats(): { residentMB: number; textureCount: number; drawCalls: number; frame: number };
};

export function createOriginalUiBridge(consumer: UiConsumer) {
  let lastScene: UiScene | null = null;
  let disposed = false;
  let updates = 0;
  let textures = 0;
  const check = () => {
    if (disposed) throw new Error("Original OpenSRO UI bridge disposed");
  };
  /**
   * Must be passed unchanged as the callback argument to ORIGINAL createUi:
   *
   *   createUi(assets, sessionCommand, bridge.setUi, bridge.setUiTexture, ...)
   *
   * Do not create a second account field, roster, or CIF HTML overlay.
   */
  const setUi: Renderer["setUi"] = (scene) => {
    check();
    if (scene !== null &&
      (!Number.isSafeInteger(scene.revision) || !Number.isFinite(scene.width) ||
        !Number.isFinite(scene.height))) {
      throw new Error("Original Silkroad UiScene frame invalid");
    }
    lastScene = scene;
    updates++;
  };
  /**
   * The original asset worker publishes images already decoded as UiTexture.
   * Renderer WebGL2 owns *only* uploaded GPU bytes; the original asset owner
   * continues to manage ImageBitmap lifecycle.
   */
  const setUiTexture: Renderer["setUiTexture"] = (id: string, image: UiTexture | null) => {
    check();
    consumer.setTexture(id, image);
    textures++;
  };
  /** Draw after the native world pass; no canvas clear, no DOM recreation. */
  function draw(): boolean {
    check();
    if (!lastScene) return false;
    consumer.draw(lastScene, false);
    return true;
  }
  return {
    setUi,
    setUiTexture,
    draw,
    stats() { return { sceneRevision:lastScene?.revision ?? null, updates, textureChanges:textures,
      visible:!!lastScene, gpu:consumer.stats() }; },
    dispose() { disposed = true; lastScene = null; }
  };
}
