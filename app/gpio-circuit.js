const Gpio = require("onoff").Gpio;

const numberToPin = {
  "1": 18,
  "2": 23,
  "3": 24,
};

module.exports = {
  create: (number) => {
    const gpioPin = numberToPin[`${number}`];
    if (!gpioPin) {
      throw new Error(`No GPIO pin for ${number}`);
    }
    const gpio = new Gpio(gpioPin, "out");
    return {
      gpio,
      on: function () {
        return this.gpio.write(1);
      },
      off: function () {
        return this.gpio.write(0);
      },
      close: function () {
        return this.gpio.unexport();
      },
    };
  },
};
