import { describe, expect, it } from "vitest";
import { SETTLE_MS, buildTimeline, currentAndNext } from "./timeline";
import type { Configuration, Program } from "../persistence/schema";

/**
 * The fixed timezone these tests run the schedule in. Configs carry it explicitly
 * and `localTime` builds epochs in the same zone, so results are deterministic
 * regardless of the machine's system timezone. UTC has no DST, keeping the basic
 * expansion tests simple (a dedicated test below covers a DST transition).
 */
const TEST_ZONE = "UTC";

/**
 * Build an epoch for a given date and time-of-day in {@link TEST_ZONE}. Because the
 * zone is UTC, `Date.UTC` is the exact match for what the zone-aware timeline
 * computes.
 */
function localTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
}

// 2026-06-01 is a Monday (ISO weekday 1).
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

  it("finds a weekly program's next occurrence later in the week", () => {
    // Reference on Tuesday; program only runs Mondays. The next Monday is 6 days
    // out — within the week-long horizon — so it must be found (this is the
    // weekly-lookahead case the 2-day window used to miss).
    const tuesday = localTime(2026, 6, 2, 5);
    const timeline = buildTimeline(config([program({ days: [1] })]), tuesday);
    const nextMondaySixAm = localTime(2026, 6, 8, 6);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      circuit: 1,
      start: nextMondaySixAm,
    });
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

    // Assert the first occurrence's three back-to-back steps. (The horizon spans
    // eight days, so a Monday-only program viewed on Monday also includes next
    // Monday's occurrence; we only check the imminent one here.)
    const sixAm = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 6);
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

  it("delays actualStart by the settle gap for back-to-back runs without shifting planned times", () => {
    const timeline = buildTimeline(
      config([
        program({
          steps: [
            { circuit: 1, durationMinutes: 10 },
            { circuit: 2, durationMinutes: 10 },
            { circuit: 3, durationMinutes: 10 },
          ],
        }),
      ]),
      localTime(MONDAY.year, MONDAY.month, MONDAY.day, 0),
    );

    const sixAm = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 6);

    // Planned starts/ends stay on the exact slot grid — no drift.
    expect(timeline[0]).toMatchObject({ circuit: 1, start: sixAm });
    expect(timeline[0]?.end).toBe(sixAm + 10 * 60_000);
    expect(timeline[1]?.start).toBe(sixAm + 10 * 60_000);
    expect(timeline[1]?.end).toBe(sixAm + 20 * 60_000);
    expect(timeline[2]?.start).toBe(sixAm + 20 * 60_000);
    expect(timeline[2]?.end).toBe(sixAm + 30 * 60_000);

    // The first run of the session has nothing before it, so no gap.
    expect(timeline[0]?.actualStart).toBe(sixAm);
    // Each subsequent back-to-back run energizes SETTLE_MS after its planned start.
    // Critically the gap is a fixed SETTLE_MS per run, not accumulating (2s/4s/6s):
    // it is measured from each run's own planned start, which never drifts.
    expect(timeline[1]?.actualStart).toBe(sixAm + 10 * 60_000 + SETTLE_MS);
    expect(timeline[2]?.actualStart).toBe(sixAm + 20 * 60_000 + SETTLE_MS);
  });

  it("does not apply a settle gap to runs that are naturally separated", () => {
    // Two programs hours apart: the second does not abut the first, so no gap.
    const timeline = buildTimeline(
      config([
        program({
          id: "a",
          startSlot: 12, // 06:00
          steps: [{ circuit: 1, durationMinutes: 10 }],
        }),
        program({
          id: "b",
          startSlot: 24, // 12:00, well after program a ends
          steps: [{ circuit: 2, durationMinutes: 10 }],
        }),
      ]),
      localTime(MONDAY.year, MONDAY.month, MONDAY.day, 0),
    );
    const noon = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 12);
    const runB = timeline.find((r) => r.circuit === 2 && r.start === noon);
    expect(runB?.actualStart).toBe(noon);
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

describe("timezone handling", () => {
  const NY = "America/New_York";

  function nyConfig(programs: Program[]): Configuration {
    return {
      circuits: [],
      programs,
      enabled: true,
      override: null,
      timezone: NY,
    };
  }

  it("honors the wall-clock start time across a spring-forward DST transition", () => {
    // America/New_York springs forward on 2026-03-08 (02:00 -> 03:00), EST (UTC-5)
    // to EDT (UTC-4). A program at 06:00 local on that Sunday should resolve to
    // 06:00 EDT = 10:00 UTC, proving the offset is taken for the target instant,
    // not "now".
    const sundayProgram = program({
      days: [7], // Sunday
      startSlot: 12, // 06:00 local
      steps: [{ circuit: 1, durationMinutes: 30 }],
    });
    // Reference: Sunday 2026-03-08 at 00:30 EST (05:30 UTC), before the run and
    // unambiguously on the target day in NY.
    const referenceUtc = Date.UTC(2026, 2, 8, 5, 30);
    const timeline = buildTimeline(nyConfig([sundayProgram]), referenceUtc);
    // 06:00 EDT on 2026-03-08 == 10:00 UTC.
    const expectedStart = Date.UTC(2026, 2, 8, 10);
    const run = timeline.find((r) => r.start === expectedStart);
    expect(run).toBeDefined();
    // Duration is 30 real minutes regardless of the transition.
    expect(run?.end).toBe(expectedStart + 30 * 60_000);
  });

  it("resolves the same wall-clock slot to different UTC instants on either side of DST", () => {
    const dailySixAm = program({
      days: [1, 2, 3, 4, 5, 6, 7],
      startSlot: 12, // 06:00 local
      steps: [{ circuit: 1, durationMinutes: 10 }],
    });
    // Reference Saturday 2026-03-07 at 12:00 EST (17:00 UTC): the Saturday 06:00
    // local run is EST (UTC-5) == 11:00 UTC.
    const fromSaturday = buildTimeline(
      nyConfig([dailySixAm]),
      Date.UTC(2026, 2, 7, 17),
    );
    expect(fromSaturday.find((r) => r.start === Date.UTC(2026, 2, 7, 11))).toBeDefined();
    // The following day's 06:00 run is after the spring-forward: EDT (UTC-4) ==
    // 10:00 UTC. The one-hour difference proves the per-instant offset.
    expect(fromSaturday.find((r) => r.start === Date.UTC(2026, 2, 8, 10))).toBeDefined();
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

  it("reports the second circuit as current once its settle gap has elapsed", () => {
    // At the planned boundary (06:10) the settle gap is still open; circuit 2 is
    // current only after the gap, when it actually energizes.
    const result = currentAndNext(
      timeline,
      localTime(MONDAY.year, MONDAY.month, MONDAY.day, 6, 10) + SETTLE_MS,
    );
    expect(result.current?.circuit).toBe(2);
  });

  it("reports no current circuit during a settle gap between runs", () => {
    const gapped = buildTimeline(
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

    // Exactly at 06:10, circuit 1's planned end: the settle gap has begun and
    // circuit 2 has not yet energized, so nothing is current and circuit 2 is next.
    const boundary = localTime(MONDAY.year, MONDAY.month, MONDAY.day, 6, 10);
    const inGap = currentAndNext(gapped, boundary);
    expect(inGap.current).toBeUndefined();
    expect(inGap.next?.circuit).toBe(2);

    // Once the settle gap elapses, circuit 2 is current.
    const afterGap = currentAndNext(gapped, boundary + SETTLE_MS);
    expect(afterGap.current?.circuit).toBe(2);
  });

  it("after today's run ends, reports next week's occurrence as next", () => {
    const result = currentAndNext(
      timeline,
      localTime(MONDAY.year, MONDAY.month, MONDAY.day, 7),
    );
    expect(result.current).toBeUndefined();
    // The weekly program recurs; the next run is the following Monday at 06:00.
    const nextMondaySixAm = localTime(2026, 6, 8, 6);
    expect(result.next?.circuit).toBe(1);
    expect(result.next?.start).toBe(nextMondaySixAm);
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

      for (let i = 0; i < timeline.length; i++) {
        const run = timeline[i];
        if (!run) {
          continue;
        }
        // The settle gap is taken from the front of the run and never inverts it.
        expect(run.actualStart).toBeGreaterThanOrEqual(run.start);
        expect(run.actualStart).toBeLessThanOrEqual(run.end);
        if (i === 0) {
          continue;
        }
        const previous = timeline[i - 1];
        if (!previous) {
          continue;
        }
        // Planned runs never overlap regardless of the gap (the gap does not touch
        // planned start/end), so no accumulated drift.
        expect(run.start).toBeGreaterThanOrEqual(previous.end);
      }
    }
  });
});
