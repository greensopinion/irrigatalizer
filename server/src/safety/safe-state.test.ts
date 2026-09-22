import { describe, expect, it, vi } from "vitest";
import {
  registerSafeStateHandlers,
  safeStateOnBoot,
  type ProcessLike,
  type SafeStateTarget,
} from "./safe-state";

type ProcessEvent =
  | "SIGINT"
  | "SIGTERM"
  | "uncaughtException"
  | "unhandledRejection"
  | "beforeExit";

class FakeProcess implements ProcessLike {
  private readonly listeners = new Map<
    ProcessEvent,
    Array<(arg: never) => void>
  >();

  on(event: ProcessEvent, listener: (arg: never) => void): void {
    this.add(event, listener);
  }

  once(event: ProcessEvent, listener: (arg: never) => void): void {
    this.add(event, listener);
  }

  private add(event: ProcessEvent, listener: (arg: never) => void): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
  }

  async emit(event: ProcessEvent, arg?: unknown): Promise<void> {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (value: unknown) => void)(arg);
    }
    // Allow queued shutdown microtasks to settle before assertions.
    await Promise.resolve();
    await Promise.resolve();
  }
}

class RecordingTarget implements SafeStateTarget {
  readonly calls: string[] = [];
  safeOffError: Error | undefined;

  async safeOffAll(): Promise<void> {
    this.calls.push("safeOffAll");
    if (this.safeOffError) {
      throw this.safeOffError;
    }
  }

  async release(): Promise<void> {
    this.calls.push("release");
  }
}

describe("safeStateOnBoot", () => {
  it("drives all circuits off", async () => {
    const target = new RecordingTarget();
    await safeStateOnBoot(target);
    expect(target.calls).toEqual(["safeOffAll"]);
  });
});

describe("registerSafeStateHandlers", () => {
  it("safe-offs then releases on SIGTERM", async () => {
    const target = new RecordingTarget();
    const proc = new FakeProcess();
    registerSafeStateHandlers({ target, process: proc });

    await proc.emit("SIGTERM");

    expect(target.calls).toEqual(["safeOffAll", "release"]);
  });

  it("safe-offs and releases on an uncaught exception", async () => {
    const target = new RecordingTarget();
    const proc = new FakeProcess();
    registerSafeStateHandlers({ target, process: proc });

    await proc.emit("uncaughtException", new Error("boom"));

    expect(target.calls).toEqual(["safeOffAll", "release"]);
  });

  it("safe-offs and releases on an unhandled rejection", async () => {
    const target = new RecordingTarget();
    const proc = new FakeProcess();
    registerSafeStateHandlers({ target, process: proc });

    await proc.emit("unhandledRejection", "nope");

    expect(target.calls).toEqual(["safeOffAll", "release"]);
  });

  it("runs the shutdown sequence at most once across multiple events", async () => {
    const target = new RecordingTarget();
    const proc = new FakeProcess();
    registerSafeStateHandlers({ target, process: proc });

    await proc.emit("SIGINT");
    await proc.emit("SIGTERM");
    await proc.emit("beforeExit");

    expect(target.calls).toEqual(["safeOffAll", "release"]);
  });

  it("still releases GPIO when safe-off fails during shutdown", async () => {
    const target = new RecordingTarget();
    target.safeOffError = new Error("stuck relay");
    const proc = new FakeProcess();
    const log = vi.fn();
    registerSafeStateHandlers({ target, process: proc, log });

    await proc.emit("SIGTERM");

    expect(target.calls).toEqual(["safeOffAll", "release"]);
    expect(log).toHaveBeenCalled();
  });
});
