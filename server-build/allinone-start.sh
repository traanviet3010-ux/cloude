#!/usr/bin/env bash
set -euo pipefail

CLIENT_PORT=8795
GM_WEB_PORT=8796
PUBLIC_HOST=${HIEUSRO_PUBLIC_HOST:-hieusro-all-in-one.onrender.com}

# Internal service-to-service credentials are generated inside the container
# when Render secrets are not supplied. They are shared only by local child
# processes and rotate on container replacement.
if [ -z "${HIEUSRO_GM_CONTROL_TOKEN:-}" ] || [ "${#HIEUSRO_GM_CONTROL_TOKEN}" -lt 32 ]; then
  export HIEUSRO_GM_CONTROL_TOKEN="$(python - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"
  echo "Generated ephemeral internal GM control token"
fi
if [ -z "${HIEUSRO_PROVISIONING_TOKEN:-}" ] || [ "${#HIEUSRO_PROVISIONING_TOKEN}" -lt 32 ]; then
  export HIEUSRO_PROVISIONING_TOKEN="$(python - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"
  echo "Generated ephemeral provisioning token"
fi
if [ -z "${HIEUSRO_GM_SESSION_SECRET:-}" ] || [ "${#HIEUSRO_GM_SESSION_SECRET}" -lt 32 ]; then
  export HIEUSRO_GM_SESSION_SECRET="$(python - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"
  echo "Generated ephemeral GM session secret"
fi
export HIEUSRO_GM_ADMIN_PASSWORD=${HIEUSRO_GM_ADMIN_PASSWORD:-DISABLED_UNTIL_OWNER_SETS_PASSWORD}
if [ "$HIEUSRO_GM_ADMIN_PASSWORD" = "DISABLED_UNTIL_OWNER_SETS_PASSWORD" ]; then
  echo "GM login is disabled until HIEUSRO_GM_ADMIN_PASSWORD is set in Render"
fi

CORE_PID=""
CLIENT_PID=""
GM_WEB_PID=""

start_client() {
  PORT="$CLIENT_PORT" \
  HIEUSRO_GAME_UPSTREAM_HOST="$PUBLIC_HOST" \
  OPENSRO_ASSET_UPSTREAM_HOST="opensro.online" \
  node /opt/hieusro/client-edge/edge.mjs > >(tee /tmp/hieusro-client-edge.log) 2>&1 &
  CLIENT_PID=$!
  echo "All-in-one client edge started pid=$CLIENT_PID port=$CLIENT_PORT"
}

start_gm_web() {
  PORT="$GM_WEB_PORT" \
  GAME_CONTROL_URL="http://127.0.0.1:8793" \
  GAME_VERSION_CONTROL_URL="http://127.0.0.1:8794" \
  GM_CONTROL_TOKEN="$HIEUSRO_GM_CONTROL_TOKEN" \
  GM_ADMIN_PASSWORD="$HIEUSRO_GM_ADMIN_PASSWORD" \
  GM_SESSION_SECRET="$HIEUSRO_GM_SESSION_SECRET" \
  node /opt/hieusro/gm-web/server.mjs > >(tee /tmp/hieusro-gm-web.log) 2>&1 &
  GM_WEB_PID=$!
  echo "All-in-one GM web started pid=$GM_WEB_PID port=$GM_WEB_PORT"
}

cleanup() {
  set +e
  [ -n "$CORE_PID" ] && kill "$CORE_PID" >/dev/null 2>&1 || true
  [ -n "$CLIENT_PID" ] && kill "$CLIENT_PID" >/dev/null 2>&1 || true
  [ -n "$GM_WEB_PID" ] && kill "$GM_WEB_PID" >/dev/null 2>&1 || true
  wait >/dev/null 2>&1 || true
}
trap cleanup TERM INT EXIT

start_client
start_gm_web
/opt/hieusro/runtime-entrypoint.sh &
CORE_PID=$!

echo "All-in-one supervisor active; core pid=$CORE_PID"

while true; do
  if ! kill -0 "$CORE_PID" >/dev/null 2>&1; then
    wait "$CORE_PID" || STATUS=$?
    echo "HieuSRO core runtime exited status=${STATUS:-0}" >&2
    exit "${STATUS:-1}"
  fi
  if ! kill -0 "$CLIENT_PID" >/dev/null 2>&1; then
    echo "Client edge exited; restarting" >&2
    start_client
  fi
  if ! kill -0 "$GM_WEB_PID" >/dev/null 2>&1; then
    echo "GM web exited; restarting" >&2
    start_gm_web
  fi
  sleep 5
done
