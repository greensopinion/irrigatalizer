import { beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler } from "./scheduler";
import type {
  RunRecorder,
  SchedulerController,
  TimeoutTimer,
} from "./scheduler";
import type { Configuration, Program } from "../persistence/schema";

function localTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

// 2026-06-01 is a Monday (ISO weekday 1).
const DAY = { year: 2026, month: 6, day: 1 };

function config(programs: Program[], enabled = true): Configuration {
  return { circuits: [], programs, enabled, override: null };
}

function twoStepProgram(): Program {
  return {
    id: "p1",
    name: "Program 1",
    days: [1],
    startSlot: 12, // 06:00
    steps: [
      { circuit: 1, durationMinutes: 10 },
      { circuit: 2, durationMinutes: 10 },
    ],
  };
}

class FakeClock {
  constructor(private now: number) {}
  read = (): number => this.now;
  set(now: number): void {
    this.now = now;
  }
}

class FakeTimer implements TimeoutTimer {
  private fire: (() => void) | undefined;
  lastDelay: number | undefined;
  cancelled = 0;

  schedule(delayMs: number, onFire: () => void): void {
    this.lastDelay = delayMs;
    this.fire = onFire;
  }

  cancel(): void {
    this.cancelled += 1;
    this.fire = undefined;
  }

  async tick(): Promise<void> {
    const fire = this.fire;
    this.fire = undefined;
    fire?.();
    await Promise.resolve();
    await Promise.resolve();
  }
}

class FakeController implements SchedulerController {
  readonly calls: string[] = [];
  async turnOn(circuit: number): Promise<void> {
    this.calls.push(`on:${circuit}`);
  }
  async safeOffAll(): Promise<void> {
    this.calls.push("off");
  }
}

class FakeHistory implements RunRecorder {
  readonly records: Array<{
    circuit: number;
    start: number;
    end: number | null;
  }> = [];
  async append(record: {
    circuit: number;
    start: number;
    end: number | null;
  }): Promise<unknown> {
    this.records.push(record);
    return record;
  }
}

describe("Scheduler", () => {
  let clock: FakeClock;
  let timer: FakeTimer;
  let controller: FakeController;
  let history: FakeHistory;
  let heartbeat: ReturnType<typeof vi.fn<() => void>>;

  const build = (): Scheduler =>
    new Scheduler({
      controller,
      history,
      timer,
      clock: clock.read,
      heartbeat,
    });

  beforeEach(() => {
    clock = new FakeClock(localTime(DAY.year, DAY.month, DAY.day, 5));
    timer = new FakeTimer();
    controller = new FakeController();
    history = new FakeHistory();
    heartbeat = vi.fn();
  });

  it("stays off and heartbeats before the schedule starts", async () => {
    const scheduler = build();
    await scheduler.start(config([twoStepProgram()]));
    expect(controller.calls).toEqual(["off"]);
    expect(heartbeat).toHaveBeenCalled();
  });

  it("energizes the running circuit and records the run at its start", async () => {
    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6));
    const scheduler = build();
    await scheduler.start(config([twoStepProgram()]));
    expect(controller.calls).toEqual(["on:1"]);
    expect(history.records).toEqual([
      {
        circuit: 1,
        start: localTime(DAY.year, DAY.month, DAY.day, 6),
        end: localTime(DAY.year, DAY.month, DAY.day, 6, 10),
      },
    ]);
  });

  it("switches to the next circuit one at a time at the transition", async () => {
    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6));
    const scheduler = build();
    await scheduler.start(config([twoStepProgram()]));

    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6, 10));
    await timer.tick();

    expect(controller.calls).toEqual(["on:1", "on:2"]);
    expect(history.records.map((r) => r.circuit)).toEqual([1, 2]);
  });

  it("turns everything off when the schedule finishes", async () => {
    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6, 5));
    const scheduler = build();
    await scheduler.start(config([twoStepProgram()]));
    expect(controller.calls).toEqual(["on:1"]);

    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6, 20));
    await timer.tick();

    expect(controller.calls).toEqual(["on:1", "off"]);
  });

  it("does not re-energize the same run on repeated evaluations", async () => {
    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6));
    const scheduler = build();
    await scheduler.start(config([twoStepProgram()]));

    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6, 5));
    await timer.tick();

    expect(controller.calls).toEqual(["on:1"]);
    expect(history.records).toHaveLength(1);
  });

  it("caps the sleep delay so it heartbeats regularly while idle", async () => {
    const scheduler = build();
    await scheduler.start(config([twoStepProgram()]));
    // 05:00 with the first run at 06:00 is more than the 60s cap away.
    expect(timer.lastDelay).toBe(60_000);
  });

  it("safe-offs and cancels the timer on stop", async () => {
    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6));
    const scheduler = build();
    await scheduler.start(config([twoStepProgram()]));
    controller.calls.length = 0;

    await scheduler.stop();

    expect(controller.calls).toEqual(["off"]);
    expect(timer.cancelled).toBeGreaterThan(0);
  });

  it("restarts scheduling when a new configuration is applied", async () => {
    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6));
    const scheduler = build();
    await scheduler.start(config([twoStepProgram()]));
    controller.calls.length = 0;

    // Apply a disabled configuration: it should cancel and drive off.
    await scheduler.apply(config([twoStepProgram()], false));

    expect(timer.cancelled).toBeGreaterThan(0);
    expect(controller.calls).toEqual(["off"]);
  });

  it("reports reconcile errors through onError", async () => {
    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6));
    const onError = vi.fn();
    const failing: SchedulerController = {
      async turnOn(): Promise<void> {
        throw new Error("energize failed");
      },
      async safeOffAll(): Promise<void> {},
    };
    const scheduler = new Scheduler({
      controller: failing,
      history,
      timer,
      clock: clock.read,
      onError,
    });

    await scheduler.start(config([twoStepProgram()]));

    expect(onError).toHaveBeenCalledOnce();
  });
});
