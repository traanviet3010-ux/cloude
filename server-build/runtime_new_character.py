#!/usr/bin/env python3
import json
import os
import pathlib
import re

ITEM_CODE = re.compile(r'^ITEM_[A-Z0-9_]+$')

DEFAULT_NEW_CHARACTER_SETTINGS = {
    'schemaVersion': 1,
    'enabled': False,
    'level': 1,
    'gold': 0,
    'skillPoints': 0,
    'statPoints': 0,
    'keepDefaultGear': True,
    'starterItems': [],
}


def _int(value, name, lo, hi):
    if isinstance(value, bool):
        raise ValueError(f'{name} phải là số nguyên.')
    try:
        value = int(value)
    except (TypeError, ValueError):
        raise ValueError(f'{name} phải là số nguyên.')
    if value < lo or value > hi:
        raise ValueError(f'{name} phải từ {lo} đến {hi}.')
    return value


def validate_new_character_settings(value):
    if not isinstance(value, dict):
        raise ValueError('Cấu hình nhân vật mới không hợp lệ.')
    enabled = value.get('enabled', False)
    keep_default = value.get('keepDefaultGear', True)
    if not isinstance(enabled, bool) or not isinstance(keep_default, bool):
        raise ValueError('Các tùy chọn bật/tắt phải là true/false.')

    rows = value.get('starterItems', [])
    if not isinstance(rows, list) or len(rows) > 16:
        raise ValueError('Starter Pack tối đa 16 loại vật phẩm.')
    starter = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Dòng Starter Pack không hợp lệ.')
        codename = str(row.get('codename') or '').strip().upper()
        if not ITEM_CODE.fullmatch(codename) or len(codename) > 128:
            raise ValueError(f'CodeName không hợp lệ: {codename or "(trống)"}.')
        starter.append({
            'codename': codename,
            'count': _int(row.get('count', 1), 'Số lượng item', 1, 65535),
            'plus': _int(row.get('plus', 0), 'Plus item', 0, 15),
        })

    return {
        'schemaVersion': 1,
        'enabled': enabled,
        'level': _int(value.get('level', 1), 'Level', 1, 140),
        'gold': _int(value.get('gold', 0), 'Gold', 0, 1_000_000_000_000),
        'skillPoints': _int(value.get('skillPoints', 0), 'Skill Point', 0, 1_000_000_000),
        'statPoints': _int(value.get('statPoints', 0), 'Stat Point', 0, 65535),
        'keepDefaultGear': keep_default,
        'starterItems': starter,
    }


def save_new_character_settings(path, value):
    path = pathlib.Path(path)
    candidate = validate_new_character_settings(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(candidate, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(tmp, path)
    return candidate


def ensure_new_character_settings(path):
    path = pathlib.Path(path)
    if not path.exists():
        return save_new_character_settings(path, DEFAULT_NEW_CHARACTER_SETTINGS)
    try:
        return validate_new_character_settings(json.loads(path.read_text(encoding='utf-8')))
    except Exception as exc:
        print(f'New-character settings invalid, resetting to vanilla defaults: {exc}', flush=True)
        return save_new_character_settings(path, DEFAULT_NEW_CHARACTER_SETTINGS)


def load_new_character_settings(path):
    return ensure_new_character_settings(path)
