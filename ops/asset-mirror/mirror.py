#!/usr/bin/env python3
"""Mirror OpenSRO SROPACK2 packs into a versioned, inactive HieuSRO TEST cache.

No service reload, DNS update, production symlink, or game-state operations.
Python 3.10+ / standard library only. Existing packs are verified before reuse.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import struct
import sys
import time
from collections import Counter
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

SOURCE = "https://opensro.online"
INDEX = "/assets/packs/manifest.json"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
RESERVE_BYTES = 1024 * 1024 * 1024
CHUNK = 1024 * 1024


class MirrorError(Exception):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def valid_path(value: object, suffix: str = ".bin") -> str:
    if not isinstance(value, str) or not value.startswith("/assets/packs/"):
        raise MirrorError("Pack path must start with /assets/packs/")
    if "\\" in value or "%" in value or "?" in value or "#" in value or "//" in value:
        raise MirrorError("Unsafe pack path")
    if any(part in (".", "..", "") for part in value.split("/")[1:]):
        raise MirrorError("Unsafe pack path component")
    if not value.endswith(suffix) or any(ord(c) < 32 for c in value):
        raise MirrorError("Unexpected pack name")
    return value


def inspect_manifest(raw: bytes, expected_groups: int, expected_packs: int, expected_assets: int):
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise MirrorError(f"Invalid manifest JSON: {exc}") from exc
    if data.get("format") != "sro-asset-pack-index" or data.get("version") != 2:
        raise MirrorError("Unexpected OpenSRO pack index format/version")
    groups = data.get("groups")
    assets = data.get("assets")
    if not isinstance(groups, list) or not isinstance(assets, list):
        raise MirrorError("Missing groups/assets arrays")
    if expected_groups and len(groups) != expected_groups:
        raise MirrorError(f"Group count changed: {len(groups)} != {expected_groups}")
    if expected_assets and len(assets) != expected_assets:
        raise MirrorError(f"Asset count changed: {len(assets)} != {expected_assets}")
    packs = {}
    names = set()
    for group in groups:
        name = group.get("name")
        if not isinstance(name, str) or not name or name in names:
            raise MirrorError("Duplicate or invalid group name")
        names.add(name)
        rows = group.get("packs")
        if not isinstance(rows, list):
            raise MirrorError(f"Group {name} has no pack list")
        for pack in rows:
            rel = valid_path(pack.get("path"))
            nbytes = pack.get("bytes")
            digest = pack.get("sha256")
            count = pack.get("assetCount")
            if rel in packs:
                raise MirrorError(f"Duplicate pack path: {rel}")
            if type(nbytes) is not int or nbytes < 12 or nbytes > 4 * 1024 ** 3:
                raise MirrorError(f"Invalid byte size for {rel}")
            if not isinstance(digest, str) or not HEX64.fullmatch(digest):
                raise MirrorError(f"Invalid SHA-256 for {rel}")
            if type(count) is not int or count < 0:
                raise MirrorError(f"Invalid assetCount for {rel}")
            suffix = re.search(r"-([0-9a-f]{12})\.bin$", rel)
            if suffix and suffix.group(1) != digest[:12]:
                raise MirrorError(f"Filename hash mismatch for {rel}")
            packs[rel] = {"path": rel, "bytes": nbytes, "sha256": digest,
                          "assetCount": count, "group": name}
    if expected_packs and len(packs) != expected_packs:
        raise MirrorError(f"Pack count changed: {len(packs)} != {expected_packs}")
    counts = Counter()
    seen_assets = set()
    for asset in assets:
        asset_path = asset.get("path")
        rel = asset.get("packPath")
        if rel not in packs or not isinstance(asset_path, str) or asset_path in seen_assets:
            raise MirrorError("Asset refers to missing pack or duplicate asset path")
        seen_assets.add(asset_path)
        if asset.get("group") != packs[rel]["group"]:
            raise MirrorError(f"Asset group does not match pack: {asset_path}")
        offset, length = asset.get("offset"), asset.get("length")
        stored = asset.get("stored")
        if stored is None:
            stored_length = length
        elif isinstance(stored, dict) and stored.get("encoding") == "gzip":
            stored_length = stored.get("length")
        else:
            raise MirrorError(f"Invalid compressed member metadata: {asset_path}")
        # length is decoded bytes; compressed packs occupy stored.length bytes.
        if (type(offset) is not int or type(length) is not int or
                type(stored_length) is not int or
                offset < 0 or length < 0 or stored_length < 0 or
                offset + stored_length > packs[rel]["bytes"]):
            raise MirrorError(f"Invalid offset or stored length: {asset_path}")
        counts[rel] += 1
    for rel, pack in packs.items():
        if counts[rel] != pack["assetCount"]:
            raise MirrorError(f"Pack assetCount mismatch: {rel}")
    return data, list(packs.values())


def inspect_pack(path: Path, descriptor: dict) -> None:
    if path.stat().st_size != descriptor["bytes"]:
        raise MirrorError("Pack size mismatch")
    if sha256(path) != descriptor["sha256"]:
        raise MirrorError("Pack SHA-256 mismatch")
    with path.open("rb") as handle:
        prefix = handle.read(12)
        if len(prefix) != 12 or prefix[:8] != b"SROPACK2":
            raise MirrorError("Invalid SROPACK2 header")
        header_size = struct.unpack("<I", prefix[8:])[0]
        if header_size < 2 or header_size > 32 * 1024 * 1024 or header_size + 12 > descriptor["bytes"]:
            raise MirrorError("Invalid SROPACK2 index length")
        try:
            header = json.loads(handle.read(header_size))
        except (UnicodeDecodeError, ValueError) as exc:
            raise MirrorError("Invalid embedded pack index") from exc
        if (header.get("format") != "sro-asset-pack" or header.get("version") != 2 or
                not isinstance(header.get("files"), list) or
                len(header["files"]) != descriptor["assetCount"]):
            raise MirrorError("Pack index or membership mismatch")


def open_source(url: str, headers: dict, origin: str):
    response = urlopen(Request(url, headers=headers), timeout=75)
    if urlsplit(response.geturl()).netloc != urlsplit(origin).netloc:
        response.close()
        raise MirrorError("Unexpected cross-host redirect")
    return response


def load_index(origin: str) -> bytes:
    url = urljoin(origin, INDEX)
    with open_source(url, {"Accept-Encoding": "identity", "User-Agent": "HieuSRO-AssetMirror/1.0"}, origin) as resp:
        if resp.status != 200:
            raise MirrorError(f"Manifest HTTP {resp.status}")
        raw = resp.read(32 * 1024 * 1024 + 1)
        if len(raw) > 32 * 1024 * 1024:
            raise MirrorError("Manifest exceeds 32 MiB")
        return raw


def download_one(pack: dict, release: Path, origin: str, retries: int = 5) -> str:
    dest = release / pack["path"].lstrip("/")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        try:
            inspect_pack(dest, pack)
            return "cached"
        except (MirrorError, OSError):
            dest.unlink()
    part = dest.with_name(dest.name + ".part")
    url = urljoin(origin, pack["path"])
    for attempt in range(1, retries + 1):
        try:
            size = part.stat().st_size if part.exists() else 0
            if size > pack["bytes"]:
                part.unlink()
                size = 0
            headers = {"Accept-Encoding": "identity", "User-Agent": "HieuSRO-AssetMirror/1.0"}
            if size:
                headers["Range"] = f"bytes={size}-"
            with open_source(url, headers, origin) as resp:
                status = resp.status
                if size and status == 206:
                    expected = f"bytes {size}-{pack['bytes'] - 1}/{pack['bytes']}"
                    if resp.headers.get("Content-Range") != expected:
                        raise MirrorError("Resume Content-Range mismatch")
                    mode = "ab"
                elif status == 200:
                    mode = "wb"  # origin ignored Range: restart cleanly
                else:
                    raise MirrorError(f"Unexpected HTTP {status} for pack")
                if resp.headers.get("Content-Encoding", "identity").lower() != "identity":
                    raise MirrorError("Pack response unexpectedly content-encoded")
                with part.open(mode) as output:
                    while block := resp.read(CHUNK):
                        output.write(block)
                    output.flush()
                    os.fsync(output.fileno())
            inspect_pack(part, pack)
            os.replace(part, dest)
            return "downloaded"
        except (OSError, MirrorError, HTTPError, URLError) as exc:
            if attempt == retries:
                raise MirrorError(f"{pack['path']}: failed after {retries} tries: {exc}") from exc
            time.sleep(min(2 ** attempt, 15))
    raise AssertionError("unreachable")


def publish(release: Path, raw: bytes, summary: dict):
    index_file = release / INDEX.lstrip("/")
    temp = index_file.with_suffix(".json.part")
    temp.parent.mkdir(parents=True, exist_ok=True)
    with temp.open("wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, index_file)
    report = release / "mirror-report.json"
    report.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    (release / "MIRROR_VERIFIED").write_text(summary["manifest_sha256"] + "\n")


def mirror(origin: str, root: Path, expected_groups: int = 17,
           expected_packs: int = 213, expected_assets: int = 36843,
           workers: int = 2, manifest_file: Path | None = None,
           expected_manifest_sha256: str | None = None) -> dict:
    if origin != SOURCE and not (urlsplit(origin).hostname in ("127.0.0.1", "localhost")):
        raise MirrorError("Unexpected origin: only opensro.online is permitted")
    if urlsplit(origin).scheme != "https" and urlsplit(origin).hostname not in ("127.0.0.1", "localhost"):
        raise MirrorError("Remote origin must use HTTPS")
    raw = manifest_file.read_bytes() if manifest_file else load_index(origin)
    data, packs = inspect_manifest(raw, expected_groups, expected_packs, expected_assets)
    manifest_sha = hashlib.sha256(raw).hexdigest()
    if expected_manifest_sha256 and manifest_sha != expected_manifest_sha256:
        raise MirrorError(f"Manifest SHA-256 changed: {manifest_sha}")
    release = root / "releases" / manifest_sha
    release.mkdir(parents=True, exist_ok=True)
    if release.is_symlink() or root.is_symlink():
        raise MirrorError("Refusing symlinked mirror directory")
    missing = sum(p["bytes"] for p in packs if not (release / p["path"].lstrip("/")).exists())
    free = shutil.disk_usage(release).free
    if free < missing + RESERVE_BYTES:
        raise MirrorError(f"Not enough free space: {free} available, {missing} estimated plus 1 GiB reserve")
    print(f"MANIFEST_SHA256={manifest_sha}", flush=True)
    print(f"GROUPS={len(data['groups'])} PACKS={len(packs)} ASSETS={len(data['assets'])}", flush=True)
    print(f"BYTES={sum(p['bytes'] for p in packs)} RELEASE={release}", flush=True)
    cached = downloaded = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(download_one, pack, release, origin): pack for pack in packs}
        errors = []
        for future in concurrent.futures.as_completed(futures):
            try:
                kind = future.result()
                cached += (kind == "cached")
                downloaded += (kind == "downloaded")
                if (cached + downloaded) % 10 == 0 or cached + downloaded == len(packs):
                    print(f"VERIFIED_PACKS={cached+downloaded}/{len(packs)} CACHED={cached} NEW={downloaded}", flush=True)
            except Exception as exc:
                errors.append(str(exc))
        if errors:
            raise MirrorError("Incomplete mirror; manifest not published:\n" + "\n".join(errors[:10]))
    summary = {"source": origin, "generatedAt": data.get("generatedAt"),
               "manifest_sha256": manifest_sha, "groups": len(data["groups"]),
               "packs": len(packs), "assets": len(data["assets"]),
               "bytes": sum(p["bytes"] for p in packs),
               "downloaded": downloaded, "reused": cached,
               "root": str(release), "production_switched": False}
    publish(release, raw, summary)
    print(f"MIRROR_READY={release}", flush=True)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/srv/hieusro-assets"))
    parser.add_argument("--origin", default=SOURCE)
    parser.add_argument("--manifest-file", type=Path)
    parser.add_argument("--expect-groups", type=int, default=17)
    parser.add_argument("--expect-packs", type=int, default=213)
    parser.add_argument("--expect-assets", type=int, default=36843)
    parser.add_argument("--workers", type=int, default=2, choices=(1, 2, 3))
    parser.add_argument("--expected-manifest-sha256")
    args = parser.parse_args()
    try:
        mirror(args.origin, args.root, args.expect_groups,
               args.expect_packs, args.expect_assets, args.workers, args.manifest_file,
               args.expected_manifest_sha256)
    except (MirrorError, OSError, HTTPError, URLError) as exc:
        print(f"MIRROR_FAILED={exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
