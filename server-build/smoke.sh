#!/usr/bin/env bash
set -euo pipefail
cd /src/opensro

NOMAD_VERSION=2.0.7
NOMAD_DIR="$PWD/.tools/nomad/$NOMAD_VERSION"
NOMAD_BIN="$NOMAD_DIR/nomad"
mkdir -p "$NOMAD_DIR"

if [ ! -x "$NOMAD_BIN" ]; then
  curl -fsSLo /tmp/nomad.zip "https://releases.hashicorp.com/nomad/${NOMAD_VERSION}/nomad_${NOMAD_VERSION}_linux_amd64.zip"
  python - <<'PY'
import zipfile
zipfile.ZipFile('/tmp/nomad.zip').extract('nomad', '/tmp/nomad-extract')
PY
  mv /tmp/nomad-extract/nomad "$NOMAD_BIN"
  chmod +x "$NOMAD_BIN"
fi

"$NOMAD_BIN" version
export SRO_NOMAD_BINARY="$NOMAD_BIN"
export SRO_SERVER_GAME_DATA_ROOT="$PWD/apps/server/.generated/game-data/1.150/server.srogz"

cleanup() {
  set +e
  go -C apps/server run ./cmd/operations/sro-nomad stop >/tmp/sro-stop.log 2>&1
  if [ -n "${DEV_AGENT_PID:-}" ]; then kill "$DEV_AGENT_PID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

(go -C apps/server run ./cmd/operations/sro-nomad dev-agent > /tmp/nomad-dev.log 2>&1) &
DEV_AGENT_PID=$!

for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4646/v1/status/leader >/dev/null 2>&1; then break; fi
  if ! kill -0 "$DEV_AGENT_PID" >/dev/null 2>&1; then cat /tmp/nomad-dev.log; exit 1; fi
  sleep 1
  if [ "$i" = 60 ]; then cat /tmp/nomad-dev.log; exit 1; fi
done

go -C apps/server run ./cmd/operations/sro-bootstrap-development
go -C apps/server run ./cmd/operations/sro-nomad deploy -build -agent-memory-mb 96 -gameworld-memory-mb 256

go -C apps/server run ./cmd/operations/sro-nomad status

for url in http://127.0.0.1:8787/readyz http://127.0.0.1:8788/transport/readyz; do
  ok=0
  for i in $(seq 1 90); do
    if curl -fsS "$url"; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" != 1 ]; then
    echo "Smoke readiness failed: $url"
    cat /tmp/nomad-dev.log || true
    exit 1
  fi
  echo
  echo "READY: $url"
done

echo "HIEUSRO_RUNTIME_SMOKE_OK"
