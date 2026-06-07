#!/usr/bin/env bash
#
# Run this FROM YOUR LOCAL MACHINE (one that can reach the server over SSH).
# It copies remote-setup.sh to the server and executes it over SSH. The remote
# script performs a Docker-based deploy (installs Docker, builds the image, and
# runs the container with a restart policy).
#
# Usage:
#   ./deploy/push-deploy.sh [user@host] [port]
# Example:
#   ./deploy/push-deploy.sh root@45.76.49.222
#
# You will be prompted for the SSH password (or use an SSH key / ssh-agent).
# To avoid the prompt you can install sshpass and set SSHPASS, then pass -e.
#
set -euo pipefail

TARGET="${1:-root@45.76.49.222}"
APP_PORT="${PORT:-3000}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Deploying to ${TARGET} (app port ${APP_PORT})"

# Copy the remote setup script and run it.
scp "${HERE}/remote-setup.sh" "${TARGET}:/tmp/majhong-remote-setup.sh"
ssh "${TARGET}" "PORT=${APP_PORT} bash /tmp/majhong-remote-setup.sh"

echo "==> Deployment finished."
