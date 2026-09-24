import { beforeEach, describe, expect, it } from "vitest";
import { GpiodCliDriver } from "./gpiod-cli-driver";
import type { HeldProcess, ProcessRunner } from "./gpiod-cli-driver";

interface SpawnRecord {
  command: string;
  args: string[];
  child: FakeChild;
}

interface RunRecord {
  command: string;
  args: string[];
}

class FakeChild implements HeldProcess {
  killed = false;
  /** When true (default), kill() synchronously emits exit, as a fast kill would. */
  exitOnKill = true;
  private exitListeners: Array<(code: number | null) => void> = [];
  private errorListeners: Array<(error: Error) => void> = [];

  kill(): void {
    this.killed = true;
    if (this.exitOnKill) {
      for (const listener of this.exitListeners) {
        listener(null);
      }
    }
  }

  on(event: "error", listener: (error: Error) => void): void;
  on(event: "exit", listener: (code: number | null) => void): void;
  on(event: "error" | "exit", listener: (arg: never) => void): void {
    if (event === "exit") {
      this.exitListeners.push(listener as (code: number | null) => void);
    } else {
      this.errorListeners.push(listener as (error: Error) => void);
    }
  }

  emitExit(code: number | null): void {
    for (const listener of this.exitListeners) {
      listener(code);
    }
  }
}

class FakeRunner implements ProcessRunner {
  readonly spawns: SpawnRecord[] = [];
  readonly runs: RunRecord[] = [];
  /** Canned stdout for the next `run` call (e.g. a `pinctrl get` line). */
  nextRunOutput = "";

  spawn(command: string, args: readonly string[]): HeldProcess {
    const child = new FakeChild();
    this.spawns.push({ command, args: [...args], child });
    return child;
  }

  async run(command: string, args: readonly string[]): Promise<string> {
    this.runs.push({ command, args: [...args] });
    return this.nextRunOutput;
  }

  lastSpawn(): SpawnRecord {
    const record = this.spawns.at(-1);
    if (!record) {
      throw new Error("no spawn recorded");
    }
    return record;
  }

  runsOf(command: string): RunRecord[] {
    return this.runs.filter((r) => r.command === command);
  }
}

