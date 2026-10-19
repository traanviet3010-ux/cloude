#!/usr/bin/env python3
"""Publish real skill PNGs generated from the same 1.150 Media.pk2 as the browser.

Vite intentionally does not copy OpenSRO's multi-GB client-public resource tree.
Without this packaging lane /assets/images/Media_extracted/icon/skill/* falls
through to an unrelated external asset host (and responds 404).
This copies *only* the skill icon subtree to the bundled TEST client.
"""
from pathlib import Path
import shutil
import sys

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
CHECK_ICON = Path("china/sword_smash_a.png")


def publish(source: Path, destination: Path) -> tuple[int, int]:
    if not source.is_dir():
        raise SystemExit(f"Cannot publish native skill icons: no converted Media.pk2 directory: {source}")
    selected: dict[str, Path] = {}
    for original in sorted(source.rglob("*")):
        if not original.is_file() or original.suffix.lower() != ".png":
            continue
        rel = original.relative_to(source)
        if any(part in (".", "..") for part in rel.parts):
            raise SystemExit("Invalid converted icon path: " + str(rel))
        normalized = "/".join(part.lower() for part in rel.parts)
        # Converter disambiguates collisions with *.ddj.png. Browser still
        # requests iconPath(name.ddj) => name.png. Prefer plain file when both.
        if normalized.endswith(".ddj.png"):
            normalized = normalized[:-8] + ".png"
        if normalized not in selected or not original.name.lower().endswith(".ddj.png"):
            selected[normalized] = original
    if len(selected) < 50:
        raise SystemExit(f"Only {len(selected)} skill icons found. Refusing a broken game build.")
    total = 0
    for rel, original in sorted(selected.items()):
        target = destination.joinpath(*rel.split("/"))
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(original, target)
        data = target.read_bytes()
        if not data.startswith(PNG_SIGNATURE):
            raise SystemExit(f"Invalid native PNG: {target}")
        total += len(data)
    expected = destination / CHECK_ICON
    if not expected.is_file() or not expected.read_bytes().startswith(PNG_SIGNATURE):
        raise SystemExit(f"Required original Silkroad skill icon missing: {expected}")
    print(f"Native Media.pk2 skill icons embedded locally: {len(selected)} icons, {total} bytes, sample {CHECK_ICON}")
    return len(selected), total


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: package-native-skill-icons.py <converted skill folder> <client public skill folder>")
    publish(Path(sys.argv[1]), Path(sys.argv[2]))
