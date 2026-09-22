import type { SchedulerController } from "../schedule/scheduler";
import type { Watchdog } from "./watchdog";

/**
 * The controller operations shared by the scheduler and manual run, plus the
 * safe-off used on shutdown.
 */
export interface RelayController extends SchedulerController {
  safeOffAll(): Promise<void>;
}

/**
 * Wraps a controller so every energize/clear also updates the watchdog's
 * max-runtime arming. Callers (scheduler, manual run) use this exactly like the
 * underlying controller, so the watchdog observes the single-active state without
 * those callers depending on it.
 */
export class WatchedController implements RelayController {
  constructor(
    private readonly inner: RelayController,
    private readonly watchdog: Watchdog,
    private readonly maxOnMs: number,
  ) {}

  async turnOn(circuit: number): Promise<void> {
    await this.inner.turnOn(circuit);
    this.watchdog.circuitEnergized(circuit, this.maxOnMs);
  }

  async safeOffAll(): Promise<void> {
    await this.inner.safeOffAll();
    this.watchdog.circuitCleared();
  }
}
