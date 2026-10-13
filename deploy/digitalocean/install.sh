#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/traanviet3010-ux/cloude.git"
BRANCH="hieusro-digitalocean"
ROOT_DIR="/opt/hieusro"
SRC_DIR="$ROOT_DIR/src"
DEPLOY_DIR="$SRC_DIR/deploy/digitalocean"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 git curl openssl ufw ca-certificates
systemctl enable --now docker

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

mkdir -p "$ROOT_DIR"
if [ ! -d "$SRC_DIR/.git" ]; then
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$SRC_DIR"
else
  git -C "$SRC_DIR" fetch origin "$BRANCH"
  git -C "$SRC_DIR" checkout "$BRANCH"
  git -C "$SRC_DIR" reset --hard "origin/$BRANCH"
fi

PUBLIC_IP="$(curl -fsS --max-time 3 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address || true)"
if [ -z "$PUBLIC_IP" ]; then
  PUBLIC_IP="$(hostname -I | awk '{print $1}')"
fi
if [ -z "$PUBLIC_IP" ]; then
  echo "Could not determine the Droplet public IPv4 address." >&2
  exit 1
fi

IP_LABEL="${PUBLIC_IP//./-}"
ENV_FILE="$DEPLOY_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  PROVISIONING_TOKEN="$(openssl rand -hex 48)"
  GM_SESSION_SECRET="$(openssl rand -hex 48)"
  GM_ADMIN_PASSWORD="$(openssl rand -hex 16)"
  cat > "$ENV_FILE" <<EOF
HIEUSRO_HOST=play.${IP_LABEL}.sslip.io
HIEUSRO_PORTAL_HOST=portal.${IP_LABEL}.sslip.io
ACME_EMAIL=off
HIEUSRO_PROVISIONING_TOKEN=${PROVISIONING_TOKEN}
HIEUSRO_GM_ADMIN_PASSWORD=${GM_ADMIN_PASSWORD}
HIEUSRO_GM_SESSION_SECRET=${GM_SESSION_SECRET}
EOF
  chmod 600 "$ENV_FILE"
fi

cd "$DEPLOY_DIR"
docker compose --env-file .env -f compose.yml build
docker compose --env-file .env -f compose.yml up -d --remove-orphans

echo "HieuSRO deployment started."
echo "Game:   https://$(grep '^HIEUSRO_HOST=' .env | cut -d= -f2-)"
echo "Portal: https://$(grep '^HIEUSRO_PORTAL_HOST=' .env | cut -d= -f2-)"
echo "GM:     https://$(grep '^HIEUSRO_HOST=' .env | cut -d= -f2-)/gm/"
echo "The GM password is stored only in $ENV_FILE on the server."
