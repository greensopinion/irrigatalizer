const Gpio = require("onoff").Gpio;

// 17, 27, 22, 5, 6, 23, 24, 25
const numberToPin = {
  "1": 17,
  "2": 27,
  "3": 22,
  "4": 5,
  "5": 6,
  "6": 23,
  "7": 24,
  "8": 25,
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
