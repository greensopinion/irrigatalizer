import type { GpioDriver, PinLevel } from "./gpio-driver";

/**
 * Optional fault injection for tests. `failWriteOnPins` makes a write to the
 * matching pin throw, so tests can exercise the controller's write-failure paths.
 */
export interface FakeGpioFaults {
  failWriteOnPins?: ReadonlySet<number>;
}

/**
 * In-memory GpioDriver for tests. Records the level of every configured pin and
 * the full sequence of writes so tests can assert both the final state and the
 * order in which the controller drove pins.
 */
export class FakeGpioDriver implements GpioDriver {
  private readonly levels = new Map<number, PinLevel>();
  private released = false;
  readonly writeLog: Array<{ pin: number; level: PinLevel }> = [];

  constructor(private readonly faults: FakeGpioFaults = {}) {}

  async setup(pins: readonly number[]): Promise<void> {
    for (const pin of pins) {
      if (!this.levels.has(pin)) {
        this.levels.set(pin, "low");
      }
    }
  }

  async write(pin: number, level: PinLevel): Promise<void> {
    this.ensureNotReleased();
    this.ensurePinKnown(pin);
    if (this.faults.failWriteOnPins?.has(pin)) {
      throw new Error(`simulated write failure on pin ${pin}`);
    }
    this.writeLog.push({ pin, level });
    this.levels.set(pin, level);
  }

  async read(pin: number): Promise<PinLevel> {
    this.ensureNotReleased();
    this.ensurePinKnown(pin);
    return this.levels.get(pin) ?? "low";
  }

  async release(): Promise<void> {
    this.released = true;
  }

  /**
   * Test helper: the pins currently driven high.
   */
  highPins(): number[] {
    return [...this.levels.entries()]
      .filter(([, level]) => level === "high")
      .map(([pin]) => pin);
  }

  private ensureNotReleased(): void {
    if (this.released) {
      throw new Error("driver used after release");
    }
  }

  private ensurePinKnown(pin: number): void {
    if (!this.levels.has(pin)) {
      throw new Error(`pin ${pin} was not set up`);
    }
  }
}
