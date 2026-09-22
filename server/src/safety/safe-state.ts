/**
 * The safety operations the lifecycle needs. Depending on this narrow interface
 * (rather than the concrete controller/driver) keeps the lifecycle logic testable
 * and decoupled.
 */
export interface SafeStateTarget {
  /**
   * Drive every circuit off. Must leave nothing energized.
   */
  safeOffAll(): Promise<void>;
  /**
   * Release GPIO resources. Called once, last, on shutdown.
   */
  release(): Promise<void>;
}

/**
 * The subset of Node's process events the lifecycle listens to. Injected so tests
 * can emit events without touching the real process.
 */
export interface ProcessLike {
  on(event: "SIGINT" | "SIGTERM", listener: () => void): void;
  on(event: "uncaughtException", listener: (error: Error) => void): void;
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  once(event: "beforeExit", listener: () => void): void;
}

export interface SafeStateOptions {
  target: SafeStateTarget;
  process: ProcessLike;
  /**
   * Optional log sink for observability. Never throws.
   */
  log?: (message: string) => void;
}

/**
 * Drive all circuits off as the very first boot action, before any scheduling
 * begins. Returns once the hardware is confirmed safe.
 */
export async function safeStateOnBoot(target: SafeStateTarget): Promise<void> {
  await target.safeOffAll();
}

/**
 * Register handlers that drive all circuits off and release GPIO on process exit
 * and on crash (uncaught exception / unhandled rejection). Runs the safe-off/
 * release sequence at most once regardless of how many events fire.
 *
 * Signal and crash handlers are the effectful edge; the actual safe-off/release
 * work lives in the injected target so it can be tested without a real process.
 */
export function registerSafeStateHandlers(options: SafeStateOptions): void {
  const { target, process: proc } = options;
  const log = options.log ?? (() => {});
  let shuttingDown = false;

  const shutdown = async (trigger: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log(`safe-state shutdown triggered by ${trigger}`);
    try {
      await target.safeOffAll();
    } catch (error) {
      log(`safe-off during shutdown failed: ${describe(error)}`);
    }
    try {
      await target.release();
    } catch (error) {
      log(`gpio release during shutdown failed: ${describe(error)}`);
    }
  };

  proc.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  proc.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  proc.on("uncaughtException", (error) => {
    log(`uncaught exception: ${describe(error)}`);
    void shutdown("uncaughtException");
  });
  proc.on("unhandledRejection", (reason) => {
    log(`unhandled rejection: ${describe(reason)}`);
    void shutdown("unhandledRejection");
  });
  proc.once("beforeExit", () => {
    void shutdown("beforeExit");
  });
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
