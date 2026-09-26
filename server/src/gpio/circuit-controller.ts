import type { GpioDriver } from "./gpio-driver";
import type { TimeoutTimer } from "../schedule/scheduler";

/**
 * Bounded window during which the outgoing and incoming circuits of a single
 * scheduled hand-off may both be energized (make-before-break). A property of the
 * plumbing, not user-tunable; replaces the timeline's former settle gap.
 */
export const OVERLAP_MS = 2000;

/**
 * A circuit's stable identity: its number and the BCM pin that drives its relay.
 * Names live in the persisted configuration, not here; the controller cares only
 * about the number-to-pin mapping needed to drive hardware.
 */
export interface CircuitPin {
  circuit: number;
  pin: number;
}

/**
 * Optional hooks into the hand-off lifecycle. Both concern the delayed release
 * that happens off the original `handoff` call stack (fired by the overlap
 * timer), so they cannot be surfaced through `handoff`'s own return/throw.
 */
export interface CircuitControllerHooks {
  /**
   * Called when a hand-off's overlap resolves normally — the outgoing circuit
   * was released within the window, leaving only the incoming one on. Lets a
   * wrapper disarm any overlap-specific safety arming (e.g. the watchdog's
   * overlap-stuck backstop).
   */
  onOverlapResolved?: () => void;
  /**
   * Called when the delayed release of the outgoing circuit fails. The two-on
   * state then persists past the window and is left for the watchdog's
   * overlap-stuck backstop to resolve via `safeOffAll`; this hook only surfaces
   * the error for logging rather than letting it become an unhandled rejection.
   */
  onReleaseError?: (error: unknown) => void;
}

/**
 * Raised when the controller cannot guarantee the single-active invariant and has
 * therefore refused to energize a circuit. The hardware is left safe-off.
 */
export class SafetyViolationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SafetyViolationError";
  }
}

/**
 * The single authority over relay state. Guarantees that at most one circuit is
 * energized at any instant: energizing a circuit first drives every other circuit
 * low. If any of those off-writes fails, no circuit is energized and the hardware
 * is driven safe-off.
 *
 * The controller does NOT read pins back to verify the off-state. On the target
 * hardware there is no reliable read-back (see `docs/gpio-driver-decision.md`):
 * the driver's off (`pinctrl set … op dl`) drives the pad low synchronously, so
 * the invariant rests on driving-others-low succeeding rather than on a read that
 * cannot be trusted. `GpioDriver.read` remains available but advisory only.
 *
 * All relay changes go through this controller so the invariant holds regardless
 * of the caller (scheduler, manual run, API). The sole exception is `handoff`,
 * which intentionally holds two circuits on for a bounded, preemptible window to
 * perform a make-before-break scheduled transition; every safety action cancels
 * that window and forces the intended state immediately.
 */
export class CircuitController {
  private readonly pinByCircuit = new Map<number, number>();
  private active: number | undefined;
  /**
   * The in-flight hand-off, if any: the outgoing (`from`) and incoming (`to`)
   * circuits both energized until `deadline`, when the timer releases `from`.
   * Undefined outside a hand-off.
   */
  private overlap: { from: number; to: number; deadline: number } | undefined;

  constructor(
    private readonly driver: GpioDriver,
    circuitPins: readonly CircuitPin[],
    private readonly overlapTimer: TimeoutTimer,
    private readonly clock: () => number,
    private readonly hooks: CircuitControllerHooks = {},
  ) {
    for (const { circuit, pin } of circuitPins) {
      this.pinByCircuit.set(circuit, pin);
    }
  }

  /**
   * Prepare all pins for output and drive them to a known safe-off state.
   */
  async initialize(): Promise<void> {
    await this.driver.setup([...this.pinByCircuit.values()]);
    await this.safeOffAll();
  }

  /**
   * The circuit currently energized, or undefined if none.
   */
  activeCircuit(): number | undefined {
    return this.active;
  }

  /**
   * Energize a circuit after guaranteeing every other circuit is off. Idempotent:
   * turning on the already-active circuit re-verifies the invariant and is a no-op
   * on success. Leaves nothing on if the off-state cannot be verified.
   */
  async turnOn(circuit: number): Promise<void> {
    const targetPin = this.requirePin(circuit);
    // Strict single-active preempts any in-flight hand-off: cancel the pending
    // release so the drive-others-off below collapses the overlap immediately.
    this.cancelOverlap();

    try {
      await this.driveOthersOff(circuit);
    } catch (error) {
      await this.forceSafeOff();
      throw this.asSafetyViolation(
        `refused to energize circuit ${circuit}: could not drive all others off`,
        error,
      );
    }

    try {
      await this.driver.write(targetPin, "high");
    } catch (error) {
      await this.forceSafeOff();
      throw this.asSafetyViolation(
        `failed to energize circuit ${circuit}`,
        error,
      );
    }
    this.active = circuit;
  }

