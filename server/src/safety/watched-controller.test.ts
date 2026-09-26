import { describe, expect, it } from "vitest";
import { WatchedController, type RelayController } from "./watched-controller";
import { OVERLAP_MS } from "../gpio/circuit-controller";
import type { Watchdog } from "./watchdog";

const MAX_ON_MS = 30 * 60 * 1000;

/** Records the controller operations invoked, enough to assert delegation order. */
class FakeInner implements RelayController {
  readonly calls: string[] = [];
  async turnOn(circuit: number): Promise<void> {
    this.calls.push(`on:${circuit}`);
  }
  async handoff(from: number, to: number): Promise<void> {
    this.calls.push(`handoff:${from}>${to}`);
  }
  async safeOffAll(): Promise<void> {
    this.calls.push("off");
  }
}

/**
 * Captures the watchdog arming/clearing calls the controller makes. Only the
 * methods `WatchedController` uses are recorded; the rest of `Watchdog` is
 * irrelevant here.
 */
class SpyWatchdog {
  readonly energized: Array<{ circuit: number; maxOnMs: number }> = [];
  readonly overlaps: number[] = [];
  cleared = 0;

  circuitEnergized(circuit: number, maxOnMs: number): void {
    this.energized.push({ circuit, maxOnMs });
  }
  overlapStarted(maxOverlapMs: number): void {
    this.overlaps.push(maxOverlapMs);
  }
  circuitCleared(): void {
    this.cleared++;
  }
}

function make(): {
  controller: WatchedController;
  inner: FakeInner;
  watchdog: SpyWatchdog;
} {
  const inner = new FakeInner();
  const watchdog = new SpyWatchdog();
  const controller = new WatchedController(
    inner,
    watchdog as unknown as Watchdog,
    MAX_ON_MS,
  );
  return { controller, inner, watchdog };
}

describe("WatchedController.handoff", () => {
  it("delegates to the inner controller's handoff", async () => {
    const { controller, inner } = make();

    await controller.handoff(1, 2);

    expect(inner.calls).toEqual(["handoff:1>2"]);
  });

  it("arms the watchdog max-runtime for the incoming circuit, not the outgoing one", async () => {
    const { controller, watchdog } = make();

    await controller.handoff(1, 2);

    expect(watchdog.energized).toEqual([{ circuit: 2, maxOnMs: MAX_ON_MS }]);
  });

  it("arms the overlap-stuck backstop for OVERLAP_MS", async () => {
    const { controller, watchdog } = make();

    await controller.handoff(1, 2);

    expect(watchdog.overlaps).toEqual([OVERLAP_MS]);
  });
});

describe("WatchedController.safeOffAll", () => {
  it("delegates and clears the max-runtime and overlap arming", async () => {
    const { controller, inner, watchdog } = make();

    await controller.safeOffAll();

    expect(inner.calls).toEqual(["off"]);
    expect(watchdog.cleared).toBe(1);
  });
});

describe("WatchedController.turnOn", () => {
  it("delegates and arms the watchdog max-runtime for that circuit", async () => {
    const { controller, inner, watchdog } = make();

    await controller.turnOn(3);

    expect(inner.calls).toEqual(["on:3"]);
    expect(watchdog.energized).toEqual([{ circuit: 3, maxOnMs: MAX_ON_MS }]);
  });
});
