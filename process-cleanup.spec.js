const cleanup = require("./process-cleanup");

describe("process-cleanup", () => {
  it("should register a cleanup for 'exit'", async () => {
    const closeable = {
      close: jest.fn(async () => {}),
    };
    const closeableProvider = () => {
      return [closeable];
    };
    const signals = [];
    const handlers = [];
    jest.spyOn(process, "on").mockImplementation((signal, handler) => {
      signals.push(signal);
      handlers.push(handler);
    });
    cleanup.configureOnExitCleanup(closeableProvider);

    expect(signals).toEqual(["SIGTERM", "SIGINT", "exit"]);
    expect(handlers).toEqual([
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    ]);

    expect(closeable.close).not.toHaveBeenCalled();
    handlers[0]();
    expect(closeable.close).toHaveBeenCalled();
  });
});
