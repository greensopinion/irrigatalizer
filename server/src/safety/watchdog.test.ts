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
