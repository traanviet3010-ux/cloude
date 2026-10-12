#!/usr/bin/env python3
import hmac
import json
import os
import pathlib
import signal
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = pathlib.Path('/opt/hieusro')
STATE_ROOT = pathlib.Path(os.environ.get('SRO_STATE_ROOT', '/opt/hieusro/server/.state'))
VERSION_ROOT = ROOT / 'versions'
MANIFEST_PATH = VERSION_ROOT / 'manifest.json'
ACTIVE_I18N = ROOT / 'i18n'
STATE_PATH = STATE_ROOT / 'active-runtime-version.json'
GM_URL = 'http://127.0.0.1:8793'
GAME_READY_URL = 'http://127.0.0.1:8788/transport/readyz'
CONTROL_ADDR = ('127.0.0.1', 8794)
GM_TOKEN = os.environ.get('HIEUSRO_GM_CONTROL_TOKEN', '').strip()

lock = threading.RLock()
active_job = None


def request_json(url, method='GET', body=None, timeout=8):
    data = None if body is None else json.dumps(body).encode('utf-8')
    headers = {'Accept': 'application/json', 'Authorization': 'Bearer ' + GM_TOKEN}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read(131072)
            return response.status, json.loads(raw.decode('utf-8')) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read(131072)
        try:
            parsed = json.loads(raw.decode('utf-8')) if raw else None
        except Exception:
            parsed = {'message': raw.decode('utf-8', errors='replace')}
        return exc.code, parsed


def game_ready():
    try:
        with urllib.request.urlopen(urllib.request.Request(GAME_READY_URL, method='GET'), timeout=3) as response:
            return response.status == 200
    except Exception:
        return False


def load_manifest():
    value = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
    rows = value.get('versions')
    if not isinstance(rows, list) or not rows:
        raise RuntimeError('runtime version manifest is empty')
    return value


MANIFEST = load_manifest()
VERSIONS = {row['id']: row for row in MANIFEST['versions']}
DEFAULT_VERSION = MANIFEST['defaultVersion']


def read_active_version():
    try:
        value = json.loads(STATE_PATH.read_text(encoding='utf-8'))
        version_id = str(value.get('version') or '')
        if version_id in VERSIONS and VERSIONS[version_id].get('rollbackSupported'):
            return version_id
    except Exception:
        pass
    return DEFAULT_VERSION


def persist_active_version(version_id):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix('.tmp')
    tmp.write_text(json.dumps({'version': version_id, 'updatedAt': time.time()}, separators=(',', ':')) + '\n', encoding='utf-8')
    os.replace(tmp, STATE_PATH)


def snapshot_path(version_id):
    row = VERSIONS[version_id]
    snap = str(row.get('snapshot') or '')
    path = VERSION_ROOT / snap / 'i18n'
    if not snap or not path.is_dir():
        raise RuntimeError(f'snapshot missing for {version_id}')
    return path


def activate(version_id):
    target = snapshot_path(version_id)
    temp_link = ROOT / '.i18n-next'
    try:
        temp_link.unlink()
    except FileNotFoundError:
        pass
    os.symlink(str(target), str(temp_link))
    os.replace(temp_link, ACTIVE_I18N)
    persist_active_version(version_id)


def ensure_active_link():
    version_id = read_active_version()
    try:
        activate(version_id)
    except Exception:
        if version_id != DEFAULT_VERSION:
            activate(DEFAULT_VERSION)
            return DEFAULT_VERSION
        raise
    return version_id


def gm_status():
    status, body = request_json(GM_URL + '/v1/status', timeout=5)
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError('GM supervisor status unavailable')
    return body


def restart_gameworld():
    state = gm_status()
    pid = state.get('gamePid')
    if not isinstance(pid, int) or pid <= 1:
        raise RuntimeError('GameWorld PID unavailable')
    os.kill(pid, signal.SIGTERM)


