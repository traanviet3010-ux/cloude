#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "/src/opensro")
main_owner = root / "apps/client-next/src/engine/runtime/assets/assets.ts"
worker_loader = root / "apps/client-next/src/engine/runtime/assets/worker/loader.ts"


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one anchor, found {count}: {old!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


# iOS WebKit has a much smaller practical memory ceiling than desktop browsers.
# Keep desktop at the upstream four concurrent foreground transactions, but let
# iPhone/iPad decode and transfer only two asset transactions at once. The main
# thread and worker use the same limit so backpressure remains valid instead of
# turning excess requests into worker errors.
replace_once(
    main_owner,
    "const REQUEST_CAPACITY = 4;",
    'const REQUEST_CAPACITY = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 2 : 4;'
)

replace_once(
    worker_loader,
    "const PROGRESS_INTERVAL_MS = 150;",
    'const FOREGROUND_REQUEST_CAPACITY = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 2 : 4;\nconst PROGRESS_INTERVAL_MS = 150;'
)
replace_once(
    worker_loader,
    "active.size >= 4 ||",
    "active.size >= FOREGROUND_REQUEST_CAPACITY ||"
)

print("HieuSRO mobile asset patch applied: iOS foreground capacity=2, desktop=4")
