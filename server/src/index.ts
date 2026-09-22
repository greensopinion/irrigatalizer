import type { Express } from "express";
import { createApp, type ApiDeps } from "./api/app";
import { CircuitController } from "./gpio/circuit-controller";
import { GpiodCliDriver } from "./gpio/gpiod-cli-driver";
import { DEFAULT_CIRCUIT_PINS } from "./gpio/default-circuit-pins";
import { ConfigStore, HistoryStore } from "./persistence/stores";
import { Scheduler } from "./schedule/scheduler";
import { ManualRunController } from "./schedule/manual-run";
import { Watchdog, type IntervalTimer } from "./safety/watchdog";
import { WatchedController } from "./safety/watched-controller";
import {
  registerSafeStateHandlers,
  safeStateOnBoot,
  type ProcessLike,
} from "./safety/safe-state";
import type { Configuration } from "./persistence/schema";
import type { TimeoutTimer } from "./schedule/scheduler";

const DEFAULT_PORT = 9000;

/**
 * Hard ceiling on how long any single circuit may stay energized, enforced by the
 * watchdog independently of the scheduler. One hour is well beyond any legitimate
 * irrigation run.
 */
const MAX_CIRCUIT_ON_MS = 60 * 60 * 1000;
const WATCHDOG_CHECK_MS = 5_000;
const WATCHDOG_HEARTBEAT_TIMEOUT_MS = 90_000;

/**
 * Real one-shot timer backed by setTimeout, satisfying the scheduler's and manual
 * run's TimeoutTimer.
 */
function systemTimeoutTimer(): TimeoutTimer {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule(delayMs, onFire) {
      if (handle) {
        clearTimeout(handle);
      }
      handle = setTimeout(onFire, delayMs);
    },
    cancel() {
      if (handle) {
        clearTimeout(handle);
        handle = undefined;
      }
    },
  };
}

/**
 * Real periodic timer backed by setInterval, satisfying the watchdog's
 * IntervalTimer.
 */
function systemIntervalTimer(): IntervalTimer {
  let handle: ReturnType<typeof setInterval> | undefined;
  return {
    start(intervalMs, onTick) {
      handle = setInterval(onTick, intervalMs);
    },
    stop() {
      if (handle) {
        clearInterval(handle);
        handle = undefined;
      }
    },
  };
}

/**
 * Compose the whole system: GPIO driver, controller, persistence, watchdog,
 * scheduler, and manual run, then build the API around them. Boot safe-state and
 * crash/exit handlers are registered so the relays are driven off before anything
 * runs and on any shutdown path.
 */
export async function bootstrap(options?: {
  dataDir?: string;
  process?: ProcessLike;
}): Promise<{ app: Express; shutdown: () => Promise<void> }> {
  const driver = new GpiodCliDriver();
  const controller = new CircuitController(driver, DEFAULT_CIRCUIT_PINS);
  const configStore = new ConfigStore(options?.dataDir);
  const historyStore = new HistoryStore(options?.dataDir);

  const watchdog = new Watchdog({
    checkIntervalMs: WATCHDOG_CHECK_MS,
    heartbeatTimeoutMs: WATCHDOG_HEARTBEAT_TIMEOUT_MS,
    clock: () => performance.now(),
    timer: systemIntervalTimer(),
    onTrip: async () => {
      await controller.safeOffAll();
    },
    onError: (error) => console.error("watchdog safe-off failed:", error),
  });

  // Route every energize/clear through the watchdog so the max-runtime cap is
  // armed, without the scheduler or manual run depending on the watchdog.
  const watched = new WatchedController(
    controller,
    watchdog,
    MAX_CIRCUIT_ON_MS,
  );

  const scheduler = new Scheduler({
    controller: watched,
    history: historyStore,
    timer: systemTimeoutTimer(),
    clock: () => Date.now(),
    heartbeat: () => watchdog.heartbeat(),
    onError: (error) => console.error("scheduler evaluation failed:", error),
  });

  const manualRun = new ManualRunController({
    controller: watched,
    scheduler,
    timer: systemTimeoutTimer(),
    clock: () => Date.now(),
    onError: (error) => console.error("manual run failed:", error),
  });

  // Safe-off before anything schedules, then bring the system up.
  await controller.initialize();
  await safeStateOnBoot(controller);
  registerSafeStateHandlers({
    target: {
      safeOffAll: () => controller.safeOffAll(),
      release: () => driver.release(),
    },
    process: options?.process ?? process,
    log: (message) => console.log(message),
  });

  watchdog.start();
  const initialConfig = await configStore.read();
  await scheduler.start(initialConfig);

  const deps: ApiDeps = {
    readConfiguration: () => configStore.read(),
    writeConfiguration: (configuration) => configStore.write(configuration),
    readHistory: () => historyStore.read(),
    applyConfiguration: (configuration: Configuration) =>
      scheduler.apply(configuration),
    startManualRun: (circuit, durationMinutes) =>
      manualRun.start(circuit, durationMinutes),
    stopManualRun: () => manualRun.stop(),
    activeManualRun: () => manualRun.activeRun(),
    clock: () => Date.now(),
  };

  const app = createApp(deps);

  const shutdown = async (): Promise<void> => {
    watchdog.stop();
    await scheduler.stop();
    await driver.release();
  };

  return { app, shutdown };
}

function resolvePort(): number {
  const configured = process.env.PORT;
  if (!configured) {
    return DEFAULT_PORT;
  }
  const parsed = Number(configured);
  return Number.isFinite(parsed) ? parsed : DEFAULT_PORT;
}

const isMainModule = process.argv[1]
  ? import.meta.url === new URL(`file://${process.argv[1]}`).href
  : false;

if (isMainModule) {
  const port = resolvePort();
  bootstrap()
    .then(({ app }) => {
      app.listen(port, () => {
        console.log(`Server listening on port ${port}...`);
      });
    })
    .catch((error: unknown) => {
      console.error("failed to start:", error);
      process.exitCode = 1;
    });
}
