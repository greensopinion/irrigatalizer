import { beforeEach, describe, expect, it } from "vitest";
import {
  CircuitController,
  OVERLAP_MS,
  SafetyViolationError,
  type CircuitControllerHooks,
  type CircuitPin,
} from "./circuit-controller";
import { FakeGpioDriver } from "./fake-gpio-driver";
import type { TimeoutTimer } from "../schedule/scheduler";

const CIRCUIT_PINS: readonly CircuitPin[] = [
  { circuit: 1, pin: 17 },
  { circuit: 2, pin: 27 },
  { circuit: 3, pin: 22 },
];

/**
 * A hand-controlled one-shot timer: the pending callback fires only when `fire()`
 * is called, so overlap release is deterministic and never waits in real time.
 */
class ControllableTimer implements TimeoutTimer {
  private pending: (() => void) | undefined;
  /** The delay of the most recent `schedule`, so tests can assert it. */
  lastDelayMs: number | undefined;

  schedule(delayMs: number, onFire: () => void): void {
    this.lastDelayMs = delayMs;
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

function makeController(
  driver: FakeGpioDriver,
  timer: TimeoutTimer = new ControllableTimer(),
  hooks?: CircuitControllerHooks,
): CircuitController {
  return new CircuitController(driver, CIRCUIT_PINS, timer, () => 0, hooks);
}

function pinOf(circuit: number): number {
  const match = CIRCUIT_PINS.find((entry) => entry.circuit === circuit);
  if (!match) {
    throw new Error(`test setup error: no pin for circuit ${circuit}`);
  }
  return match.pin;
}

describe("CircuitController", () => {
  let driver: FakeGpioDriver;
  let controller: CircuitController;

  beforeEach(async () => {
    driver = new FakeGpioDriver();
    controller = makeController(driver);
    await controller.initialize();
  });

  it("starts with all circuits off and none active", () => {
    expect(driver.highPins()).toEqual([]);
    expect(controller.activeCircuit()).toBeUndefined();
  });

  it("energizes a single circuit and reports it active", async () => {
    await controller.turnOn(2);
    expect(driver.highPins()).toEqual([pinOf(2)]);
    expect(controller.activeCircuit()).toBe(2);
  });

  it("keeps at most one circuit active when switching", async () => {
    await controller.turnOn(1);
    await controller.turnOn(3);
    expect(driver.highPins()).toEqual([pinOf(3)]);
    expect(controller.activeCircuit()).toBe(3);
  });

  it("turns all others off before energizing the requested circuit", async () => {
    await controller.turnOn(1);
    driver.writeLog.length = 0;

    await controller.turnOn(2);

    const energizeIndex = driver.writeLog.findIndex(
      (entry) => entry.pin === pinOf(2) && entry.level === "high",
    );
    const otherOffIndex = driver.writeLog.findIndex(
      (entry) => entry.pin === pinOf(1) && entry.level === "low",
    );
    expect(otherOffIndex).toBeGreaterThanOrEqual(0);
    expect(energizeIndex).toBeGreaterThan(otherOffIndex);
  });

  it("is idempotent when turning on the already-active circuit", async () => {
    await controller.turnOn(2);
    await controller.turnOn(2);
    expect(driver.highPins()).toEqual([pinOf(2)]);
    expect(controller.activeCircuit()).toBe(2);
  });

  it("turns a circuit off and clears the active circuit", async () => {
    await controller.turnOn(2);
    await controller.turnOff(2);
    expect(driver.highPins()).toEqual([]);
    expect(controller.activeCircuit()).toBeUndefined();
  });

  it("is idempotent when turning off an inactive circuit", async () => {
    await controller.turnOff(3);
    expect(driver.highPins()).toEqual([]);
    expect(controller.activeCircuit()).toBeUndefined();
  });

  it("drives every circuit off on safeOffAll", async () => {
    await controller.turnOn(1);
    await controller.safeOffAll();
    expect(driver.highPins()).toEqual([]);
    expect(controller.activeCircuit()).toBeUndefined();
  });

  it("rejects an unknown circuit without energizing anything", async () => {
    await expect(controller.turnOn(99)).rejects.toBeInstanceOf(
      SafetyViolationError,
    );
    expect(driver.highPins()).toEqual([]);
  });

  describe("failure handling leaves nothing on", () => {
    it("refuses to energize when driving another circuit off fails", async () => {
      // A low-write to a peer pin fails, so the controller cannot drive all
      // others off and must refuse to energize the target.
      const failDriver = new FakeGpioDriver({
        failWriteOnPins: new Set([pinOf(1)]),
      });
      const failController = makeController(failDriver);
      await failDriver.setup(CIRCUIT_PINS.map((entry) => entry.pin));

      await expect(failController.turnOn(2)).rejects.toBeInstanceOf(
        SafetyViolationError,
      );
      expect(failController.activeCircuit()).toBeUndefined();
      // The would-be target pin is never driven high when a peer cannot be
      // driven off.
      expect(
        failDriver.writeLog.some(
          (entry) => entry.pin === pinOf(2) && entry.level === "high",
        ),
      ).toBe(false);
    });

    it("clears the active circuit when energizing the target write fails", async () => {
      const writeFailDriver = new FakeGpioDriver({
        failWriteOnPins: new Set([pinOf(3)]),
      });
      const writeFailController = makeController(writeFailDriver);
      await writeFailDriver.setup(CIRCUIT_PINS.map((entry) => entry.pin));

      await expect(writeFailController.turnOn(3)).rejects.toBeInstanceOf(
        SafetyViolationError,
      );
      expect(writeFailController.activeCircuit()).toBeUndefined();
      expect(writeFailDriver.highPins()).toEqual([]);
    });

    it("attempts every pin and reports failure when one cannot be driven off", async () => {
      const partialDriver = new FakeGpioDriver({
        failWriteOnPins: new Set([pinOf(2)]),
      });
      const partialController = makeController(partialDriver);
      await partialDriver.setup(CIRCUIT_PINS.map((entry) => entry.pin));
      partialDriver.writeLog.length = 0;

      await expect(partialController.safeOffAll()).rejects.toBeInstanceOf(
        SafetyViolationError,
      );
      // A single failing pin does not stop the others from being driven off:
      // every configured pin except the failing one receives a low write.
      for (const { pin } of CIRCUIT_PINS) {
        if (pin === pinOf(2)) {
          continue;
        }
        expect(
          partialDriver.writeLog.some(
            (entry) => entry.pin === pin && entry.level === "low",
          ),
        ).toBe(true);
      }
    });
  });

  describe("handoff", () => {
    let timer: ControllableTimer;

    beforeEach(async () => {
      driver = new FakeGpioDriver();
      timer = new ControllableTimer();
      controller = makeController(driver, timer);
      await controller.initialize();
    });

    it("energizes the incoming circuit before releasing the outgoing one", async () => {
      await controller.turnOn(1);
      driver.writeLog.length = 0;

      await controller.handoff(1, 2);

      const incomingHighIndex = driver.writeLog.findIndex(
        (entry) => entry.pin === pinOf(2) && entry.level === "high",
      );
      const outgoingLowIndex = driver.writeLog.findIndex(
        (entry) => entry.pin === pinOf(1) && entry.level === "low",
      );
      // Make-before-break: incoming goes high, and the outgoing low is deferred
      // to the timer, so it has not even been written yet.
      expect(incomingHighIndex).toBeGreaterThanOrEqual(0);
      expect(outgoingLowIndex).toBe(-1);

      // The two-on window is open the instant handoff returns.
      expect(driver.highPins()).toEqual(
        expect.arrayContaining([pinOf(1), pinOf(2)]),
      );
      expect(driver.highPins()).toHaveLength(2);

      timer.fire();

      // After the window, only the incoming circuit remains on. The release
      // ordering (incoming high strictly before outgoing low) still holds.
      const outgoingLowAfterFire = driver.writeLog.findIndex(
        (entry) => entry.pin === pinOf(1) && entry.level === "low",
      );
      expect(outgoingLowAfterFire).toBeGreaterThan(incomingHighIndex);
      expect(driver.highPins()).toEqual([pinOf(2)]);
      expect(controller.activeCircuit()).toBe(2);
    });

    it("holds the two-on window until the timer fires, and schedules it for OVERLAP_MS", async () => {
      await controller.turnOn(1);

      await controller.handoff(1, 2);

      // The release is timer-driven for exactly OVERLAP_MS; nothing releases
      // the outgoing circuit before the timer fires.
      expect(timer.lastDelayMs).toBe(OVERLAP_MS);
      expect(driver.highPins()).toEqual(
        expect.arrayContaining([pinOf(1), pinOf(2)]),
      );
      expect(driver.highPins()).toHaveLength(2);

      timer.fire();

      expect(driver.highPins()).toEqual([pinOf(2)]);
      expect(controller.activeCircuit()).toBe(2);
    });

    describe("mid-overlap preemption forces the correct state immediately", () => {
      beforeEach(async () => {
        // Start every preemption case from an in-flight hand-off 1 -> 2:
        // both high, timer pending, not yet fired.
        await controller.turnOn(1);
        await controller.handoff(1, 2);
        expect(driver.highPins()).toEqual(
          expect.arrayContaining([pinOf(1), pinOf(2)]),
        );
        expect(driver.highPins()).toHaveLength(2);
      });

      it("safeOffAll cancels the pending release and drives both off", async () => {
        await controller.safeOffAll();

        expect(driver.highPins()).toEqual([]);
        expect(controller.activeCircuit()).toBeUndefined();

        // The now-cancelled timer firing afterward is a harmless no-op.
        timer.fire();
        expect(driver.highPins()).toEqual([]);
        expect(controller.activeCircuit()).toBeUndefined();
      });

      it("turnOn a third circuit cancels the overlap and collapses to strict single-active", async () => {
        driver.writeLog.length = 0;

        await controller.turnOn(3);

        expect(driver.highPins()).toEqual([pinOf(3)]);
        expect(controller.activeCircuit()).toBe(3);

        // Strict single-active: both overlap participants are driven low before
        // the third circuit is energized.
        const thirdHighIndex = driver.writeLog.findIndex(
          (entry) => entry.pin === pinOf(3) && entry.level === "high",
        );
        for (const outgoing of [1, 2]) {
          const offIndex = driver.writeLog.findIndex(
            (entry) => entry.pin === pinOf(outgoing) && entry.level === "low",
          );
          expect(offIndex).toBeGreaterThanOrEqual(0);
          expect(thirdHighIndex).toBeGreaterThan(offIndex);
        }

        // A stale timer fire must not resurrect the abandoned overlap.
        timer.fire();
        expect(driver.highPins()).toEqual([pinOf(3)]);
        expect(controller.activeCircuit()).toBe(3);
      });

      it("turnOff a participant cancels the pending release", async () => {
        // Turn off the incoming circuit (the one that would otherwise remain).
        await controller.turnOff(2);
        expect(driver.highPins()).toEqual([pinOf(1)]);

        // The cancelled timer firing must not drive the outgoing circuit off as
        // if the overlap were still in flight (no stale release).
        driver.writeLog.length = 0;
        timer.fire();
        expect(driver.writeLog).toEqual([]);
        expect(driver.highPins()).toEqual([pinOf(1)]);
      });
    });

    describe("release hooks", () => {
      it("calls onOverlapResolved (not onReleaseError) when the release succeeds", async () => {
        const resolved: number[] = [];
        const releaseErrors: unknown[] = [];
        const hookDriver = new FakeGpioDriver();
        const hookTimer = new ControllableTimer();
        const hookController = makeController(hookDriver, hookTimer, {
          onOverlapResolved: () => resolved.push(1),
          onReleaseError: (error) => releaseErrors.push(error),
        });
        await hookController.initialize();

        await hookController.turnOn(1);
        await hookController.handoff(1, 2);
        // Not resolved until the release actually fires.
        expect(resolved).toEqual([]);

        hookTimer.fire();
        await Promise.resolve();

        expect(resolved).toEqual([1]);
        expect(releaseErrors).toEqual([]);
        expect(hookDriver.highPins()).toEqual([pinOf(2)]);
      });

      it("calls onReleaseError and leaves both circuits on when the release write fails", async () => {
        const resolved: number[] = [];
        const releaseErrors: unknown[] = [];
        const failingPins = new Set<number>();
        const hookDriver = new FakeGpioDriver({ failWriteOnPins: failingPins });
        const hookTimer = new ControllableTimer();
        const hookController = makeController(hookDriver, hookTimer, {
          onOverlapResolved: () => resolved.push(1),
          onReleaseError: (error) => releaseErrors.push(error),
        });
        await hookController.initialize();

        await hookController.turnOn(1);
        await hookController.handoff(1, 2);

        // Arm the fault so only the outgoing release (pin 1 low) fails.
        failingPins.add(pinOf(1));
        hookTimer.fire();
        await Promise.resolve();

        // The failure is surfaced, not swallowed as an unhandled rejection, and
        // the make (incoming) was never undone: both circuits stay on for the
        // watchdog to catch.
        expect(releaseErrors).toHaveLength(1);
        expect(resolved).toEqual([]);
        expect(hookDriver.highPins()).toEqual(
          expect.arrayContaining([pinOf(1), pinOf(2)]),
        );
      });

      it("does not throw when no hooks are provided and the release fails", async () => {
        const failingPins = new Set<number>();
        const hookDriver = new FakeGpioDriver({ failWriteOnPins: failingPins });
        const hookTimer = new ControllableTimer();
        const hookController = makeController(hookDriver, hookTimer);
        await hookController.initialize();

        await hookController.turnOn(1);
        await hookController.handoff(1, 2);

        failingPins.add(pinOf(1));
        // Firing must not throw synchronously even with no onReleaseError wired;
        // the swallowed rejection is the property under test.
        expect(() => hookTimer.fire()).not.toThrow();
        await Promise.resolve();
      });
    });

    it("leaves nothing energized when the incoming energize fails", async () => {
      // Start with no fault so the outgoing circuit can be energized, then arm
      // the fault so only the hand-off's incoming energize (pin high) fails.
      const failingPins = new Set<number>();
      const failDriver = new FakeGpioDriver({ failWriteOnPins: failingPins });
      const failController = makeController(failDriver, new ControllableTimer());
      await failDriver.setup(CIRCUIT_PINS.map((entry) => entry.pin));
      await failController.turnOn(1);

      failingPins.add(pinOf(2));

      await expect(failController.handoff(1, 2)).rejects.toBeInstanceOf(
        SafetyViolationError,
      );

      // Incoming energize failed, so force-safe-off ran: nothing is on.
      expect(failDriver.highPins()).toEqual([]);
      expect(failController.activeCircuit()).toBeUndefined();
    });

    // Requirements §5: boot/exit/crash handlers call only `safeOffAll`, which
    // drives every pin low regardless of how many are high. This guards the
    // property that the crash/shutdown paths stay ignorant of overlap — a
    // shutdown or crash mid-overlap collapses both circuits to off via the very
    // call the lifecycle handlers use (see safe-state.ts SafeStateTarget). This
    // overlaps with the "safeOffAll cancels the pending release" preemption test
    // above, but is kept as an explicit lifecycle guard so the traceability to
    // §5 is visible at the controller layer.
    it("a shutdown/crash safe-off during an overlap drives both circuits off", async () => {
      await controller.turnOn(1);
      await controller.handoff(1, 2);
      // Precondition: an in-flight overlap with both circuits energized.
      expect(driver.highPins()).toEqual(
        expect.arrayContaining([pinOf(1), pinOf(2)]),
      );
      expect(driver.highPins()).toHaveLength(2);

      // Exactly what the SIGINT/SIGTERM/uncaughtException handlers invoke.
      await controller.safeOffAll();

      expect(driver.highPins()).toEqual([]);
      expect(controller.activeCircuit()).toBeUndefined();

      // The overlap timer, now cancelled, is a stale fire that must not
      // resurrect either circuit after the safe-off.
      timer.fire();
      expect(driver.highPins()).toEqual([]);
      expect(controller.activeCircuit()).toBeUndefined();
    });
  });
});
