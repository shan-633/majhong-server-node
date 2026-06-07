#!/usr/bin/env bash
#
# Remote setup script for the Sichuan Mahjong server (Docker deploy).
# Run this ON the target server (e.g. root@45.76.49.222) to install Docker,
# fetch the code, and run it as a managed Docker container.
#
# Usage (on the server):
#   curl -fsSL <raw-url>/deploy/remote-setup.sh | bash
# or copy this file over and:
#   REPO_URL=https://github.com/shan-633/majhong-server-node.git \
#   BRANCH=claude/sichuan-mahjong-server-RQZ94 \
#   PORT=3000 bash remote-setup.sh
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/shan-633/majhong-server-node.git}"
BRANCH="${BRANCH:-claude/sichuan-mahjong-server-RQZ94}"
APP_DIR="${APP_DIR:-/opt/majhong-server}"
PORT="${PORT:-3000}"
CONTAINER_NAME="${CONTAINER_NAME:-majhong-server}"
IMAGE_NAME="${IMAGE_NAME:-majhong-server:latest}"

echo "==> Sichuan Mahjong server deploy (Docker)"
echo "    repo:      $REPO_URL ($BRANCH)"
echo "    dir:       $APP_DIR"
echo "    port:      $PORT"
echo "    container: $CONTAINER_NAME"

# --- 1. Docker --------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker Engine"
  curl -fsSL https://get.docker.com | sh
else
  echo "==> Docker $(docker --version | awk '{print $3}' | tr -d ',') already present"
fi
systemctl enable --now docker 2>/dev/null || true

# Detect the Compose command: prefer the v2 plugin, fall back to docker-compose.
COMPOSE=""
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
fi

# --- 2. Code ----------------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  (apt-get update && apt-get install -y git) || yum install -y git || true
fi

if [ -d "$APP_DIR/.git" ]; then
  echo "==> Updating existing checkout"
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  echo "==> Cloning repository"
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# --- 3. Build & run with Docker ---------------------------------------------
if [ -n "$COMPOSE" ]; then
  echo "==> Building and starting via $COMPOSE"
  PORT="$PORT" $COMPOSE up -d --build
else
  echo "==> docker compose not available; using plain docker build/run"
  docker build -t "$IMAGE_NAME" .
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -p "${PORT}:3000" \
    -e NODE_ENV=production \
    "$IMAGE_NAME"
fi

# --- 4. Report --------------------------------------------------------------
echo "==> Done. Running containers:"
docker ps --filter "name=${CONTAINER_NAME}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
echo
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "Server should be reachable at: http://${IP:-<server-ip>}:${PORT}/"
echo "Health check:                  curl http://localhost:${PORT}/healthz"
echo "Logs:                          docker logs -f ${CONTAINER_NAME}"
echo "Restart:                       docker restart ${CONTAINER_NAME}"
