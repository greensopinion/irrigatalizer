import { existsSync } from "node:fs";
import path from "node:path";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import {
  ConfigurationSchema,
  type Configuration,
  type History,
  type Override,
} from "../persistence/schema";
import { currentAndNext } from "../schedule/timeline";
import { effectiveTimeline } from "../schedule/overrides";
import {
  createRainDelay,
  createSkip24h,
  createSkipNext,
} from "../schedule/overrides";
import type { ActiveManualRun } from "../schedule/manual-run";

/**
 * Everything the API needs from the rest of the system, injected so the app can be
 * tested against fakes. The API never touches hardware directly; it goes through
 * the scheduler and manual-run controller, which own the `CircuitController`.
 */
export interface ApiDeps {
  readConfiguration(): Promise<Configuration>;
  writeConfiguration(configuration: Configuration): Promise<void>;
  readHistory(): Promise<History>;
  /**
   * Apply a configuration and safely restart the scheduler.
   */
  applyConfiguration(configuration: Configuration): Promise<void>;
  startManualRun(circuit: number, durationMinutes: number): Promise<void>;
  stopManualRun(): Promise<void>;
  activeManualRun(): ActiveManualRun | undefined;
  clock(): number;
  /**
   * Absolute path to the built SPA (the web-ui `dist` directory). When set and
   * present on disk, the app serves those static files and falls back to
   * `index.html` for client-side routes. When omitted or absent, only the API is
   * served (e.g. during `vite dev`, which proxies `/api` to this process).
   */
  staticDir?: string;
}

const ManualRunRequestSchema = z.object({
  circuit: z.number().int().positive(),
  durationMinutes: z.number().int().positive(),
});

const OverrideRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("skip-next") }),
  z.object({ kind: z.literal("skip-24h") }),
  z.object({
    kind: z.literal("rain-delay"),
    days: z.number().int().positive(),
  }),
]);

/**
 * Build the Express app. All state access and side effects are delegated to
 * `deps`, so tests inject fakes and the production entrypoint injects the real
 * scheduler, stores, and manual-run controller.
 */
export function createApp(deps: ApiDeps): Express {
  const app = express();
  app.use(express.json());

  app.get(
    "/api/status",
    asyncHandler(async (_request, response) => {
      const configuration = await deps.readConfiguration();
      const now = deps.clock();
      const timeline = effectiveTimeline(configuration, now);
      const { current, next } = currentAndNext(timeline, now);
      response.json({
        now,
        enabled: configuration.enabled,
        override: configuration.override,
        manualRun: deps.activeManualRun() ?? null,
        current: current ?? null,
        next: next ?? null,
      });
    }),
  );

  app.get(
    "/api/configuration",
    asyncHandler(async (_request, response) => {
      response.json(await deps.readConfiguration());
    }),
  );

  app.put(
    "/api/configuration",
    asyncHandler(async (request, response) => {
      const parsed = ConfigurationSchema.safeParse(request.body);
      if (!parsed.success) {
        return badRequest(response, parsed.error);
      }
      await deps.writeConfiguration(parsed.data);
      await deps.applyConfiguration(parsed.data);
      response.json(parsed.data);
    }),
  );

  app.get(
    "/api/history",
    asyncHandler(async (_request, response) => {
      response.json(await deps.readHistory());
    }),
  );

  app.post(
    "/api/manual-run",
    asyncHandler(async (request, response) => {
      const parsed = ManualRunRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return badRequest(response, parsed.error);
      }
      await deps.startManualRun(
        parsed.data.circuit,
        parsed.data.durationMinutes,
      );
      response.json({ manualRun: deps.activeManualRun() ?? null });
    }),
  );

  app.post(
    "/api/manual-run/stop",
    asyncHandler(async (_request, response) => {
      await deps.stopManualRun();
      response.json({ manualRun: null });
    }),
  );

  app.post(
    "/api/override",
    asyncHandler(async (request, response) => {
      const parsed = OverrideRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return badRequest(response, parsed.error);
      }
      const configuration = await deps.readConfiguration();
      const override = buildOverride(parsed.data, deps.clock());
      const updated: Configuration = { ...configuration, override };
      await deps.writeConfiguration(updated);
      await deps.applyConfiguration(updated);
      response.json({ override });
    }),
  );

  app.delete(
    "/api/override",
    asyncHandler(async (_request, response) => {
      const configuration = await deps.readConfiguration();
      const updated: Configuration = { ...configuration, override: null };
      await deps.writeConfiguration(updated);
      await deps.applyConfiguration(updated);
      response.json({ override: null });
    }),
  );

  serveSpa(app, deps.staticDir);

  return app;
}

/**
 * Serve the built SPA as static files with a client-side-routing fallback: any
 * non-API GET that does not match a real file returns `index.html` so deep links
 * work. API routes are already registered above, so they take precedence; unknown
 * `/api/*` paths get a JSON 404 rather than the SPA shell. A missing or unset
 * `staticDir` leaves the app API-only (the Vite dev server serves the SPA then).
 */
function serveSpa(app: Express, staticDir: string | undefined): void {
  if (!staticDir || !existsSync(staticDir)) {
    return;
  }

  app.use(express.static(staticDir));

  const indexHtml = path.join(staticDir, "index.html");
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return next();
    }
    if (request.path.startsWith("/api/")) {
      return response.status(404).json({ error: "Not found" });
    }
    response.sendFile(indexHtml, (error) => {
      if (error) {
        next(error);
      }
    });
  });
}

function buildOverride(
  request: z.infer<typeof OverrideRequestSchema>,
  now: number,
): Override {
  switch (request.kind) {
    case "skip-next":
      return createSkipNext(now);
    case "skip-24h":
      return createSkip24h(now);
    case "rain-delay":
      return createRainDelay(now, request.days);
  }
}

/**
 * Wrap an async route so a rejected promise becomes a 500 rather than an unhandled
 * rejection, keeping the process alive (and the safe-state handlers untriggered by
 * a mere request error).
 */
function asyncHandler(
  handler: (request: Request, response: Response) => Promise<void>,
): (request: Request, response: Response) => void {
  return (request, response) => {
    handler(request, response).catch((error: unknown) => {
      if (!response.headersSent) {
        response.status(500).json({ error: describe(error) });
      }
    });
  };
}

function badRequest(response: Response, error: z.ZodError): void {
  response.status(400).json({ error: z.prettifyError(error) });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
