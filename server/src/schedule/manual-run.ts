import type { SchedulerController, TimeoutTimer } from "./scheduler";

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
    }

    await this.options.controller.turnOn(circuit);
    const endsAt = this.options.clock() + durationMinutes * 60_000;
    this.active = { circuit, endsAt };
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
      await this.options.scheduler.resume();
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}
