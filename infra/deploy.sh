#!/usr/bin/env bash
#
# deploy.sh — build, ship, install, and (re)start the controller on the Pi.
#
# Steps:
#   1. Build the release tarball locally (package.sh).
#   2. Copy it to the Pi over scp.
#   3. Extract it into APP_DIR, run `npm install --omit=dev`, write the runtime
#      env file, start/restart the pm2 service, and health-check the new build.
#
# Assumes provision.sh has already run once. Re-running deploys a new build via
# `pm2 startOrRestart` (fork mode has a brief restart, which is fine for a single
# controller). This performs REMOTE operations over SSH; run it only when you
# intend to update the Pi.
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

"${SCRIPT_DIR}/package.sh"

# Ship to /tmp, then move into place with sudo: APP_DIR is owned by the service
# user, not the login user doing the scp.
REMOTE_TMP="/tmp/irrigatalizer-release.tar.gz"
echo "==> Copying release to ${PI_USER}@${PI_HOST}:${REMOTE_TMP}"
scp "${SCP_OPTS[@]}" "${TARBALL}" "${PI_USER}@${PI_HOST}:${REMOTE_TMP}"

# Config values are passed via an exported header prepended to the remote script
# so they are never interpolated into command bodies.
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

echo "--> Starting/restarting the pm2 service as ${SERVICE_USER}..."
# pm2's recommended idempotent update: startOrRestart with the ecosystem file
# starts the app if it is not running and restarts it (refreshing config) if it
# is. Passing the ecosystem file (not the app name) plus --update-env is what
# makes pm2 pick up updated `env:` values — CLI env is otherwise conservative and
# would keep stale values. We use fork mode (single owner of the GPIO), where
# `reload` has no zero-downtime advantage over `restart`, so the brief restart is
# expected and acceptable for a single-instance controller.
as_service "pm2 startOrRestart '${APP_DIR}/ecosystem.config.cjs' --update-env"

echo "--> Saving the pm2 process list so it resurrects on boot..."
as_service "pm2 save"

echo "--> Health check: waiting for the new build to answer on port ${APP_PORT}..."
# pm2 reporting "online" only means the process is alive, not that the HTTP
# server bound the port (a failed boot can linger as live-but-not-listening).
# Require the `driver` field in the response: it exists only in current builds,
# so a stale or stray process answering on the port cannot pass this check and
# masquerade as a successful deploy.
healthy=0
for attempt in $(seq 1 15); do
  body="$(curl -fsS "http://localhost:${APP_PORT}/api/status" 2>/dev/null || true)"
  if printf '%s' "${body}" | grep -q '"driver"'; then
    healthy=1
    echo "    OK: /api/status responded with a current build (attempt ${attempt})."
    break
  fi
  sleep 1
done

if [ "${healthy}" != "1" ]; then
  echo "    ERROR: the current build did not answer on port ${APP_PORT} after 15s." >&2
  echo "    Recent logs:" >&2
  as_service "pm2 logs irrigatalizer --lines 40 --nostream" >&2 || true
  as_service "pm2 status irrigatalizer" >&2 || true
  # Distinguish a crash from a port already held by a non-pm2 process: if
  # something owns the port but pm2's app is not the listener, a stray process is
  # squatting it (e.g. a hand-started `node`). Report it rather than auto-killing,
  # since killing arbitrary processes is a decision for a human.
  echo "    Listeners on port ${APP_PORT}:" >&2
  if command -v ss >/dev/null 2>&1; then
    sudo ss -ltnp "sport = :${APP_PORT}" >&2 || true
  fi
  echo "    If a non-pm2 process is holding ${APP_PORT}, stop it and redeploy." >&2
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
