#!/usr/bin/env python3
from pathlib import Path

root = Path('/src/opensro/apps/server')
characters = root / 'internal/agent/api/characters.go'
wiring = root / 'cmd/services/sro-gameworld/wiring_authority.go'

text = characters.read_text(encoding='utf-8')
anchor = '\tc.Gender = &gender\n\treturn c\n'
replacement = '\tc.Gender = &gender\n\thieusroApplyNewCharacterDefaults(c)\n\treturn c\n'
if anchor not in text:
    raise SystemExit('characters.go creation anchor not found')
characters.write_text(text.replace(anchor, replacement, 1), encoding='utf-8')

text = wiring.read_text(encoding='utf-8')
anchor = 'options.DefaultInventory = enterworld.StarterInventorySeeder(\n'
replacement = 'options.DefaultInventory = hieusroStarterInventorySeeder(\n'
if anchor not in text:
    raise SystemExit('wiring_authority.go inventory seeder anchor not found')
wiring.write_text(text.replace(anchor, replacement, 1), encoding='utf-8')

print('Patched GameWorld new-character defaults hook.')
