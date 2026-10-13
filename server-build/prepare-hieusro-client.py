#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: prepare-hieusro-client.py <index.html>")

index = Path(sys.argv[1])
text = index.read_text(encoding="utf-8")

scripts = (
    '<script src="/hieusro-mobile-runtime.js"></script>'
    '<script src="/hieusro-language.js"></script>'
)

if "hieusro-mobile-runtime.js" not in text:
    anchor = "<head>"
    if anchor not in text:
        raise SystemExit("client index has no <head> anchor")
    text = text.replace(anchor, anchor + scripts, 1)

index.write_text(text, encoding="utf-8")
print("Prepared HieuSRO client index with mobile diagnostics and language switch")
