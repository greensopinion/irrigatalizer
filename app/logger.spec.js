const logger = require("./logger");

global.console = { log: jest.fn() };

describe("logger", () => {
  afterEach(() => {
    logger.clearMessages();
  });

  it("should provide a log function", () => {
    expect(logger.log).toBeDefined();
  });

  it("should emit messages", () => {
    logger.log("a message");
    expect(console.log).toHaveBeenCalledWith("a message");
  });

  it("should track messages", () => {
    logger.log("first message");
    logger.log("second message");
    expect(logger.messages()).toMatchObject([
      {
        message: "first message",
      },
      {
        message: "second message",
      },
    ]);
  });

  it("should clear messages", () => {
    logger.log("first message");
    expect(logger.messages()).toMatchObject([
      {
        message: "first message",
      },
    ]);
    logger.clearMessages();
    expect(logger.messages()).toEqual([]);
  });

  it("should track a maximum of 20 messages", () => {
    for (let x = 0; x < 50; ++x) {
      logger.log(`message ${x}`);
    }
    let messages = logger.messages();
    expect(messages.length).toEqual(20);
    expect(messages[0].message).toEqual("message 30");
    expect(messages[19].message).toEqual("message 49");
  });
});
