const logger = require("./logger");

describe("logger", () => {
    it("should provide a log function", () => {
        expect(logger.log).toBe(console.log);
    });
});