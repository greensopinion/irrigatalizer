#!/usr/bin/env bash
#
# deploy.sh — build, ship, install, and (re)start the controller on the Pi.
#
# Steps:
#   1. Build the release tarball locally (package.sh).
#   2. Copy it to the Pi over scp.
#   3. Extract it into APP_DIR, run `npm install --omit=dev`, write the runtime
#      env file, and start/reload the pm2 service, then persist the pm2 list.
#
# Assumes provision.sh has already run once. Re-running deploys a new build with
# near-zero downtime (pm2 reload). This performs REMOTE operations over SSH; run
# it only when you intend to update the Pi.
#
# Usage:
#   ./infra/deploy.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
TARBALL="${REPO_ROOT}/dist/irrigatalizer-release.tar.gz"

if [ ! -f "${CONFIG_FILE}" ]; then
  echo "error: ${CONFIG_FILE} not found. Copy config.env.example to config.env and edit it." >&2
  exit 1
fi
# shellcheck source=/dev/null
. "${CONFIG_FILE}"

: "${PI_HOST:?PI_HOST must be set in config.env}"
: "${PI_USER:?PI_USER must be set in config.env}"
: "${PI_SSH_PORT:=22}"
: "${SERVICE_USER:?SERVICE_USER must be set in config.env}"
: "${APP_DIR:?APP_DIR must be set in config.env}"
: "${DATA_DIR:?DATA_DIR must be set in config.env}"
: "${APP_PORT:=9000}"
: "${GPIO_DRIVER:=}"

SSH_OPTS=(-p "${PI_SSH_PORT}" -o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-P "${PI_SSH_PORT}" -o StrictHostKeyChecking=accept-new)
if [ -n "${PI_SSH_KEY:-}" ]; then
  SSH_OPTS+=(-i "${PI_SSH_KEY}")
  SCP_OPTS+=(-i "${PI_SSH_KEY}")
fi

# 1. Build.
"${SCRIPT_DIR}/package.sh"

# 2. Ship to a staging path in the login user's home, then move into place with
#    sudo (APP_DIR is owned by the service user).
REMOTE_TMP="/tmp/irrigatalizer-release.tar.gz"
echo "==> Copying release to ${PI_USER}@${PI_HOST}:${REMOTE_TMP}"
scp "${SCP_OPTS[@]}" "${TARBALL}" "${PI_USER}@${PI_HOST}:${REMOTE_TMP}"

# 3. Remote install + restart. Config values are passed via an exported header so
#    they are never interpolated into command bodies.
echo "==> Installing and (re)starting on the Pi..."
REMOTE_HEADER="$(cat <<EOF
export SERVICE_USER="${SERVICE_USER}"
export APP_DIR="${APP_DIR}"
export DATA_DIR="${DATA_DIR}"
export APP_PORT="${APP_PORT}"
export GPIO_DRIVER="${GPIO_DRIVER}"
export REMOTE_TMP="${REMOTE_TMP}"
EOF
)"

remote_script() {
  cat <<'REMOTE'
set -euo pipefail

echo "--> Checking for passwordless sudo..."
# Runs non-interactively over `ssh bash -s`; a sudo password prompt would hang.
if ! sudo -n true 2>/dev/null; then
  echo "    error: '${USER}' cannot run sudo without a password on this Pi." >&2
  echo "    deploy.sh runs non-interactively and cannot answer a password prompt." >&2
  echo "    Enable passwordless sudo for this user (see infra/README.md) and retry." >&2
  exit 1
fi

echo "--> Extracting release into ${APP_DIR}..."
sudo mkdir -p "${APP_DIR}"
# Replace app contents but preserve ownership by extracting as the service user.
sudo rm -rf "${APP_DIR:?}/server" "${APP_DIR:?}/web-ui" \
  "${APP_DIR}/package.json" "${APP_DIR}/ecosystem.config.cjs" "${APP_DIR}/RELEASE"
sudo tar -C "${APP_DIR}" -xzf "${REMOTE_TMP}"
sudo chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"
rm -f "${REMOTE_TMP}"

echo "--> Writing runtime env (infra.env) for pm2..."
sudo tee "${APP_DIR}/infra.env" >/dev/null <<ENV
APP_PORT=${APP_PORT}
GPIO_DRIVER=${GPIO_DRIVER}
DATA_HOME=${DATA_DIR}
ENV
sudo chown "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}/infra.env"

echo "--> Ensuring log + pm2 directories are owned by ${SERVICE_USER}..."
# The ecosystem config writes logs to ${DATA_DIR}/logs. Make sure it (and the
# pm2 home) exist and are service-user-owned, so logs are actually captured and
# never end up root-owned (which previously hid a failed boot).
sudo mkdir -p "${DATA_DIR}/logs" "${DATA_DIR}/.pm2"
sudo chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}/logs" "${DATA_DIR}/.pm2"

# Run a command as the service user, from a directory the service user can
# access (APP_DIR). pm2 spawns its daemon inheriting the current working
# directory; launching from a dir the service user cannot enter (e.g. the login
# user's 0700 home) makes Node's spawn fail with `spawn node EACCES`. Running
# from APP_DIR avoids that.
as_service() {
  sudo -u "${SERVICE_USER}" env HOME="${DATA_DIR}" sh -c "cd '${APP_DIR}' && $*"
}

echo "--> Installing runtime dependencies (npm install --omit=dev)..."
as_service "npm install --omit=dev --no-audit --no-fund"

echo "--> Starting/reloading the pm2 service as ${SERVICE_USER}..."
# reload if already running (near-zero downtime), otherwise start fresh.
if as_service "pm2 describe irrigatalizer" >/dev/null 2>&1; then
  as_service "pm2 reload '${APP_DIR}/ecosystem.config.cjs'"
else
  as_service "pm2 start '${APP_DIR}/ecosystem.config.cjs'"
fi

echo "--> Saving the pm2 process list so it resurrects on boot..."
as_service "pm2 save"

echo "--> Health check: waiting for the app to answer on port ${APP_PORT}..."
# pm2 reporting "online" only means the process is alive, not that the HTTP
# server bound the port (a failed boot can linger as live-but-not-listening).
# Poll the status endpoint and fail the deploy loudly if it never responds, so a
# broken deploy is obvious instead of silently leaving a dead service.
healthy=0
for attempt in $(seq 1 15); do
  if curl -fsS -o /dev/null "http://localhost:${APP_PORT}/api/status"; then
    healthy=1
    echo "    OK: /api/status responded (attempt ${attempt})."
    break
  fi
  sleep 1
done

if [ "${healthy}" != "1" ]; then
  echo "    ERROR: app did not answer on port ${APP_PORT} after 15s." >&2
  echo "    Recent logs:" >&2
  as_service "pm2 logs irrigatalizer --lines 40 --nostream" >&2 || true
  as_service "pm2 status irrigatalizer" >&2 || true
  exit 1
fi

echo "--> Current status:"
as_service "pm2 status irrigatalizer" || true
cat "${APP_DIR}/RELEASE" 2>/dev/null || true
echo "--> Deploy complete."
REMOTE
}

printf '%s\n%s\n' "${REMOTE_HEADER}" "$(remote_script)" \
  | ssh "${SSH_OPTS[@]}" "${PI_USER}@${PI_HOST}" 'bash -s'

echo "==> Deployed. The app should be reachable at http://${PI_HOST}/ (port 80 -> ${APP_PORT})."
