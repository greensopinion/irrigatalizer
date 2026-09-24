#!/usr/bin/env bash
#
# package.sh — build the app locally and assemble a release tarball.
#
# Produces dist/irrigatalizer-release.tar.gz containing the compiled server, the
# built SPA, the pm2 ecosystem config, and a minimal package.json so that
# `npm install --omit=dev` on the Pi pulls only the runtime dependencies
# (express, luxon, zod). No dev toolchain or source is shipped.
#
# Runs entirely on your machine; it does not touch the Pi. deploy.sh calls this
# automatically, but you can run it on its own to inspect the artifact.
#
# Usage:
#   ./infra/package.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="${REPO_ROOT}/dist"
STAGE_DIR="${BUILD_DIR}/release-stage"
TARBALL="${BUILD_DIR}/irrigatalizer-release.tar.gz"

cd "${REPO_ROOT}"

echo "==> Verifying and building (typecheck + lint + test + build)..."
npm run verify

echo "==> Staging release layout..."
rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}/server/dist" "${STAGE_DIR}/web-ui/dist"

cp -R server/dist/. "${STAGE_DIR}/server/dist/"
cp -R web-ui/dist/. "${STAGE_DIR}/web-ui/dist/"
cp infra/ecosystem.config.cjs "${STAGE_DIR}/ecosystem.config.cjs"

# Ship only the server's production dependencies (read from server/package.json
# to stay in sync) so `npm install --omit=dev` on the Pi resolves nothing extra.
echo "==> Generating runtime package.json..."
STAGE_DIR="${STAGE_DIR}" node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const stage = process.env.STAGE_DIR;
const serverPkg = JSON.parse(readFileSync("server/package.json", "utf8"));

const runtimePkg = {
  name: "irrigatalizer",
  version: serverPkg.version,
  private: true,
  type: "module",
  scripts: {
    start: "node server/dist/index.js",
  },
  dependencies: serverPkg.dependencies ?? {},
};

writeFileSync(
  resolve(stage, "package.json"),
  JSON.stringify(runtimePkg, null, 2) + "\n",
);
NODE

# A marker the deploy health check and operators use to identify the artifact.
BUILD_STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_REV="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
printf 'built=%s\ncommit=%s\n' "${BUILD_STAMP}" "${GIT_REV}" > "${STAGE_DIR}/RELEASE"

echo "==> Creating tarball..."
rm -f "${TARBALL}"
tar -C "${STAGE_DIR}" -czf "${TARBALL}" .

echo "==> Built ${TARBALL}"
tar -tzf "${TARBALL}" | sed 's/^/    /' | head -n 40
echo "==> Package complete (commit ${GIT_REV})."
