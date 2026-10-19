#!/usr/bin/env python3
"""Isolated HieuSRO TEST patch for OpenSRO's EFP rotation assignment.

Upstream does not bake dynamic SetRotation/SetRotationMat schedules into a static
node. The commands are already compiled below into ParticleEmitter.commands and
executed by the particle graph at their authored frames. Keep exact legacy
static-node baking when all rotations use its supported initialization schedule,
but route genuinely timed rotations to the existing command runtime.
"""
from pathlib import Path
import os

root = Path(os.environ.get("HIEUSRO_OPENSRO_ROOT", "/src/opensro"))
path = root / "apps/client-next/src/engine/runtime/assets/worker/effects/program/program.ts"
src = path.read_text(encoding="utf-8")
marker = "\t\t\t\tlet combinedMatrix: number[] | null = null;"
assert src.count(marker) == 1, "OpenSRO rotation node anchor changed"
src = src.replace(
    marker,
    """\t\t\t\t// Timed native rotations cannot be reduced to the one-time parent
\t\t\t\t// node matrix. The ParticleEmitter command runner already applies
\t\t\t\t// these at their specified frames; only bake truly static programs.
\t\t\t\tconst canBakeRotation = rotations.every( op =>
\t\t\t\t\t(op.start === 0 && op.step === 0 && op.end === 0) ||
\t\t\t\t\t(op.start === 0 && (
\t\t\t\t\t\t((op.flags === 0 || op.flags === 1 || op.flags === 2) &&
\t\t\t\t\t\t\top.step === 0 && op.end === 1) ||
\t\t\t\t\t\t(op.flags === 3 && (op.step === 0 || op.step === 1) && op.end === 1)
\t\t\t\t\t))
\t\t\t\t);
""" + marker,
    1,
)
start_marker = "\t\t\t\t\t\tconst validSchedule = op.start === 0 && ("
end_marker = "\t\t\t\t\t\t// AF4410: Opcode execution uses last-wins overwrite semantics"
assert src.count(start_marker) == 1 and src.count(end_marker) == 1, "OpenSRO EFP validation contract changed"
start, end = src.index(start_marker), src.index(end_marker)
assert start < end
previous = src[start:end]
assert 'Unsupported particle rotation assignment' in previous and 'matrix[15] !== 1' in previous
src = src[:start] + """\t\t\t\t\t\tif (
\t\t\t\t\t\t\t!Array.isArray( matrix ) || matrix.length !== 16 || matrix.some( v =>
\t\t\t\t\t\t\t\ttypeof v !== "number" || !Number.isFinite( v )
\t\t\t\t\t\t\t) || matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1
\t\t\t\t\t\t) {
\t\t\t\t\t\t\tthrow new Error( "Invalid particle rotation matrix" );
\t\t\t\t\t\t}
\t\t\t\t\t\t// Dynamic rotation is handled once, at authored frame(s), by
\t\t\t\t\t\t// ParticleEmitter.commands below. Do not double-apply it here.
\t\t\t\t\t\tif ( !canBakeRotation ) continue;
""" + src[end:]
assert src.count("if ( !canBakeRotation ) continue;") == 1
path.write_text(src, encoding="utf-8")
print("Patched HieuSRO TEST EFP rotation scheduling: dynamic -> native particle command runtime.")
