#!/usr/bin/env python3
import hmac
import json
import os
import pathlib
import signal
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = pathlib.Path('/opt/hieusro/server')
STATE_ROOT = pathlib.Path(os.environ.get('SRO_STATE_ROOT', str(ROOT / '.state')))
SETTINGS_PATH = STATE_ROOT / 'gm-settings.json'
EVENT_PATH = STATE_ROOT / 'gm-event.json'
PROVISION_TOKEN_PATH = STATE_ROOT / 'cluster' / 'agent-provisioning-token'
AUTH_DB = STATE_ROOT / 'shards' / 'global-official' / 'authority' / 'state.db'
OPERATOR_TOKEN_PATH = STATE_ROOT / 'shards' / 'global-official' / 'authority' / 'operator-token'
GAMEWORLD = ROOT / 'gameworld'
SRO_NOMAD = ROOT / 'sro-nomad'
CATALOG = ROOT / 'config' / 'shards.json'
AGENT_URL = 'http://127.0.0.1:8787'
PROVISION_URL = 'http://127.0.0.1:8789'
GAME_READY_URL = 'http://127.0.0.1:8788/transport/readyz'
GAME_CONTROL_URL = 'http://127.0.0.1:8791'
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
event_state = {'active': False}


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


def ensure_operator_token():
    OPERATOR_TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    OPERATOR_TOKEN_PATH.write_text(GM_TOKEN + '\n', encoding='utf-8')
    OPERATOR_TOKEN_PATH.chmod(0o600)


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
    def worker_fn():
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
    threading.Thread(target=worker_fn, name='gm-world-restart', daemon=True).start()


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
            raw = response.read(1 << 20)
            parsed = json.loads(raw.decode('utf-8')) if raw else None
            return response.status, parsed
    except urllib.error.HTTPError as exc:
        raw = exc.read(1 << 20)
        try:
            parsed = json.loads(raw.decode('utf-8')) if raw else None
        except Exception:
            parsed = {'message': raw.decode('utf-8', errors='replace').strip()}
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


def game_control_request(path, method='GET', body=None):
    headers = {
        'Authorization': 'Bearer ' + GM_TOKEN,
        'X-SRO-Local-Diagnostics': '1',
    }
    return request_json(GAME_CONTROL_URL + path, method=method, body=body, headers=headers, timeout=12)


def operator_read(character=''):
    query = urllib.parse.urlencode({'character': character})
    return game_control_request('/internal/operations/player?' + query)


def operator_action(character, body):
    action = str(body.get('action') or '').strip()
    if action not in {'rescue', 'grant-items', 'clear-pk', 'grant-silk', 'reset-stats'}:
        raise ValueError('Thao tác nhân vật không được hỗ trợ.')
    reason = str(body.get('reason') or '').strip()
    if len(reason) < 5 or len(reason) > 500:
        raise ValueError('Lý do thao tác phải từ 5 đến 500 ký tự.')
    payload = {
        'id': uuid.uuid4().hex,
        'operator': 'web-gm-superadmin',
        'character': character,
        'action': action,
        'reason': reason,
    }
    if action == 'rescue':
        payload['town'] = int(body.get('town') or 0)
    elif action == 'grant-silk':
        amount = int(body.get('silk') or 0)
        if amount < 1 or amount > 1_000_000:
            raise ValueError('Silk mỗi lần phải từ 1 đến 1.000.000.')
        payload['silk'] = amount
    elif action == 'grant-items':
        rows = body.get('items')
        if not isinstance(rows, list) or not (1 <= len(rows) <= 32):
            raise ValueError('Danh sách vật phẩm phải có từ 1 đến 32 dòng.')
        clean = []
        for row in rows:
            codename = str((row or {}).get('codename') or '').strip().upper()
            count = int((row or {}).get('count') or 0)
            if not codename.startswith('ITEM_') or len(codename) > 128 or count < 1 or count > 65535:
                raise ValueError('CodeName hoặc số lượng vật phẩm không hợp lệ.')
            clean.append({'codename': codename, 'count': count})
        payload['items'] = clean
    return game_control_request('/internal/operations/player', 'POST', payload)


def open_authority():
    if not AUTH_DB.exists():
        raise FileNotFoundError('Authority database chưa sẵn sàng.')
    conn = sqlite3.connect(f'file:{AUTH_DB}?mode=ro', uri=True, timeout=3)
    conn.execute('PRAGMA query_only=ON')
    return conn