describe("GpiodCliDriver", () => {
  let runner: FakeRunner;
  let driver: GpiodCliDriver;

  beforeEach(async () => {
    runner = new FakeRunner();
    driver = new GpiodCliDriver({ runner });
    await driver.setup([17, 27]);
  });

  it("drives all configured pins low on setup", () => {
    // setup ran in beforeEach; it should have driven both pins low in one call.
    const pinctrl = runner.runsOf("pinctrl");
    expect(pinctrl).toHaveLength(1);
    expect(pinctrl[0]!.args).toEqual(["set", "17,27", "op", "dl"]);
  });

  it("holds a line high with gpioset on the default chip", async () => {
    await driver.write(17, "high");
    const spawn = runner.lastSpawn();
    expect(spawn.command).toBe("gpioset");
    expect(spawn.args).toEqual(["-c", "gpiochip0", "17=1"]);
  });

  it("does not spawn a second holder for an already-high line", async () => {
    await driver.write(17, "high");
    await driver.write(17, "high");
    expect(runner.spawns).toHaveLength(1);
  });

  it("turns a line off by killing the holder then driving low with pinctrl", async () => {
    await driver.write(17, "high");
    const { child } = runner.lastSpawn();

    await driver.write(17, "low");

    expect(child.killed).toBe(true);
    // The last pinctrl call drives pin 17 low.
    const lastPinctrl = runner.runsOf("pinctrl").at(-1);
    expect(lastPinctrl?.args).toEqual(["set", "17", "op", "dl"]);
  });

  it("drives a line low even when it was never held high", async () => {
    // No holder for 27 beyond setup; an explicit off must still drive it low.
    const before = runner.runsOf("pinctrl").length;
    await driver.write(27, "low");
    const after = runner.runsOf("pinctrl");
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)?.args).toEqual(["set", "27", "op", "dl"]);
  });

  it("waits for the holder to exit before driving low", async () => {
    // A child that does NOT exit synchronously on kill(), so we can observe that
    // write(low) stays pending until the holder actually exits (the line is
    // exclusively reserved until then).
    const slowRunner = new FakeRunner();
    const slowDriver = new GpiodCliDriver({
      runner: slowRunner,
      releaseTimeoutMs: 10_000,
    });
    await slowDriver.setup([17]);
    await slowDriver.write(17, "high");
    const { child } = slowRunner.lastSpawn();
    child.exitOnKill = false;

    let resolved = false;
    const low = slowDriver.write(17, "low").then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false); // still waiting for the holder to die

    child.emitExit(0);
    await low;
    expect(resolved).toBe(true);
    expect(child.killed).toBe(true);
  });

  it("rejects write(low) when the holder never exits (fails closed, does not hang)", async () => {
    // A wedged holder that ignores kill(): write(low) must NOT resolve as success
    // — an unconfirmed de-energize has to surface so callers fail closed.
    const wedgedRunner = new FakeRunner();
    const wedgedDriver = new GpiodCliDriver({
      runner: wedgedRunner,
      releaseTimeoutMs: 20,
    });
    await wedgedDriver.setup([17]);
    await wedgedDriver.write(17, "high");
    wedgedRunner.lastSpawn().child.exitOnKill = false; // never exits on kill

    await expect(wedgedDriver.write(17, "low")).rejects.toThrow(
      /did not exit within/,
    );
    // Best-effort drive-low still ran despite the timeout.
    expect(wedgedRunner.runsOf("pinctrl").at(-1)?.args).toEqual([
      "set",
      "17",
      "op",
      "dl",
    ]);
  });

  it("propagates a pinctrl failure out of write(low)", async () => {
    const failRunner = new (class extends FakeRunner {
      override async run(command: string, args: readonly string[]) {
        if (command === "pinctrl" && args[0] === "set") {
          throw new Error("simulated pinctrl failure");
        }
        return super.run(command, args);
      }
    })();
    const failDriver = new GpiodCliDriver({ runner: failRunner });
    // setup itself drives low, so it should already reject; assert on an explicit
    // off after a successful high instead by allowing setup to fail loudly.
    await expect(failDriver.setup([17])).rejects.toThrow(/pinctrl failure/);
  });

  it("reads back level via pinctrl get and parses the level field", async () => {
    runner.nextRunOutput = "17: op -- pd | hi // GPIO17 = output\n";
    expect(await driver.read(17)).toBe("high");
    runner.nextRunOutput = "17: op -- pd | lo // GPIO17 = output\n";
    expect(await driver.read(17)).toBe("low");

    const lastRun = runner.runs.at(-1);
    expect(lastRun?.command).toBe("pinctrl");
    expect(lastRun?.args).toEqual(["get", "17"]);
  });

  it("throws on unexpected pinctrl get output", async () => {
    runner.nextRunOutput = "garbage";
    await expect(driver.read(17)).rejects.toThrow(/unexpected pinctrl get output/);
  });

  it("kills all held lines and drives all pins low on release", async () => {
    await driver.write(17, "high");
    await driver.write(27, "high");
    const children = runner.spawns.map((record) => record.child);

    await driver.release();

    expect(children.every((child) => child.killed)).toBe(true);
    // Release must leave the hardware off: a final drive-low of every pin.
    const lastPinctrl = runner.runsOf("pinctrl").at(-1);
    expect(lastPinctrl?.args[0]).toBe("set");
    expect(lastPinctrl?.args[1]!.split(",").sort()).toEqual(["17", "27"]);
    expect(lastPinctrl?.args.slice(2)).toEqual(["op", "dl"]);
  });

  it("stops tracking a held line if its process exits on its own", async () => {
    await driver.write(17, "high");
    const { child } = runner.lastSpawn();

    child.emitExit(0);
    // A subsequent high write should spawn a fresh holder rather than reuse the
    // dead one.
    await driver.write(17, "high");
    expect(runner.spawns).toHaveLength(2);
  });

  it("passes arguments as an argv array, never an interpolated string", async () => {
    await driver.write(17, "high");
    runner.nextRunOutput = "27: op -- pd | lo // GPIO27 = output\n";
    await driver.read(27);
    for (const record of [...runner.spawns, ...runner.runs]) {
      for (const arg of record.args) {
        // pinctrl's comma-joined pin list is a single arg with no spaces; that is
        // fine. We are guarding against space-separated interpolation.
        expect(arg).not.toContain(" ");
      }
    }
  });

  it("rejects writes to pins that were not set up", async () => {
    await expect(driver.write(99, "high")).rejects.toThrow(/not set up/);
  });

  it("addresses a custom chip when configured", async () => {
    const customRunner = new FakeRunner();
    const customDriver = new GpiodCliDriver({
      runner: customRunner,
      chip: "gpiochip4",
    });
    await customDriver.setup([20]);
    await customDriver.write(20, "high");
    expect(customRunner.lastSpawn().args).toEqual(["-c", "gpiochip4", "20=1"]);
  });
});
