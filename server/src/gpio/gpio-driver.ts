/**
 * A relay is energized when its pin is driven high and de-energized when low.
 * The controller keeps at most one pin high at any instant.
 */
export type PinLevel = "high" | "low";

/**
 * Hardware boundary for relay control. Domain and scheduling logic depend only on
 * this interface, never on a concrete GPIO library, so the library can be chosen
 * (onoff, libgpiod, ...) without touching safety logic.
 *
 * `read` exists so the controller can verify that a pin actually reached the "low"
 * state before energizing another pin, rather than trusting a write blindly.
 */
export interface GpioDriver {
  /**
   * Prepare the given pins for output. Called once before any write.
   */
  setup(pins: readonly number[]): Promise<void>;

  /**
   * Drive a single pin to the given level.
   */
  write(pin: number, level: PinLevel): Promise<void>;

  /**
   * Read back the current level of a pin. Used to verify off-state.
   */
  read(pin: number): Promise<PinLevel>;

  /**
   * Release all pins and any underlying resources. Called on shutdown.
   */
  release(): Promise<void>;
}
