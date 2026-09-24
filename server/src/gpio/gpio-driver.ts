/**
 * A relay is energized when its pin is driven high and de-energized when low.
 * The controller keeps at most one pin high at any instant.
 */
export type PinLevel = "high" | "low";

/**
 * Hardware boundary for relay control. Domain and scheduling logic depend only on
 * this interface, never on a concrete GPIO library, so the library can be chosen
 * without touching safety logic.
 *
 * `read` is **advisory** — a best-effort report of a pin's level for diagnostics.
 * The controller does NOT use it to verify off-state before energizing, because
 * the target hardware has no reliable read-back (see
 * `docs/gpio-driver-decision.md`). The invariant rests on driving pins low, which
 * the driver does synchronously, not on reading them back.
 */
export interface GpioDriver {
  /**
   * Prepare the given pins for output and drive them to a known-off (low) state.
   * Called once before any write.
   */
  setup(pins: readonly number[]): Promise<void>;

  /**
   * Drive a single pin to the given level. "low" must actively drive the pad low
   * (not merely release the line, which can retain the last level).
   */
  write(pin: number, level: PinLevel): Promise<void>;

  /**
   * Advisory read of a pin's current level. Best-effort, for diagnostics only —
   * not used to gate the single-active invariant.
   */
  read(pin: number): Promise<PinLevel>;

  /**
   * Drive all pins low and release any underlying resources. Called on shutdown.
   * Must leave the hardware de-energized, not merely released.
   */
  release(): Promise<void>;
}
