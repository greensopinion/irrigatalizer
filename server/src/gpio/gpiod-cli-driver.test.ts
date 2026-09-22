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
  private exitListeners: Array<(code: number | null) => void> = [];
  private errorListeners: Array<(error: Error) => void> = [];

  kill(): void {
    this.killed = true;
    for (const listener of this.exitListeners) {
      listener(null);
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
  nextReadValue = "0";

  spawn(command: string, args: readonly string[]): HeldProcess {
    const child = new FakeChild();
    this.spawns.push({ command, args: [...args], child });
    return child;
  }

  async run(command: string, args: readonly string[]): Promise<string> {
    this.runs.push({ command, args: [...args] });
    return this.nextReadValue;
  }

  lastSpawn(): SpawnRecord {
    const record = this.spawns.at(-1);
    if (!record) {
      throw new Error("no spawn recorded");
    }
    return record;
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

  it("holds a line high with gpioset --mode=signal on the default chip", async () => {
    await driver.write(17, "high");
    const spawn = runner.lastSpawn();
    expect(spawn.command).toBe("gpioset");
    expect(spawn.args).toEqual(["--mode=signal", "gpiochip0", "17=1"]);
  });

  it("de-energizes by killing the held process", async () => {
    await driver.write(17, "high");
    const { child } = runner.lastSpawn();
    await driver.write(17, "low");
    expect(child.killed).toBe(true);
  });

  it("does not spawn a second holder for an already-high line", async () => {
    await driver.write(17, "high");
    await driver.write(17, "high");
    expect(runner.spawns).toHaveLength(1);
  });

  it("reads back level with gpioget and parses the value", async () => {
    runner.nextReadValue = "1";
    expect(await driver.read(27)).toBe("high");
    runner.nextReadValue = "0";
    expect(await driver.read(27)).toBe("low");

    const lastRun = runner.runs.at(-1);
    expect(lastRun?.command).toBe("gpioget");
    expect(lastRun?.args).toEqual(["gpiochip0", "27"]);
  });

  it("throws on unexpected gpioget output", async () => {
    runner.nextReadValue = "garbage";
    await expect(driver.read(17)).rejects.toThrow(/unexpected gpioget output/);
  });

  it("kills all held lines on release", async () => {
    await driver.write(17, "high");
    await driver.write(27, "high");
    const children = runner.spawns.map((record) => record.child);

    await driver.release();

    expect(children.every((child) => child.killed)).toBe(true);
  });

  it("stops tracking a held line if its process exits on its own", async () => {
    await driver.write(17, "high");
    const { child } = runner.lastSpawn();

    child.emitExit(0);
    // A subsequent low write should be a no-op (nothing to kill) and a new high
    // write should spawn a fresh holder rather than reuse the dead one.
    await driver.write(17, "low");
    await driver.write(17, "high");
    expect(runner.spawns).toHaveLength(2);
  });

  it("passes arguments as an argv array, never an interpolated string", async () => {
    await driver.write(17, "high");
    await driver.read(27);
    for (const record of [...runner.spawns, ...runner.runs]) {
      for (const arg of record.args) {
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
    expect(customRunner.lastSpawn().args).toEqual([
      "--mode=signal",
      "gpiochip4",
      "20=1",
    ]);
  });
});
