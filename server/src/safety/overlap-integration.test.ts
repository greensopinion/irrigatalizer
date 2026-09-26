import { beforeEach, describe, expect, it } from "vitest";
import {
  CircuitController,
  OVERLAP_MS,
  type CircuitPin,
} from "../gpio/circuit-controller";
import { FakeGpioDriver } from "../gpio/fake-gpio-driver";
import { WatchedController } from "./watched-controller";
import {
  Watchdog,
  type IntervalTimer,
  type WatchdogTripReason,
} from "./watchdog";
import type { TimeoutTimer } from "../schedule/scheduler";

/**
 * End-to-end wiring of the REAL CircuitController + WatchedController + Watchdog
 * (no spies) to exercise the overlap lifecycle across the layer boundary. The
 * spy-based unit tests can't catch a defect that only appears when the real
 * watchdog trip logic runs against real arming/disarming.
 */

const CIRCUIT_PINS: readonly CircuitPin[] = [
  { circuit: 1, pin: 17 },
  { circuit: 2, pin: 27 },
];

const MAX_ON_MS = 60 * 60 * 1000;

/**
 * Drain the microtask queue so a detached async callback (the overlap timer fires
 * `void releaseOutgoing(...)`) completes before assertions run.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

function pinOf(circuit: number): number {
  const match = CIRCUIT_PINS.find((entry) => entry.circuit === circuit);
  if (!match) {
    throw new Error(`test setup error: no pin for circuit ${circuit}`);
  }
  return match.pin;
}

/** A shared, test-controlled monotonic clock for controller + watchdog. */
class ManualClock {
  private now = 0;
  read = (): number => this.now;
  advance(ms: number): void {
    this.now += ms;
  }
}

/** One-shot timer whose pending callback fires only on `fire()`. */
class ControllableTimeoutTimer implements TimeoutTimer {
  private pending: (() => void) | undefined;
  schedule(_delayMs: number, onFire: () => void): void {
    this.pending = onFire;
  }
  cancel(): void {
    this.pending = undefined;
  }
  fire(): void {
    const callback = this.pending;
    this.pending = undefined;
    callback?.();
  }
}

/** Interval timer whose tick is driven manually. */
class ManualIntervalTimer implements IntervalTimer {
  private onTick: (() => void) | undefined;
  start(_intervalMs: number, onTick: () => void): void {
    this.onTick = onTick;
  }
  stop(): void {
    this.onTick = undefined;
  }
  tick(): void {
    this.onTick?.();
  }
}

