#!/usr/bin/env bash
#
# Remote setup script for the Sichuan Mahjong server.
# Run this ON the target server (e.g. root@45.76.49.222) to install Node.js,
# fetch the code, and run it as a managed systemd service.
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
NODE_MAJOR="${NODE_MAJOR:-20}"
SERVICE_NAME="${SERVICE_NAME:-majhong}"

echo "==> Sichuan Mahjong server deploy"
echo "    repo:    $REPO_URL ($BRANCH)"
echo "    dir:     $APP_DIR"
echo "    port:    $PORT"

# --- 1. Node.js -------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || \
   [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "==> Installing Node.js $NODE_MAJOR.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  echo "==> Node.js $(node -v) already present"
fi

# --- 2. Code ----------------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  apt-get update && apt-get install -y git
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

# --- 3. Dependencies --------------------------------------------------------
echo "==> Installing production dependencies"
cd "$APP_DIR"
npm install --omit=dev

# --- 4. systemd service -----------------------------------------------------
echo "==> Installing systemd service: $SERVICE_NAME"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Sichuan Mahjong (血战到底) game server
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=PORT=${PORT}
Environment=NODE_ENV=production
ExecStart=$(command -v node) ${APP_DIR}/src/server.js
Restart=on-failure
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "==> Done. Service status:"
systemctl --no-pager --full status "${SERVICE_NAME}" | head -n 12 || true
echo
echo "Server should be reachable at: http://$(hostname -I | awk '{print $1}'):${PORT}/"
echo "Health check:                  curl http://localhost:${PORT}/healthz"
echo "Logs:                          journalctl -u ${SERVICE_NAME} -f"
