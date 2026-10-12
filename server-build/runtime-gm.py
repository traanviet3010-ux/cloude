#!/usr/bin/env python3
import hmac
import json
import os
import pathlib
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

ROOT = pathlib.Path('/opt/hieusro/server')
STATE_ROOT = pathlib.Path(os.environ.get('SRO_STATE_ROOT', str(ROOT / '.state')))
SETTINGS_PATH = STATE_ROOT / 'gm-settings.json'
PROVISION_TOKEN_PATH = STATE_ROOT / 'cluster' / 'agent-provisioning-token'
GAMEWORLD = ROOT / 'gameworld'
SRO_NOMAD = ROOT / 'sro-nomad'
CATALOG = ROOT / 'config' / 'shards.json'
AGENT_URL = 'http://127.0.0.1:8787'
PROVISION_URL = 'http://127.0.0.1:8789'
GAME_READY_URL = 'http://127.0.0.1:8788/transport/readyz'
CONTROL_ADDR = ('127.0.0.1', 8793)
GM_TOKEN = os.environ.get('HIEUSRO_GM_CONTROL_TOKEN', '').strip()

DEFAULTS = {
    'expRate': 1,
    'skillExpRate': 1,
    'dropRate': 1,
    'goldRate': 1,
    'rareRate': 1,
    'dropCap': 0,
    'betaGrowth': False,
}
LIMITS = {
    'expRate': (1, 1000),
    'skillExpRate': (1, 10000),
    'dropRate': (1, 100),
    'goldRate': (1, 10000),
    'rareRate': (1, 1000),
    'dropCap': (0, 1000),
}

lock = threading.RLock()
world = None
world_started_at = None
restart_count = 0
last_error = ''
stopping = False
settings = dict(DEFAULTS)


def load_settings():
    global settings
    try:
        raw = json.loads(SETTINGS_PATH.read_text(encoding='utf-8'))
        settings = validate_settings(raw)
    except FileNotFoundError:
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        save_settings(DEFAULTS)
        settings = dict(DEFAULTS)
    except Exception as exc:
        print(f'GM settings invalid, using defaults: {exc}', flush=True)
        settings = dict(DEFAULTS)


def save_settings(value):
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_PATH.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(tmp, SETTINGS_PATH)


def validate_settings(value):
    if not isinstance(value, dict):
        raise ValueError('settings must be an object')
    out = {}
    for key, (lo, hi) in LIMITS.items():
        raw = value.get(key, DEFAULTS[key])
        if isinstance(raw, bool) or not isinstance(raw, int) or not (lo <= raw <= hi):
            raise ValueError(f'{key} must be an integer from {lo} to {hi}')
        out[key] = raw
    beta = value.get('betaGrowth', DEFAULTS['betaGrowth'])
    if not isinstance(beta, bool):
        raise ValueError('betaGrowth must be boolean')
    out['betaGrowth'] = beta
    return out


def world_env():
    env = os.environ.copy()
    with lock:
        current = dict(settings)
    env.update({
        'SRO_HIEUSRO_EXP_RATE': str(current['expRate']),
        'SRO_BETA_SKILL_EXP_RATE': str(current['skillExpRate']),
        'SRO_BETA_DROP_RATE': str(current['dropRate']),
        'SRO_BETA_GOLD_RATE': str(current['goldRate']),
        'SRO_BETA_RARE_RATE': str(current['rareRate']),
        'SRO_BETA_DROP_CAP': str(current['dropCap']),
        'SRO_BETA_GROWTH': 'on' if current['betaGrowth'] else 'off',
    })
    return env


def start_world():
    global world, world_started_at, last_error
    with lock:
        if world is not None and world.poll() is None:
            return
        print('GM supervisor: starting GameWorld with settings ' + json.dumps(settings, separators=(',', ':')), flush=True)
        world = subprocess.Popen([str(GAMEWORLD)], env=world_env())
        world_started_at = time.time()
        last_error = ''


