#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/hieusro/server
STATE_ROOT=${SRO_STATE_ROOT:-$ROOT/.state}
NOMAD_BIN=/opt/hieusro/bin/nomad
SRO_NOMAD="$ROOT/sro-nomad"
BOOTSTRAP="$ROOT/sro-bootstrap-development"

export NOMAD_ADDR=http://127.0.0.1:4646
export NOMAD_NAMESPACE=sro
export SRO_NOMAD_BINARY="$NOMAD_BIN"
export SRO_SERVER_GAME_DATA_ROOT=/opt/hieusro/server.srogz
export SRO_ALLOWED_ORIGINS=${SRO_ALLOWED_ORIGINS:-https://opensro-mobile-test.onrender.com,https://hieusro-portal.onrender.com}

mkdir -p "$STATE_ROOT/cluster" "$STATE_ROOT/shards" "$STATE_ROOT/nomad/dev-agent"

cleanup() {
  set +e
  "$SRO_NOMAD" stop \
    -module-root "$ROOT" \
    -catalog "$ROOT/config/shards.json" \
    -state-dir "$STATE_ROOT/cluster" \
    -release-dir "$STATE_ROOT/cluster/releases" \
    -jobs-dir "$ROOT/ops/nomad/jobs" \
    -namespace sro >/tmp/hieusro-stop.log 2>&1 || true
  if [ -n "${NOMAD_PID:-}" ]; then kill "$NOMAD_PID" >/dev/null 2>&1 || true; fi
}
trap cleanup TERM INT EXIT

diagnose() {
  set +e
  echo "===== HIEUSRO RUNTIME DIAGNOSTICS ====="
  "$NOMAD_BIN" node status -verbose || true
  "$NOMAD_BIN" job status -namespace=sro sro-agent || true
  "$NOMAD_BIN" job status -namespace=sro sro-gameworld-global-official || true
  for job in sro-agent sro-gameworld-global-official; do
    curl -fsS "http://127.0.0.1:4646/v1/job/$job/allocations?namespace=sro" -o "/tmp/$job-allocs.json" || true
    python - "$job" <<'PY' 2>/dev/null || true
import json, pathlib, subprocess, sys
job = sys.argv[1]
p = pathlib.Path(f'/tmp/{job}-allocs.json')
if not p.exists():
    raise SystemExit
try:
    data = json.loads(p.read_text())
except Exception:
    raise SystemExit
for row in data:
    alloc = row.get('ID')
    if not alloc:
        continue
    print(f'--- {job} allocation {alloc} ---', flush=True)
    subprocess.run(['/opt/hieusro/bin/nomad','alloc','status','-namespace=sro',alloc], check=False)
    task = 'agent' if job == 'sro-agent' else 'gameworld'
    subprocess.run(['/opt/hieusro/bin/nomad','alloc','logs','-namespace=sro',alloc,task], check=False)
    subprocess.run(['/opt/hieusro/bin/nomad','alloc','logs','-namespace=sro','-stderr',alloc,task], check=False)
PY
  done
  tail -n 250 /tmp/nomad-runtime.log 2>/dev/null || true
  echo "===== END HIEUSRO RUNTIME DIAGNOSTICS ====="
  set -e
}

"$SRO_NOMAD" dev-agent \
  -module-root "$ROOT" \
  -nomad-binary "$NOMAD_BIN" \
  -config "$ROOT/ops/nomad/config/dev-windows.hcl" \
  -data-dir "$STATE_ROOT/nomad/dev-agent" \
  > >(tee /tmp/nomad-runtime.log) 2>&1 &
NOMAD_PID=$!

for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4646/v1/status/leader >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$NOMAD_PID" >/dev/null 2>&1; then
    echo "Nomad exited before becoming ready"
    diagnose
    exit 1
  fi
  sleep 1
  if [ "$i" = 60 ]; then
    echo "Nomad did not become ready"
    diagnose
    exit 1
  fi
done

echo "Nomad is ready"

"$BOOTSTRAP" \
  -state-dir "$STATE_ROOT/cluster" \
  -dev-account "$ROOT/config/dev-account.env" \
  -shard-catalog "$ROOT/config/shards.json" \
  -shard-state-root "$STATE_ROOT/shards"

if ! "$SRO_NOMAD" deploy \
  -module-root "$ROOT" \
  -catalog "$ROOT/config/shards.json" \
  -state-dir "$STATE_ROOT/cluster" \
  -release-dir "$STATE_ROOT/cluster/releases" \
  -jobs-dir "$ROOT/ops/nomad/jobs" \
  -namespace sro \
  -allowed-origins "$SRO_ALLOWED_ORIGINS" \
  -agent-cpu 50 -gameworld-cpu 100 \
  -agent-memory-mb 96 -gameworld-memory-mb 256; then
  echo "HieuSRO deploy failed"
  diagnose
  exit 1
fi

"$SRO_NOMAD" status \
  -module-root "$ROOT" \
  -catalog "$ROOT/config/shards.json" \
  -state-dir "$STATE_ROOT/cluster" \
  -release-dir "$STATE_ROOT/cluster/releases" \
  -jobs-dir "$ROOT/ops/nomad/jobs" \
  -namespace sro || true

for url in http://127.0.0.1:8787/readyz http://127.0.0.1:8788/transport/readyz; do
  ready=0
  for i in $(seq 1 120); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  if [ "$ready" != 1 ]; then
    echo "Runtime readiness failed: $url"
    diagnose
    exit 1
  fi
  echo "READY: $url"
done

echo "HIEUSRO_RUNTIME_READY"
trap - EXIT
exec nginx -c /opt/hieusro/runtime-nginx.conf -g 'daemon off;'
