#!/usr/bin/env python3
"""Download a legally usable Silkroad v1.150 client from a PRIVATE file-ID manifest.

No account keys or Google Drive file IDs are included in this source tree.
Accepts publicly shared file IDs via gdown; does not bypass Drive permissions.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

EXPECTED = {
    "Media.pk2": 289_288_192,
    "Data.pk2": 1_342_164_992,
    "Map.pk2": 621_858_816,
    "Particles.pk2": 68_116_480,
    "Music.pk2": 35_569_664,
    "SRO_Client.exe": 9_383_936,
}
PART_SIZES = {
    "Data.pk2": [199_229_440] * 6 + [146_788_352],
    "Map.pk2": [199_229_440] * 3 + [24_170_496],
}
MAGIC = b"JoyMax File Manager!\n"


def verify(path: Path, name: str) -> bool:
    if not path.is_file() or path.stat().st_size != EXPECTED[name]:
        return False
    with path.open("rb") as stream:
        start = stream.read(len(MAGIC))
    return start.startswith(b"MZ") if name.endswith(".exe") else start == MAGIC


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def download(gdown, file_id: str, destination: Path, expected: int | None = None) -> None:
    if not isinstance(file_id, str) or len(file_id) < 10 or "/" in file_id:
        raise ValueError("Invalid Google Drive file ID in private manifest")
    destination.parent.mkdir(parents=True, exist_ok=True)
    result = gdown.download(id=file_id, output=str(destination), quiet=False,
                            use_cookies=False, resume=True)
    if not result or not destination.is_file():
        raise RuntimeError("Drive download failed; check sharing permissions or download quota")
    if expected is not None and destination.stat().st_size != expected:
        raise RuntimeError(
            f"Wrong download size for {destination.name}: "
            f"{destination.stat().st_size} != {expected} (possibly an HTML error page)"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        import gdown
    except ImportError as exc:
        raise SystemExit("Install: python3 -m pip install gdown==5.2.0") from exc

    cfg = json.loads(args.manifest.read_text(encoding="utf-8"))
    if set(cfg) != set(EXPECTED):
        raise SystemExit(f"Private manifest must have exactly: {', '.join(EXPECTED)}")
    out = args.output.expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    report = {}

    for name in EXPECTED:
        target = out / name
        if verify(target, name):
            print(f"[OK] Existing valid {name}", flush=True)
            report[name] = {"bytes": EXPECTED[name], "sha256": digest(target)}
            continue
        if target.exists():
            raise SystemExit(f"Refusing to overwrite existing invalid file: {target}")

        entry = cfg[name]
        if not isinstance(entry, dict) or (("single" in entry) == ("parts" in entry)):
            raise SystemExit(f"{name}: specify exactly one of single or parts")

        stage = out / (name + ".building")
        if "single" in entry:
            download(gdown, entry["single"], stage, EXPECTED[name])
        else:
            ids = entry["parts"]
            sizes = PART_SIZES.get(name)
            if not sizes or not isinstance(ids, list) or len(ids) != len(sizes):
                raise SystemExit(f"{name}: expected {len(sizes) if sizes else 0} ordered parts")
            # Stream one part at a time to avoid duplicating gigabytes of disk.
            with stage.open("wb") as combined:
                for index, (part_id, part_size) in enumerate(zip(ids, sizes), 1):
                    chunk = out / (name + f".chunk{index:03}.downloading")
                    if chunk.exists() and chunk.stat().st_size != part_size:
                        chunk.unlink()
                    if not chunk.exists():
                        download(gdown, part_id, chunk, part_size)
                    elif chunk.stat().st_size != part_size:
                        raise RuntimeError(f"Bad size for {chunk}")
                    with chunk.open("rb") as stream:
                        shutil.copyfileobj(stream, combined, length=4 * 1024 * 1024)
                    chunk.unlink()
                combined.flush()
                os.fsync(combined.fileno())

        if not verify(stage, name):
            raise RuntimeError(f"{name}: wrong size or invalid PK2/EXE header")
        stage.replace(target)
        report[name] = {"bytes": EXPECTED[name], "sha256": digest(target)}
        print(f"[VERIFIED] {name} ({EXPECTED[name]:,} bytes)", flush=True)

    path = out / "hieusro-drive-verification.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"All six required retail inputs verified. Report: {path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"BUILD INPUT ERROR: {error}", file=sys.stderr)
        sys.exit(1)
