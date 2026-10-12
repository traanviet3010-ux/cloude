#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/hieusro/server
STATE_ROOT=${SRO_STATE_ROOT:-$ROOT/.state}
BOOTSTRAP="$ROOT/sro-bootstrap-development"
SHARD_ID=global-official
AGENT_ADDR=127.0.0.1:8787
GAME_ADDR=127.0.0.1:8788
CONTROL_ADDR=127.0.0.1:8791
OIDC_ADDR=127.0.0.1:8792
OIDC_ISSUER="http://$OIDC_ADDR"

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
  for f in /tmp/hieusro-agent.log /tmp/hieusro-gameworld.log /tmp/hieusro-oidc.log; do
    echo "--- $f ---"
    tail -n 250 "$f" 2>/dev/null || true
  done
  echo "===== END HIEUSRO DIRECT RUNTIME DIAGNOSTICS ====="
  exit 1
}

# Render's container exposes cgroup v2 read-only, so a Nomad client cannot
# create allocation cgroups. Run the two OpenSRO services directly instead.
# The Agent still expects a Nomad-style workload identity for GameWorld
# control calls. For this single-container development deployment we mint a
# loopback-only RS256 identity and expose its JWKS on 127.0.0.1.
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

python - "$STATE_ROOT" "$OIDC_ISSUER" "$SHARD_ID" <<'PY'
import base64
import json
import pathlib
import subprocess
import sys
import time

state = pathlib.Path(sys.argv[1])
issuer = sys.argv[2]
shard = sys.argv[3]
cluster = state / 'cluster'
cluster.mkdir(parents=True, exist_ok=True)


def b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()

# GameWorld needs the public projection of Agent's Ed25519 session key ring.
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

# A private development OIDC/JWKS authority replaces Nomad workload identity
# only inside this Render container. Nothing is exposed by nginx.
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

now = int(time.time())
header = {'alg': 'RS256', 'typ': 'JWT', 'kid': kid}
payload = {
    'iss': issuer,
    'aud': 'sro-agent',
    'iat': now,
    'nbf': now - 5,
    'exp': now + 30 * 24 * 60 * 60,
    'nomad_namespace': 'default',
    'nomad_job_id': f'sro-gameworld-{shard}',
    'nomad_allocation_id': 'render-single-container',
    'nomad_task': 'gameworld',
}
part1 = b64u(json.dumps(header, separators=(',', ':')).encode())
part2 = b64u(json.dumps(payload, separators=(',', ':')).encode())
signing = f'{part1}.{part2}'.encode()
signing_path = cluster / 'render-identity-signing.txt'
sig_path = cluster / 'render-identity-signature.bin'
signing_path.write_bytes(signing)
subprocess.run([
    'openssl', 'dgst', '-sha256', '-sign', str(key),
    '-out', str(sig_path), str(signing_path)
], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
token = f'{part1}.{part2}.{b64u(sig_path.read_bytes())}'
(cluster / 'gameworld-identity.jwt').write_text(token + '\n')
signing_path.unlink(missing_ok=True)
sig_path.unlink(missing_ok=True)
print('Prepared local workload identity and Agent session public keys', flush=True)
PY

python - "$STATE_ROOT/cluster/render-oidc-jwks.json" <<'PY' >/tmp/hieusro-oidc.log 2>&1 &
import json
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
export SRO_AGENT_PROVISIONING_TOKEN_PATH="$STATE_ROOT/cluster/provisioning-token"
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

export SRO_SHARD_ID="$SHARD_ID"
export SRO_AGENT_URL="http://$AGENT_ADDR"
export SRO_AGENT_URL_REQUIRE=1
export SRO_AGENT_IDENTITY_FILE="$STATE_ROOT/cluster/gameworld-identity.jwt"
export SRO_AGENT_SESSION_PUBLIC_KEYS_PATH="$STATE_ROOT/cluster/agent-session-public-keys.json"
export SRO_AUTHORITY_STATE_DIR="$STATE_ROOT/shards/$SHARD_ID/authority"
export SRO_AUTHORITY_REQUIRE=1
export SRO_GAMEWORLD_CONTROL_ADDR="$CONTROL_ADDR"
export SRO_PUBLIC_API_ADDR=off
export TRANSPORT_WT_ADDR="$GAME_ADDR"
export TRANSPORT_WS_ADDR="$GAME_ADDR"
export TRANSPORT_CERT_DIR="$STATE_ROOT/dev-certs"
export TRANSPORT_ALLOWED_ORIGINS="$SRO_ALLOWED_ORIGINS"
export GOMEMLIMIT=${GOMEMLIMIT:-320MiB}

"$ROOT/gameworld" > >(tee /tmp/hieusro-gameworld.log) 2>&1 &
GAME_PID=$!
PIDS+=("$GAME_PID")

for i in $(seq 1 180); do
  if curl -fsS "http://$GAME_ADDR/transport/readyz" >/dev/null 2>&1; then
    echo "READY: GameWorld http://$GAME_ADDR/transport/readyz"
    break
  fi
  if ! kill -0 "$GAME_PID" >/dev/null 2>&1; then fail_with_logs; fi
  sleep 1
  if [ "$i" = 180 ]; then fail_with_logs; fi
done

# Verify the Agent now publishes the HieuSRO shard after GameWorld acquired
# its authenticated lease. Browser routes require OpenSRO release protocol 6.
if ! curl -fsS -H 'X-OpenSRO-Protocol: 6' "http://$AGENT_ADDR/title/servers" | tee /tmp/hieusro-servers.json; then
  fail_with_logs
fi
if ! grep -q 'HieuSRO' /tmp/hieusro-servers.json; then
  echo "Agent server catalogue did not publish HieuSRO"
  cat /tmp/hieusro-servers.json || true
  fail_with_logs
fi

echo "HIEUSRO_RUNTIME_READY"
trap - EXIT
exec nginx -c /opt/hieusro/runtime-nginx.conf -g 'daemon off;'
