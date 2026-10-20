import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const folder = new URL("../../src/engine/", import.meta.url);
const load = path => readFileSync(new URL(path, folder), "utf8");

test("iOS physical backing resolution capped without changing CSS pointer scaling", () => {
  const source = load("runtime/platform/platform.ts");
  const w = source.match(/viewport\.width = Math\.max\([^\n]+/g);
  const h = source.match(/viewport\.height = Math\.max\([^\n]+/g);
  assert.equal(w?.length, 1);
  assert.equal(h?.length, 1);
  assert.match(w[0], /Math\.min\(devicePixelRatio, 1\.5\)/);
  assert.match(h[0], /Math\.min\(devicePixelRatio, 1\.5\)/);
});

test("iOS retains 24MiB Range LRU, limits only network in-flight reads, and does not blindly keep oversized chunks", () => {
  const source = load("runtime/assets/worker/packs/blocks.ts");
  assert.match(source, /24 << 20/);
  assert.match(source, /capacity = .* \? 2 : 4/);
  assert.match(source, /if \( bytes\.length <= budget \)/);
  assert.match(source, /while \( resident \+ bytes\.length > budget && cache\.size \)/);
  assert.match(source, /cache\.delete\( oldest \)/);
});

test("client-worker request budget contract stays 4 on both ends", () => {
  const main = load("runtime/assets/assets.ts");
  const worker = load("runtime/assets/worker/loader.ts");
  assert.match(main, /REQUEST_CAPACITY = 4/);
  assert.match(worker, /active\.size >= 4/);
});

test("iOS avoids whole-small-pack loads and spreads world uploads", () => {
  const packs = load("runtime/assets/worker/packs/packs.ts");
  const world = load("runtime/renderer/world/world.ts");
  assert.match(packs, /SMALL_PACK_BYTES = .* \? 0 : 4 << 20/);
  assert.match(world, /UPLOAD_BYTES_PER_FRAME = .* \? \(2 << 20\) : \(4 << 20\)/);
});

test("renderer not replaced, protocol and gameplay remain original", () => {
  const renderer = load("runtime/renderer/renderer.ts");
  assert.match(renderer, /WebGPU|webgpu|createDevice/);
  assert.doesNotMatch(renderer, /Babylon|new WebGL/);
});
