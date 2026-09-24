import type { GpioDriver } from "./gpio-driver";

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
 * of the caller (scheduler, manual run, API).
 */
export class CircuitController {
  private readonly pinByCircuit = new Map<number, number>();
  private active: number | undefined;

  constructor(
    private readonly driver: GpioDriver,
    circuitPins: readonly CircuitPin[],
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
   * De-energize a circuit. Idempotent: turning off a circuit that is not active
   * still drives its pin low.
   */
  async turnOff(circuit: number): Promise<void> {
    const pin = this.requirePin(circuit);
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