def stop_world(timeout=25):
    global world
    with lock:
        proc = world
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=10)


def restart_world_async():
    def worker():
        global restart_count, last_error
        try:
            stop_world()
            time.sleep(2)
            with lock:
                restart_count += 1
            start_world()
        except Exception as exc:
            with lock:
                last_error = str(exc)
            print(f'GM supervisor restart failed: {exc}', flush=True)
    threading.Thread(target=worker, name='gm-world-restart', daemon=True).start()


def monitor_world():
    global last_error
    while not stopping:
        with lock:
            proc = world
        if proc is None:
            time.sleep(1)
            continue
        code = proc.poll()
        if code is None:
            time.sleep(2)
            continue
        if stopping:
            return
        with lock:
            last_error = f'GameWorld exited with code {code}'
        print(f'GM supervisor: GameWorld exited code={code}; restarting in 3s', flush=True)
        time.sleep(3)
        if not stopping:
            try:
                start_world()
            except Exception as exc:
                with lock:
                    last_error = str(exc)
                time.sleep(5)


def request_json(url, method='GET', body=None, headers=None, timeout=8):
    data = None if body is None else json.dumps(body).encode('utf-8')
    h = {'Accept': 'application/json'}
    if data is not None:
        h['Content-Type'] = 'application/json'
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read(65536)
            parsed = json.loads(raw.decode('utf-8')) if raw else None
            return response.status, parsed
    except urllib.error.HTTPError as exc:
        raw = exc.read(65536)
        try:
            parsed = json.loads(raw.decode('utf-8')) if raw else None
        except Exception:
            parsed = {'message': raw.decode('utf-8', errors='replace')}
        return exc.code, parsed


def game_ready():
    try:
        req = urllib.request.Request(GAME_READY_URL, method='GET')
        with urllib.request.urlopen(req, timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def shard_status():
    try:
        status, body = request_json(AGENT_URL + '/title/servers', headers={'X-OpenSRO-Protocol': '6'}, timeout=3)
        if status == 200 and isinstance(body, list):
            for row in body:
                if row.get('id') == 'global-official':
                    return row
    except Exception:
        pass
    return {'id': 'global-official', 'name': 'HieuSRO', 'onlinePlayers': 0, 'capacity': 200, 'operating': False}


def provision_request(path, method='GET', body=None):
    token = PROVISION_TOKEN_PATH.read_text(encoding='utf-8').strip()
    return request_json(PROVISION_URL + path, method=method, body=body, headers={'Authorization': 'Bearer ' + token}, timeout=10)


def utf16_units(text):
    return len(text.encode('utf-16-le')) // 2


def publish_notice(message):
    message = str(message or '').strip()
    if not message or utf16_units(message) > 100:
        raise ValueError('Thông báo phải từ 1 đến 100 ký tự UTF-16.')
    if any(ord(ch) < 32 and ch not in '\t' for ch in message):
        raise ValueError('Thông báo chứa ký tự không hợp lệ.')
    result = subprocess.run([
        str(SRO_NOMAD), 'notice',
        '-state-dir', str(STATE_ROOT / 'cluster'),
        '-catalog', str(CATALOG),
        '-message', message,
    ], text=True, capture_output=True, timeout=15)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or 'notice failed').strip())
    return (result.stdout or '').strip()


