import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import type { ApiDeps } from "./app";
import { CircuitController } from "../gpio/circuit-controller";
import { FakeGpioDriver } from "../gpio/fake-gpio-driver";
import { ConfigStore, HistoryStore } from "../persistence/stores";
import { Scheduler, type TimeoutTimer } from "../schedule/scheduler";
import { ManualRunController } from "../schedule/manual-run";
import {
  emptyConfiguration,
  type Configuration,
  type Program,
} from "../persistence/schema";

const CIRCUIT_PINS = [
  { circuit: 1, pin: 17 },
  { circuit: 2, pin: 27 },
];

/**
 * A controllable one-shot timer: captures the pending callback so tests fire it
 * on demand.
 */
class ControllableTimer implements TimeoutTimer {
  private fire: (() => void) | undefined;
  schedule(_delayMs: number, onFire: () => void): void {
    this.fire = onFire;
  }
  cancel(): void {
    this.fire = undefined;
  }
  async trigger(): Promise<void> {
    const fire = this.fire;
    this.fire = undefined;
    fire?.();
    await Promise.resolve();
    await Promise.resolve();
  }
}

function program(): Program {
  return {
    id: "p1",
    name: "Program 1",
    days: [1, 2, 3, 4, 5, 6, 7],
    startSlot: 12,
    steps: [{ circuit: 1, durationMinutes: 10 }],
  };
}

interface HistoryRun {
  circuit: number;
  start: number;
  end: number | null;
}

/**
 * Poll GET /api/history until `predicate` holds over its runs, so tests can assert
 * on history written by the fire-and-forget manual-run start/finish paths without
 * racing their async file I/O.
 */
