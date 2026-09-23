import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, type ApiDeps } from "./app";
import { emptyConfiguration, emptyHistory } from "../persistence/schema";

/**
 * Minimal API deps for exercising the static-file serving; the scheduler/manual-run
 * side effects are not needed here, so they resolve to no-ops.
 */
function staticOnlyDeps(staticDir: string): ApiDeps {
  return {
    readConfiguration: async () => emptyConfiguration(),
    writeConfiguration: async () => {},
    readHistory: async () => emptyHistory(),
    applyConfiguration: async () => {},
    startManualRun: async () => {},
    stopManualRun: async () => {},
    activeManualRun: () => undefined,
    clock: () => 0,
    staticDir,
  };
}

describe("SPA static serving", () => {
  let staticDir: string;

  beforeEach(async () => {
    staticDir = await mkdtemp(join(tmpdir(), "irrigatalizer-spa-"));
    await writeFile(
      join(staticDir, "index.html"),
      "<!doctype html><html><body><div id=\"root\"></div></body></html>",
    );
    await writeFile(join(staticDir, "app.js"), "console.log('spa');");
  });

  afterEach(async () => {
    await rm(staticDir, { recursive: true, force: true });
  });

  it("serves index.html at the root", async () => {
    const app = createApp(staticOnlyDeps(staticDir));
    const response = await request(app).get("/");
    expect(response.status).toBe(200);
    expect(response.text).toContain('id="root"');
  });

  it("serves real static assets", async () => {
    const app = createApp(staticOnlyDeps(staticDir));
    const response = await request(app).get("/app.js");
    expect(response.status).toBe(200);
    expect(response.text).toContain("spa");
  });

  it("falls back to index.html for client-side routes (deep links)", async () => {
    const app = createApp(staticOnlyDeps(staticDir));
    const response = await request(app).get("/schedule");
    expect(response.status).toBe(200);
    expect(response.text).toContain('id="root"');
  });

  it("returns JSON 404 for unknown API routes rather than the SPA shell", async () => {
    const app = createApp(staticOnlyDeps(staticDir));
    const response = await request(app).get("/api/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not found" });
    expect(response.text).not.toContain("root");
  });

  it("stays API-only when no static directory is configured", async () => {
    const deps = staticOnlyDeps(staticDir);
    const app = createApp({ ...deps, staticDir: undefined });
    const response = await request(app).get("/");
    // With no SPA registered there is no catch-all, so Express 404s the root.
    expect(response.status).toBe(404);
    expect(response.text).not.toContain('id="root"');
  });
});

/**
 * Build-dependent smoke test: when the real web-ui build output exists (produced by
 * `npm run build`), boot the API against it and confirm the actual built SPA shell
 * loads and references its bundled module. Skipped when `web-ui/dist` is absent so
 * the unit-test phase (which runs before the build) stays green; the full `verify`
 * flow builds first, then a re-run exercises this.
 */
describe("built SPA smoke test", () => {
  const here = fileURLToPath(import.meta.url);
  const distDir = resolve(here, "..", "..", "..", "..", "web-ui", "dist");
  const built = existsSync(join(distDir, "index.html"));

  it.runIf(built)("serves the built index.html shell", async () => {
    const app = createApp(staticOnlyDeps(distDir));
    const response = await request(app).get("/");
    expect(response.status).toBe(200);
    expect(response.text).toContain('id="root"');
    // Vite injects a hashed module script into the built shell.
    expect(response.text).toMatch(/<script[^>]+type="module"/);
  });
});
