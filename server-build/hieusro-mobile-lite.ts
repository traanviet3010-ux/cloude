/*
 * HieuSRO Mobile Lite V1 — deterministic, side-effect-free device policy.
 * Works in both the browser main thread and asset workers. Desktop unchanged.
 * iOS browsers use WebKit; prefer a safe baseline for A14 iPhone Safari.
 */
export function isMobileLiteUserAgent(userAgent: string): boolean {
  return /iPhone|iPod|iPad/i.test(userAgent);
}
export function mobileLiteEnabled(): boolean {
  return typeof navigator !== "undefined" && isMobileLiteUserAgent(navigator.userAgent || "");
}
export const MOBILE_LITE_FRAME_FPS = 30;
export const MOBILE_LITE_RENDER_SCALE = 75 as const;
export const MOBILE_LITE_PACK_BYTES = 32 << 20;
export const MOBILE_LITE_MESH_LIMIT = 384;
