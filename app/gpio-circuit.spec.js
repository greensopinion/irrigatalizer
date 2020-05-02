
const gpioCircuit = require("./gpio-circuit");

jest.mock("onoff");
const onoff = require("onoff");

describe("gpio-circuit", () => {

    describe("create", () => {
        it("creates a circuit", () => {
            const circuit = gpioCircuit.create(1);
            expect(circuit).toBeDefined();
            expect(circuit.gpio).toBeDefined();
            expect(circuit.gpio.pin).toEqual(18);
            expect(circuit.gpio.direction).toEqual("out");
        });

        it("rejects a circuit for an unknown circuit number", () => {
            expect(() => gpioCircuit.create(999)).toThrow(new Error("No GPIO pin for 999"));
        });
    });

    describe("circuit", () => {
        it("close unexports a circuit", () => {
            const circuit = gpioCircuit.create(1);
            expect(circuit.gpio.unexported).toBe(false);
            circuit.close();
            expect(circuit.gpio.unexported).toBe(true);
        });

        it("on writes to the circuit", async () => {
            const circuit = gpioCircuit.create(1);
            expect(circuit.gpio.written).toBeUndefined();
            await circuit.on();
            expect(circuit.gpio.written).toBe(1);
        });

        it("off writes to the circuit", async () => {
            const circuit = gpioCircuit.create(1);
            expect(circuit.gpio.written).toBeUndefined();
            await circuit.off();
            expect(circuit.gpio.written).toBe(0);
        });
    });
});