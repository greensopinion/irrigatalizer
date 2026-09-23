## About

This project provides a NodeJS application for operating a Raspberry Pi that drives an irrigation system via GPIO pins, with two major components:

1. A web UI for configuring an irrigation schedule
2. A scheduler that turns GPIO pins on and off

### Status

This project is in the early stages. Lots of features are missing.

Continuous Integration: ![CI](https://github.com/greensopinion/irrigatalizer/workflows/CI/badge.svg)

### Local development (with a fake GPIO driver)

The app is a TypeScript Express backend (`server/`) that serves a Vite + React SPA
(`web-ui/`). For development you can run the whole thing on a machine with **no
GPIO hardware and no `gpiod` CLI** by using the in-memory fake driver:

```sh
npm install
npm run dev:fake
```

This runs two processes together (via `concurrently`):

- the backend on port **9000**, using the `FakeGpioDriver` (selected by
  `GPIO_DRIVER=fake`) — pin state is held in memory and nothing shells out to
  `gpioset`/`gpioget`;
- the Vite dev server on port **5173**, which proxies `/api/*` to the backend.

Open <http://localhost:5173>. Because the SPA calls the API same-origin and Vite
proxies it, **only port 5173** needs to be reachable.

`npm run dev` is the same flow but with the real libgpiod driver, which requires
`gpiod` installed and access to `/dev/gpiochip0` — use `dev:fake` on a dev machine.

#### Reaching it from another machine (e.g. a dev container)

The Vite dev server binds all interfaces on a fixed port (`host: true`,
`port: 5173`, `strictPort`), so it is reachable once that port is exposed to your
host. Forward port `5173` from your editor's Ports panel, or publish it at the
container level (see `.devcontainer/docker-compose.yml`).

## Deploying to a Raspberry Pi

Deployment is infrastructure-as-code under [`infra/`](infra/), driven over SSH from
your machine against a bare **Raspberry Pi OS Lite (arm64)** install (Debian 12
bookworm or later). See [`infra/README.md`](infra/README.md) for the full guide.

In short:

```sh
cp infra/config.env.example infra/config.env   # set PI_HOST, PI_USER, etc.
./infra/provision.sh                            # one-time system setup on the Pi
./infra/deploy.sh                               # build, ship, install, (re)start
```

- `provision.sh` installs the libgpiod v2 CLI (`gpiod`), Node.js, and pm2; creates
  an unprivileged service user in the `gpio` group; and sets up a persistent
  port `80 -> app` redirect so the app runs without root.
- `deploy.sh` runs the local verification/build, packages the compiled server plus
  the built SPA into a tarball, and installs it on the Pi under pm2 (`npm install
  --omit=dev` pulls only the runtime dependencies). Redeploys reload with near-zero
  downtime; persisted config and history live outside the app directory and survive
  redeploys.

The controller is a single Node process: it owns GPIO, the scheduler, persistence,
and the API, and serves the built SPA. It is local-network only with no
authentication, by design.

### Wiring: normally-closed relays

Wire the relays **normally-closed** so that loss of power or the controlling
process de-energizes the valves and stops watering. Each active line is held high
by a child process, so if the Node process dies the line releases; combined with
normally-closed wiring, that fails safe. This is a wiring convention, not something
the software enforces.

### GPIO on libgpiod v2

The GPIO driver targets **libgpiod v2** (the version on bookworm and later); it
does not support the older v1.x CLI. See [`docs/gpio-driver.md`](docs/gpio-driver.md)
for details. The driver is not yet hardware-validated — confirm pin toggling on the
Pi before trusting it with real valves.

## Related

There are several related projects out there, most of which are more mature, have more features and are better supported:

- [Open Sprinkler](https://github.com/OpenSprinkler)
- [Raspberry Pi Controlled Irrigation System (Instructables)](https://www.instructables.com/id/Raspberry-Pi-Controlled-Irrigation-System/)
- [SIP (Sustainable Irrigation Platform)](https://dan-in-ca.github.io/SIP/)

## License

Copyright 2020 David Green

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