def search_characters(query):
    term = str(query or '').strip().lower()
    if not term:
        return []
    out = []
    with open_authority() as conn:
        for division, char_id, name_lower, record in conn.execute('SELECT division,id,name_lower,record FROM characters ORDER BY id DESC LIMIT 5000'):
            try:
                data = json.loads(record)
            except Exception:
                continue
            name = str(data.get('name') or name_lower or '')
            account = str(data.get('accountId') or '')
            if term not in name.lower() and term not in account.lower():
                continue
            world_data = data.get('world') or {}
            spawn = world_data.get('spawn') or {}
            out.append({
                'division': division,
                'id': char_id,
                'name': name,
                'accountId': account,
                'level': int(data.get('level') or 0),
                'gold': int(data.get('gold') or 0),
                'statPoints': int(data.get('statPoints') or 0),
                'lastLoginAtMs': int(data.get('lastLoginAtMs') or 0),
                'inventoryRows': len(data.get('missionInventory') or []),
                'regionId': spawn.get('regionId'),
            })
            if len(out) >= 20:
                break
    return out


def economy_snapshot():
    total_gold = 0
    total_chars = 0
    total_items = 0
    plus7 = plus9 = plus12 = 0
    richest = []
    serial_owners = {}
    suspicious_gold = []
    with open_authority() as conn:
        rows = conn.execute('SELECT division,id,record FROM characters').fetchall()
        total_chars = len(rows)
        for division, char_id, record in rows:
            try:
                data = json.loads(record)
            except Exception:
                continue
            name = str(data.get('name') or f'#{char_id}')
            gold = max(0, int(data.get('gold') or 0))
            total_gold += gold
            richest.append({'name': name, 'gold': gold, 'level': int(data.get('level') or 0)})
            if gold >= 1_000_000_000:
                suspicious_gold.append({'name': name, 'gold': gold})
            for item in data.get('missionInventory') or []:
                total_items += 1
                plus = int((item or {}).get('plus') or 0)
                plus7 += plus >= 7
                plus9 += plus >= 9
                plus12 += plus >= 12
                serial = str((item or {}).get('recordId') or '').strip()
                if serial and serial != '0':
                    serial_owners.setdefault(serial, []).append({'character': name, 'slot': (item or {}).get('slot'), 'codename': (item or {}).get('codename')})
        total_silk = total_gift_silk = 0
        try:
            for silk, gift in conn.execute('SELECT silk,gift_silk FROM mall_accounts'):
                total_silk += int(silk or 0)
                total_gift_silk += int(gift or 0)
        except sqlite3.Error:
            pass
    duplicates = [{'recordId': key, 'owners': value} for key, value in serial_owners.items() if len(value) > 1][:20]
    richest.sort(key=lambda row: row['gold'], reverse=True)
    suspicious_gold.sort(key=lambda row: row['gold'], reverse=True)
    risk = min(100, len(duplicates) * 25 + len(suspicious_gold) * 5)
    return {
        'ok': True,
        'capturedAt': time.time(),
        'totalCharacters': total_chars,
        'totalGold': total_gold,
        'totalSilk': total_silk,
        'totalGiftSilk': total_gift_silk,
        'inventoryRows': total_items,
        'plus7': plus7,
        'plus9': plus9,
        'plus12': plus12,
        'richest': richest[:10],
        'duplicateItems': duplicates,
        'largeGoldCharacters': suspicious_gold[:20],
        'riskScore': risk,
        'databaseBytes': AUTH_DB.stat().st_size if AUTH_DB.exists() else 0,
    }


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


def current_event():
    with lock:
        row = dict(event_state)
    if row.get('active') and row.get('endsAt', 0) <= time.time():
        return dict(row, active=False)
    return row


def _restore_event(event_id, automatic=False):
    global settings, event_state
    with lock:
        if not event_state.get('active') or event_state.get('id') != event_id:
            return False
        previous = validate_settings(event_state.get('previous') or DEFAULTS)
        label = event_state.get('label') or 'Sự kiện'
        event_state = dict(event_state, active=False, endedAt=time.time(), automatic=automatic)
        settings = previous
        save_settings(settings)
    try:
        publish_notice(f'{label} đã kết thúc. Tỷ lệ server trở về bình thường.')
    except Exception as exc:
        print(f'event end notice failed: {exc}', flush=True)
    restart_world_async()
    return True


def _event_timer(event_id, ends_at):
    delay = max(0, ends_at - time.time())
    time.sleep(delay)
    if not stopping:
        _restore_event(event_id, True)


def start_event(body):
    global settings, event_state
    duration = int(body.get('durationMinutes') or 0)
    if duration < 5 or duration > 240:
        raise ValueError('Thời lượng sự kiện phải từ 5 đến 240 phút.')
    with lock:
        if event_state.get('active') and event_state.get('endsAt', 0) > time.time():
            raise ValueError('Đang có một sự kiện tỷ lệ hoạt động.')
        previous = dict(settings)
        candidate = dict(settings)
        for key in ('expRate', 'skillExpRate', 'dropRate', 'goldRate', 'rareRate'):
            if key in body:
                candidate[key] = int(body[key])
        candidate = validate_settings(candidate)
        event_id = uuid.uuid4().hex
        starts = time.time()
        ends = starts + duration * 60
        label = str(body.get('label') or 'Sự kiện GM').strip()[:40]
        settings = candidate
        save_settings(settings)
        event_state = {
            'active': True,
            'id': event_id,
            'label': label,
            'startsAt': starts,
            'endsAt': ends,
            'durationMinutes': duration,
            'previous': previous,
            'settings': candidate,
        }
    try:
        publish_notice(f'{label} bắt đầu trong {duration} phút. EXP x{candidate["expRate"]}, Drop x{candidate["dropRate"]}.')
    except Exception as exc:
        print(f'event start notice failed: {exc}', flush=True)
    restart_world_async()
    threading.Thread(target=_event_timer, args=(event_id, ends), name='gm-event-timer', daemon=True).start()
    return current_event()


