import { describe, expect, it } from "vitest";
import { buildTimeline, currentAndNext } from "./timeline";
import type { Configuration, Program } from "../persistence/schema";

/**
 * Build a local-time epoch for a given date and time-of-day so tests are
 * independent of the machine timezone.
 */
function localTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

// 2026-06-01 is a Monday (ISO weekday 1).
const MONDAY = { year: 2026, month: 6, day: 1 };

function config(programs: Program[], enabled = true): Configuration {
  return { circuits: [], programs, enabled, override: null };
}

function program(overrides: Partial<Program>): Program {
  return {
    id: "p1",
    name: "Program 1",
    days: [1],
    startSlot: 12, // 06:00
    steps: [{ circuit: 1, durationMinutes: 10 }],
    ...overrides,
  };
}

describe("buildTimeline", () => {
  it("returns nothing when the schedule is disabled", () => {
    const timeline = buildTimeline(
      config([program({})], false),
      localTime(MONDAY.year, MONDAY.month, MONDAY.day, 5),
    );
    expect(timeline).toEqual([]);
  });

  it("returns nothing on a day the program does not run", () => {
    // Reference on Tuesday; program only runs Mondays, and Wednesday is the
    // following day, so neither day in the window matches.
    const tuesday = localTime(2026, 6, 2, 5);
    const timeline = buildTimeline(config([program({ days: [1] })]), tuesday);
    expect(timeline).toEqual([]);
  });

  it("expands a program's steps back-to-back from its start slot", () => {
    const timeline = buildTimeline(
      config([
        program({
          startSlot: 12, // 06:00
          steps: [
            { circuit: 1, durationMinutes: 10 },
            { circuit: 2, durationMinutes: 15 },
            { circuit: 3, durationMinutes: 5 },
          ],
        }),
      ]),
      localTime(MONDAY.year, MONDAY.month, MONDAY.day, 0),
    );

    const sixAm = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 6);
    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toMatchObject({ circuit: 1, start: sixAm });
    expect(timeline[0]?.end).toBe(sixAm + 10 * 60_000);
    expect(timeline[1]).toMatchObject({
      circuit: 2,
      start: sixAm + 10 * 60_000,
    });
    expect(timeline[2]).toMatchObject({
      circuit: 3,
      start: sixAm + 25 * 60_000,
    });
  });

  it("serializes overlapping programs so runs do not overlap", () => {
    const timeline = buildTimeline(
      config([
        program({
          id: "a",
          startSlot: 12, // 06:00, 40 min total
          steps: [{ circuit: 1, durationMinutes: 40 }],
        }),
        program({
          id: "b",
          startSlot: 13, // 06:30, would overlap program a
          steps: [{ circuit: 2, durationMinutes: 20 }],
        }),
      ]),
      localTime(MONDAY.year, MONDAY.month, MONDAY.day, 0),
    );

    const sixAm = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 6);
    expect(timeline[0]).toMatchObject({ circuit: 1, start: sixAm });
    // Program b is pushed to start when program a ends (06:40), not 06:30.
    expect(timeline[1]).toMatchObject({
      circuit: 2,
      start: sixAm + 40 * 60_000,
    });
  });
});

describe("currentAndNext", () => {
  const timeline = buildTimeline(
    config([
      program({
        startSlot: 12, // 06:00
        steps: [
          { circuit: 1, durationMinutes: 10 },
          { circuit: 2, durationMinutes: 10 },
        ],
      }),
    ]),
    localTime(MONDAY.year, MONDAY.month, MONDAY.day, 0),
  );

  it("reports no current and the first run as next before the schedule starts", () => {
    const result = currentAndNext(
      timeline,
      localTime(MONDAY.year, MONDAY.month, MONDAY.day, 5),
    );
    expect(result.current).toBeUndefined();
    expect(result.next?.circuit).toBe(1);
  });

  it("reports the running circuit as current at a mid-run instant", () => {
    const result = currentAndNext(
      timeline,
      localTime(MONDAY.year, MONDAY.month, MONDAY.day, 6, 5),
    );
    expect(result.current?.circuit).toBe(1);
    expect(result.next?.circuit).toBe(2);
  });

  it("reports the second circuit as current right at the boundary", () => {
    const result = currentAndNext(
      timeline,
      localTime(MONDAY.year, MONDAY.month, MONDAY.day, 6, 10),
    );
    expect(result.current?.circuit).toBe(2);
  });

  it("reports no current and no next after the schedule ends", () => {
    const result = currentAndNext(
      timeline,
      localTime(MONDAY.year, MONDAY.month, MONDAY.day, 7),
    );
    expect(result.current).toBeUndefined();
    expect(result.next).toBeUndefined();
  });
});

describe("no-overlap property", () => {
  function randomInt(seed: () => number, min: number, max: number): number {
    return min + Math.floor(seed() * (max - min + 1));
  }

  // Deterministic PRNG so failures reproduce.
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("never produces overlapping runs across many random configurations", () => {
    for (let iteration = 0; iteration < 200; iteration++) {
      const rand = mulberry32(iteration + 1);
      const programCount = randomInt(rand, 1, 4);
      const programs: Program[] = [];
      for (let p = 0; p < programCount; p++) {
        const stepCount = randomInt(rand, 1, 4);
        const steps = Array.from({ length: stepCount }, () => ({
          circuit: randomInt(rand, 1, 8),
          durationMinutes: randomInt(rand, 1, 60),
        }));
        programs.push({
          id: `p${p}`,
          name: `Program ${p}`,
          days: [1, 2, 3, 4, 5, 6, 7],
          startSlot: randomInt(rand, 0, 47),
          steps,
        });
      }

      const timeline = buildTimeline(
        config(programs),
        localTime(MONDAY.year, MONDAY.month, MONDAY.day, 0),
      );

      for (let i = 1; i < timeline.length; i++) {
        const previous = timeline[i - 1];
        const run = timeline[i];
        if (!previous || !run) {
          continue;
        }
        expect(run.start).toBeGreaterThanOrEqual(previous.end);
      }
    }
  });
});
