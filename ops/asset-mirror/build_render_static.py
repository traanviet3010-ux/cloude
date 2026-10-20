#!/usr/bin/env python3
"""Render Static Site builder for HieuSRO asset packs.

Default smoke mode publishes exactly one verified pack and a status file,
NOT a partial client manifest. Full mode downloads all pinned manifest packs.
Static site path: render-asset-public/
Requires Python 3.10+. No app runtime, database, or LIVE configuration changes.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from mirror import (
    INDEX, SOURCE, MirrorError, download_one, inspect_manifest,
    load_index, mirror, sha256,
)

ROOT = Path(__file__).resolve().parents[2]
BUILD_ROOT = ROOT / ".asset-mirror-cache"
PUBLIC_ROOT = ROOT / "render-asset-public"


def publish_status(status: dict) -> None:
    PUBLIC_ROOT.mkdir(exist_ok=True)
    (PUBLIC_ROOT / "mirror-status.json").write_text(
        json.dumps(status, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )


def build_sample() -> None:
    raw = load_index(SOURCE)
    index, packs = inspect_manifest(raw, 17, 213, 36843)
    smallest = min(packs, key=lambda row: row["bytes"])
    manifest_digest = __import__("hashlib").sha256(raw).hexdigest()
    stage = BUILD_ROOT / "smoke" / manifest_digest
    stage.mkdir(parents=True, exist_ok=True)
    download_one(smallest, stage, SOURCE)
    src = stage / smallest["path"].lstrip("/")
    dest = PUBLIC_ROOT / smallest["path"].lstrip("/")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        dest.unlink()
    src.replace(dest)
    publish_status({
        "phase": "sample-only",
        "ready_for_client": False,
        "manifest_sha256": manifest_digest,
        "manifest_asset_count": len(index["assets"]),
        "manifest_pack_count": len(packs),
        "sample_path": smallest["path"],
        "sample_bytes": smallest["bytes"],
        "sample_sha256": sha256(dest),
        "notice": "No manifest published: client must not use this incomplete mirror",
    })
    print(f"RENDER_SAMPLE_READY={smallest['path']}", flush=True)


def build_full() -> None:
    result = mirror(SOURCE, BUILD_ROOT / "full")
    release = Path(result["root"])
    src = release / INDEX.lstrip("/")
    assert src.is_file(), "Full mirror must include the verified manifest"
    pack_dir = src.parent
    target = PUBLIC_ROOT / "assets" / "packs"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise MirrorError("Refusing to overwrite a preexisting publish directory")
    pack_dir.rename(target)
    publish_status({
        "phase": "full",
        "ready_for_client": True,
        "manifest_sha256": result["manifest_sha256"],
        "manifest_pack_count": result["packs"],
        "manifest_asset_count": result["assets"],
        "total_bytes": result["bytes"],
        "verified": True,
    })
    print(f"RENDER_FULL_READY_PACKS={result['packs']}", flush=True)


if __name__ == "__main__":
    mode = os.environ.get("ASSET_MIRROR_MODE", "smoke").lower()
    if not mode in ("smoke", "full"):
        raise SystemExit("ASSET_MIRROR_MODE must be smoke or full")
    if PUBLIC_ROOT.exists():
        raise SystemExit("Refusing to overwrite render-asset-public from another build")
    if mode == "smoke":
        build_sample()
    else:
        build_full()
