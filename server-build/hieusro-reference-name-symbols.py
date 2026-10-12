from pathlib import Path

root = Path('/src/opensro/apps/server/internal/game/enterworld')

response = root / 'response.go'
s = response.read_text(encoding='utf-8')
old = '''\tCodename                   string       `json:"codename"`\n\tKind                       string       `json:"kind"`\n\tName                       string       `json:"name"`\n'''
new = '''\tCodename                   string       `json:"codename"`\n\tNameStrID                  string       `json:"nameStrId,omitempty"`\n\tKind                       string       `json:"kind"`\n\tName                       string       `json:"name"`\n'''
if old not in s:
    raise SystemExit('RefItemRow shape changed upstream')
response.write_text(s.replace(old, new, 1), encoding='utf-8')

bootstrap = root / 'bootstrap.go'
s = bootstrap.read_text(encoding='utf-8')
old = '''\t\tCodename:     row.Codename,\n\t\tKind:         "equipment",\n\t\tName:         row.Name,\n'''
new = '''\t\tCodename:     row.Codename,\n\t\tNameStrID:    row.NameStrID,\n\t\tKind:         "equipment",\n\t\tName:         row.Name,\n'''
if old not in s:
    raise SystemExit('refItemCollector projection changed upstream')
bootstrap.write_text(s.replace(old, new, 1), encoding='utf-8')

print('HieuSRO: item reference nameStrId projection installed')
