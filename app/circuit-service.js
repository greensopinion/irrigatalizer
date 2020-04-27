var circuitNumberToEntry = {};

const createEntry = (number) => {
  return {
    circuit: number,
    isOn: false,
    on: async function () {
      if (!this.isOn) {
        console.log(`turning circuit on: ${this.circuit}`);
        this.isOn = true;
      }
    },
    off: async function () {
      if (this.isOn) {
        console.log(`turning circuit off: ${this.circuit}`);
        this.isOn = false;
      }
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
