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

/**
 * A held-high line: the `gpioset` process holding it, whether it has exited, and
 * a resolver used to await that exit during release.
 */
interface HeldLine {
  child: HeldProcess;
  exited: boolean;
  resolveExit?: () => void;
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
  /**
   * How long turning a line off waits for its holding `gpioset` process to
   * actually exit (releasing the line) before driving it low with `pinctrl`.
   * Bounded so de-energizing cannot hang on a wedged holder. Defaults to 2000ms.
   */
  releaseTimeoutMs?: number;
}

const DEFAULT_CHIP = "gpiochip0";
const DEFAULT_RELEASE_TIMEOUT_MS = 2000;

/**
 * Drives relays through the Raspberry Pi GPIO command-line tools (`gpioset` from
 * libgpiod v2 and `pinctrl`), rather than a native addon — avoiding node-gyp, a
 * compiler, and Node-version coupling.
 *
 * ## Why two tools, and why not release-to-turn-off
 *
 * This design is the result of hardware characterization on the target stack
 * (Raspberry Pi 4, Debian 13 trixie, libgpiod v2.2.1) with the relay board wired.
 * See `docs/gpio-driver-decision.md` and `docs/manual-tests-gpio-hardware.md` for
 * the full evidence. The findings that shape it:
 *
 * - **On** is a long-lived `gpioset -c <chip> <pin>=1` process holding the line
 *   high. The relay is energized while the holder lives.
 * - **Releasing that holder does NOT drive the line low** on this stack — the pad
 *   retains its last driven level (high), so the relay stays on. "Off = kill the
 *   holder" is therefore false and unsafe here.
 * - **Off** must be an explicit drive-low. `pinctrl set <pin> op dl` drives the
 *   pad low *synchronously* (the command returns after the level is set) and the
 *   level is retained after it exits. So off = kill the holder, wait for it to
 *   release the line, then `pinctrl set <pin> op dl`.
 * - Driving one line low with `pinctrl` is not disturbed by a later `gpioset` on
 *   a different line (verified), so the single-active invariant is stable.
 *
 * ## Fail-safe scope
 *
 * Graceful stops are covered: safe-off drives every line low explicitly. A hard
 * kill (`kill -9`), kernel panic, or power loss while a circuit is energized
 * leaves the pad high (relay on) until something drives it low — no userspace
 * cleanup can cover that. The strict "no live process ⇒ valve closed" guarantee
 * must come from hardware (normally-closed wiring). See the decision doc.
 *
 * ## read()
 *
 * `read()` reports the pad level via `pinctrl get` and is **advisory only** — it
 * is accurate right after a `set`, but the controller does not use it to gate the
 * single-active invariant (no reliable read-back-to-verify exists on this stack;
 * `gpioget` reports the pin's pull resistor, not its driven level). It is kept for
 * diagnostics/logging.
 *
 * All arguments are passed as an argv array, never an interpolated shell string.
 */
export class GpiodCliDriver implements GpioDriver {
  private readonly chip: string;
  private readonly runner: ProcessRunner;
  private readonly releaseTimeoutMs: number;
  private readonly configuredPins = new Set<number>();
  private readonly heldByPin = new Map<number, HeldLine>();

  constructor(options: GpiodCliOptions = {}) {
    this.chip = options.chip ?? DEFAULT_CHIP;
    this.runner = options.runner ?? defaultRunner();
    this.releaseTimeoutMs =
      options.releaseTimeoutMs ?? DEFAULT_RELEASE_TIMEOUT_MS;
  }

  /**
   * Record the configured pins and drive them all low as the initial safe state,
   * so every relay line is off before anything is energized.
   */
  async setup(pins: readonly number[]): Promise<void> {
    for (const pin of pins) {
      this.configuredPins.add(pin);
    }
    if (pins.length > 0) {
      await this.driveLow(pins);
    }
  }

  async write(pin: number, level: PinLevel): Promise<void> {
    this.requireConfigured(pin);
    if (level === "high") {
      this.holdHigh(pin);
    } else {
      await this.turnLow(pin);
    }
  }

  /**
   * Advisory read of the pad level via `pinctrl get`. NOT used by the controller's
   * safety logic — see the class docstring. `pinctrl get` prints a line like
   * "17: op -- pd | lo // GPIO17 = output"; the `hi`/`lo` field after the `|` is
   * the level.
   */
  async read(pin: number): Promise<PinLevel> {
    this.requireConfigured(pin);
    const output = await this.runner.run("pinctrl", ["get", String(pin)]);
    return parseLevel(output, pin);
  }

