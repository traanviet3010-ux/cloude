#!/usr/bin/env python3
"""Publish verified UI members from the existing full Render TEST pack CDN.

Only extracts selected UI groups to the LOCAL Mobile Lite Nginx docroot.
Never touches LIVE, backend APIs, characters, server lists, or databases.
No whole pack is retained in a running browser. Python 3 stdlib only.
"""
import gzip
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen

BASE="https://hieusro-assets-cdn-test-20261020.onrender.com"
GROUPS={"native-ui","game-images","ui-icons"}
PACK_INDEX="/assets/packs/manifest.json"
MAX_PACK=96*1024*1024
MAX_MEMBER=32*1024*1024
ROOT=Path(os.environ.get("HIEUSRO_UI_PUBLISH_ROOT","/opt/opensro/apps/client-next/temp/artifacts/dist"))
HEX=re.compile(r"[0-9a-f]{64}\Z")
def fail(reason):raise RuntimeError(reason)
def fetch(path,expected):
    if not path.startswith("/assets/packs/") or ".." in path or "\\" in path or "?" in path:
        fail("Unsafe CDN pack URL: "+path)
    for attempt in range(4):
        try:
            req=Request(BASE+path,headers={"Accept-Encoding":"identity","User-Agent":"HieuSRO-Verified-UI/1.0"})
            with urlopen(req,timeout=80) as response:
                if response.status!=200 or response.headers.get("Content-Encoding","identity")!="identity":
                    fail("Unexpected transport response")
                payload=response.read(expected+1)
            if len(payload)!=expected:fail(f"Wrong CDN byte count for {path}: {len(payload)} vs {expected}")
            return payload
        except Exception:
            if attempt==3:raise
            time.sleep(min(2**attempt,8))
def safe_path(path):
    if not isinstance(path,str) or not path.startswith("/assets/") or len(path)>1024:
        fail("Unexpected UI member path")
    if "%" in path or "\\" in path or "\0" in path or "//" in path:
        fail("Unsafe UI path characters")
    seg=path.split("/")[1:]
    if any(not part or part in (".","..") for part in seg):fail("Unsafe UI path segments")
    return path
def sha(payload):return hashlib.sha256(payload).hexdigest()
def main():
    # Manifest is small; a pack download is capped to avoid unbounded build RAM.
    req=Request(BASE+PACK_INDEX,headers={"Accept-Encoding":"identity"})
    with urlopen(req,timeout=70) as response:
        raw=response.read(16*1024*1024+1)
    if len(raw)>16*1024*1024:fail("Unexpectedly large manifest")
    catalog=json.loads(raw)
    groups=catalog.get("groups",[])
    assets=catalog.get("assets",[])
    if len(groups)!=17 or sum(len(g["packs"]) for g in groups)!=213 or len(assets)!=36843:
        fail("CDN manifest version/count drift")
    owned={g["name"]:g for g in groups if g["name"] in GROUPS}
    if owned.keys()!=GROUPS:fail("Required UI groups missing")
    bypack={}
    for entry in assets:
        if entry.get("group") in GROUPS:
            path=safe_path(entry["path"])
            # OpenSRO member paths preserve original mixed case; the manifest lookup is case-insensitive.
            if entry["length"]>MAX_MEMBER:fail("Oversized UI member")
            bypack.setdefault(entry["packPath"],[]).append(entry)
    output_count=0;output_bytes=0;download_bytes=0
    ROOT.mkdir(parents=True,exist_ok=True)
    for group in groups:
        if group["name"] not in GROUPS:continue
        for desc in group["packs"]:
            name=desc["path"];size=desc["bytes"];digest=desc["sha256"]
            if not isinstance(digest,str) or not HEX.fullmatch(digest) or size>MAX_PACK:
                fail("Invalid UI pack descriptor")
            blob=fetch(name,size)
            if sha(blob)!=digest:fail("Pack SHA-256 mismatch: "+name)
            if blob[:8]!=b"SROPACK2":fail("Not a SROPACK2 pack")
            header_len=int.from_bytes(blob[8:12],"little")
            if not 1<=header_len<=16*1024*1024 or 12+header_len>len(blob):
                fail("Invalid pack header size")
            metadata=json.loads(blob[12:12+header_len])
            if metadata.get("format")!="sro-asset-pack" or metadata.get("version")!=2:
                fail("Unexpected pack format")
            source={row["path"]:row for row in metadata["files"]}
            data_offset=12+header_len
            selected=bypack.get(name,[])
            if len(selected)!=desc["assetCount"] or len(source)!=len(selected):
                fail("Pack member count mismatch")
            for item in selected:
                p=safe_path(item["path"])
                stored=item.get("stored")
                span=stored["length"] if stored else item["length"]
                start=data_offset+item["offset"];stop=start+span
                if start<data_offset or stop>len(blob):fail("Invalid UI member offset")
                indexed=source.get(p)
                if not indexed or any(indexed.get(k)!=item.get(k) for k in ("offset","length","sha256")):
                    fail("Pack index/manifest disagreement")
                member=blob[start:stop]
                if stored:
                    if stored.get("encoding")!="gzip":fail("Unsupported stored member encoding")
                    member=gzip.decompress(member)
                if len(member)!=item["length"] or sha(member)!=item["sha256"]:
                    fail("UI member checksum mismatch: "+p)
                dest=ROOT/p.lstrip("/")
                if not dest.is_file():
                    dest.parent.mkdir(parents=True,exist_ok=True)
                    dest.write_bytes(member)
                    output_count+=1;output_bytes+=len(member)
            download_bytes+=len(blob)
            print(f"UI_PACK_VERIFIED={name} members={len(selected)}",flush=True)
    # Original OpenSRO UI CSS uses /assets/images/Media_extracted/ case, but
    # its manifest normalizes filenames to lowercase. Match the public URL
    # without forwarding a failing request to the Preview TEST backend.
    folder=ROOT/"assets/images"
    target=folder/"media_extracted"
    alias=folder/"Media_extracted"
    if target.is_dir() and not alias.exists():
        alias.symlink_to("media_extracted",target_is_directory=True)
    elif alias.is_dir() and not target.exists():
        target.symlink_to("Media_extracted",target_is_directory=True)
    print(f"LOCAL_UI_READY=1 FILES={output_count} BYTES={output_bytes} PACK_DOWNLOAD_BYTES={download_bytes}",flush=True)
if __name__=="__main__":
    try:main()
    except Exception as exc:
        print(f"LOCAL_UI_BUILD_FAILED={exc}",file=sys.stderr,flush=True)
        raise
