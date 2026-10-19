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
    , ('device.recoverable() && recoveries < 3',
       'device.recoverable() && recoveries < (mobileLiteEnabled() ? 1 : 3)')
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

# Preflight must run before game assets / renderer are even created. An
# unsupported or temporarily unavailable GPU must show a retry UI rather than
# repeatedly downloading content, raising No WebGPU adapter or reloading.
patch("../bootstrap.ts", [
    ('import { startRuntime, startViewerRuntime } from "./engine/runtime/runtime";',
     'import { startRuntime, startViewerRuntime } from "./engine/runtime/runtime";\n'
     'import { mobileLiteEnabled } from "./engine/foundation/rendering/mobile-lite";\n'
     'import { createMobileLiteHud } from "./engine/runtime/mobile-lite/mobile-hud";'),
    (
     'export const runtime = document.documentElement.dataset.page === "viewer" ? startViewer() : startGame();',
     '''async function startMobileGame() {
    // No page reload loop. Only an explicit user gesture re-checks WebGPU.
    let started = false, checking = false;
    let failureHud: ReturnType<typeof createMobileLiteHud> | null = null;
    const detail = document.querySelector<HTMLElement>( "#startup-loading .sro-boot-loading__detail" );
    const controls = document.createElement( "div" );
    controls.style.cssText = "margin:16px auto 0;text-align:center;max-width:310px;color:#ffe2ac;font:13px system-ui";
    const explanation = document.createElement( "p" );
    explanation.setAttribute( "role", "alert" );
    const retry = document.createElement( "button" );
    retry.type = "button";
    retry.textContent = "Thử lại GPU";
    retry.style.cssText = "border:1px solid #d9bd70;border-radius:8px;padding:12px 18px;background:#233448;color:#fff;font:14px system-ui;cursor:pointer;min-height:44px";
    controls.append( explanation, retry );
    const showFailure = (reason: string) => {
        if (detail) detail.textContent = "Safari không cấp được WebGPU";
        explanation.textContent = reason + " Hãy đóng tab khác, để iPhone nguội; sau đó bấm Thử lại GPU.";
        if (!controls.isConnected) (document.querySelector( "#startup-loading .sro-boot-loading__inner" ) || document.body).append( controls );
        failureHud ??= createMobileLiteHud( () => ({ phase:"failed", error:reason }) );
    };
    async function probe() {
        if (started || checking) return;
        checking = true;
        retry.disabled = true;
        if (detail) detail.textContent = "Đang kiểm tra GPU trên iPhone…";
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
            const gpu = navigator.gpu;
            if (!gpu) throw new Error( "WebGPU không có trên Safari hiện tại." );
            const adapter = await Promise.race( [
                gpu.requestAdapter(),
                new Promise<null>( resolve => { timer = setTimeout( () => resolve( null ), 10000 ); } )
            ] );
            if (!adapter) throw new Error( "WebGPU adapter không khả dụng hoặc quá thời gian 10 giây." );
            started = true;
            controls.remove();
            failureHud?.dispose();
            failureHud = null;
            if (detail) detail.textContent = "Đang mở HieuSRO Mobile Lite…";
            // Never alter the account, shard, movement or combat stack.
            return startGame();
        } catch (error) {
            showFailure( String( error ) );
        } finally {
            if (timer !== null) clearTimeout(timer);
            checking = false;
            retry.disabled = false;
        }
    }
    retry.addEventListener( "click", () => { void probe(); } );
    await probe();
}

export const runtime = document.documentElement.dataset.page === "viewer" ?
    startViewer() : mobileLiteEnabled() ? startMobileGame() : startGame();'''
    )
])

print("HieuSRO iPhone Mobile Lite patch complete.")
