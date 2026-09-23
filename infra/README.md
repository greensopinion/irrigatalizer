# Deployment (infra)

Infrastructure-as-code to set up and deploy the Irrigatalizer controller on a
Raspberry Pi over SSH, starting from a bare **Raspberry Pi OS Lite (arm64)**
install.

Everything here runs from your machine and drives the Pi over SSH. Nothing is
executed automatically — you run each script by hand when you intend to change
the Pi.

## What's here

| File                    | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `config.env.example`    | Template for connection + install settings. Copy to `config.env`.  |
| `provision.sh`          | One-time system setup on the Pi (Node, gpiod, pm2, user, network). |
| `package.sh`            | Build locally and assemble a release tarball. Runs on your machine.|
| `deploy.sh`             | Build, ship, install deps, and (re)start the pm2 service on the Pi.|
| `ecosystem.config.cjs`  | pm2 process definition (shipped inside the release).               |

## Prerequisites

On your machine: `ssh`, `scp`, `tar`, Node/npm (to build), and this repo checked
out. On the Pi: a fresh Raspberry Pi OS Lite (arm64) with SSH enabled and a login
user that has `sudo` (both configurable in Raspberry Pi Imager).

**Passwordless sudo is required.** `provision.sh` and `deploy.sh` run
non-interactively over SSH, so they cannot answer a sudo password prompt — both
scripts preflight-check for it and fail fast with instructions if it is missing.
On Raspberry Pi OS the default user usually already has passwordless sudo. To grant
it for `PI_USER` manually:

```sh
echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/$USER
sudo chmod 0440 /etc/sudoers.d/$USER
```

## One-time setup

1. Flash Raspberry Pi OS Lite (arm64) and enable SSH. In Raspberry Pi Imager you
   can preset the hostname, the login user, and your SSH public key.

2. Create your config from the template and edit it:

   ```sh
   cp infra/config.env.example infra/config.env
   $EDITOR infra/config.env
   ```

   At minimum set `PI_HOST` and `PI_USER`. `config.env` is git-ignored so your
   host details never get committed.

3. Provision the Pi:

   ```sh
   ./infra/provision.sh
   ```

   This installs the libgpiod CLI (`gpiod`), Node.js, and pm2; creates the
   `SERVICE_USER` account and adds it to the `gpio` group; creates `APP_DIR` and
   `DATA_DIR`; sets up a persistent port `80 -> APP_PORT` redirect; and configures
   pm2 to start on boot. It is idempotent, so you can re-run it safely.

## Deploy (and redeploy)

```sh
./infra/deploy.sh
```

This builds the release (`npm run verify` + packaging), copies the tarball to the
Pi, extracts it into `APP_DIR`, runs `npm install --omit=dev` (runtime deps only:
express, luxon, zod), writes the runtime env, and reloads the pm2 service with
near-zero downtime. The pm2 process list is saved so the service resurrects on
reboot.

Once deployed, the app is reachable at `http://<PI_HOST>/` (port 80 redirects to
`APP_PORT`). It is local-network only with no authentication, by design.

## How data persists across deploys

`APP_DIR` (default `/opt/irrigatalizer`) is replaced wholesale on every deploy, so
persisted state lives elsewhere. The service account's home is `DATA_DIR` (default
`/var/lib/irrigatalizer`) and the JSON config + history are stored at
`DATA_DIR/.irrigatalizer` (the server writes to `$HOME/.irrigatalizer`). Deploys
never touch `DATA_DIR`.

## Operating the service on the Pi

pm2 runs the process as `SERVICE_USER`. To inspect or control it, run pm2 as that
user with its home pointed at `DATA_DIR`, e.g.:

```sh
sudo -u irrigatalizer env HOME=/var/lib/irrigatalizer pm2 status
sudo -u irrigatalizer env HOME=/var/lib/irrigatalizer pm2 logs irrigatalizer
sudo -u irrigatalizer env HOME=/var/lib/irrigatalizer pm2 restart irrigatalizer
```

(Substitute your `SERVICE_USER` / `DATA_DIR` if you changed them.)

## Wiring: normally-closed relays

Wire the relays **normally-closed** so that a loss of power or the controlling
process de-energizes the valves and stops watering. The driver holds each active
line high with a child process, so if the Node process dies the line releases —
combined with normally-closed wiring, that fails safe. This is a wiring
convention, not something the software can enforce.

## GPIO: libgpiod v2

Current `raspios_lite_arm64_latest` images ship **libgpiod v2** (Debian 12
bookworm and Debian 13 trixie). The production GPIO driver (`GpiodCliDriver`)
targets the v2 `gpioset`/`gpioget` CLI (see
[`docs/gpio-driver.md`](../docs/gpio-driver.md)) and does **not** support the older
libgpiod v1.x CLI (bullseye). Provisioning has been run against trixie
(libgpiod v2.2.1); `provision.sh` prints the `gpio` group and `/dev/gpiochip*`
ownership so you can confirm the service user has access.

The driver has not yet been exercised on real hardware. Before trusting the
controller with real valves, confirm on the Pi:

1. `gpioset --version` reports libgpiod v2.x.
2. A pin toggles and reads back as expected, e.g.
   `gpioset -c gpiochip0 17=1` (in one shell) and
   `gpioget --numeric -c gpiochip0 17` (in another) returns `1`.

You can deploy and exercise the whole UI without hardware by setting
`GPIO_DRIVER="fake"` in `config.env` — the in-memory driver will not switch real
relays.

## Note on git and remote operations

These scripts perform SSH/scp operations against your Pi only when you run
`provision.sh` or `deploy.sh`. They do not perform any git remote operations.
Deploying is your own ops step; run it deliberately.
