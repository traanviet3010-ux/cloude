/* HieuSRO isolated rotation scheduling regression; run from
 * apps/client-next/tests/runtime/hieusro-particle-rotation.test.mjs
 * with Node 24 after native OpenSRO dependency installation.
 */
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { createEffectPrograms } = await import("../../src/engine/runtime/assets/worker/effects/program/program.ts");

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const operation = (name = "SetRotation", step = 1) => ({
  name, flags: 0, start: 0, end: 1, step,
  parameter: name === "SetRotationMat" ?
    {kind: "Matrix4", value: [...identity]} :
    {kind: "RotVector", left: [0, 0, 90]}
});
function fixture(ops) {
  return new TextEncoder().encode(JSON.stringify({
    framesPerSecond: 20, meshes: {}, textures: {},
    effects: {"hieusro/rotation-test.efp": {
      scale: 1,
      root: {
        name: "rotation-test", children: [], controllers: [], globalData: {totalFrames: 5, parameters: []},
        preProgram: [], postEmitterProgram: [], updateProgram: [], trailingProgram: [],
        emitterProgram: [{ name: "StaticEmit", parameter: { kind: "StaticEmit", value: {
          min: 0, max: 3, burstRate: 1, minParticles: 1, spawnRate: 1
        } } }],
        renderProgram: ops,
        viewCommand: {name: "ViewNone"}, renderCommand: {name: "RenderNone"},
        lifeCommand: {name: "NormalTimeExtinct"},
        resource: {
          srcBlend: 5, dstBlend: 6, backFaceType: 0,
          srcTextureArg1: 1, srcTextureArg2: 2, srcTextureOp: 4,
          dstTextureArg1: 1, dstTextureArg2: 2, dstTextureOp: 4, meshes: []
        }
      }
    }}
  }));
}
const decode = ops => createEffectPrograms().decode(fixture(ops), "hieusro/rotation-test.efp").model;

for (const opName of ["SetRotation", "SetRotationMat"]) {
  test(opName + " with authored timed schedule is decoded into particle graph", () => {
    const model = decode([operation(opName, 1)]);
    const emitter = model.particleGraph[0];
    assert.equal(model.nodes.some(n => n.name === "rotation-test:rotation"), false,
      "a time-varying rotation must not be pre-baked as a static parent");
    const command = emitter.commands.find(c => c.name === opName);
    assert.ok(command, "native command remains present");
    assert.deepEqual(command.frames, [0, 1], "authored timing must be retained");
    assert.equal(command.rotations.length, 1);
    assert.equal(command.rotations[0].length, 16);
  });
}

test("the legacy one-shot rotation continues to use its static parent", () => {
  const model = decode([operation("SetRotation", 0)]);
  const node = model.nodes.find(n => n.name === "rotation-test:rotation");
  assert.ok(node, "legacy one-shot effect parent retained");
  assert.equal(node.matrix.length, 16);
});

test("mixed one-shot and timed rotation schedules do not double-apply a parent", () => {
  const model = decode([operation("SetRotation", 0), operation("SetRotationMat", 1)]);
  assert.equal(model.nodes.some(n => n.name === "rotation-test:rotation"), false);
  const commands = model.particleGraph[0].commands.filter(c => c.rotations);
  assert.equal(commands.length, 2);
});

test("malformed rotation parameter still fails instead of hiding broken EFP data", () => {
  const op = operation();
  op.parameter.left = [0, 90]; // malformed RotVector
  assert.throws(() => decode([op]), /Invalid particle rotation parameter/);
});
