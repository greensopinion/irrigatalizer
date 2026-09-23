import type { RunRecorder, SchedulerController, TimeoutTimer } from "./scheduler";

/**
 * The history operations a manual run needs: record the run when it starts (with a
 * null end) and close that open record with the actual end when it finishes.
 * Satisfied by `HistoryStore`.
 */
export interface ManualRunHistory extends RunRecorder {
  closeOpenRun(end: number): Promise<unknown>;
}

/**
 * A manual run in progress: the circuit and the epoch millisecond it will
 * automatically turn off.
 */
export interface ActiveManualRun {
  circuit: number;
  endsAt: number;
}

/**
 * Suspends and resumes automatic scheduling around a manual run. Satisfied by the
 * `Scheduler` (`stop`/`start` against the current configuration); modeled as an
 * interface so the manual-run controller can be tested without a real scheduler.
 */
export interface SchedulerSuspension {
  suspend(): Promise<void>;
  resume(): Promise<void>;
}

export interface ManualRunOptions {
  controller: SchedulerController;
  scheduler: SchedulerSuspension;
  timer: TimeoutTimer;
  clock: () => number;
  /**
   * Records the manual run in history so it shows up in the dashboard, exactly
   * like a scheduled run: an open record (end: null) is written when the run
   * starts and closed with the actual end when it finishes. Optional so tests that
   * don't care about history can omit it.
   */
  history?: ManualRunHistory;
  onError?: (error: unknown) => void;
}

/**
 * Runs a single circuit on demand for a fixed duration, then turns it off. Manual
 * runs go through the same `CircuitController` as the scheduler, so the
 * single-active invariant and the watchdog apply. While a manual run is active the
 * scheduler is suspended so the two never fight over the hardware; scheduling
 * resumes when the run ends, whether by timeout or an early stop.
 */
export class ManualRunController {
  private readonly options: ManualRunOptions;
  private active: ActiveManualRun | undefined;

  constructor(options: ManualRunOptions) {
    this.options = options;
  }

  activeRun(): ActiveManualRun | undefined {
    return this.active;
  }

  /**
   * Start a manual run of `circuit` for `durationMinutes`, replacing any run
   * already in progress. Suspends the scheduler, energizes the circuit, and arms
   * the auto-off timer.
   */
  async start(circuit: number, durationMinutes: number): Promise<void> {
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      throw new Error(
        `manual run duration must be a positive integer, got ${durationMinutes}`,
      );
    }

    if (!this.active) {
      await this.options.scheduler.suspend();
    } else {
      this.options.timer.cancel();
      // Replacing a run already in progress: close its open history record before
      // starting the new one, so we don't leave a dangling open run.
      if (this.options.history) {
        await this.options.history.closeOpenRun(this.options.clock());
      }
    }

    await this.options.controller.turnOn(circuit);
    const startedAt = this.options.clock();
    const endsAt = startedAt + durationMinutes * 60_000;
    this.active = { circuit, endsAt };
    // Record the run as it starts with an open (null) end, so the dashboard shows
    // it immediately as "on" without a spurious "off". The end is filled in on
    // finish. Fire-and-forget: history must not block energizing the circuit.
    if (this.options.history) {
      await this.options.history.append({
        circuit,
        start: startedAt,
        end: null,
      });
    }
    this.options.timer.schedule(durationMinutes * 60_000, () => {
      void this.finish();
    });
  }

  /**
   * Stop the active manual run early. No-op if none is running.
   */
  async stop(): Promise<void> {
    if (!this.active) {
      return;
    }
    this.options.timer.cancel();
    await this.finish();
  }

  private async finish(): Promise<void> {
    if (!this.active) {
      return;
    }
    this.active = undefined;
    try {
      await this.options.controller.safeOffAll();
      // Close the open record opened at start with the actual end time, so an
      // early stop records its true (shorter) duration.
      if (this.options.history) {
        await this.options.history.closeOpenRun(this.options.clock());
      }
      await this.options.scheduler.resume();
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}
