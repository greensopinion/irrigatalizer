const circuitService = require("./circuit-service");
jest.mock("onoff");

describe("circuit-service", () => {
  afterEach(() => {
    circuitService.reset();
  });

  it("provide empty all circuits", () => {
    expect(circuitService.allCircuits()).toEqual([]);
  });

  it("adds a circuit", () => {
    const circuit = circuitService.circuit(1);
    expect(circuit).toMatchObject({ isOn: false });
    expect(circuitService.allCircuits()).toMatchObject([{ isOn: false }]);
  });

  it("provides the same circuit", () => {
    const circuit = circuitService.circuit(1);
    const circuit2 = circuitService.circuit(1);
    expect(circuit).toBe(circuit2);
  });

  it("turns a circuit on and off", async () => {
    const circuit = circuitService.circuit(1);
    expect(circuit.isOn).toBe(false);
    expect(circuit.gpio.gpio.written).toBeUndefined();
    await circuit.on();
    expect(circuit.isOn).toBe(true);
    expect(circuit.gpio.gpio.written).toBe(1);
    await circuit.off();
    expect(circuit.isOn).toBe(false);
    expect(circuit.gpio.gpio.written).toBe(0);
  });
});
