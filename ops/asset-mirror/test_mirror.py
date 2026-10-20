#!/usr/bin/env python3
"""Offline/local HTTP tests for the HieuSRO asset mirror (never touches LIVE)."""
import hashlib
import json
import struct
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import mirror


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fixture():
    member = b"verified SROPACK2 example"
    index = {"format": "sro-asset-pack", "version": 2,
             "files": [{"path": "/assets/data.bin", "offset": 0,
                        "length": len(member), "sha256": digest(member)}]}
    header = json.dumps(index, separators=(",", ":")).encode()
    pack_bytes = b"SROPACK2" + struct.pack("<I", len(header)) + header + member
    name = f"game-data-001-{digest(pack_bytes)[:12]}.bin"
    path = f"/assets/packs/{name}"
    manifest = {
        "format": "sro-asset-pack-index", "version": 2,
        "assetSchema": 4, "generatedAt": "test",
        "groups": [{"name": "game-data", "packs": [{
            "path": path, "bytes": len(pack_bytes),
            "sha256": digest(pack_bytes), "assetCount": 1}]}],
        "assets": [{"path": "/assets/data.bin", "group": "game-data",
                    "packPath": path, "offset": 0, "length": len(member),
                    "sha256": digest(member)}]
    }
    return pack_bytes, path, json.dumps(manifest, separators=(",", ":")).encode()


class TestMirror(unittest.TestCase):
    def test_reject_traversal(self):
        for path in ["/assets/packs/../evil.bin", "/assets/packs/x/../../evil.bin",
                     "https://evil.invalid/p.bin", "/assets/packs/a%2fb.bin"]:
            with self.subTest(path=path):
                with self.assertRaises(mirror.MirrorError):
                    mirror.valid_path(path)

    def test_reject_bad_membership(self):
        _, _, raw = fixture()
        broken = json.loads(raw)
        broken["groups"][0]["packs"][0]["assetCount"] = 2
        with self.assertRaisesRegex(mirror.MirrorError, "assetCount"):
            mirror.inspect_manifest(json.dumps(broken).encode(), 1, 1, 1)

    def test_reject_modified_pack(self):
        content, path, raw = fixture()
        _, packs = mirror.inspect_manifest(raw, 1, 1, 1)
        with tempfile.TemporaryDirectory() as temp:
            pack_file = Path(temp) / Path(path).name
            pack_file.write_bytes(content[:-1] + b"x")
            with self.assertRaisesRegex(mirror.MirrorError, "SHA-256"):
                mirror.inspect_pack(pack_file, packs[0])

    def test_local_download_resume_and_repair(self):
        packed, path, raw = fixture()
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                if self.path == mirror.INDEX:
                    response = raw
                    code = 200
                    extra = None
                elif self.path == path:
                    start = 0
                    range_value = self.headers.get("Range")
                    if range_value:
                        requests.append(range_value)
                        start = int(range_value.split("=")[1].split("-")[0])
                        extra = f"bytes {start}-{len(packed)-1}/{len(packed)}"
                        code = 206
                    else:
                        requests.append("full")
                        extra = None
                        code = 200
                    response = packed[start:]
                else:
                    self.send_error(404)
                    return
                self.send_response(code)
                self.send_header("Content-Length", str(len(response)))
                if extra:
                    self.send_header("Content-Range", extra)
                self.end_headers()
                self.wfile.write(response)
        http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server_thread = threading.Thread(target=http.serve_forever, daemon=True)
        server_thread.start()
        try:
            origin = f"http://127.0.0.1:{http.server_port}"
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                release = root / "releases" / digest(raw)
                dest = release / path.lstrip("/")
                dest.parent.mkdir(parents=True)
                dest.with_name(dest.name + ".part").write_bytes(packed[:20])
                first = mirror.mirror(origin, root, 1, 1, 1, 1)
                self.assertEqual(first["downloaded"], 1)
                self.assertEqual(dest.read_bytes(), packed)
                self.assertEqual(requests[-1], "bytes=20-")
                self.assertTrue((release / "MIRROR_VERIFIED").is_file())
                second = mirror.mirror(origin, root, 1, 1, 1, 1)
                self.assertEqual(second["reused"], 1)
                dest.write_bytes(b"broken")
                third = mirror.mirror(origin, root, 1, 1, 1, 1)
                self.assertEqual(third["downloaded"], 1)
                self.assertEqual(dest.read_bytes(), packed)
                self.assertFalse(third["production_switched"])
        finally:
            http.shutdown()
            http.server_close()
            server_thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
