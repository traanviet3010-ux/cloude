#!/usr/bin/env python3
"""Install bounded HieuSRO iPhone Mobile Lite without modifying Go/gameplay.

Pinned OpenSRO source anchors are checked exactly once. A mismatch FAILS the
build rather than deploying an untested half-patch. No LIVE file is touched.
"""
from pathlib import Path
import os

root=Path(os.environ.get("HIEUSRO_OPENSRO_ROOT","/src/opensro"))
client=root/"apps/client-next/src/engine"
def patch(relative, changes):
    path=client/relative
    s=path.read_text(encoding="utf8")
    for old,new in changes:
        if s.count(old)!=1:
            raise SystemExit(f"Mobile Lite patch anchor failed: {relative}: {old[:110]!r} count={s.count(old)}")
        s=s.replace(old,new,1)
    path.write_text(s,encoding="utf8")
    print("Mobile Lite patched: ",relative)

policy='@/engine/foundation/rendering/mobile-lite'

patch("runtime/frame-pacing.ts", [
    ('import { DEFAULT_FRAME_LIMIT, frameLimits } from "@/engine/foundation/rendering/video-options";',
     'import { DEFAULT_FRAME_LIMIT, frameLimits } from "@/engine/foundation/rendering/video-options";\n'
     'import { mobileLiteEnabled, MOBILE_LITE_FRAME_FPS } from "'+policy+'";'),
    ('let limit = DEFAULT_FRAME_LIMIT, deadline: number | undefined, visible = false;',
     'let limit = mobileLiteEnabled() ? MOBILE_LITE_FRAME_FPS : DEFAULT_FRAME_LIMIT, deadline: number | undefined, visible = false;'),
    ('const next = frameLimits().includes( value ) ? value : DEFAULT_FRAME_LIMIT;',
     'const requested = frameLimits().includes( value ) ? value : DEFAULT_FRAME_LIMIT;\n'
     '\t\t\tconst next = mobileLiteEnabled() ? Math.min( requested || MOBILE_LITE_FRAME_FPS, MOBILE_LITE_FRAME_FPS ) : requested;')
])
patch("foundation/rendering/video-options.ts", [
    ('return [ 60, 120, 240, 0 ];','return [ 30, 60, 120, 240, 0 ];')
])
patch("runtime/renderer/renderer.ts", [
    ('import { createDevice } from "./device/device";',
     'import { createDevice } from "./device/device";\n'
     'import { mobileLiteEnabled, MOBILE_LITE_RENDER_SCALE } from "'+policy+'";'),
    ('const renderScale = experimental.renderScale,',
     '// iPhone uses a stable 75% scene target; do not repeatedly resize GPU\n'
     '\t\t\t\t// textures as temperature or instantaneous FPS fluctuates.\n'
     '\t\t\t\tconst renderScale = mobileLiteEnabled() ? Math.min( experimental.renderScale, MOBILE_LITE_RENDER_SCALE ) as 50 | 75 : experimental.renderScale,')
])
patch("runtime/assets/worker/packs/packs.ts", [
    ('(128 << 20) && cache.size',
     '(typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ? (32 << 20) : (128 << 20)) && cache.size')
])
patch("runtime/assets/worker/world/resources/resources.ts", [
    ('const PARSED_MESH_LIMIT = 1024;',
     'const PARSED_MESH_LIMIT = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ? 384 : 1024;')
])
patch("runtime/renderer/device/device.ts", [
    ('throw new Error( "No WebGPU adapter" );',
     'throw new Error( "No WebGPU adapter - Safari/iOS did not provide a GPU. '
     'Close other tabs, cool the phone and retry manually; automatic reload is disabled." );')
])
patch("runtime/runtime.ts", [
    ('import { createFramePacing } from "./frame-pacing";',
     'import { createFramePacing } from "./frame-pacing";\n'
     'import { createMobileLiteHud } from "./mobile-lite/mobile-hud";'),
    ('\t\tconst frontend = own(\n\t\t\tcreateFrontend(',
     '\t\t// Read-only diagnostics. Can never block game boot or simulation.\n'
     '\t\ttry { own( createMobileLiteHud( () => ({phase: renderer.phase(), error: renderer.error()}) ) ); }\n'
     '\t\tcatch (error) { console.warn("Mobile Lite UI unavailable", error); }\n'
     '\t\tconst frontend = own(\n\t\t\tcreateFrontend(')
])
print("HieuSRO iPhone Mobile Lite patch complete.")
