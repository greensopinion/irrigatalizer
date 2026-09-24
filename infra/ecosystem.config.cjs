// pm2 process definition for the Irrigatalizer controller.
//
// This file ships inside the release tarball and is executed on the Pi by pm2.
// deploy.sh writes an `infra.env` next to it (from config.env) so the concrete
// paths/port/driver land here without being baked into the committed file.
//
// The controller is a single long-lived Node process that owns GPIO, the
// scheduler, persistence, and the API, and serves the built SPA. It must stay
// resident and restart on crash so the safety machinery (boot safe-off, crash
// handlers, watchdog) governs the relays.

const path = require("node:path");
const fs = require("node:fs");

const appDir = __dirname;

// Load deploy-time settings written by deploy.sh. Falls back to sensible
// defaults so `pm2 start ecosystem.config.cjs` still works if run by hand.
function loadEnv() {
  const envFile = path.join(appDir, "infra.env");
  const env = {};
  if (fs.existsSync(envFile)) {
    for (const raw of fs.readFileSync(envFile, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^"|"$/g, "");
      env[key] = value;
    }
  }
  return env;
}

const deployEnv = loadEnv();

const runtimeEnv = {
  NODE_ENV: "production",
  PORT: deployEnv.APP_PORT || "9000",
  // Absolute path to the built SPA so the server never has to guess. It sits
  // beside the compiled server inside the release: <APP_DIR>/web-ui/dist.
  WEB_UI_DIST: path.join(appDir, "web-ui", "dist"),
  // The JSON stores live at `$HOME/.irrigatalizer`. Point HOME at the explicit,
  // redeploy-safe data directory so config/history persist outside APP_DIR
  // (which is replaced wholesale on each deploy). Data then lives at
  // <DATA_HOME>/.irrigatalizer.
  HOME: deployEnv.DATA_HOME || appDir,
  // Always set GPIO_DRIVER explicitly (empty when unset) so `pm2 startOrRestart
  // --update-env` overwrites any value from a previous deploy. Omitting the key
  // instead leaves pm2's persisted env untouched, so an earlier GPIO_DRIVER=fake
  // would survive a redeploy that meant to clear it — the process would keep
  // running the fake driver despite an empty config value. The server treats an
  // empty string the same as unset and selects the real gpiod driver.
  GPIO_DRIVER: deployEnv.GPIO_DRIVER || "",
};

// Write logs to an explicit, service-user-owned directory (the data dir, which
// persists across redeploys) rather than relying on pm2's default under $HOME/
// .pm2 — that default was silently uncaptured/root-owned during bring-up, which
// made a failed boot impossible to diagnose. deploy.sh ensures this dir exists
// and is owned by the service user.
const logDir = path.join(deployEnv.DATA_HOME || appDir, "logs");

module.exports = {
  apps: [
    {
      name: "irrigatalizer",
      script: path.join(appDir, "server", "dist", "index.js"),
      cwd: appDir,
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      // Give the process room; a restart storm should back off, not hammer.
      restart_delay: 2000,
      kill_timeout: 8000,
      // Explicit log files so stdout/stderr are always captured and readable by
      // the service user. merge_logs keeps them simple in fork mode; timestamps
      // make a crash loop legible.
      out_file: path.join(logDir, "irrigatalizer-out.log"),
      error_file: path.join(logDir, "irrigatalizer-error.log"),
      merge_logs: true,
      time: true,
      env: runtimeEnv,
    },
  ],
};
