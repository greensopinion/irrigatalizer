import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManualRunController } from "./manual-run";
import type { SchedulerController, TimeoutTimer } from "./scheduler";
import type { IntervalTimer } from "../safety/watchdog";

/** One-shot timer whose scheduled callback the test fires on demand. */
class FakeTimeoutTimer implements TimeoutTimer {
  private fire: (() => void) | undefined;
  lastDelayMs: number | undefined;

  schedule(delayMs: number, onFire: () => void): void {
    this.lastDelayMs = delayMs;
    this.fire = onFire;
  }
  cancel(): void {
    this.fire = undefined;
  }
  trigger(): void {
    const fire = this.fire;
    this.fire = undefined;
    fire?.();
  }
}

/** Periodic timer whose ticks the test drives, tracking start/stop state. */
class FakeIntervalTimer implements IntervalTimer {
  private onTick: (() => void) | undefined;
  intervalMs: number | undefined;
  running = false;
  startCount = 0;

  start(intervalMs: number, onTick: () => void): void {
    this.intervalMs = intervalMs;
    this.onTick = onTick;
    this.running = true;
    this.startCount++;
  }
  stop(): void {
    this.running = false;
    this.onTick = undefined;
  }
  tick(times = 1): void {
    for (let i = 0; i < times; i++) {
      this.onTick?.();
    }
  }
}

/** Records energize/off calls; enough to assert manual-run behaviour. */
class FakeController implements SchedulerController {
  active: number | undefined;
  async turnOn(circuit: number): Promise<void> {
    this.active = circuit;
  }
  async safeOffAll(): Promise<void> {
    this.active = undefined;
  }
}

describe("ManualRunController watchdog heartbeat", () => {
  let controller: FakeController;
  let timer: FakeTimeoutTimer;
  let heartbeatTimer: FakeIntervalTimer;
  let heartbeat: ReturnType<typeof vi.fn<() => void>>;
  let suspend: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let resume: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let manualRun: ManualRunController;

  beforeEach(() => {
    controller = new FakeController();
    timer = new FakeTimeoutTimer();
    heartbeatTimer = new FakeIntervalTimer();
    heartbeat = vi.fn<() => void>();
    suspend = vi.fn<() => Promise<void>>(async () => {});
    resume = vi.fn<() => Promise<void>>(async () => {});
    manualRun = new ManualRunController({
      controller,
      scheduler: { suspend, resume },
      timer,
      clock: () => 0,
      heartbeat,
      heartbeatTimer,
      heartbeatIntervalMs: 30_000,
    });
  });

  it("beats the heartbeat on start and keeps beating while active", async () => {
    await manualRun.start(1, 2);

    // Beats once immediately on start, and arms the periodic beat.
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(heartbeatTimer.running).toBe(true);
    expect(heartbeatTimer.intervalMs).toBe(30_000);

    // Each interval tick beats again — this is what keeps the watchdog from
    // tripping a stale-heartbeat safe-off during a run longer than the timeout.
    heartbeatTimer.tick(3);
    expect(heartbeat).toHaveBeenCalledTimes(4);
  });

  it("stops beating when the run finishes on its timer", async () => {
    await manualRun.start(1, 2);
    expect(heartbeatTimer.running).toBe(true);

    timer.trigger(); // auto-off fires
    await Promise.resolve();

    expect(heartbeatTimer.running).toBe(false);
    expect(controller.active).toBeUndefined();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("stops beating on an early stop", async () => {
    await manualRun.start(1, 5);
    await manualRun.stop();

    expect(heartbeatTimer.running).toBe(false);
    expect(controller.active).toBeUndefined();
  });

  it("does not leave two heartbeat intervals running when a run is replaced", async () => {
    await manualRun.start(1, 5);
    await manualRun.start(2, 5); // replace in place

    // The old interval was stopped before the new one started, so exactly one is
    // running (start called twice, but never two live at once).
    expect(heartbeatTimer.running).toBe(true);
    expect(heartbeatTimer.startCount).toBe(2);
    expect(controller.active).toBe(2);
  });

  it("works without a heartbeat wired (no-op)", async () => {
    const bare = new ManualRunController({
      controller,
      scheduler: {
        suspend: async () => {},
        resume: async () => {},
      },
      timer: new FakeTimeoutTimer(),
      clock: () => 0,
    });
    await expect(bare.start(1, 2)).resolves.toBeUndefined();
    expect(controller.active).toBe(1);
  });
});