describe("overlap lifecycle (real controller + watched + watchdog)", () => {
  let clock: ManualClock;
  let driver: FakeGpioDriver;
  let overlapTimer: ControllableTimeoutTimer;
  let watchdogTimer: ManualIntervalTimer;
  let trips: WatchdogTripReason[];
  let releaseErrors: unknown[];
  let watchdog: Watchdog;
  let watched: WatchedController;

  beforeEach(async () => {
    clock = new ManualClock();
    driver = new FakeGpioDriver();
    overlapTimer = new ControllableTimeoutTimer();
    watchdogTimer = new ManualIntervalTimer();
    trips = [];
    releaseErrors = [];

    const controller = new CircuitController(
      driver,
      CIRCUIT_PINS,
      overlapTimer,
      clock.read,
      {
        onOverlapResolved: () => watchdog.overlapEnded(),
        onReleaseError: (error) => releaseErrors.push(error),
      },
    );
    await controller.initialize();

    watchdog = new Watchdog({
      checkIntervalMs: 100,
      heartbeatTimeoutMs: 1_000_000, // large: isolate overlap-stuck from staleness
      clock: clock.read,
      timer: watchdogTimer,
      onTrip: (reason) => {
        trips.push(reason);
        void watched.safeOffAll();
      },
    });
    watched = new WatchedController(controller, watchdog, MAX_ON_MS);
    watchdog.start();

    // Establish a steady-state run on circuit 1.
    await watched.turnOn(1);
  });

  it("trips overlap-stuck when the controller's release timer never fires", async () => {
    // Never firing overlapTimer models a stalled event loop: the controller's own
    // release never runs, so the watchdog is the only thing left to end the overlap.
    await watched.handoff(1, 2);
    expect(driver.highPins()).toEqual(
      expect.arrayContaining([pinOf(1), pinOf(2)]),
    );

    // Past the window plus the watchdog's backstop margin, the watchdog must trip.
    clock.advance(OVERLAP_MS + 1000 + 1);
    watchdog.heartbeat();
    watchdogTimer.tick();

    expect(trips.map((t) => t.kind)).toEqual(["overlap-stuck"]);
  });

  it("does NOT trip overlap-stuck after a normal, successful hand-off", async () => {
    // A clean scheduled transition 1 -> 2: hand-off, then the controller's own
    // overlap timer fires and releases the outgoing circuit within the window.
    await watched.handoff(1, 2);
    clock.advance(OVERLAP_MS);
    overlapTimer.fire(); // outgoing circuit 1 released -> only circuit 2 on
    await flushMicrotasks();

    // Overlap has fully resolved: exactly one circuit is energized.
    expect(driver.highPins()).toEqual([pinOf(2)]);

    // Let the watchdog tick a bit later, still far under circuit 2's max-runtime.
    clock.advance(2000);
    watchdog.heartbeat();
    watchdogTimer.tick();

    // The hand-off completed cleanly, so nothing should have tripped.
    expect(trips).toEqual([]);
    expect(driver.highPins()).toEqual([pinOf(2)]);
  });

  it("routes a failed delayed release to onReleaseError and lets the watchdog catch it", async () => {
    // A fault set the test arms only when the release is about to run, so setup
    // and the initial turnOn (which write pin 17) succeed first.
    const failingPins = new Set<number>();
    const faultDriver = new FakeGpioDriver({ failWriteOnPins: failingPins });
    const faultReleaseTimer = new ControllableTimeoutTimer();
    const errors: unknown[] = [];
    const faultController = new CircuitController(
      faultDriver,
      CIRCUIT_PINS,
      faultReleaseTimer,
      clock.read,
      {
        onOverlapResolved: () => faultWatchdog.overlapEnded(),
        onReleaseError: (error) => errors.push(error),
      },
    );
    await faultController.initialize();

    const faultTrips: WatchdogTripReason[] = [];
    const faultWatchdog: Watchdog = new Watchdog({
      checkIntervalMs: 100,
      heartbeatTimeoutMs: 1_000_000,
      clock: clock.read,
      timer: watchdogTimer,
      onTrip: (reason) => {
        faultTrips.push(reason);
        void faultWatched.safeOffAll();
      },
    });
    const faultWatched = new WatchedController(
      faultController,
      faultWatchdog,
      MAX_ON_MS,
    );
    faultWatchdog.start();

    await faultWatched.turnOn(1);
    await faultWatched.handoff(1, 2);

    // Now make the outgoing circuit's low-write (its release) fail.
    failingPins.add(pinOf(1));
    clock.advance(OVERLAP_MS);
    faultReleaseTimer.fire(); // timer callback runs releaseOutgoing (detached)
    await flushMicrotasks();

    // The failure is surfaced through the hook (not an unhandled rejection), and
    // the two-on state persists because the release did not take effect.
    expect(errors).toHaveLength(1);
    expect(faultDriver.highPins()).toEqual(
      expect.arrayContaining([pinOf(1), pinOf(2)]),
    );

    // Because the release failed, onOverlapResolved was NOT called, so the
    // overlap-stuck backstop is still armed and trips once the deadline passes.
    failingPins.clear(); // let the safe-off actually drive pins low
    clock.advance(1000 + 1); // past the backstop margin beyond the window
    faultWatchdog.heartbeat();
    watchdogTimer.tick();
    await flushMicrotasks(); // let the detached onTrip safe-off complete

    expect(faultTrips.map((t) => t.kind)).toEqual(["overlap-stuck"]);
    expect(faultDriver.highPins()).toEqual([]);
  });
});