  /**
   * Release all held lines and drive every configured pin low, so shutdown leaves
   * the hardware off rather than merely releasing lines (which would retain their
   * last level).
   */
  async release(): Promise<void> {
    // Stop every holder, but do not let one wedged holder prevent the others from
    // being stopped or the final drive-low from running. Collect failures and
    // surface them after driving all pins low, so shutdown always attempts to
    // de-energize everything yet still reports an unconfirmed release.
    const stops = await Promise.allSettled(
      [...this.heldByPin.keys()].map((pin) => this.stopHolder(pin)),
    );
    if (this.configuredPins.size > 0) {
      await this.driveLow([...this.configuredPins]);
    }
    const failure = stops.find((s) => s.status === "rejected");
    if (failure && failure.status === "rejected") {
      throw failure.reason instanceof Error
        ? failure.reason
        : new Error(String(failure.reason));
    }
  }

  private holdHigh(pin: number): void {
    if (this.heldByPin.has(pin)) {
      return;
    }
    const child = this.runner.spawn("gpioset", ["-c", this.chip, `${pin}=1`]);
    const line: HeldLine = { child, exited: false };
    const markExited = (): void => {
      line.exited = true;
      line.resolveExit?.();
      if (this.heldByPin.get(pin) === line) {
        this.heldByPin.delete(pin);
      }
    };
    child.on("exit", markExited);
    child.on("error", markExited);
    this.heldByPin.set(pin, line);
  }

  /**
   * Turn a line off: stop its `gpioset` holder (if any) and wait for it to release
   * the line, then explicitly drive the pad low with `pinctrl`. Driving low is
   * done unconditionally (even if there was no holder) so "off" always leaves the
   * pad actively low rather than retaining a stale level.
   *
   * If the holder does not exit within `releaseTimeoutMs`, this drives low as a
   * best effort and then **throws**: the line is still exclusively reserved, so we
   * cannot confirm de-energize. On a relay controller a de-energize that cannot be
   * confirmed must surface as a failure (fail closed), never resolve as success —
   * the controller's `safeOffAll` aggregates it and the caller can react. It must
   * not hang either, which is why the wait is bounded.
   */
  private async turnLow(pin: number): Promise<void> {
    let stopError: unknown;
    try {
      await this.stopHolder(pin);
    } catch (error) {
      stopError = error;
    }
    // Best-effort drive-low regardless: if the holder did exit, this de-energizes;
    // if it is wedged, this at least attempts to and any pinctrl error surfaces.
    await this.driveLow([pin]);
    if (stopError !== undefined) {
      throw stopError;
    }
  }

  /**
   * Kill a pin's holder and wait for it to actually exit (bounded by
   * `releaseTimeoutMs`), so the line is released before `pinctrl` drives it. In
   * libgpiod v2 a held line is exclusively reserved; `pinctrl` must not race a
   * still-live holder. A pin with no holder resolves immediately. Rejects if the
   * holder does not exit within the timeout, so a wedged holder is reported as a
   * failure rather than silently treated as released.
   */
  private async stopHolder(pin: number): Promise<void> {
    const line = this.heldByPin.get(pin);
    if (!line) {
      return;
    }
    this.heldByPin.delete(pin);
    if (line.exited) {
      return;
    }
    const exited = new Promise<void>((resolve) => {
      line.resolveExit = resolve;
    });
    line.child.kill();
    if (line.exited) {
      return;
    }
    await rejectOnTimeout(
      exited,
      this.releaseTimeoutMs,
      `gpioset holder for pin ${pin} did not exit within ${this.releaseTimeoutMs}ms`,
    );
  }

  /**
   * Drive the given pins low as outputs via a single `pinctrl set <pins> op dl`.
   * Synchronous (returns after the level is set) and retained after exit.
   */
  private async driveLow(pins: readonly number[]): Promise<void> {
    await this.runner.run("pinctrl", ["set", pins.join(","), "op", "dl"]);
  }

  private requireConfigured(pin: number): void {
    if (!this.configuredPins.has(pin)) {
      throw new Error(`pin ${pin} was not set up`);
    }
  }
}

/**
 * Resolve when `promise` resolves, or **reject** with `timeoutMessage` when
 * `timeoutMs` elapses first. Bounds how long turning off waits for a holder to
 * exit so de-energizing cannot hang on a wedged process — but a timeout is a
 * failure, not a success: on a relay controller an unconfirmed de-energize must
 * surface, never be swallowed.
 */
function rejectOnTimeout(
  promise: Promise<void>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    void promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Parse the level out of `pinctrl get <pin>` output. The level is the `hi`/`lo`
 * token after the `|`, e.g. "17: op -- pd | lo // GPIO17 = output".
 */
function parseLevel(output: string, pin: number): PinLevel {
  const text = output.trim();
  if (/\|\s*hi\b/.test(text)) {
    return "high";
  }
  if (/\|\s*lo\b/.test(text)) {
    return "low";
  }
  throw new Error(`unexpected pinctrl get output for pin ${pin}: "${output}"`);
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
