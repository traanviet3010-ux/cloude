from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: ph90-apply-test-patches.py <go-sro-dir>")

root = Path(sys.argv[1])

p = root / "agent-server/navmeshv2/loader.go"
s = p.read_text()
old = "\tobjectEntry := l.ObjectInfo.Objects[objectIndex]\n\tswitch path.Ext(objectEntry.FilePath) {"
new = "\tobjectEntry := l.ObjectInfo.Objects[objectIndex]\n\tif _, skip := ph90SkipMissingObjectIndices[objectIndex]; skip {\n\t\tlogrus.Warnf(\"TEST-only PHUONGHOANG90: skipping missing direct navmesh resource object %d: %s\", objectIndex, objectEntry.FilePath)\n\t\tempty := RtNavmeshObj{}\n\t\tl.ObjectData[objectIndex] = empty\n\t\treturn empty\n\t}\n\tswitch path.Ext(objectEntry.FilePath) {"
if s.count(old) != 1:
    raise SystemExit(f"skip patch point mismatch: {s.count(old)}")
p.write_text(s.replace(old, new, 1))

p = root / "agent-server/server.go"
s = p.read_text()
old = "model.RefItems = model.GetAllRefItems()"
new = "model.RefItems = make(map[uint32]model.RefItem) // TEST-only existing schema probe workaround"
if s.count(old) != 1:
    raise SystemExit(f"RefItems patch point mismatch: {s.count(old)}")
p.write_text(s.replace(old, new, 1))
