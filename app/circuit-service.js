const gpioCircuit = require("./gpio-circuit");
const logger = require("./logger");

var circuitNumberToEntry = {};

const createEntry = (number) => {
  const gpio = gpioCircuit.create(number);
  return {
    circuit: number,
    isOn: false,
    gpio,
    on: async function () {
      if (!this.isOn) {
        logger.log(`turning circuit on: ${this.circuit}`);
        await this.gpio.on();
        this.isOn = true;
      }
    },
    off: async function () {
      if (this.isOn) {
        logger.log(`turning circuit off: ${this.circuit}`);
        await this.gpio.off();
        this.isOn = false;
      }
    },
    close: async function () {
      await this.gpio.close();
    },
  };
};

module.exports = {
  circuit: (number) => {
    const key = `${number}`;
    let entry = circuitNumberToEntry[key];
    if (!entry) {
      entry = createEntry(number);
      circuitNumberToEntry[key] = entry;
    }
    return entry;
  },
  allCircuits: () => {
    return Object.values(circuitNumberToEntry);
  },
  reset: () => {
    circuitNumberToEntry = {};
  },
};
