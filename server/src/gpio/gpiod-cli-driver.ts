import { spawn as nodeSpawn } from "node:child_process";
import type {
  ChildProcess,
  ChildProcessWithoutNullStreams,
} from "node:child_process";
import type { GpioDriver, PinLevel } from "./gpio-driver";

/**
 * Minimal shapes of the child-process functions this driver needs, so tests can
 * inject fakes without a real `child_process`.
 */
export interface ProcessRunner {
  /**
   * Spawn a long-lived process (used to hold a line high). The returned handle
   * must support `kill()` and emit `error`/`exit`.
   */
  spawn(command: string, args: readonly string[]): HeldProcess;
  /**
   * Run a command to completion and resolve with its trimmed stdout. Rejects on
   * non-zero exit or spawn error.
   */
  run(command: string, args: readonly string[]): Promise<string>;
}

export interface HeldProcess {
  kill(): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "exit", listener: (code: number | null) => void): void;
}

export interface GpiodCliOptions {
  /**
   * GPIO chip to address. The Raspberry Pi 4's 40-pin header is on gpiochip0.
   */
  chip?: string;
  /**
   * Override the process runner. Defaults to Node's child_process.
   */
  runner?: ProcessRunner;
}

const DEFAULT_CHIP = "gpiochip0";

/**
 * Drives relays through the libgpiod v2 command-line tools instead of a native
 * addon, avoiding node-gyp, a compiler, and Node-version coupling. Only the
 * `gpiod` package needs to be installed on the Pi (Debian 12 bookworm and later
 * ship libgpiod v2).
 *
 * A line is held high by a long-lived `gpioset` process. Under libgpiod v2,
 * `gpioset` holds the requested value until the process exits by default (no
 * `--mode` flag), and exiting releases the line, driving it low. This fails safe:
 * if the Node process dies, its child `gpioset` processes die too and the relays
 * de-energize (with normally-closed wiring, water stops).
 *
 * The chip is passed as `-c <chip>` so that lines are addressed by numeric offset
 * rather than name. Read-back uses `gpioget --numeric` (v2 otherwise prints
 * `active`/`inactive`). All arguments are passed as an argv array, never an
 * interpolated shell string.
 */
export class GpiodCliDriver implements GpioDriver {
  private readonly chip: string;
  private readonly runner: ProcessRunner;
  private readonly configuredPins = new Set<number>();
  private readonly heldByPin = new Map<number, HeldProcess>();

  constructor(options: GpiodCliOptions = {}) {
    this.chip = options.chip ?? DEFAULT_CHIP;
    this.runner = options.runner ?? defaultRunner();
  }

  async setup(pins: readonly number[]): Promise<void> {
    for (const pin of pins) {
      this.configuredPins.add(pin);
    }
  }

  async write(pin: number, level: PinLevel): Promise<void> {
    this.requireConfigured(pin);
    if (level === "high") {
      this.holdHigh(pin);
    } else {
      this.releaseLine(pin);
    }
  }

  async read(pin: number): Promise<PinLevel> {
    this.requireConfigured(pin);
    const output = await this.runner.run("gpioget", [
      "--numeric",
      "-c",
      this.chip,
      String(pin),
    ]);
    return parseLevel(output, pin);
  }

  async release(): Promise<void> {
    for (const pin of [...this.heldByPin.keys()]) {
      this.releaseLine(pin);
    }
  }

  private holdHigh(pin: number): void {
    if (this.heldByPin.has(pin)) {
      return;
    }
    const child = this.runner.spawn("gpioset", [
      "-c",
      this.chip,
      `${pin}=1`,
    ]);
    child.on("exit", () => {
      if (this.heldByPin.get(pin) === child) {
        this.heldByPin.delete(pin);
      }
    });
    child.on("error", () => {
      if (this.heldByPin.get(pin) === child) {
        this.heldByPin.delete(pin);
      }
    });
    this.heldByPin.set(pin, child);
  }

  private releaseLine(pin: number): void {
    const child = this.heldByPin.get(pin);
    if (child) {
      this.heldByPin.delete(pin);
      child.kill();
    }
  }

  private requireConfigured(pin: number): void {
    if (!this.configuredPins.has(pin)) {
      throw new Error(`pin ${pin} was not set up`);
    }
  }
}

function parseLevel(output: string, pin: number): PinLevel {
  const value = output.trim();
  if (value === "1") {
    return "high";
  }
  if (value === "0") {
    return "low";
  }
  throw new Error(`unexpected gpioget output for pin ${pin}: "${output}"`);
}

function defaultRunner(): ProcessRunner {
  return {
    spawn(command, args): HeldProcess {
      return nodeSpawn(command, [...args]) as ChildProcessWithoutNullStreams;
    },
    run(command, args): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        const child: ChildProcess = nodeSpawn(command, [...args]);
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(
              new Error(
                `${command} exited with code ${code}: ${stderr.trim()}`,
              ),
            );
          }
        });
      });
    },
  };
}
