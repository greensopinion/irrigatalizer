/**
 * Monotonic time source in milliseconds. Injected so tests control time without
 * real delays. Production uses a monotonic clock (`performance.now`-style) so the
 * watchdog is unaffected by wall-clock adjustments.
 */
export type Clock = () => number;

/**
 * Schedules and cancels the watchdog's own periodic check. Injected so tests can
 * drive ticks deterministically. Independent of the scheduler's timer.
 */
export interface IntervalTimer {
  start(intervalMs: number, onTick: () => void): void;
  stop(): void;
}

export interface WatchdogOptions {
  /**
   * How often the watchdog evaluates its conditions.
   */
  checkIntervalMs: number;
  /**
   * Maximum age of the last heartbeat before the scheduler is considered stalled.
   */
  heartbeatTimeoutMs: number;
  clock: Clock;
  timer: IntervalTimer;
  /**
   * Invoked when a safety condition trips. Must drive all circuits off. Any error
   * is surfaced through `onError` rather than thrown from the tick.
   */
  onTrip: (reason: WatchdogTripReason) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export type WatchdogTripReason =
  | { kind: "max-runtime-exceeded"; circuit: number; maxOnMs: number }
  | { kind: "heartbeat-stale"; ageMs: number }
  | { kind: "overlap-stuck"; overdueMs: number };

/**
 * Backstop margin the watchdog adds beyond the controller's own `OVERLAP_MS`
 * timer before treating a lingering two-energized state as stuck. The
 * controller's own timer normally releases the outgoing circuit first; this
 * margin gives it room to do so, so the watchdog trips only when that timer
 * never fired (e.g. a stalled event loop).
 */
const OVERLAP_BACKSTOP_MARGIN_MS = 1000;

/**
 * An independent safety net that forces all circuits off if a circuit runs past
 * its hard maximum on-time or the scheduler stops heart-beating. It does not share
 * the scheduler's timer, so a stalled or crashed scheduler cannot also disable the
 * watchdog.
 *
 * The watchdog observes state through `circuitEnergized`/`circuitCleared` and
 * `heartbeat`; it never drives hardware itself, delegating that to `onTrip`.
 */
export class Watchdog {
  private readonly options: WatchdogOptions;
  private activeCircuit: number | undefined;
  private activeSince = 0;
  private activeMaxOnMs = 0;
  private overlapDeadline: number | undefined;
  private lastHeartbeat = 0;
  private running = false;
  private tripped = false;

  constructor(options: WatchdogOptions) {
    this.options = options;
  }

  /**
   * Begin monitoring. The heartbeat starts fresh so a just-started watchdog does
   * not immediately trip on staleness.
   */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.tripped = false;
    this.lastHeartbeat = this.options.clock();
    this.options.timer.start(this.options.checkIntervalMs, () => {
      this.check();
    });
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.options.timer.stop();
  }

  /**
   * Record that a circuit was energized, arming the max-runtime cap for it.
   */
  circuitEnergized(circuit: number, maxOnMs: number): void {
    this.activeCircuit = circuit;
    this.activeSince = this.options.clock();
    this.activeMaxOnMs = maxOnMs;
  }

  /**
   * Record that a scheduled hand-off began, arming the overlap-stuck backstop
   * for the bounded two-energized window.
   */
  overlapStarted(maxOverlapMs: number): void {
    this.overlapDeadline =
      this.options.clock() + maxOverlapMs + OVERLAP_BACKSTOP_MARGIN_MS;
  }

  /**
   * Record that no circuit is active, disarming the max-runtime cap and the
   * overlap-stuck backstop (a completed hand-off or safe-off ends the window).
   */
  circuitCleared(): void {
    this.activeCircuit = undefined;
    this.overlapDeadline = undefined;
  }

  /**
   * Record that a hand-off's overlap resolved normally — the outgoing circuit was
   * released within the window — disarming only the overlap-stuck backstop. The
   * incoming circuit keeps running, so its max-runtime cap is left armed. Without
   * this, a clean hand-off would leave `overlapDeadline` set and trip a spurious
   * overlap-stuck once the deadline passed.
   */
  overlapEnded(): void {
    this.overlapDeadline = undefined;
  }

  /**
   * Record a scheduler heartbeat, proving the scheduler is still alive.
   */
  heartbeat(): void {
    this.lastHeartbeat = this.options.clock();
  }

  private check(): void {
    if (!this.running || this.tripped) {
      return;
    }
    const now = this.options.clock();

    if (this.activeCircuit !== undefined) {
      const onFor = now - this.activeSince;
      if (onFor >= this.activeMaxOnMs) {
        this.trip({
          kind: "max-runtime-exceeded",
          circuit: this.activeCircuit,
          maxOnMs: this.activeMaxOnMs,
        });
        return;
      }
    }

    if (this.overlapDeadline !== undefined && now >= this.overlapDeadline) {
      this.trip({
        kind: "overlap-stuck",
        overdueMs: now - this.overlapDeadline,
      });
      return;
    }

    const heartbeatAge = now - this.lastHeartbeat;
    if (heartbeatAge >= this.options.heartbeatTimeoutMs) {
      this.trip({ kind: "heartbeat-stale", ageMs: heartbeatAge });
    }
  }

  private trip(reason: WatchdogTripReason): void {
    this.tripped = true;
    this.activeCircuit = undefined;
    this.overlapDeadline = undefined;
    try {
      const result = this.options.onTrip(reason);
      if (result instanceof Promise) {
        result.catch((error) => this.reportError(error));
      }
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    this.options.onError?.(error);
  }
}
