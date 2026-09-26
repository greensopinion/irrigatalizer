import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Watchdog,
  type IntervalTimer,
  type WatchdogTripReason,
} from "./watchdog";

class ManualClock {
  private now = 0;

  read = (): number => this.now;

  advance(ms: number): void {
    this.now += ms;
  }
}

class ManualTimer implements IntervalTimer {
  private onTick: (() => void) | undefined;
  intervalMs = 0;

  start(intervalMs: number, onTick: () => void): void {
    this.intervalMs = intervalMs;
    this.onTick = onTick;
  }

  stop(): void {
    this.onTick = undefined;
  }

  tick(): void {
    this.onTick?.();
  }

  get isRunning(): boolean {
    return this.onTick !== undefined;
  }
}

describe("Watchdog", () => {
  let clock: ManualClock;
  let timer: ManualTimer;
  let trips: WatchdogTripReason[];

  const build = (overrides?: { heartbeatTimeoutMs?: number }): Watchdog =>
    new Watchdog({
      checkIntervalMs: 100,
      heartbeatTimeoutMs: overrides?.heartbeatTimeoutMs ?? 1000,
      clock: clock.read,
      timer,
      onTrip: (reason) => {
        trips.push(reason);
      },
    });

  beforeEach(() => {
    clock = new ManualClock();
    timer = new ManualTimer();
    trips = [];
  });

  it("does not trip while a circuit runs within its cap", () => {
    const watchdog = build();
    watchdog.start();
    watchdog.circuitEnergized(1, 5000);

    // Keep the heartbeat fresh so this isolates the runtime-cap condition.
    clock.advance(4000);
    watchdog.heartbeat();
    timer.tick();

    expect(trips).toEqual([]);
  });

  it("trips on a stale heartbeat even while a circuit is within its cap", () => {
    const watchdog = build({ heartbeatTimeoutMs: 1000 });
    watchdog.start();
    watchdog.circuitEnergized(1, 60000);

    // No heartbeat: a stalled scheduler with a valve open must still trip.
    clock.advance(1000);
    timer.tick();

    expect(trips).toHaveLength(1);
    expect(trips[0]?.kind).toBe("heartbeat-stale");
  });

  it("trips when a circuit exceeds its max on-time", () => {
    const watchdog = build();
    watchdog.start();
    watchdog.circuitEnergized(2, 5000);

    clock.advance(5000);
    timer.tick();

    expect(trips).toEqual([
      { kind: "max-runtime-exceeded", circuit: 2, maxOnMs: 5000 },
    ]);
  });

  it("does not trip on runtime after the circuit is cleared", () => {
    const watchdog = build();
    watchdog.start();
    watchdog.circuitEnergized(1, 2000);
    watchdog.circuitCleared();

    clock.advance(10000);
    watchdog.heartbeat();
    timer.tick();

    expect(trips).toEqual([]);
  });

  it("trips when the scheduler heartbeat goes stale", () => {
    const watchdog = build({ heartbeatTimeoutMs: 1000 });
    watchdog.start();

    clock.advance(1000);
    timer.tick();

    expect(trips).toHaveLength(1);
    expect(trips[0]?.kind).toBe("heartbeat-stale");
  });

  it("stays healthy while heartbeats keep arriving", () => {
    const watchdog = build({ heartbeatTimeoutMs: 1000 });
    watchdog.start();

    for (let i = 0; i < 5; i++) {
      clock.advance(500);
      watchdog.heartbeat();
      timer.tick();
    }

    expect(trips).toEqual([]);
  });

  it("trips only once even if conditions persist", () => {
    const watchdog = build();
    watchdog.start();
    watchdog.circuitEnergized(3, 1000);

    clock.advance(2000);
    timer.tick();
    timer.tick();
    timer.tick();

    expect(trips).toHaveLength(1);
  });

  it("stops its timer when stopped", () => {
    const watchdog = build();
    watchdog.start();
    expect(timer.isRunning).toBe(true);
    watchdog.stop();
    expect(timer.isRunning).toBe(false);
  });

  describe("overlap-stuck", () => {
    // overlapStarted(maxOverlapMs) arms a deadline of now + maxOverlapMs + an
    // internal backstop margin. These tests treat that margin as an
    // implementation detail and pick clock advances that land clearly before or
    // after it: with a 2000 ms overlap the margin puts the deadline somewhere
    // past 2000 ms, so 3001 ms is safely past and 2500 ms is safely before.

    it("trips when an overlap persists past the window plus margin", () => {
      const watchdog = build();
      watchdog.start();
      watchdog.overlapStarted(2000);

      // Keep the heartbeat fresh so this isolates the overlap-stuck condition.
      clock.advance(3001);
      watchdog.heartbeat();
      timer.tick();

      expect(trips).toHaveLength(1);
      expect(trips[0]?.kind).toBe("overlap-stuck");
    });

    it("does not trip while still within the overlap window", () => {
      const watchdog = build();
      watchdog.start();
      watchdog.overlapStarted(2000);

      // Before the deadline: a normal in-progress hand-off must not trip.
      clock.advance(2500);
      watchdog.heartbeat();
      timer.tick();

      expect(trips).toEqual([]);
    });

    it("does not trip for an overlap that resolves within the window", () => {
      const watchdog = build();
      watchdog.start();
      watchdog.overlapStarted(2000);

      // Hand-off completes early: circuitCleared disarms the overlap deadline.
      clock.advance(1500);
      watchdog.circuitCleared();

      // Advancing well past the old deadline must not resurrect the trip.
      clock.advance(10000);
      watchdog.heartbeat();
      timer.tick();

      expect(trips).toEqual([]);
    });

    it("does not interfere with a normal within-cap circuit", () => {
      const watchdog = build();
      watchdog.start();
      watchdog.circuitEnergized(1, 60000);
      watchdog.overlapStarted(2000);

      // Overlap resolves within its window while the incoming circuit keeps
      // running well under its cap: no spurious trip.
      clock.advance(1500);
      watchdog.circuitCleared();
      watchdog.circuitEnergized(1, 60000);

      clock.advance(4000);
      watchdog.heartbeat();
      timer.tick();

      expect(trips).toEqual([]);
    });
  });

  it("reports errors thrown by the trip handler", () => {
    const onError = vi.fn();
    const watchdog = new Watchdog({
      checkIntervalMs: 100,
      heartbeatTimeoutMs: 1000,
      clock: clock.read,
      timer,
      onTrip: () => {
        throw new Error("safe-off failed");
      },
      onError,
    });
    watchdog.start();
    watchdog.circuitEnergized(1, 500);

    clock.advance(500);
    timer.tick();

    expect(onError).toHaveBeenCalledOnce();
  });
});