class Handler(BaseHTTPRequestHandler):
    server_version = 'HieuSRO-GM-Control/1.0'

    def log_message(self, fmt, *args):
        print('[gm-control] ' + (fmt % args), flush=True)

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
        if path == '/v1/status':
            with lock:
                proc = world
                current = dict(settings)
                error = last_error
                starts = world_started_at
                restarts = restart_count
            shard = shard_status()
            return self._json(200, {
                'ok': True,
                'server': 'HieuSRO',
                'agentReady': True,
                'gameReady': game_ready(),
                'gamePid': proc.pid if proc and proc.poll() is None else None,
                'gameStartedAt': starts,
                'restartCount': restarts,
                'lastError': error,
                'onlinePlayers': int(shard.get('onlinePlayers') or 0),
                'capacity': int(shard.get('capacity') or 0),
                'operating': bool(shard.get('operating')),
                'settings': current,
            })
        if path == '/v1/settings':
            with lock:
                return self._json(200, {'ok': True, 'settings': dict(settings), 'gameReady': game_ready()})
        if path.startswith('/v1/accounts/'):
            account_id = unquote(path[len('/v1/accounts/'):])
            if '/' in account_id or not account_id:
                return self._json(400, {'ok': False, 'message': 'Tài khoản không hợp lệ.'})
            status, body = provision_request('/v1/accounts/' + urllib.parse.quote(account_id, safe=''))
            return self._json(status, body or {'ok': status < 400})
        return self._json(404, {'ok': False, 'code': 'NOT_FOUND'})

    def do_PUT(self):
        global settings
        if not self._guard():
            return
        path = urlparse(self.path).path
        try:
            body = self._body()
            if path == '/v1/settings':
                candidate = validate_settings(body)
                with lock:
                    changed = candidate != settings
                    settings = candidate
                    save_settings(settings)
                if changed:
                    restart_world_async()
                return self._json(200, {'ok': True, 'settings': candidate, 'restarting': changed})
            prefix = '/v1/accounts/'
            if path.startswith(prefix) and path.endswith('/disabled'):
                account_id = unquote(path[len(prefix):-len('/disabled')].rstrip('/'))
                if not isinstance(body.get('disabled'), bool):
                    return self._json(400, {'ok': False, 'message': 'disabled phải là true/false.'})
                status, result = provision_request('/v1/accounts/' + urllib.parse.quote(account_id, safe='') + '/disabled', 'PUT', {'disabled': body['disabled']})
                return self._json(status, result or {'ok': status < 400})
            if path.startswith(prefix) and path.endswith('/password'):
                account_id = unquote(path[len(prefix):-len('/password')].rstrip('/'))
                password = body.get('password')
                if not isinstance(password, str) or not (8 <= len(password.encode('utf-8')) <= 72):
                    return self._json(400, {'ok': False, 'message': 'Mật khẩu phải từ 8 đến 72 byte.'})
                status, result = provision_request('/v1/accounts/' + urllib.parse.quote(account_id, safe='') + '/password', 'PUT', {'password': password})
                return self._json(status, result or {'ok': status < 400})
        except ValueError as exc:
            return self._json(400, {'ok': False, 'message': str(exc)})
        except Exception as exc:
            return self._json(503, {'ok': False, 'message': str(exc)})
        return self._json(404, {'ok': False, 'code': 'NOT_FOUND'})

    def do_POST(self):
        if not self._guard():
            return
        path = urlparse(self.path).path
        try:
            body = self._body()
            if path == '/v1/notice':
                detail = publish_notice(body.get('message'))
                return self._json(200, {'ok': True, 'message': 'Đã phát thông báo toàn server.', 'detail': detail})
        except ValueError as exc:
            return self._json(400, {'ok': False, 'message': str(exc)})
        except Exception as exc:
            return self._json(503, {'ok': False, 'message': str(exc)})
        return self._json(404, {'ok': False, 'code': 'NOT_FOUND'})


def shutdown(signum=None, frame=None):
    global stopping
    stopping = True
    print('GM supervisor shutting down', flush=True)
    stop_world(timeout=15)


def main():
    if len(GM_TOKEN.encode('utf-8')) < 32:
        raise SystemExit('HIEUSRO_GM_CONTROL_TOKEN must be at least 32 bytes')
    load_settings()
    start_world()
    threading.Thread(target=monitor_world, name='gm-world-monitor', daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    server = ThreadingHTTPServer(CONTROL_ADDR, Handler)
    server.daemon_threads = True
    print(f'GM control listening on http://{CONTROL_ADDR[0]}:{CONTROL_ADDR[1]}', flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        shutdown()


if __name__ == '__main__':
    main()
