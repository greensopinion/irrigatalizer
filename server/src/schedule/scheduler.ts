import type { Configuration } from "../persistence/schema";
import { buildTimeline, currentAndNext, type ScheduledRun } from "./timeline";

/**
 * The relay-control operations the scheduler needs. Depending on this narrow
 * interface (satisfied by `CircuitController`) keeps the scheduler decoupled from
 * the GPIO layer and easy to test.
 */
export interface SchedulerController {
  turnOn(circuit: number): Promise<void>;
  safeOffAll(): Promise<void>;
}

/**
 * Records circuit runs as they transition. Satisfied by `HistoryStore.append`.
 */
export interface RunRecorder {
  append(record: {
    circuit: number;
    start: number;
    end: number | null;
  }): Promise<unknown>;
}

/**
 * A one-shot timer the scheduler uses to wake at the next transition. Injected so
 * tests drive time deterministically. Distinct from the watchdog's timer.
 */
export interface TimeoutTimer {
  schedule(delayMs: number, onFire: () => void): void;
  cancel(): void;
}

export interface SchedulerOptions {
  controller: SchedulerController;
  history: RunRecorder;
  timer: TimeoutTimer;
  clock: () => number;
  /**
   * Called on every evaluation so the watchdog knows the scheduler is alive.
   */
  heartbeat?: () => void;
  onError?: (error: unknown) => void;
  /**
   * Never sleep longer than this between evaluations, so a long idle gap still
   * produces regular heartbeats. Defaults to one minute.
   */
  maxSleepMs?: number;
}

const DEFAULT_MAX_SLEEP_MS = 60_000;

/**
 * Timer-driven scheduler that realizes the pure timeline on the hardware. It wakes
 * at each transition, drives at most one circuit at a time through the controller,
 * records runs as they start and end, and heartbeats so the watchdog can tell it
 * is alive. All timeline math is delegated to the pure `timeline` module; this
 * class owns only the effects (timer, controller, history).
 */
export class Scheduler {
  private readonly options: SchedulerOptions;
  private configuration: Configuration | undefined;
  private running = false;
  private activeRun: ScheduledRun | undefined;

  constructor(options: SchedulerOptions) {
    this.options = options;
  }

  /**
   * Start scheduling against the given configuration, evaluating immediately.
   */
  async start(configuration: Configuration): Promise<void> {
    this.configuration = configuration;
    this.running = true;
    await this.evaluate();
  }

  /**
   * Apply a new configuration and safely restart scheduling from it.
   */
  async apply(configuration: Configuration): Promise<void> {
    if (!this.running) {
      this.configuration = configuration;
      return;
    }
    this.options.timer.cancel();
    this.configuration = configuration;
    await this.evaluate();
  }

  /**
   * Stop scheduling and drive all circuits off.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.options.timer.cancel();
    this.activeRun = undefined;
    await this.options.controller.safeOffAll();
  }

  private async evaluate(): Promise<void> {
    if (!this.running || !this.configuration) {
      return;
    }
    this.options.heartbeat?.();

    const now = this.options.clock();
    const timeline = buildTimeline(this.configuration, now);
    const { current, next } = currentAndNext(timeline, now);

    try {
      await this.reconcile(current, now);
    } catch (error) {
      this.options.onError?.(error);
    }

    this.scheduleNextWake(current, next, now);
  }

  /**
   * Drive the hardware to match the intended state: energize the current circuit
   * (one at a time via the controller), or turn everything off when idle. Records
   * history as runs start and end.
   */
  private async reconcile(
    current: ScheduledRun | undefined,
    now: number,
  ): Promise<void> {
    if (current) {
      if (!this.activeRun || this.activeRun.start !== current.start) {
        await this.options.controller.turnOn(current.circuit);
        this.activeRun = current;
        await this.options.history.append({
          circuit: current.circuit,
          start: current.start,
          end: current.end,
        });
      }
      return;
    }

    if (this.activeRun) {
      this.activeRun = undefined;
    }
    await this.options.controller.safeOffAll();
    void now;
  }

  private scheduleNextWake(
    current: ScheduledRun | undefined,
    next: ScheduledRun | undefined,
    now: number,
  ): void {
    if (!this.running) {
      return;
    }
    const maxSleep = this.options.maxSleepMs ?? DEFAULT_MAX_SLEEP_MS;
    const nextBoundary = current?.end ?? next?.start;
    const untilBoundary =
      nextBoundary !== undefined ? nextBoundary - now : maxSleep;
    const delay = Math.max(0, Math.min(maxSleep, untilBoundary));
    this.options.timer.schedule(delay, () => {
      void this.evaluate();
    });
  }
}
