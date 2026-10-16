#!/usr/bin/env python3
"""Prewarm the persistent Nginx asset mirror and verify pack integrity.

The script talks to the local Nginx listener, not opensro.online directly. A
successful GET therefore fills the same proxy_cache that browsers use. Pack
bytes are SHA-256 checked against assets/packs/manifest.json before the run is
considered successful.
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("HIEUSRO_PREWARM_BASE", "http://127.0.0.1:10000").rstrip("/")
REGION_TOKEN = os.environ.get("HIEUSRO_PREWARM_REGION", "61a8").lower().replace("0x", "")
WORKERS = max(1, min(6, int(os.environ.get("HIEUSRO_PREWARM_WORKERS", "3"))))
TIMEOUT = int(os.environ.get("HIEUSRO_PREWARM_TIMEOUT", "180"))
USER_AGENT = "HieuSRO-asset-prewarm/1"


def request(path: str) -> urllib.request.Request:
    return urllib.request.Request(
        f"{BASE}{path}",
        headers={"Accept-Encoding": "identity", "User-Agent": USER_AGENT},
        method="GET",
    )


def fetch_bytes(path: str) -> tuple[bytes, str]:
    with urllib.request.urlopen(request(path), timeout=TIMEOUT) as response:
        if response.status != 200:
            raise RuntimeError(f"{path}: HTTP {response.status}")
        return response.read(), response.headers.get("X-HieuSRO-Asset-Cache", "-")


def stream_and_verify(path: str, expected_sha256: str) -> dict[str, object]:
    digest = hashlib.sha256()
    total = 0
    started = time.monotonic()
    with urllib.request.urlopen(request(path), timeout=TIMEOUT) as response:
        if response.status != 200:
            raise RuntimeError(f"{path}: HTTP {response.status}")
        cache = response.headers.get("X-HieuSRO-Asset-Cache", "-")
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            total += len(chunk)
    actual = digest.hexdigest()
    if expected_sha256 and actual != expected_sha256:
        raise RuntimeError(
            f"{path}: sha256 mismatch expected={expected_sha256} actual={actual}"
        )
    return {
        "path": path,
        "bytes": total,
        "sha256": actual,
        "cache": cache,
        "seconds": time.monotonic() - started,
    }


def main() -> int:
    raw, manifest_cache = fetch_bytes("/assets/packs/manifest.json")
    manifest = json.loads(raw.decode("utf-8"))
    if manifest.get("format") != "sro-asset-pack-index":
        raise RuntimeError("unexpected asset pack manifest format")

    pack_meta: dict[str, dict[str, object]] = {}
    selected: set[str] = set()
    startup_groups: list[str] = []

    for group in manifest.get("groups", []):
        name = str(group.get("name", ""))
        load = str(group.get("load", ""))
        if load == "startup":
            startup_groups.append(name)
        for pack in group.get("packs", []):
            path = str(pack.get("path", ""))
            if not path:
                continue
            pack_meta[path] = pack
            if load == "startup":
                selected.add(path)

    region_paths: set[str] = set()
    for asset in manifest.get("assets", []):
        asset_path = str(asset.get("path", "")).lower()
        if REGION_TOKEN and REGION_TOKEN in asset_path:
            pack_path = str(asset.get("packPath", ""))
            if pack_path:
                selected.add(pack_path)
                region_paths.add(pack_path)

    # Warm the web asset manifest too. It is intentionally revalidatable and
    # not part of the integrity count because it is not a binary pack.
    try:
        _, web_manifest_cache = fetch_bytes("/assets/manifest.json")
    except Exception as error:  # fallback remains available; report only.
        web_manifest_cache = f"error:{error}"

    print(
        "PREWARM_PLAN "
        f"manifest_cache={manifest_cache} web_manifest_cache={web_manifest_cache} "
        f"startup_groups={','.join(startup_groups) or '-'} "
        f"packs={len(selected)} region={REGION_TOKEN or '-'} region_packs={len(region_paths)}",
        flush=True,
    )

    if not selected:
        raise RuntimeError("manifest selected zero packs for prewarm")

    failures: list[str] = []
    results: list[dict[str, object]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {}
        for path in sorted(selected):
            pack = pack_meta.get(path) or {}
            expected = str(pack.get("sha256", ""))
            futures[executor.submit(stream_and_verify, path, expected)] = path
        for future in concurrent.futures.as_completed(futures):
            path = futures[future]
            try:
                result = future.result()
                results.append(result)
                mib = int(result["bytes"]) / (1024 * 1024)
                print(
                    f"PREWARM_OK cache={result['cache']} bytes={int(result['bytes'])} "
                    f"mib={mib:.1f} seconds={float(result['seconds']):.2f} {path}",
                    flush=True,
                )
            except Exception as error:
                failures.append(f"{path}: {error}")
                print(f"PREWARM_FAIL {path}: {error}", file=sys.stderr, flush=True)

    total = sum(int(row["bytes"]) for row in results)
    hits = sum(1 for row in results if str(row.get("cache", "")).upper() == "HIT")
    print(
        f"PREWARM_SUMMARY ok={len(results)} fail={len(failures)} "
        f"bytes={total} mib={total / (1024 * 1024):.1f} hits={hits}",
        flush=True,
    )
    if failures:
        raise RuntimeError("; ".join(failures[:5]))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (urllib.error.URLError, json.JSONDecodeError, RuntimeError) as error:
        print(f"PREWARM_ERROR {error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