def process_rss_mib(pid):
    if not pid:
        return 0.0
    try:
        for line in pathlib.Path(f'/proc/{pid}/status').read_text().splitlines():
            if line.startswith('VmRSS:'):
                return round(int(line.split()[1]) / 1024, 1)
    except Exception:
        pass
    return 0.0


class Handler(BaseHTTPRequestHandler):
    server_version = 'HieuSRO-GM-Control/2.0'

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

    def _body(self, limit=32768):
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
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path == '/v1/status':
            with lock:
                proc = world
                current = dict(settings)
                error = last_error
                starts = world_started_at
                restarts = restart_count
            shard = shard_status()
            pid = proc.pid if proc and proc.poll() is None else None
            try:
                load1 = round(os.getloadavg()[0], 2)
            except Exception:
                load1 = 0
            return self._json(200, {
                'ok': True,
                'server': 'HieuSRO',
                'agentReady': True,
                'gameReady': game_ready(),
                'gamePid': pid,
                'gameStartedAt': starts,
                'gameUptimeSeconds': max(0, int(time.time() - starts)) if starts and pid else 0,
                'gameRssMiB': process_rss_mib(pid),
                'load1': load1,
                'databaseBytes': AUTH_DB.stat().st_size if AUTH_DB.exists() else 0,
                'restartCount': restarts,
                'lastError': error,
                'onlinePlayers': int(shard.get('onlinePlayers') or 0),
                'capacity': int(shard.get('capacity') or 0),
                'operating': bool(shard.get('operating')),
                'settings': current,
                'event': current_event(),
            })
        if path == '/v1/settings':
            with lock:
                return self._json(200, {'ok': True, 'settings': dict(settings), 'gameReady': game_ready()})
        if path == '/v1/economy':
            try:
                return self._json(200, economy_snapshot())
            except Exception as exc:
                return self._json(503, {'ok': False, 'message': str(exc)})
        if path == '/v1/event':
            return self._json(200, {'ok': True, 'event': current_event()})
        if path == '/v1/monsters':
            try:
                ref = int((query.get('ref') or ['0'])[0])
                if ref <= 0:
                    raise ValueError('RefObjID phải lớn hơn 0.')
                status, body = game_control_request('/internal/diagnostics/monsters?' + urllib.parse.urlencode({'ref': ref}))
                return self._json(status, body or {'ok': status < 400})
            except ValueError as exc:
                return self._json(400, {'ok': False, 'message': str(exc)})
            except Exception as exc:
                return self._json(503, {'ok': False, 'message': str(exc)})
        if path == '/v1/characters/search':
            try:
                rows = search_characters((query.get('q') or [''])[0])
                return self._json(200, {'ok': True, 'characters': rows})
            except Exception as exc:
                return self._json(503, {'ok': False, 'message': str(exc)})
        if path.startswith('/v1/characters/'):
            character = unquote(path[len('/v1/characters/'):])
            if not character or '/' in character:
                return self._json(400, {'ok': False, 'message': 'Nhân vật không hợp lệ.'})
            try:
                status, body = operator_read(character)
                return self._json(status, body or {'ok': status < 400})
            except Exception as exc:
                return self._json(503, {'ok': False, 'message': str(exc)})
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
            if path == '/v1/event/start':
                return self._json(200, {'ok': True, 'event': start_event(body), 'restarting': True})
            if path == '/v1/event/stop':
                row = current_event()
                if not row.get('active'):
                    return self._json(409, {'ok': False, 'message': 'Không có sự kiện đang chạy.'})
                _restore_event(row.get('id'), False)
                return self._json(200, {'ok': True, 'event': current_event(), 'restarting': True})
            prefix = '/v1/characters/'
            suffix = '/operation'
            if path.startswith(prefix) and path.endswith(suffix):
                character = unquote(path[len(prefix):-len(suffix)].rstrip('/'))
                if not character or '/' in character:
                    return self._json(400, {'ok': False, 'message': 'Nhân vật không hợp lệ.'})
                status, result = operator_action(character, body)
                return self._json(status, result or {'ok': status < 400})
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
    ensure_operator_token()
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
