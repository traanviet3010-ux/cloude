#!/usr/bin/env python3
"""HieuSRO Mobile Lite V2: safety-first patches to pinned OpenSRO client.

Run AFTER patch-mobile-lite.py; all anchors are unique and fail closed.
Never modifies a game server, DB, or production route.
"""
from pathlib import Path
import os

root=Path(os.environ.get("HIEUSRO_OPENSRO_ROOT","/opt/opensro"))
engine=root/"apps/client-next/src/engine"
def patch(rel, pairs):
    p=engine/rel
    s=p.read_text(encoding="utf8")
    for old,new in pairs:
        count=s.count(old)
        if count!=1:
            raise SystemExit(f"Mobile memory V2 patch anchor failed: {rel} ({count}): {old[:120]!r}")
        s=s.replace(old,new,1)
    p.write_text(s,encoding="utf8")
    print("Mobile memory V2 patched:",rel,flush=True)

M='@/engine/foundation/rendering/mobile-memory'

# Device-level registry counts WebGPU allocations and guarantees final destroy
# of allocations left after frame-safe owners release their handles.
patch("runtime/renderer/device/device.ts",[
    ('import { createRetirement } from "./retirement";',
     'import { createRetirement } from "./retirement";\n'
     f'import {{ registerGpuDevice, unregisterGpuDevice, type GpuLedger }} from "{M}";'),
    ('let phase: RuntimePhase = "starting", failure: string | null = null, device: GPUDevice | null = null;',
     'let phase: RuntimePhase = "starting", failure: string | null = null, device: GPUDevice | null = null;\n'
     '    let mobileGpuLedger: GpuLedger | null = null;'),
    ('device = created;\n\t\t\tif ( timingEnabled',
     'device = created;\n\t\t\tmobileGpuLedger = registerGpuDevice(created);\n\t\t\tif ( timingEnabled'),
    ('beginFrame() {\n\t\t\tretirement.open();',
     'beginFrame() {\n\t\t\tmobileGpuLedger?.beginFrame();\n\t\t\tretirement.open();'),
    ('retirement.close();\n\t\t\t}\n\t\t},\n\t\t/*\n\t\t================\n\t\tbloom',
     'retirement.close();\n\t\t\t\tmobileGpuLedger?.endFrame();\n\t\t\t}\n\t\t},\n\t\t/*\n\t\t================\n\t\tbloom'),
    ('retirement.close();\n\t\t\tdevice?.destroy();',
     'retirement.close();\n\t\t\tif ( mobileGpuLedger ) unregisterGpuDevice( mobileGpuLedger );\n'
     '\t\t\tmobileGpuLedger = null;\n\t\t\tdevice?.destroy();')
])

# Worker raw .bin blocks must not remain in a 64MB JS heap cache on iOS.
# Keep offset plans and short-lived in-flight ranges; persistent verified
# *members* can still be stored in Cache Storage (not a raw pack mirror).
patch("runtime/assets/worker/packs/blocks.ts",[
    ('import type { PackDescriptor, PackEntry, PackDownload } from "./internal/pack-contract";',
     'import type { PackDescriptor, PackEntry, PackDownload } from "./internal/pack-contract";\n'
     'import { mobileLiteEnabled } from "@/engine/foundation/rendering/mobile-lite";'),
    ('const blockBytes = 1 << 20, budget = 64 << 20, capacity = 4;',
     'const blockBytes = 1 << 20, budget = mobileLiteEnabled() ? 0 : (64 << 20), capacity = mobileLiteEnabled() ? 2 : 4;'),
    ('cache.set( key, bytes );\n\t\t\tresident += bytes.length;',
     'if ( budget > 0 ) { cache.set( key, bytes ); resident += bytes.length; }')
])
patch("runtime/assets/worker/packs/packs.ts",[
    ('const SMALL_PACK_BYTES = 4 << 20;',
     'const SMALL_PACK_BYTES = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ? 0 : 4 << 20;'),
    ('while ( loading.size >= 4 ) {',
     'while ( loading.size >= (typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ? 2 : 4) ) {')
])
patch("runtime/assets/worker/loader.ts",[
    ('active.size >= 4 || !Number.isSafeInteger( request.limit )',
     'active.size >= (typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ? 2 : 4) || !Number.isSafeInteger( request.limit )')
])

# Per-scene meshes and GPU work are capped; rescue mode goes further.
# Propagate the main thread's interrupted-load rescue mode into the asset
# worker. Workers do not have sessionStorage, and the message runs before reads.
patch("runtime/assets/assets.ts",[
    ('name: "sro-assets"\n\t} );',
     'name: "sro-assets"\n\t} );\n'
     '\tworker.postMessage( { kind: "hieusro-memory-mode", ultra: rescueMode() } );')
])
p=engine/"runtime/assets/assets.ts"
p.write_text('import { rescueMode } from "@/engine/foundation/rendering/mobile-memory";\n'+p.read_text())
patch("runtime/assets/worker/entry.ts",[
    ('port.onmessage = event => loader.receive(event.data);',
     'port.onmessage = event => {\n'
     '\tconst control = event.data as unknown as { kind: string; ultra?: boolean };\n'
     '\tif (control?.kind === "hieusro-memory-mode") { setWorkerRescueMode(control.ultra === true); return; }\n'
     '\tloader.receive(event.data);\n'
     '};')
])
p=engine/"runtime/assets/worker/entry.ts"
p.write_text('import { setWorkerRescueMode } from "@/engine/foundation/rendering/mobile-memory";\n'+p.read_text())

