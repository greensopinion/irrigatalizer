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
import type { Configuration, Program } from "../persistence/schema";

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

function configuration(overrides?: Partial<Configuration>): Configuration {
  return {
    circuits: [
      { number: 1, name: "Front", pin: 17 },
      { number: 2, name: "Back", pin: 27 },
    ],
    programs: [program()],
    enabled: true,
    override: null,
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
    expect(response.body).toEqual({
      circuits: [],
      programs: [],
      enabled: true,
      override: null,
    });
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