def wait_ready(timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if game_ready():
            return True
        time.sleep(2)
    return False


def public_job():
    with lock:
        return None if active_job is None else dict(active_job)


def set_job(**fields):
    global active_job
    with lock:
        if active_job is None:
            active_job = {}
        active_job.update(fields)
        active_job['updatedAt'] = time.time()


def rollback_worker(target_id, previous_id, forced):
    try:
        set_job(phase='switching')
        activate(target_id)
        set_job(phase='restarting')
        restart_gameworld()
        time.sleep(4)
        set_job(phase='health-check')
        if not wait_ready():
            raise RuntimeError('GameWorld did not become ready after rollback')
        set_job(phase='live')
    except Exception as exc:
        set_job(phase='failed', error=str(exc))
        try:
            set_job(phase='restoring')
            activate(previous_id)
            try:
                restart_gameworld()
            except Exception:
                pass
            if not wait_ready():
                raise RuntimeError('previous version restore did not become ready')
            set_job(phase='restored')
        except Exception as restore_exc:
            set_job(phase='restore-failed', restoreError=str(restore_exc))


def snapshot_payload():
    current = read_active_version()
    job = public_job()
    rows = []
    for row in MANIFEST['versions']:
        item = dict(row)
        item['current'] = row['id'] == current
        rows.append(item)
    return {
        'ok': True,
        'current': current,
        'rollbackEnabled': True,
        'controlMode': 'embedded-runtime-snapshots',
        'activeJob': job,
        'versions': rows,
        'policy': {
            'database': 'never-automatic',
            'gm': 'independent',
            'client': 'independent',
            'autoRestoreOnFailedHealthCheck': True,
            'externalApiKeyRequired': False,
        },
    }


class Handler(BaseHTTPRequestHandler):
    server_version = 'HieuSRO-Version-Control/1.0'

    def log_message(self, fmt, *args):
        print('[version-control] ' + (fmt % args), flush=True)

    def _authorized(self):
        auth = self.headers.get('Authorization', '')
        supplied = auth[7:] if auth.startswith('Bearer ') else ''
        return bool(GM_TOKEN) and hmac.compare_digest(supplied, GM_TOKEN)

    def _json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _body(self, limit=8192):
        length = int(self.headers.get('Content-Length', '0') or 0)
        if length < 0 or length > limit:
            raise ValueError('payload too large')
        raw = self.rfile.read(length)
        return json.loads(raw.decode('utf-8') or '{}')

    def _guard(self):
        if not self._authorized():
            self._json(401, {'ok': False, 'code': 'UNAUTHORIZED'})
            return False
        return True

    def do_GET(self):
        if not self._guard():
            return
        path = urlparse(self.path).path
        if path == '/v1/versions':
            return self._json(200, snapshot_payload())
        if path == '/v1/version-health':
            return self._json(200, {'ok': True, 'current': read_active_version(), 'gameReady': game_ready()})
        return self._json(404, {'ok': False, 'code': 'NOT_FOUND'})

    def do_POST(self):
        global active_job
        if not self._guard():
            return
        path = urlparse(self.path).path
        prefix = '/v1/versions/'
        suffix = '/rollback'
        if not (path.startswith(prefix) and path.endswith(suffix)):
            return self._json(404, {'ok': False, 'code': 'NOT_FOUND'})
        version_id = path[len(prefix):-len(suffix)].strip('/')
        row = VERSIONS.get(version_id)
        if not row:
            return self._json(404, {'ok': False, 'code': 'VERSION_NOT_FOUND', 'message': 'Không tìm thấy version.'})
        if not row.get('rollbackSupported'):
            return self._json(409, {
                'ok': False,
                'code': 'HOT_ROLLBACK_UNSUPPORTED',
                'message': row.get('unsupportedReason') or 'Version này cần full image deploy.'
            })
        current = read_active_version()
        if current == version_id:
            return self._json(409, {'ok': False, 'code': 'ALREADY_CURRENT', 'message': f'{version_id} đang chạy.'})
        try:
            body = self._body()
        except Exception as exc:
            return self._json(400, {'ok': False, 'message': str(exc)})
        forced = body.get('force') is True
        try:
            state = gm_status()
            online = int(state.get('onlinePlayers') or 0)
        except Exception:
            online = 0
        if online > 0 and not forced:
            return self._json(409, {
                'ok': False,
                'code': 'PLAYERS_ONLINE',
                'message': f'Đang có {online} người chơi online. Cần xác nhận rollback cưỡng bức.'
            })
        with lock:
            if active_job and active_job.get('phase') not in ('live', 'restored', 'failed', 'restore-failed'):
                return self._json(409, {'ok': False, 'code': 'ROLLBACK_BUSY', 'message': 'Đang có rollback khác chạy.'})
            active_job = {
                'id': f'rollback-{int(time.time() * 1000)}',
                'target': version_id,
                'previous': current,
                'phase': 'queued',
                'forced': forced,
                'onlinePlayers': online,
                'requestedAt': time.time(),
                'updatedAt': time.time(),
            }
            job = dict(active_job)
        threading.Thread(target=rollback_worker, args=(version_id, current, forced), daemon=True, name='version-rollback').start()
        return self._json(202, {'ok': True, 'job': job})


def main():
    if len(GM_TOKEN.encode('utf-8')) < 32:
        raise SystemExit('HIEUSRO_GM_CONTROL_TOKEN must be at least 32 bytes')
    active = ensure_active_link()
    print(f'Version control active={active} listening on http://{CONTROL_ADDR[0]}:{CONTROL_ADDR[1]}', flush=True)
    server = ThreadingHTTPServer(CONTROL_ADDR, Handler)
    server.daemon_threads = True
    server.serve_forever(poll_interval=0.5)


if __name__ == '__main__':
    main()