# Evaluate worker rescue at read-time, NOT module import-time.
patch("runtime/assets/worker/world/resources/resources.ts",[
    ('const PARSED_REGION_LIMIT = 12;',
     f'import {{ rescueMode }} from "{M}";\n'
     'import { mobileLiteEnabled } from "@/engine/foundation/rendering/mobile-lite";\n'
     'const PARSED_REGION_LIMIT = 12;'),
    ('const PARSED_MESH_LIMIT = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ? 384 : 1024;',
     'const PARSED_MESH_LIMIT = 1024;'),
    ('regions.get( path ) ?? parse<Region>( await read( path ) ),\n\t\t\tPARSED_REGION_LIMIT',
     'regions.get( path ) ?? parse<Region>( await read( path ) ),\n'
     '\t\t\trescueMode() ? 2 : mobileLiteEnabled() ? 5 : PARSED_REGION_LIMIT'),
    ('return remember( regions, path, region, PARSED_REGION_LIMIT );',
     'return remember( regions, path, region, rescueMode() ? 2 : mobileLiteEnabled() ? 5 : PARSED_REGION_LIMIT );'),
    ('return remember( meshes, path, mesh, PARSED_MESH_LIMIT );',
     'return remember( meshes, path, mesh, rescueMode() ? 160 : mobileLiteEnabled() ? 384 : PARSED_MESH_LIMIT );'),
    ('if ( !dx && !dz ) continue;',
     'if ( !dx && !dz ) continue;\n'
     '\t\t\t\t\tif ( mobileLiteEnabled() && (rescueMode() || Math.abs(dx) + Math.abs(dz) > 1) ) continue;')
])
patch("runtime/renderer/world/world.ts",[
    ('const UPLOAD_BYTES_PER_FRAME = 4 << 20;',
     'const UPLOAD_BYTES_PER_FRAME = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ? (1 << 20) : (4 << 20);')
])

# Keep CSS UI coordinates unchanged, cap only physical backing store pixels.
patch("runtime/platform/platform.ts",[
    ('import ',f'import {{ maxMobilePixelRatio }} from "{M}";\nimport ') if False else
    ('viewport.width = Math.max( 1, Math.round( box.width * devicePixelRatio ) );',
     'viewport.width = Math.max( 1, Math.round( box.width * maxMobilePixelRatio() ) );'),
    ('viewport.height = Math.max( 1, Math.round( box.height * devicePixelRatio ) );',
     'viewport.height = Math.max( 1, Math.round( box.height * maxMobilePixelRatio() ) );')
])
# All imports at file top; stable in both dev / beta.
p=engine/"runtime/platform/platform.ts"
s=p.read_text()
s=f'import {{ maxMobilePixelRatio }} from "{M}";\n'+s
p.write_text(s)

# The first confirmed WorldReady removes crash marker; title/login alone
# cannot claim the 3D world reached a healthy state.
patch("runtime/runtime.ts",[
    ('import { createRenderer } from "./renderer/renderer";',
     'import { createRenderer } from "./renderer/renderer";\n'
     f'import {{ markMobileLiteReady }} from "{M}";'),
    ('readySent = true;\n\t\t\t\t\t// Foreground loading is done:',
     'readySent = true;\n\t\t\t\t\tmarkMobileLiteReady();\n\t\t\t\t\t// Foreground loading is done:')
])

# Device loss: previous Mobile Lite patch caps automatic recovery to ONE.
# No new force-reload code is introduced, ever.

# pagehide/beforeunload dispose the owning runtime. Its already-existing
# cleanup stack cancels RAF/asset worker/AbortControllers and closes audio.
# GPU textures and buffers are destroyed after owners safely retire them.
patch("../bootstrap.ts",[
    ('import { createMobileLiteHud } from "./engine/runtime/mobile-lite/mobile-hud";',
     'import { createMobileLiteHud } from "./engine/runtime/mobile-lite/mobile-hud";\n'
     'import { startMobileMemorySession, markMobileLiteReady } from "./engine/foundation/rendering/mobile-memory";'),
    ('function startGame() {',
     'let ownedMobileGame: ReturnType<typeof startRuntime> | null = null;\n'
     'const mobileMemorySession = mobileLiteEnabled() ? startMobileMemorySession() : null;\n'
     'let mobilePageDisposed = false;\n'
     'function mobilePageCleanup() {\n'
     '    if (mobilePageDisposed) return;\n'
     '    mobilePageDisposed = true;\n'
     '    try { ownedMobileGame?.dispose(); } catch (e) { console.warn("Mobile cleanup:", e); }\n'
     '    mobileMemorySession?.dispose();\n'
     '    markMobileLiteReady();\n'
     '}\n'
     'if (mobileMemorySession) {\n'
     '    addEventListener("pagehide", mobilePageCleanup, { once: true });\n'
     '    addEventListener("beforeunload", mobilePageCleanup, { once: true });\n'
     '}\n'
     'function startGame() {'),
    ('const started = startRuntime( canvas, status, undefined, diagnosticsFromQuery() );',
     'const started = startRuntime( canvas, status, undefined, diagnosticsFromQuery() );\n'
     '    if (mobileMemorySession) ownedMobileGame = started;')
])

print("HieuSRO Mobile Lite memory V2 patch complete")
