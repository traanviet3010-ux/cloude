#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/hieusro/server
STATE_ROOT=${SRO_STATE_ROOT:-$ROOT/.state}
BOOTSTRAP="$ROOT/sro-bootstrap-development"
LIVE_SHARD_ID=global-official
TEST_SHARD_ID=hieusro-test
AGENT_ADDR=127.0.0.1:8787
LIVE_GAME_ADDR=127.0.0.1:8788
LIVE_CONTROL_ADDR=127.0.0.1:8791
TEST_GAME_ADDR=127.0.0.1:8797
TEST_CONTROL_ADDR=127.0.0.1:8798
OIDC_ADDR=127.0.0.1:8792
OIDC_ISSUER="http://$OIDC_ADDR"
VERSION_ADDR=127.0.0.1:8794

export SRO_SERVER_GAME_DATA_ROOT=/opt/hieusro/server.srogz
export SRO_ALLOWED_ORIGINS=${SRO_ALLOWED_ORIGINS:-https://opensro-mobile-test.onrender.com,https://hieusro-private-client-test.onrender.com,https://hieusro-portal.onrender.com}

mkdir -p "$STATE_ROOT/cluster" "$STATE_ROOT/shards" "$STATE_ROOT/dev-certs"

PIDS=()
cleanup() {
  set +e
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  wait >/dev/null 2>&1 || true
}
trap cleanup TERM INT EXIT

fail_with_logs() {
  echo "===== HIEUSRO DIRECT RUNTIME DIAGNOSTICS ====="
  for f in /tmp/hieusro-agent.log /tmp/hieusro-gameworld.log /tmp/hieusro-test-gameworld.log /tmp/hieusro-gm.log /tmp/hieusro-version.log /tmp/hieusro-oidc.log; do
    echo "--- $f ---"
    tail -n 250 "$f" 2>/dev/null || true
  done
  echo "===== END HIEUSRO DIRECT RUNTIME DIAGNOSTICS ====="
  exit 1
}

if ! command -v openssl >/dev/null 2>&1; then
  echo "Installing openssl for loopback workload identity bootstrap"
  apt-get update >/tmp/hieusro-apt.log 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openssl >>/tmp/hieusro-apt.log 2>&1
  rm -rf /var/lib/apt/lists/*
fi

"$BOOTSTRAP" \
  -state-dir "$STATE_ROOT/cluster" \
  -dev-account "$ROOT/config/dev-account.env" \
  -shard-catalog "$ROOT/config/shards.json" \
  -shard-state-root "$STATE_ROOT/shards"

# Build one workload identity per enabled GameWorld. The Agent is shared, while
# every shard has a distinct authority directory, control endpoint and lease.
python - "$STATE_ROOT" "$OIDC_ISSUER" "$LIVE_SHARD_ID" "$TEST_SHARD_ID" <<'PY'
import base64
import json
import pathlib
import subprocess
import sys
import time

state = pathlib.Path(sys.argv[1])
issuer = sys.argv[2]
shards = sys.argv[3:]
cluster = state / 'cluster'
cluster.mkdir(parents=True, exist_ok=True)

def b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()

private_ring = json.loads((cluster / 'agent-session-keys.json').read_text())
public_keys = []
for row in private_ring['keys']:
    raw = base64.urlsafe_b64decode(row['privateKey'] + '=' * (-len(row['privateKey']) % 4))
    if len(raw) != 64:
        raise SystemExit(f"unexpected Ed25519 private key length: {len(raw)}")
    public_keys.append({
        'id': row['id'],
        'publicKey': b64u(raw[-32:]),
        'createdAt': row['createdAt'],
    })
(cluster / 'agent-session-public-keys.json').write_text(
    json.dumps({'keys': public_keys}, separators=(',', ':')) + '\n'
)

key = cluster / 'render-oidc-rsa.pem'
if not key.exists():
    subprocess.run([
        'openssl', 'genpkey', '-algorithm', 'RSA',
        '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(key)
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    key.chmod(0o600)

modulus_line = subprocess.check_output(
    ['openssl', 'rsa', '-in', str(key), '-noout', '-modulus'], text=True
).strip()
modulus_hex = modulus_line.split('=', 1)[1]
n_int = int(modulus_hex, 16)
n_raw = n_int.to_bytes((n_int.bit_length() + 7) // 8, 'big')
kid = 'hieusro-render-local'
(cluster / 'render-oidc-jwks.json').write_text(json.dumps({
    'keys': [{
        'kty': 'RSA', 'use': 'sig', 'alg': 'RS256', 'kid': kid,
        'n': b64u(n_raw), 'e': 'AQAB'
    }]
}, separators=(',', ':')) + '\n')

header = {'alg': 'RS256', 'typ': 'JWT', 'kid': kid}
for shard in shards:
    now = int(time.time())
    payload = {
        'iss': issuer,
        'aud': 'sro-agent',
        'iat': now,
        'nbf': now - 5,
        'exp': now + 30 * 24 * 60 * 60,
        'nomad_namespace': 'default',
        'nomad_job_id': f'sro-gameworld-{shard}',
        'nomad_allocation_id': f'hieusro-single-container-{shard}',
        'nomad_task': 'gameworld',
    }
    part1 = b64u(json.dumps(header, separators=(',', ':')).encode())
    part2 = b64u(json.dumps(payload, separators=(',', ':')).encode())
    signing = f'{part1}.{part2}'.encode()
    signing_path = cluster / f'render-identity-signing-{shard}.txt'
    sig_path = cluster / f'render-identity-signature-{shard}.bin'
    signing_path.write_bytes(signing)
    subprocess.run([
        'openssl', 'dgst', '-sha256', '-sign', str(key),
        '-out', str(sig_path), str(signing_path)
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    token = f'{part1}.{part2}.{b64u(sig_path.read_bytes())}'
    identity = cluster / f'gameworld-identity-{shard}.jwt'
    identity.write_text(token + '\n')
    identity.chmod(0o600)
    signing_path.unlink(missing_ok=True)
    sig_path.unlink(missing_ok=True)

print('Prepared local workload identities for: ' + ', '.join(shards), flush=True)
PY

python - "$STATE_ROOT/cluster/render-oidc-jwks.json" <<'PY' >/tmp/hieusro-oidc.log 2>&1 &
import pathlib
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

jwks = pathlib.Path(sys.argv[1]).read_bytes()
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/jwks':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(jwks)))
            self.end_headers()
            self.wfile.write(jwks)
        elif self.path == '/healthz':
            body = b'ok'
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, fmt, *args):
        print('[oidc]', fmt % args, flush=True)
ThreadingHTTPServer(('127.0.0.1', 8792), Handler).serve_forever()
PY
OIDC_PID=$!
PIDS+=("$OIDC_PID")

for i in $(seq 1 20); do
  if curl -fsS "$OIDC_ISSUER/healthz" >/dev/null 2>&1; then break; fi
  sleep 0.25
  if [ "$i" = 20 ]; then fail_with_logs; fi
done

export SRO_SHARD_CATALOG_PATH="$ROOT/config/shards.json"
export SRO_AGENT_ACCOUNTS_PATH="$STATE_ROOT/cluster/accounts.json"
export SRO_AGENT_ACCOUNTS_DB_PATH="$STATE_ROOT/cluster/accounts.db"
export SRO_AGENT_API_ADDR="$AGENT_ADDR"
export SRO_AGENT_DIRECTORY_STATE_PATH="$STATE_ROOT/cluster/shard-leases.json"
export SRO_AGENT_PROVISIONING_TOKEN_PATH="$STATE_ROOT/cluster/agent-provisioning-token"
export SRO_AGENT_PROVISIONING_ADDR=127.0.0.1:8789
export SRO_AGENT_ALLOWED_ORIGINS="$SRO_ALLOWED_ORIGINS"
export SRO_NOMAD_IDENTITY_ISSUER="$OIDC_ISSUER"
export SRO_NOMAD_JWKS_URL="$OIDC_ISSUER/jwks"
export SRO_NOMAD_NAMESPACE=default
export SRO_AGENT_SESSION_KEYRING_PATH="$STATE_ROOT/cluster/agent-session-keys.json"
export SRO_RELEASE_ID=hieusro-render-direct-v1

"$ROOT/agent" > >(tee /tmp/hieusro-agent.log) 2>&1 &
AGENT_PID=$!
PIDS+=("$AGENT_PID")

for i in $(seq 1 60); do
  if curl -fsS "http://$AGENT_ADDR/readyz" >/dev/null 2>&1; then
    echo "READY: Agent http://$AGENT_ADDR/readyz"
    break
  fi
  if ! kill -0 "$AGENT_PID" >/dev/null 2>&1; then fail_with_logs; fi
  sleep 1
  if [ "$i" = 60 ]; then fail_with_logs; fi
done

# LIVE remains owned by the existing GM supervisor, preserving current GM
# controls and its separate global-official authority database.
export SRO_SHARD_ID="$LIVE_SHARD_ID"
export SRO_AGENT_URL="http://$AGENT_ADDR"
export SRO_AGENT_URL_REQUIRE=1
export SRO_AGENT_IDENTITY_FILE="$STATE_ROOT/cluster/gameworld-identity-$LIVE_SHARD_ID.jwt"
export SRO_AGENT_SESSION_PUBLIC_KEYS_PATH="$STATE_ROOT/cluster/agent-session-public-keys.json"
export SRO_AUTHORITY_STATE_DIR="$STATE_ROOT/shards/$LIVE_SHARD_ID/authority"
export SRO_AUTHORITY_REQUIRE=1
export SRO_GAMEWORLD_CONTROL_ADDR="$LIVE_CONTROL_ADDR"
export SRO_PUBLIC_API_ADDR=off
export TRANSPORT_WT_ADDR="$LIVE_GAME_ADDR"
export TRANSPORT_WS_ADDR="$LIVE_GAME_ADDR"
export TRANSPORT_CERT_DIR="$STATE_ROOT/dev-certs"
export TRANSPORT_ALLOWED_ORIGINS="$SRO_ALLOWED_ORIGINS"
export GOMEMLIMIT=${GOMEMLIMIT:-320MiB}

python /opt/hieusro/runtime-gm.py > >(tee /tmp/hieusro-gm.log) 2>&1 &
GM_PID=$!
PIDS+=("$GM_PID")

python /opt/hieusro/runtime-version-control.py > >(tee /tmp/hieusro-version.log) 2>&1 &
VERSION_PID=$!
PIDS+=("$VERSION_PID")

# TEST has a dedicated GameWorld process, authority DB and transport/control
# ports. It intentionally does not share LIVE character state. A small restart
# loop keeps the test shard available without changing LIVE's GM supervisor.
supervise_test_world() {
  set +e
  while true; do
    echo "TEST supervisor: starting $TEST_SHARD_ID"
    env \
      SRO_SHARD_ID="$TEST_SHARD_ID" \
      SRO_AGENT_URL="http://$AGENT_ADDR" \
      SRO_AGENT_URL_REQUIRE=1 \
      SRO_AGENT_IDENTITY_FILE="$STATE_ROOT/cluster/gameworld-identity-$TEST_SHARD_ID.jwt" \
      SRO_AGENT_SESSION_PUBLIC_KEYS_PATH="$STATE_ROOT/cluster/agent-session-public-keys.json" \
      SRO_AUTHORITY_STATE_DIR="$STATE_ROOT/shards/$TEST_SHARD_ID/authority" \
      SRO_AUTHORITY_REQUIRE=1 \
      SRO_GAMEWORLD_CONTROL_ADDR="$TEST_CONTROL_ADDR" \
      SRO_PUBLIC_API_ADDR=off \
      TRANSPORT_WT_ADDR="$TEST_GAME_ADDR" \
      TRANSPORT_WS_ADDR="$TEST_GAME_ADDR" \
      TRANSPORT_CERT_DIR="$STATE_ROOT/dev-certs" \
      TRANSPORT_ALLOWED_ORIGINS="$SRO_ALLOWED_ORIGINS" \
      GOMEMLIMIT="${HIEUSRO_TEST_GOMEMLIMIT:-256MiB}" \
      SRO_HIEUSRO_EXP_RATE="${HIEUSRO_TEST_EXP_RATE:-50}" \
      SRO_BETA_SKILL_EXP_RATE="${HIEUSRO_TEST_SKILL_EXP_RATE:-100}" \
      SRO_BETA_DROP_RATE="${HIEUSRO_TEST_DROP_RATE:-20}" \
      SRO_BETA_GOLD_RATE="${HIEUSRO_TEST_GOLD_RATE:-250}" \
      SRO_BETA_RARE_RATE="${HIEUSRO_TEST_RARE_RATE:-5}" \
      SRO_BETA_DROP_CAP="${HIEUSRO_TEST_DROP_CAP:-16}" \
      SRO_BETA_GROWTH="${HIEUSRO_TEST_BETA_GROWTH:-on}" \
      "$ROOT/gameworld"
    code=$?
    echo "TEST supervisor: GameWorld exited code=$code; restarting in 3s"
    sleep 3
  done
}

supervise_test_world > >(tee /tmp/hieusro-test-gameworld.log) 2>&1 &
TEST_SUPERVISOR_PID=$!
PIDS+=("$TEST_SUPERVISOR_PID")

for i in $(seq 1 40); do
  if curl -fsS -H "Authorization: Bearer ${HIEUSRO_GM_CONTROL_TOKEN:-}" "http://$VERSION_ADDR/v1/versions" >/dev/null 2>&1; then
    echo "READY: Version control http://$VERSION_ADDR/v1/versions"
    break
  fi
  if ! kill -0 "$VERSION_PID" >/dev/null 2>&1; then fail_with_logs; fi
  sleep 0.5
  if [ "$i" = 40 ]; then fail_with_logs; fi
done

for i in $(seq 1 240); do
  if curl -fsS "http://$LIVE_GAME_ADDR/transport/readyz" >/dev/null 2>&1; then
    echo "READY: LIVE GameWorld http://$LIVE_GAME_ADDR/transport/readyz"
    break
  fi
  if ! kill -0 "$GM_PID" >/dev/null 2>&1; then fail_with_logs; fi
  sleep 1
  if [ "$i" = 240 ]; then fail_with_logs; fi
done

for i in $(seq 1 240); do
  if curl -fsS "http://$TEST_GAME_ADDR/transport/readyz" >/dev/null 2>&1; then
    echo "READY: TEST GameWorld http://$TEST_GAME_ADDR/transport/readyz"
    break
  fi
  if ! kill -0 "$TEST_SUPERVISOR_PID" >/dev/null 2>&1; then fail_with_logs; fi
  sleep 1
  if [ "$i" = 240 ]; then fail_with_logs; fi
done

if ! curl -fsS -H 'X-OpenSRO-Protocol: 6' "http://$AGENT_ADDR/title/servers" | tee /tmp/hieusro-servers.json; then
  fail_with_logs
fi
python - /tmp/hieusro-servers.json <<'PY'
import json
import pathlib
import sys
rows = json.loads(pathlib.Path(sys.argv[1]).read_text())
by_id = {row.get('id'): row for row in rows if isinstance(row, dict)}
expected = {
    'global-official': 'HieuSRO',
    'hieusro-test': 'HieuSRO TEST',
}
for shard, name in expected.items():
    row = by_id.get(shard)
    if not row or row.get('name') != name:
        raise SystemExit(f'missing shard {shard} ({name}) in Agent catalogue: {rows!r}')
print('Agent catalogue contains LIVE + TEST', flush=True)
PY

echo "HIEUSRO_RUNTIME_READY"
trap - EXIT
exec nginx -c /opt/hieusro/runtime-nginx.conf -g 'daemon off;'