  /**
   * Make-before-break transition from an outgoing circuit to an incoming one:
   * energize `to` first (leaving `from` on), then release `from` after
   * `OVERLAP_MS`. This is the only path that intentionally holds two circuits on,
   * and only for the bounded window. The release is timer-driven, never a blocking
   * wait, so a safety action can always preempt it.
   *
   * If energizing `to` fails, `from` was never released and `to` may be partially
   * on; the hardware is driven safe-off and a SafetyViolationError is thrown,
   * identical to `turnOn`'s energize-failure path.
   */
  async handoff(from: number, to: number): Promise<void> {
    const toPin = this.requirePin(to);
    // Any prior hand-off is superseded by this one.
    this.cancelOverlap();

    try {
      await this.driver.write(toPin, "high");
    } catch (error) {
      await this.forceSafeOff();
      throw this.asSafetyViolation(`failed to energize circuit ${to}`, error);
    }
    this.active = to;
    this.overlap = { from, to, deadline: this.clock() + OVERLAP_MS };
    this.overlapTimer.schedule(OVERLAP_MS, () => {
      void this.releaseOutgoing(from);
    });
  }

  /**
   * De-energize a circuit. Idempotent: turning off a circuit that is not active
   * still drives its pin low.
   */
  async turnOff(circuit: number): Promise<void> {
    const pin = this.requirePin(circuit);
    // Only abandon a hand-off when this circuit is one of its two participants;
    // an unrelated turn-off leaves the overlap running.
    if (this.overlap && (this.overlap.from === circuit || this.overlap.to === circuit)) {
      this.cancelOverlap();
    }
    await this.driver.write(pin, "low");
    if (this.active === circuit) {
      this.active = undefined;
    }
  }

  /**
   * Drive every known circuit low. Attempts all pins even if some fail, so a
   * single failing pin cannot prevent the others from being de-energized. Throws
   * if any pin could not be driven low.
   */
  async safeOffAll(): Promise<void> {
    // Off always wins: abandon any pending hand-off release before driving low.
    this.cancelOverlap();
    const failures: unknown[] = [];
    for (const [circuit, pin] of this.pinByCircuit) {
      try {
        await this.driver.write(pin, "low");
      } catch (error) {
        failures.push(error);
      }
      if (this.active === circuit) {
        this.active = undefined;
      }
    }
    if (failures.length > 0) {
      throw this.asSafetyViolation(
        `failed to drive ${failures.length} circuit(s) off`,
        failures[0],
      );
    }
  }

  private async driveOthersOff(keep: number): Promise<void> {
    for (const [circuit, pin] of this.pinByCircuit) {
      if (circuit === keep) {
        continue;
      }
      await this.driver.write(pin, "low");
      if (this.active === circuit) {
        this.active = undefined;
      }
    }
  }

  /**
   * Fired by the overlap timer at the end of the hand-off window: release the
   * outgoing circuit, leaving only the incoming one on. Guarded against a stale
   * fire — a preempting action clears the overlap first — so it acts only while
   * this exact hand-off is still in flight.
   */
  private async releaseOutgoing(from: number): Promise<void> {
    if (!this.overlap || this.overlap.from !== from) {
      return;
    }
    const fromPin = this.requirePin(from);
    this.overlap = undefined;
    try {
      await this.driver.write(fromPin, "low");
    } catch (error) {
      // The two-on state now persists past the window; the watchdog's
      // overlap-stuck backstop resolves it via `safeOffAll`. Surface the error
      // for logging rather than letting the timer callback's void'd promise
      // become an unhandled rejection, and do NOT signal a normal resolution.
      this.hooks.onReleaseError?.(error);
      return;
    }
    this.hooks.onOverlapResolved?.();
  }

  /**
   * Abandon any in-flight hand-off: cancel the pending release and forget the
   * overlap state. Leaves the pins untouched; the caller drives the intended
   * state. Idempotent when no hand-off is in flight.
   */
  private cancelOverlap(): void {
    if (!this.overlap) {
      return;
    }
    this.overlapTimer.cancel();
    this.overlap = undefined;
  }

  /**
   * Best-effort safe-off used on a failed energize path. Swallows secondary
   * errors so the original failure is the one surfaced to the caller.
   */
  private async forceSafeOff(): Promise<void> {
    try {
      await this.safeOffAll();
    } catch {
      // The original error is more informative; safe-off is best-effort here.
    }
    this.active = undefined;
  }

  private requirePin(circuit: number): number {
    const pin = this.pinByCircuit.get(circuit);
    if (pin === undefined) {
      throw new SafetyViolationError(`unknown circuit ${circuit}`);
    }
    return pin;
  }

  private asSafetyViolation(
    message: string,
    cause: unknown,
  ): SafetyViolationError {
    return cause instanceof SafetyViolationError
      ? cause
      : new SafetyViolationError(message, { cause });
  }
}
