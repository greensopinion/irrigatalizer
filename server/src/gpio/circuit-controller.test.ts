import { beforeEach, describe, expect, it } from "vitest";
import {
  CircuitController,
  SafetyViolationError,
  type CircuitPin,
} from "./circuit-controller";
import { FakeGpioDriver } from "./fake-gpio-driver";

const CIRCUIT_PINS: readonly CircuitPin[] = [
  { circuit: 1, pin: 17 },
  { circuit: 2, pin: 27 },
  { circuit: 3, pin: 22 },
];

function pinOf(circuit: number): number {
  const match = CIRCUIT_PINS.find((entry) => entry.circuit === circuit);
  if (!match) {
    throw new Error(`test setup error: no pin for circuit ${circuit}`);
  }
  return match.pin;
}

describe("CircuitController", () => {
  let driver: FakeGpioDriver;
  let controller: CircuitController;

  beforeEach(async () => {
    driver = new FakeGpioDriver();
    controller = new CircuitController(driver, CIRCUIT_PINS);
    await controller.initialize();
  });

  it("starts with all circuits off and none active", () => {
    expect(driver.highPins()).toEqual([]);
    expect(controller.activeCircuit()).toBeUndefined();
  });

  it("energizes a single circuit and reports it active", async () => {
    await controller.turnOn(2);
    expect(driver.highPins()).toEqual([pinOf(2)]);
    expect(controller.activeCircuit()).toBe(2);
  });

  it("keeps at most one circuit active when switching", async () => {
    await controller.turnOn(1);
    await controller.turnOn(3);
    expect(driver.highPins()).toEqual([pinOf(3)]);
    expect(controller.activeCircuit()).toBe(3);
  });

  it("turns all others off before energizing the requested circuit", async () => {
    await controller.turnOn(1);
    driver.writeLog.length = 0;

    await controller.turnOn(2);

    const energizeIndex = driver.writeLog.findIndex(
      (entry) => entry.pin === pinOf(2) && entry.level === "high",
    );
    const otherOffIndex = driver.writeLog.findIndex(
      (entry) => entry.pin === pinOf(1) && entry.level === "low",
    );
    expect(otherOffIndex).toBeGreaterThanOrEqual(0);
    expect(energizeIndex).toBeGreaterThan(otherOffIndex);
  });

  it("is idempotent when turning on the already-active circuit", async () => {
    await controller.turnOn(2);
    await controller.turnOn(2);
    expect(driver.highPins()).toEqual([pinOf(2)]);
    expect(controller.activeCircuit()).toBe(2);
  });

  it("turns a circuit off and clears the active circuit", async () => {
    await controller.turnOn(2);
    await controller.turnOff(2);
    expect(driver.highPins()).toEqual([]);
    expect(controller.activeCircuit()).toBeUndefined();
  });

  it("is idempotent when turning off an inactive circuit", async () => {
    await controller.turnOff(3);
    expect(driver.highPins()).toEqual([]);
    expect(controller.activeCircuit()).toBeUndefined();
  });

  it("drives every circuit off on safeOffAll", async () => {
    await controller.turnOn(1);
    await controller.safeOffAll();
    expect(driver.highPins()).toEqual([]);
    expect(controller.activeCircuit()).toBeUndefined();
  });

  it("rejects an unknown circuit without energizing anything", async () => {
    await expect(controller.turnOn(99)).rejects.toBeInstanceOf(
      SafetyViolationError,
    );
    expect(driver.highPins()).toEqual([]);
  });

  describe("failure handling leaves nothing on", () => {
    it("refuses to energize when driving another circuit off fails", async () => {
      // A low-write to a peer pin fails, so the controller cannot drive all
      // others off and must refuse to energize the target.
      const failDriver = new FakeGpioDriver({
        failWriteOnPins: new Set([pinOf(1)]),
      });
      const failController = new CircuitController(failDriver, CIRCUIT_PINS);
      await failDriver.setup(CIRCUIT_PINS.map((entry) => entry.pin));

      await expect(failController.turnOn(2)).rejects.toBeInstanceOf(
        SafetyViolationError,
      );
      expect(failController.activeCircuit()).toBeUndefined();
      // The would-be target pin is never driven high when a peer cannot be
      // driven off.
      expect(
        failDriver.writeLog.some(
          (entry) => entry.pin === pinOf(2) && entry.level === "high",
        ),
      ).toBe(false);
    });

    it("clears the active circuit when energizing the target write fails", async () => {
      const writeFailDriver = new FakeGpioDriver({
        failWriteOnPins: new Set([pinOf(3)]),
      });
      const writeFailController = new CircuitController(
        writeFailDriver,
        CIRCUIT_PINS,
      );
      await writeFailDriver.setup(CIRCUIT_PINS.map((entry) => entry.pin));

      await expect(writeFailController.turnOn(3)).rejects.toBeInstanceOf(
        SafetyViolationError,
      );
      expect(writeFailController.activeCircuit()).toBeUndefined();
      expect(writeFailDriver.highPins()).toEqual([]);
    });

    it("attempts every pin and reports failure when one cannot be driven off", async () => {
      const partialDriver = new FakeGpioDriver({
        failWriteOnPins: new Set([pinOf(2)]),
      });
      const partialController = new CircuitController(
        partialDriver,
        CIRCUIT_PINS,
      );
      await partialDriver.setup(CIRCUIT_PINS.map((entry) => entry.pin));
      partialDriver.writeLog.length = 0;

      await expect(partialController.safeOffAll()).rejects.toBeInstanceOf(
        SafetyViolationError,
      );
      // A single failing pin does not stop the others from being driven off:
      // every configured pin except the failing one receives a low write.
      for (const { pin } of CIRCUIT_PINS) {
        if (pin === pinOf(2)) {
          continue;
        }
        expect(
          partialDriver.writeLog.some(
            (entry) => entry.pin === pin && entry.level === "low",
          ),
        ).toBe(true);
      }
    });
  });
});
