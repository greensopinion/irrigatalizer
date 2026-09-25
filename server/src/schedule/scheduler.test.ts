import { beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler } from "./scheduler";
import { SETTLE_MS } from "./timeline";
import type {
  RunRecorder,
  SchedulerController,
  TimeoutTimer,
} from "./scheduler";
import type { Configuration, Program } from "../persistence/schema";

const TEST_ZONE = "UTC";

function localTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
}

// 2026-06-01 is a Monday (ISO weekday 1).
const DAY = { year: 2026, month: 6, day: 1 };

function config(programs: Program[], enabled = true): Configuration {
  return {
    circuits: [],
    programs,
    enabled,
    override: null,
    timezone: TEST_ZONE,
  };
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
    this.records.push({ ...record });
    return record;
  }
  /** Close the newest still-open record, mirroring HistoryStore.closeOpenRun. */
  async closeOpenRun(end: number): Promise<unknown> {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i]!.end === null) {
        this.records[i]!.end = end;
        return this.records[i];
      }
    }
    return undefined;
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

  it("records the run open (end: null) when it starts", async () => {
    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6));
    const scheduler = build();
    await scheduler.start(config([twoStepProgram()]));
    expect(controller.calls).toEqual(["on:1"]);
    // Opened with a null end — not the scheduled end — so the dashboard shows it
    // as in-progress and never renders a future "turned off". The end is filled
    // in when the run actually stops.
    expect(history.records).toEqual([
      {
        circuit: 1,
        start: localTime(DAY.year, DAY.month, DAY.day, 6),
        end: null,
      },
    ]);
  });

  it("closes the open record with the actual end when a run stops early", async () => {
    // Start mid-run so circuit 1 is active with an open record.
    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6, 5));
    const scheduler = build();
    await scheduler.start(config([twoStepProgram()]));
    expect(history.records).toEqual([
      {
        circuit: 1,
        start: localTime(DAY.year, DAY.month, DAY.day, 6),
        end: null,
      },
    ]);

    // Stop scheduling at 06:07: the active run's open record is closed with the
    // actual stop time, not a scheduled end.
    const stopAt = localTime(DAY.year, DAY.month, DAY.day, 6, 7);
    clock.set(stopAt);
    await scheduler.stop();

    expect(history.records).toEqual([
      {
        circuit: 1,
        start: localTime(DAY.year, DAY.month, DAY.day, 6),
        end: stopAt,
      },
    ]);
  });

  it("switches to the next circuit one at a time at the transition", async () => {
    const sixTen = localTime(DAY.year, DAY.month, DAY.day, 6, 10);
    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6));
    const scheduler = build();
    await scheduler.start(config([twoStepProgram()]));

    // Circuit 1 ends at 06:10; the settle gap holds everything off, then circuit 2
    // energizes once the gap elapses — still strictly one at a time.
    clock.set(sixTen);
    await timer.tick();
    clock.set(sixTen + SETTLE_MS);
    await timer.tick();

    expect(controller.calls).toEqual(["on:1", "off", "on:2"]);
    expect(history.records.map((r) => r.circuit)).toEqual([1, 2]);
  });

  it("holds all circuits off through a settle gap, then energizes the next circuit", async () => {
    const sixTen = localTime(DAY.year, DAY.month, DAY.day, 6, 10);

    clock.set(localTime(DAY.year, DAY.month, DAY.day, 6));
    const scheduler = build();
    await scheduler.start(config([twoStepProgram()]));
    expect(controller.calls).toEqual(["on:1"]);

    // At circuit 1's planned end the settle gap begins: nothing is energized.
    clock.set(sixTen);
    await timer.tick();
    expect(controller.calls).toEqual(["on:1", "off"]);
    // Circuit 1's record is closed at its planned end.
    expect(history.records[0]).toEqual({
      circuit: 1,
      start: localTime(DAY.year, DAY.month, DAY.day, 6),
      end: sixTen,
    });

    // Once the settle gap elapses, circuit 2 energizes.
    clock.set(sixTen + SETTLE_MS);
    await timer.tick();
    expect(controller.calls).toEqual(["on:1", "off", "on:2"]);
    // Circuit 2's history uses its PLANNED start (06:10), not the actual energize
    // instant (06:10:02) — history stays on the clean schedule grid.
    expect(history.records[1]).toEqual({
      circuit: 2,
      start: sixTen,
      end: null,
    });
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
