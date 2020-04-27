module.exports = {
  configureOnExitCleanup: (closeableProvider) => {
    const cleanup = async (_) => {
      const closeables = closeableProvider();
      console.log(`cleaning up ${closeables.length} items`);
      await Promise.all(closeables.map((it) => it.close()));
    };
    const signals = ["SIGTERM", "SIGINT", "exit"];
    signals.forEach((signal) => {
      process.on(signal, cleanup);
    });
  },
};
