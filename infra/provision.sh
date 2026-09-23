#!/usr/bin/env bash
#
# provision.sh — one-time system setup on a bare Raspberry Pi OS Lite (arm64).
#
# Prepares a fresh install to run the Irrigatalizer controller: installs Node,
# the libgpiod CLI tools, and pm2; creates the unprivileged service account and
# puts it in the `gpio` group; creates the app and data directories; and sets up
# a port 80 -> APP_PORT redirect that persists across reboots.
#
# Idempotent: safe to run again. It changes system state on the Pi over SSH but
# does NOT deploy the application (use deploy.sh for that).
#
# Usage:
#   cp infra/config.env.example infra/config.env   # then edit
#   ./infra/provision.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"

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
: "${NODE_MAJOR:=24}"

SSH_OPTS=(-p "${PI_SSH_PORT}" -o StrictHostKeyChecking=accept-new)
if [ -n "${PI_SSH_KEY:-}" ]; then
  SSH_OPTS+=(-i "${PI_SSH_KEY}")
fi

echo "==> Provisioning ${PI_USER}@${PI_HOST}:${PI_SSH_PORT}"

# The remote script runs as PI_USER (with sudo) on the Pi. Config values are
# exported into its environment via a small header so we never string-interpolate
# untrusted-looking values into the middle of shell commands.
remote_script() {
  cat <<'REMOTE'
set -euo pipefail

echo "--> Checking for passwordless sudo..."
# This script runs non-interactively over `ssh bash -s`, so a sudo password
# prompt would hang with no way to answer. Fail fast with a clear message.
if ! sudo -n true 2>/dev/null; then
  echo "    error: '${USER}' cannot run sudo without a password on this Pi." >&2
  echo "    provision.sh runs non-interactively and cannot answer a password prompt." >&2
  echo "    Enable passwordless sudo for this user, e.g.:" >&2
  echo "      echo '${USER} ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/${USER}" >&2
  echo "      sudo chmod 0440 /etc/sudoers.d/${USER}" >&2
  echo "    (On Raspberry Pi OS the default user typically already has this.)" >&2
  exit 1
fi

echo "--> Detected OS:"
. /etc/os-release || true
echo "    ${PRETTY_NAME:-unknown}"

echo "--> Updating apt and installing base packages (gpiod, curl, ca-certificates, iptables-persistent)..."
# Preseed iptables-persistent so it installs without an interactive prompt.
echo "iptables-persistent iptables-persistent/autosave_v4 boolean true" | sudo debconf-set-selections
echo "iptables-persistent iptables-persistent/autosave_v6 boolean true" | sudo debconf-set-selections
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  gpiod curl ca-certificates iptables iptables-persistent

echo "--> Verifying libgpiod CLI is present..."
if command -v gpioset >/dev/null 2>&1; then
  gpioset --version 2>/dev/null | head -n1 || true
  echo "    NOTE: the driver targets libgpiod v2 (bookworm and later). Confirm the"
  echo "    version above is v2.x and toggle a pin manually before trusting it to"
  echo "    switch relays (see infra/README.md)."
else
  echo "    error: gpioset not found after install" >&2
  exit 1
fi

echo "--> Installing Node.js ${NODE_MAJOR}.x if needed..."
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  CURRENT_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${CURRENT_MAJOR}" = "${NODE_MAJOR}" ]; then
    NEED_NODE=0
    echo "    Node $(node -v) already installed."
  fi
fi
if [ "${NEED_NODE}" = "1" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  echo "    Installed Node $(node -v)."
fi

echo "--> Installing pm2 globally if needed..."
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
else
  echo "    pm2 already installed."
fi

echo "--> Ensuring service user '${SERVICE_USER}'..."
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  # A system-style account with a real home at DATA_DIR: the JSON stores live at
  # \$HOME/.irrigatalizer, so this keeps persisted data outside APP_DIR.
  sudo useradd --create-home --home-dir "${DATA_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
  echo "    Created ${SERVICE_USER} (home ${DATA_DIR})."
else
  echo "    ${SERVICE_USER} already exists."
fi

echo "--> Adding '${SERVICE_USER}' to the 'gpio' group (for /dev/gpiochip0)..."
if getent group gpio >/dev/null 2>&1; then
  sudo usermod -aG gpio "${SERVICE_USER}"
else
  echo "    WARNING: no 'gpio' group on this system; /dev/gpiochip* permissions may differ."
  echo "    Check 'ls -l /dev/gpiochip*' and grant the service user access accordingly."
fi

echo "--> Verifying GPIO access (informational)..."
# Surface the group membership and device ownership so a permission problem is
# visible here rather than only at first energize. Non-fatal.
getent group gpio || echo "    (no gpio group)"
ls -l /dev/gpiochip* 2>/dev/null || echo "    (no /dev/gpiochip* devices found)"
echo "    ${SERVICE_USER} groups: $(id -nG "${SERVICE_USER}" 2>/dev/null || echo '?')"
echo "    NOTE: group membership takes effect for new logins/services; the pm2"
echo "    service picks it up when it starts at deploy time."

echo "--> Creating directories..."
sudo mkdir -p "${APP_DIR}"
sudo chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"
sudo mkdir -p "${DATA_DIR}/.irrigatalizer"
sudo chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"

echo "--> Setting up port 80 -> ${APP_PORT} redirect..."
# Add the NAT rule only if an equivalent one is not already present, so re-runs
# do not stack duplicates.
if ! sudo iptables -t nat -C PREROUTING -p tcp --dport 80 -j REDIRECT --to-port "${APP_PORT}" 2>/dev/null; then
  sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port "${APP_PORT}"
  echo "    Added redirect rule."
else
  echo "    Redirect rule already present."
fi
# Persist across reboots (iptables-persistent reads /etc/iptables/rules.v4).
sudo mkdir -p /etc/iptables
sudo sh -c 'iptables-save > /etc/iptables/rules.v4'

echo "--> Configuring pm2 to start on boot for '${SERVICE_USER}'..."
# Generate and install the systemd unit that resurrects pm2's saved process list.
sudo env PATH="$PATH" pm2 startup systemd -u "${SERVICE_USER}" --hp "${DATA_DIR}" >/dev/null
echo "    pm2 boot service installed. Saved processes will resurrect after the first deploy."

echo "--> Provisioning complete."
REMOTE
}

# Ship config values as an exported header prepended to the remote script.
REMOTE_HEADER="$(cat <<EOF
export NODE_MAJOR="${NODE_MAJOR}"
export SERVICE_USER="${SERVICE_USER}"
export APP_DIR="${APP_DIR}"
export DATA_DIR="${DATA_DIR}"
export APP_PORT="${APP_PORT}"
EOF
)"

printf '%s\n%s\n' "${REMOTE_HEADER}" "$(remote_script)" \
  | ssh "${SSH_OPTS[@]}" "${PI_USER}@${PI_HOST}" 'bash -s'

echo "==> Done. Next: ./infra/deploy.sh"
