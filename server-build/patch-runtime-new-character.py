#!/usr/bin/env python3
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
if 'NEW_CHARACTER_SETTINGS_PATH' in text:
    raise SystemExit('runtime GM already contains new-character settings patch')


def replace_once(old, new):
    global text
    if old not in text:
        raise SystemExit('runtime patch anchor not found: ' + old[:100])
    text = text.replace(old, new, 1)

replace_once(
    "import uuid\nfrom http.server import BaseHTTPRequestHandler, ThreadingHTTPServer\n",
    "import uuid\nfrom runtime_new_character import ensure_new_character_settings, load_new_character_settings, save_new_character_settings\nfrom http.server import BaseHTTPRequestHandler, ThreadingHTTPServer\n",
)
replace_once(
    "EVENT_PATH = STATE_ROOT / 'gm-event.json'\n",
    "EVENT_PATH = STATE_ROOT / 'gm-event.json'\nNEW_CHARACTER_SETTINGS_PATH = STATE_ROOT / 'new-character-settings.json'\n",
)
replace_once(
    "        'SRO_BETA_GROWTH': 'on' if current['betaGrowth'] else 'off',\n",
    "        'SRO_BETA_GROWTH': 'on' if current['betaGrowth'] else 'off',\n        'HIEUSRO_NEW_CHARACTER_SETTINGS': str(NEW_CHARACTER_SETTINGS_PATH),\n",
)
replace_once(
    "        if path == '/v1/economy':\n",
    "        if path == '/v1/new-character-settings':\n            return self._json(200, {\n                'ok': True,\n                'settings': load_new_character_settings(NEW_CHARACTER_SETTINGS_PATH),\n                'appliesTo': 'future-characters-only',\n            })\n        if path == '/v1/economy':\n",
)
replace_once(
    "            if path == '/v1/settings':\n                candidate = validate_settings(body)\n",
    "            if path == '/v1/new-character-settings':\n                candidate = save_new_character_settings(NEW_CHARACTER_SETTINGS_PATH, body)\n                return self._json(200, {\n                    'ok': True,\n                    'settings': candidate,\n                    'restarting': False,\n                    'message': 'Đã lưu. Cấu hình áp dụng ngay cho nhân vật tạo mới sau thời điểm này.',\n                })\n            if path == '/v1/settings':\n                candidate = validate_settings(body)\n",
)
replace_once(
    "    load_settings()\n    ensure_operator_token()\n",
    "    load_settings()\n    ensure_new_character_settings(NEW_CHARACTER_SETTINGS_PATH)\n    ensure_operator_token()\n",
)

path.write_text(text, encoding='utf-8')
print('Patched runtime GM with new-character settings API.')
