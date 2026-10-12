import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path('/opt/hieusro')
ARTIFACT = ROOT / 'server.srogz'
COMMIT_FILE = ROOT / 'opensro-commit.txt'


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


class Handler(BaseHTTPRequestHandler):
    def _reply(self, status: int, payload: dict):
        data = json.dumps(payload, ensure_ascii=False, indent=2).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path not in ('/', '/healthz', '/build-info'):
            self._reply(404, {'ok': False, 'error': 'not_found'})
            return
        ok = ARTIFACT.is_file() and ARTIFACT.stat().st_size > 0
        self._reply(200 if ok else 503, {
            'ok': ok,
            'service': 'HieuSRO OpenSRO v1.150 build verifier',
            'opensro_commit': COMMIT_FILE.read_text().strip() if COMMIT_FILE.exists() else None,
            'server_srogz_bytes': ARTIFACT.stat().st_size if ok else 0,
            'server_srogz_sha256': sha256(ARTIFACT) if ok else None,
            'agent_binary': (ROOT / 'sro-agent').is_file(),
            'gameworld_binary': (ROOT / 'sro-gameworld').is_file(),
        })

    def log_message(self, fmt, *args):
        print('[http]', fmt % args, flush=True)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '10000'))
    print(f'HieuSRO build verifier listening on :{port}', flush=True)
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