async function waitForRuns(
  app: ReturnType<typeof createApp>,
  predicate: (runs: HistoryRun[]) => boolean,
  attempts = 50,
): Promise<HistoryRun[]> {
  let runs: HistoryRun[] = [];
  for (let i = 0; i < attempts; i++) {
    const response = await request(app).get("/api/history");
    runs = response.body.runs as HistoryRun[];
    if (predicate(runs)) {
      return runs;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return runs;
}

function configuration(overrides?: Partial<Configuration>): Configuration {
  return {
    circuits: [
      { number: 1, name: "Front", pin: 17 },
      { number: 2, name: "Back", pin: 27 },
    ],
    programs: [program()],
    enabled: true,
    override: null,
    timezone: "America/Vancouver",
    ...overrides,
  };
}

describe("API", () => {
  let dataDir: string;
  let driver: FakeGpioDriver;
  let controller: CircuitController;
  let scheduler: Scheduler;
  let manualRun: ManualRunController;
  let manualTimer: ControllableTimer;
  let now: number;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "irrigatalizer-api-"));
    driver = new FakeGpioDriver();
    controller = new CircuitController(driver, CIRCUIT_PINS);
    await controller.initialize();

    const configStore = new ConfigStore(dataDir);
    const historyStore = new HistoryStore(dataDir);
    now = 1_000_000;

    scheduler = new Scheduler({
      controller,
      history: historyStore,
      timer: new ControllableTimer(),
      clock: () => now,
    });
    manualTimer = new ControllableTimer();
    manualRun = new ManualRunController({
      controller,
      scheduler,
      timer: manualTimer,
      clock: () => now,
      history: historyStore,
    });
    await scheduler.start(await configStore.read());

    const deps: ApiDeps = {
      readConfiguration: () => configStore.read(),
      writeConfiguration: (c) => configStore.write(c),
      readHistory: () => historyStore.read(),
      applyConfiguration: (c) => scheduler.apply(c),
      startManualRun: (circuit, minutes) => manualRun.start(circuit, minutes),
      stopManualRun: () => manualRun.stop(),
      activeManualRun: () => manualRun.activeRun(),
      clock: () => now,
    };
    app = createApp(deps);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("returns an empty configuration on first run", async () => {
    const response = await request(app).get("/api/configuration");
    expect(response.status).toBe(200);
    // The default config includes a resolved system timezone, so compare against
    // the canonical empty configuration rather than a hardcoded zone.
    expect(response.body).toEqual(emptyConfiguration());
  });

  it("stores and re-reads a configuration via PUT then GET", async () => {
    const config = configuration();
    const put = await request(app).put("/api/configuration").send(config);
    expect(put.status).toBe(200);

    const get = await request(app).get("/api/configuration");
    expect(get.body).toEqual(config);
  });

  it("rejects an invalid configuration with 400", async () => {
    const response = await request(app)
      .put("/api/configuration")
      .send({ circuits: "nope" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });

  it("rejects a configuration with an unknown timezone", async () => {
    const response = await request(app)
      .put("/api/configuration")
      .send(configuration({ timezone: "Mars/Olympus_Mons" }));
    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });

  it("accepts a configuration with a valid IANA timezone", async () => {
    const response = await request(app)
      .put("/api/configuration")
      .send(configuration({ timezone: "Europe/London" }));
    expect(response.status).toBe(200);
    expect(response.body.timezone).toBe("Europe/London");
  });

  it("reports status with current and next", async () => {
    await request(app).put("/api/configuration").send(configuration());
    const response = await request(app).get("/api/status");
    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(true);
    expect(response.body).toHaveProperty("current");
    expect(response.body).toHaveProperty("next");
  });

  it("starts a manual run through the controller and reflects it in status", async () => {
    const response = await request(app)
      .post("/api/manual-run")
      .send({ circuit: 2, durationMinutes: 5 });
    expect(response.status).toBe(200);
    expect(response.body.manualRun).toMatchObject({ circuit: 2 });
    expect(controller.activeCircuit()).toBe(2);

    const status = await request(app).get("/api/status");
    expect(status.body.manualRun).toMatchObject({ circuit: 2 });
  });

  it("rejects a manual run with an invalid body", async () => {
    const response = await request(app)
      .post("/api/manual-run")
      .send({ circuit: 0 });
    expect(response.status).toBe(400);
  });

  it("stops a manual run and drives circuits off", async () => {
    await request(app)
      .post("/api/manual-run")
      .send({ circuit: 2, durationMinutes: 5 });
    const response = await request(app).post("/api/manual-run/stop");
    expect(response.status).toBe(200);
    expect(response.body.manualRun).toBeNull();
    expect(controller.activeCircuit()).toBeUndefined();
  });

  it("records the manual run as open (end null) the moment it starts", async () => {
    const startedAt = now;
    await request(app)
      .post("/api/manual-run")
      .send({ circuit: 2, durationMinutes: 5 });

    // While the run is active the history holds a single open record — start set,
    // end null — so the dashboard shows it as "on" without a spurious "off".
    const runs = await waitForRuns(app, (r) => r.length >= 1);
    expect(runs).toContainEqual({ circuit: 2, start: startedAt, end: null });
    expect(runs.filter((r) => r.end === null)).toHaveLength(1);
  });

  it("closes the open record with the actual end when a run completes", async () => {
    const startedAt = now;
    await request(app)
      .post("/api/manual-run")
      .send({ circuit: 2, durationMinutes: 5 });

    // The run auto-finishes when its timer fires; advance the clock so the closed
    // end reflects elapsed time.
    now = startedAt + 5 * 60_000;
    await manualTimer.trigger();

    // Wait for the open record to be closed (end set), not merely present.
    const runs = await waitForRuns(app, (r) =>
      r.some((run) => run.end !== null),
    );
    expect(runs).toContainEqual({
      circuit: 2,
      start: startedAt,
      end: startedAt + 5 * 60_000,
    });
    // Exactly one record for the run — no duplicate.
    expect(runs.filter((r) => r.start === startedAt)).toHaveLength(1);
  });

  it("records an early-stopped manual run with its actual (shorter) duration", async () => {
    const startedAt = now;
    await request(app)
      .post("/api/manual-run")
      .send({ circuit: 2, durationMinutes: 5 });

    // Stop after two minutes instead of the requested five.
    now = startedAt + 2 * 60_000;
    await request(app).post("/api/manual-run/stop");

    const history = await request(app).get("/api/history");
    expect(history.body.runs).toContainEqual({
      circuit: 2,
      start: startedAt,
      end: startedAt + 2 * 60_000,
    });
  });

  it("applies and clears an override", async () => {
    await request(app).put("/api/configuration").send(configuration());

    const set = await request(app)
      .post("/api/override")
      .send({ kind: "rain-delay", days: 2 });
    expect(set.status).toBe(200);
    expect(set.body.override).toMatchObject({ kind: "rain-delay" });

    const status = await request(app).get("/api/status");
    expect(status.body.override).toMatchObject({ kind: "rain-delay" });

    const cleared = await request(app).delete("/api/override");
    expect(cleared.body.override).toBeNull();
  });

  it("rejects an override with a missing required field", async () => {
    const response = await request(app)
      .post("/api/override")
      .send({ kind: "rain-delay" });
    expect(response.status).toBe(400);
  });

  it("returns history", async () => {
    const response = await request(app).get("/api/history");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ runs: [] });
  });
});
