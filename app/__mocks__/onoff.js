class Gpio {

    constructor(gpioPin, direction) {
        this.pin = gpioPin;
        this.direction = direction;
        this.unexported = false;
    }

    write(value) {
        this.written = value;
        return Promise.resolve({});
    }

    unexport() {
        this.unexported = true;
    }
}

module.exports = {
    Gpio
}