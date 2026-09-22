import { describe, expect, it } from "vitest";
import { currentHealth } from "./health";

describe("currentHealth", () => {
  it("reports an ok status", () => {
    const health = currentHealth();
    expect(health.status).toBe("ok");
  });

  it("reports the timestamp of the given time", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const health = currentHealth(now);
    expect(health.timestamp).toBe(now.getTime());
  });
});
