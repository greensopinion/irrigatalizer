import { describe, expect, it } from "vitest";
import { FakeGpioDriver } from "./fake-gpio-driver";

describe("FakeGpioDriver", () => {
  it("initializes configured pins low", async () => {
    const driver = new FakeGpioDriver();
    await driver.setup([17, 27]);
    expect(await driver.read(17)).toBe("low");
    expect(driver.highPins()).toEqual([]);
  });

  it("records writes and reflects them on read", async () => {
    const driver = new FakeGpioDriver();
    await driver.setup([17]);
    await driver.write(17, "high");
    expect(await driver.read(17)).toBe("high");
    expect(driver.writeLog).toEqual([{ pin: 17, level: "high" }]);
  });

  it("rejects use of a pin that was not set up", async () => {
    const driver = new FakeGpioDriver();
    await expect(driver.write(99, "high")).rejects.toThrow(/not set up/);
  });

  it("rejects use after release", async () => {
    const driver = new FakeGpioDriver();
    await driver.setup([17]);
    await driver.release();
    await expect(driver.read(17)).rejects.toThrow(/after release/);
  });

  it("injects a write fault on the configured pin", async () => {
    const driver = new FakeGpioDriver({
      failWriteOnPins: new Set([17]),
    });
    await driver.setup([17, 27]);

    await expect(driver.write(17, "low")).rejects.toThrow(/write failure/);
    // Other pins are unaffected.
    await driver.write(27, "high");
    expect(await driver.read(27)).toBe("high");
  });
});
