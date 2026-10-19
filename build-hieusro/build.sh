#!/usr/bin/env bash
# Isolated, source-zip-based build. NO deployment or production DB operations.
set -Eeuo pipefail

usage() {
  cat <<'HELP'
Usage: bash build-hieusro/build.sh \
  --source-zip /private/opensro-main.zip \
  --game-root /private/legend3-client \
  --work-dir /private/hieusro-test-build [--preflight]

Requires: Node 24, Corepack/pnpm 12.6.0, Python >=3.12, Go 1.27.1, ffmpeg.
This builds source and assets ONLY. It never deploys or starts LIVE.
HELP
}

ZIP=""
GAME_ROOT=""
WORK_DIR=""
PREFLIGHT=0
while (( $# )); do
  case "$1" in
    --source-zip) ZIP="$2"; shift 2 ;;
    --game-root) GAME_ROOT="$2"; shift 2 ;;
    --work-dir) WORK_DIR="$2"; shift 2 ;;
    --preflight) PREFLIGHT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

[[ -n "$ZIP" && -n "$GAME_ROOT" && -n "$WORK_DIR" ]] || { usage; exit 2; }
ZIP="$(realpath "$ZIP")"
GAME_ROOT="$(realpath "$GAME_ROOT")"
mkdir -p "$WORK_DIR"
WORK_DIR="$(realpath "$WORK_DIR")"
[[ -f "$ZIP" ]] || { echo "Missing source zip: $ZIP" >&2; exit 1; }
[[ -d "$GAME_ROOT" ]] || { echo "Missing game folder: $GAME_ROOT" >&2; exit 1; }
[[ "$GAME_ROOT" != "$WORK_DIR" ]] || { echo "GAME_ROOT and WORK_DIR must be separate" >&2; exit 1; }
[[ -f "$GAME_ROOT/SRO_Client.exe" ]] || { echo "Missing SRO_Client.exe" >&2; exit 1; }

for command in node corepack python3 go ffmpeg unzip; do
  command -v "$command" >/dev/null || { echo "Missing tool: $command" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)' || {
  echo "Node.js >=24 required for this build" >&2; exit 1;
}
python3 -c 'import sys; assert sys.version_info >= (3, 12)' || {
  echo "Python >=3.12 required" >&2; exit 1;
}
go version
node --version
corepack pnpm --version
ffmpeg -version | head -n 1

export SRO_GAME_ROOT="$GAME_ROOT"
export HIEUSRO_BUILD_SOURCE="$ZIP"
python3 - <<'PY'
import os
import pathlib
import sys
from zipfile import ZipFile

client = pathlib.Path(os.environ["SRO_GAME_ROOT"])
expected = {
 "Media.pk2": 289288192,
 "Data.pk2": 1342164992,
 "Map.pk2": 621858816,
 "Particles.pk2": 68116480,
 "Music.pk2": 35569664,
 "SRO_Client.exe": 9383936,
}
missing = []
for name, size in expected.items():
    p = client / name
    if not p.is_file() or p.stat().st_size != size:
        missing.append(f"{name} (expected {size} bytes)")
        continue
    with p.open("rb") as f:
        magic = f.read(21)
    if name.endswith(".pk2") and magic != b"JoyMax File Manager!\n":
        missing.append(f"{name} (invalid PK2 signature)")
    if name.endswith(".exe") and not magic.startswith(b"MZ"):
        missing.append(f"{name} (invalid PE signature)")
if missing:
    sys.exit("Client inputs missing or invalid:\n - " + "\n - ".join(missing))

with ZipFile(os.environ["HIEUSRO_BUILD_SOURCE"]) as z:
    bad = [n for n in z.namelist()
        if n.startswith("/") or ".." in pathlib.PurePosixPath(n).parts]
    if bad:
        sys.exit(f"Unsafe archive path: {bad[0]}")
    required = ["opensro-main/package.json",
                "opensro-main/apps/server/go.mod",
                "opensro-main/scripts/prepare_client_resources.py"]
    absent = [p for p in required if p not in z.namelist()]
    if absent:
        sys.exit(f"Source zip is missing {absent}")
print("PREFLIGHT PASSED: Six client files and OpenSRO source archive verified.")
PY

if (( PREFLIGHT )); then
  echo "Preflight-only mode: NO source extraction, NO build, NO deployment."
  exit 0
fi

SRC="$WORK_DIR/opensro-main"
if [[ ! -f "$SRC/package.json" ]]; then
  echo "Extracting the supplied OpenSRO source zip..."
  unzip -n -q "$ZIP" -d "$WORK_DIR"
fi
[[ -f "$SRC/package.json" ]] || { echo "Source extraction failed" >&2; exit 1; }
mkdir -p "$WORK_DIR/bin"

cd "$SRC"
echo "Installing exact Node dependencies..."
corepack pnpm install --frozen-lockfile

echo "Preparing Python build dependencies..."
if [[ ! -x "$WORK_DIR/.venv/bin/python" ]]; then
  python3 -m venv "$WORK_DIR/.venv"
fi
"$WORK_DIR/.venv/bin/python" -m pip install -r requirements-build.txt
export SRO_PYTHON="$WORK_DIR/.venv/bin/python"

echo "Extracting v1.150 client assets (isolated game directory)..."
corepack pnpm assets prepare
corepack pnpm assets doctor
corepack pnpm assets build full
corepack pnpm assets ledger
corepack pnpm task build server-game-data
corepack pnpm assets check integrity

echo "Building browser client..."
corepack pnpm --filter @sro/client-next build

echo "Building standalone Go services (not starting them)..."
go -C apps/server build -o "$WORK_DIR/bin/sro-agent" ./cmd/services/sro-agent
go -C apps/server build -o "$WORK_DIR/bin/sro-gameworld" ./cmd/services/sro-gameworld

export HIEUSRO_SRC="$SRC"
python3 - <<'PY'
from datetime import datetime, timezone
from pathlib import Path
import json
import os
import sys
r = Path(os.environ["HIEUSRO_SRC"])
files = {
    "asset_manifest": r / ".generated/client-public/assets/packs/manifest.json",
    "web_client": r / "apps/client-next/dist/index.html",
    "server_data": r / "apps/server/.generated/game-data/1.150",
    "agent_binary": r.parent / "bin/sro-agent",
    "gameworld_binary": r.parent / "bin/sro-gameworld",
}
missing = [k for k, v in files.items() if not v.exists()]
report = {
    "status": "complete" if not missing else "incomplete",
    "at_utc": datetime.now(timezone.utc).isoformat(),
    "source": "user-supplied opensro-main.zip",
    "components": {k: {"exists": v.exists(), "path": str(v)} for k, v in files.items()},
    "missing": missing,
    "deployment_performed": False,
}
(r / ".hieusro-build-verification.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
if missing:
    sys.exit("Build output validation failed")
PY
echo "BUILD COMPLETE. This is a TEST build, NOT a running game server."
