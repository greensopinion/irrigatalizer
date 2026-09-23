import { describe, expect, it } from "vitest";
import {
  applyOverride,
  createRainDelay,
  createSkip24h,
  createSkipNext,
  effectiveTimeline,
} from "./overrides";
import { buildTimeline } from "./timeline";
import type { Configuration, Program } from "../persistence/schema";

const TEST_ZONE = "UTC";

function localTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
}

// 2026-06-01 is a Monday; 2026-06-02 is a Tuesday.
const MONDAY = { year: 2026, month: 6, day: 1 };

function config(programs: Program[], enabled = true): Configuration {
  return {
    circuits: [],
    programs,
    enabled,
    override: null,
    timezone: TEST_ZONE,
  };
}

/**
 * A program running every day at 06:00 with two back-to-back circuits, so each
 * day forms one session.
 */
function dailyProgram(): Program {
  return {
    id: "daily",
    name: "Daily",
    days: [1, 2, 3, 4, 5, 6, 7],
    startSlot: 12, // 06:00
    steps: [
      { circuit: 1, durationMinutes: 10 },
      { circuit: 2, durationMinutes: 10 },
    ],
  };
}

describe("override builders", () => {
  it("builds a skip-next override with no fixed expiry", () => {
    const now = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 5);
    expect(createSkipNext(now)).toEqual({
      kind: "skip-next",
      createdAt: now,
      expiresAt: null,
    });
  });

  it("builds a skip-24h window", () => {
    const now = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 5);
    const override = createSkip24h(now);
    expect(override.kind).toBe("skip-24h");
    expect(override.expiresAt).toBe(now + 24 * 60 * 60 * 1000);
  });

  it("builds a rain-delay window spanning the given days", () => {
    const now = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 5);
    const override = createRainDelay(now, 3);
    expect(override.expiresAt).toBe(now + 3 * 24 * 60 * 60 * 1000);
  });

  it("rejects a non-positive rain-delay", () => {
    const now = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 5);
    expect(() => createRainDelay(now, 0)).toThrow(/positive integer/);
  });
});

describe("applyOverride", () => {
  const buildAt = (hour: number): ReturnType<typeof buildTimeline> =>
    buildTimeline(
      config([dailyProgram()]),
      localTime(MONDAY.year, MONDAY.month, MONDAY.day, hour),
    );

  it("passes the timeline through when there is no override", () => {
    const timeline = buildAt(5);
    expect(applyOverride(timeline, null, buildAt(5)[0]?.start ?? 0)).toEqual(
      timeline,
    );
  });

  describe("skip-next", () => {
    it("suppresses the next session but leaves later sessions running", () => {
      const now = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 5);
      const timeline = buildAt(5);
      const override = createSkipNext(now);

      const result = applyOverride(timeline, override, now);

      const mondaySix = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 6);
      const tuesdaySix = localTime(2026, 6, 2, 6);
      // Monday's session (both circuits) is gone; Tuesday's remains.
      expect(result.some((run) => run.start === mondaySix)).toBe(false);
      expect(result.some((run) => run.start === tuesdaySix)).toBe(true);
    });

    it("does not suppress a session that already started before it was created", () => {
      // Created mid-way through Monday's session: the next session at/after now
      // is Tuesday, so Monday keeps running and Tuesday is skipped.
      const now = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 6, 5);
      const timeline = buildAt(6);
      const override = createSkipNext(now);

      const result = applyOverride(timeline, override, now);

      const tuesdaySix = localTime(2026, 6, 2, 6);
      expect(result.some((run) => run.start === tuesdaySix)).toBe(false);
      // Monday's in-progress session is untouched.
      expect(
        result.some(
          (run) =>
            run.start === localTime(MONDAY.year, MONDAY.month, MONDAY.day, 6),
        ),
      ).toBe(true);
    });
  });

  describe("time-window overrides", () => {
    it("suppresses all runs within a skip-24h window", () => {
      const now = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 5);
      const timeline = buildAt(5);
      const result = applyOverride(timeline, createSkip24h(now), now);
      // Monday 06:00 is within 24h; Tuesday 06:00 (25h later) is not.
      expect(result.some((run) => run.start < now + 24 * 60 * 60 * 1000)).toBe(
        false,
      );
    });

    it("auto-resumes once the window has expired", () => {
      const created = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 5);
      const override = createSkip24h(created);
      const timeline = buildAt(5);
      // Evaluate after expiry: the override suppresses nothing.
      const afterExpiry = created + 25 * 60 * 60 * 1000;
      const result = applyOverride(timeline, override, afterExpiry);
      expect(result).toEqual(timeline);
    });
  });
});

describe("effectiveTimeline", () => {
  it("yields nothing for a disabled schedule regardless of override", () => {
    const now = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 5);
    const disabled: Configuration = {
      ...config([dailyProgram()], false),
      override: createSkipNext(now),
    };
    expect(effectiveTimeline(disabled, now)).toEqual([]);
  });

  it("applies the configuration's override to the built timeline", () => {
    const now = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 5);
    const enabled: Configuration = {
      ...config([dailyProgram()]),
      override: createSkip24h(now),
    };
    const result = effectiveTimeline(enabled, now);
    expect(result.some((run) => run.start < now + 24 * 60 * 60 * 1000)).toBe(
      false,
    );
  });
});
