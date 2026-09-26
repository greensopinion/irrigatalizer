import type { SchedulerController } from "../schedule/scheduler";
import { OVERLAP_MS } from "../gpio/circuit-controller";
import type { Watchdog } from "./watchdog";

/**
 * The controller operations shared by the scheduler and manual run, plus the
 * safe-off used on shutdown. `handoff` comes from `SchedulerController` so the
 * scheduler can initiate a make-before-break transition without knowing the
 * concrete controller.
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

  /**
   * Delegate a make-before-break transition, then arm the watchdog for the
   * incoming circuit's max-runtime — it is the one that continues in steady
   * state — and arm the overlap-stuck backstop for the bounded two-energized
   * window. The outgoing circuit needs no separate arming: it is released well
   * within `OVERLAP_MS`.
   */
  async handoff(from: number, to: number): Promise<void> {
    await this.inner.handoff(from, to);
    this.watchdog.circuitEnergized(to, this.maxOnMs);
    this.watchdog.overlapStarted(OVERLAP_MS);
  }

  async safeOffAll(): Promise<void> {
    await this.inner.safeOffAll();
    this.watchdog.circuitCleared();
  }
}
