#!/usr/bin/env python3
"""Conservative SRWeb-inspired streaming profile for the pinned OpenSRO client.

Goals:
 - iOS-only physical render scale cap (not UI CSS coordinate changes)
 - bounded raw pack range cache (24 MiB), 2 in-flight pack downloads
 - spread GPU staging uploads across more frames
 - keep the exact worker/host foreground request-capacity contract (4)
 - no changes to combat, player movement, protocol, servers, UI or WebGPU backend.

WebGL/Babylon is NOT implemented here; that requires an independent renderer.
Refuse to patch if upstream changes prevent exact known anchor matching.
"""
from pathlib import Path
import os
ROOT = Path(os.environ.get("HIEUSRO_OPENSRO_ROOT", "/src/opensro"))
BASE = ROOT / "apps/client-next/src/engine"
IOS = 'typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent || "")'

def patch(file, replacements):
    target = BASE / file
    text = target.read_text(encoding="utf-8")
    for old, new in replacements:
        if text.count(old) != 1:
            raise SystemExit(f"Refusing unverified upstream change in {file}: {old!r}, count={text.count(old)}")
        text = text.replace(old, new, 1)
    target.write_text(text, encoding="utf-8")
    print(f"SRWEB_INSPIRED_PATCH_OK={file}", flush=True)

# iPhone 12 Pro Max DPR 3 -> 1.5 backing resolution, preserving UI hit targets.
patch("runtime/platform/platform.ts", [
    ("viewport.width = Math.max( 1, Math.round( box.width * devicePixelRatio ) );",
     f"viewport.width = Math.max( 1, Math.round( box.width * ({IOS} ? Math.min(devicePixelRatio, 1.5) : devicePixelRatio) ) );"),
    ("viewport.height = Math.max( 1, Math.round( box.height * devicePixelRatio ) );",
     f"viewport.height = Math.max( 1, Math.round( box.height * ({IOS} ? Math.min(devicePixelRatio, 1.5) : devicePixelRatio) ) );"),
])

# Unlike zero-cache previous Mobile V2 experiments, preserve a useful 24-MiB
# byte-range cache to avoid re-fetching common tiles/textures over and over.
patch("runtime/assets/worker/packs/blocks.ts", [
    ("const blockBytes = 1 << 20, budget = 64 << 20, capacity = 4;",
     f"const blockBytes = 1 << 20, budget = {IOS} ? (24 << 20) : (64 << 20), capacity = {IOS} ? 2 : 4;"),
    ("cache.set( key, bytes );\n\t\t\tresident += bytes.length;\n\t\t\treturn bytes;",
     "if ( bytes.length <= budget ) {\n\t\t\t\tcache.set( key, bytes );\n\t\t\t\tresident += bytes.length;\n\t\t\t}\n\t\t\treturn bytes;"),
])

# Do not decode full small packs merely to satisfy a single member on iOS.
patch("runtime/assets/worker/packs/packs.ts", [
    ("const SMALL_PACK_BYTES = 4 << 20;",
     f"const SMALL_PACK_BYTES = {IOS} ? 0 : 4 << 20;"),
])

# Preserve OpenSRO's preexisting 4-request handshake between host and worker;
# only lower the number of network pack range reads, which never rejects work.
patch("runtime/renderer/world/world.ts", [
    ("const UPLOAD_BYTES_PER_FRAME = 4 << 20;",
     f"const UPLOAD_BYTES_PER_FRAME = {IOS} ? (2 << 20) : (4 << 20);"),
])

print("SRWEB_INSPIRED_CLIENT_PROFILE_READY=1", flush=True)
