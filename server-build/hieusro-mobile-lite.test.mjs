import "../helpers/native-source-loader.mjs";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
const { isMobileLiteUserAgent, mobileLiteEnabled, MOBILE_LITE_FRAME_FPS,
  MOBILE_LITE_RENDER_SCALE, MOBILE_LITE_PACK_BYTES, MOBILE_LITE_MESH_LIMIT } =
  await import("../../src/engine/foundation/rendering/mobile-lite.ts");
const { createFramePacing } = await import("../../src/engine/runtime/frame-pacing.ts");

test("mobile policy applies on iPhone Safari and all other iOS WebKit shells", () => {
  assert.equal(isMobileLiteUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"), true);
  assert.equal(isMobileLiteUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) CriOS/120"), true);
  assert.equal(isMobileLiteUserAgent("Mozilla/5.0 (iPad; CPU OS 26_6 like Mac OS X)"), true);
  assert.equal(isMobileLiteUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0"), false);
  assert.equal(isMobileLiteUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605"), false);
});

test("mobile baselines are bounded, consistent and do not modify desktop defaults", () => {
  assert.equal(MOBILE_LITE_FRAME_FPS, 30);
  assert.equal(MOBILE_LITE_RENDER_SCALE, 75);
  assert.equal(MOBILE_LITE_PACK_BYTES, 32<<20);
  assert.equal(MOBILE_LITE_MESH_LIMIT, 384);
  assert.equal(mobileLiteEnabled(), false); // Node native loader runs as desktop
});

test("the frame pacing caps iPhone at 30fps but keeps desktop uncapped", () => {
  const old = Object.getOwnPropertyDescriptor(globalThis,"navigator");
  try {
    Object.defineProperty(globalThis,"navigator",{value:{userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X)"},configurable:true});
    const limiter = createFramePacing();
    limiter.setFrameLimit(120); // user selecting 120 must not bypass mobile cap
    assert.equal(limiter.admit(0,true),true);
    assert.equal(limiter.admit(10,true),false);
    assert.equal(limiter.admit(20,true),false);
    assert.equal(limiter.admit(34,true),true);
    assert.equal(limiter.admit(40,true),false);
  } finally {
    if (old) Object.defineProperty(globalThis,"navigator",old);
    else delete globalThis.navigator;
  }
  const native = createFramePacing();
  native.setFrameLimit(0);
  assert.equal(native.admit(1,true),true);
  assert.equal(native.admit(2,true),true);
});

test("WebGPU failure stays explicit and never triggers programmatic reload", () => {
  const src = readFileSync(new URL("../../src/engine/runtime/renderer/device/device.ts",import.meta.url),"utf8");
  assert.match(src,/No WebGPU adapter/);
  const screen = readFileSync(new URL("../../src/engine/runtime/mobile-lite/mobile-hud.ts",import.meta.url),"utf8");
  assert.ok(screen.includes("GPU"));
  assert.ok(!screen.includes("location.reload"));
  assert.ok(!screen.includes("window.location"));
});

test("iPhone scene output is capped to stable render scale (not dynamic resizing)", () => {
  const renderer=readFileSync(new URL("../../src/engine/runtime/renderer/renderer.ts",import.meta.url),"utf8");
  assert.match(renderer,/mobileLiteEnabled\(\) \? Math\.min\( experimental\.renderScale, MOBILE_LITE_RENDER_SCALE \)/);
  const packs=readFileSync(new URL("../../src/engine/runtime/assets/worker/packs/packs.ts",import.meta.url),"utf8");
  assert.match(packs,/\(32 << 20\)/);
});
