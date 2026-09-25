import { DateTime } from "luxon";
import { SLOTS_PER_DAY, systemTimezone } from "../persistence/schema";
import type { Configuration, Program } from "../persistence/schema";

const MINUTES_PER_SLOT = 30;
const MS_PER_MINUTE = 60_000;

/**
 * The valve-settle gap: a brief all-off pause before a circuit that runs
 * back-to-back after another, so a closing valve's hydraulic transient can damp out
 * before the next opens. Fixed rather than configured — it is a property of the
 * plumbing, and small enough that no run loses a meaningful amount of water.
 * {@link serialize} applies it.
 */
export const SETTLE_MS = 2_000;

/**
 * A concrete, absolute-time run of a single circuit: the circuit number, the epoch
 * milliseconds it starts and ends, and the program it came from. Runs in a
 * timeline never overlap.
 */
export interface ScheduledRun {
  circuit: number;
  /**
   * The planned (slot-derived) start: the intended wall-clock start on the schedule
   * grid. History and the UI use this; consecutive runs chain off `end`.
   */
  start: number;
  /**
   * The planned end (`start + duration`). Anchored to the planned start regardless
   * of any settle gap, so it doubles as the chaining boundary for the next run.
   */
  end: number;
  /**
   * When the scheduler actually energizes the circuit: `start`, or `start` plus the
   * settle gap when this run abuts a previous one (see {@link serialize}). The
   * scheduler and the live countdown time off this; history uses `start`.
   */
  actualStart: number;
  programId: string;
}

/**
 * The scheduler's view at a given instant: the run happening now (if any) and the
 * next run to come (if any).
 */
export interface CurrentAndNext {
  current: ScheduledRun | undefined;
  next: ScheduledRun | undefined;
}

/**
 * Expand one program on a specific calendar day into candidate runs, with each step
 * running back-to-back from the program's start slot. The start slot is anchored to
 * the given day's midnight *in the configured zone*, so a program's wall-clock time
 * is honored across DST transitions (Luxon resolves the correct UTC instant for
 * that zone and instant). Durations then accumulate in absolute milliseconds — a
 * 20-minute run is always 20 real minutes, even across a DST change. These
 * candidates carry the program's intended start time and may overlap other
 * programs'; the timeline serializes them afterwards.
 */
function expandProgramOnDay(
  program: Program,
  dayStartInZone: DateTime,
): ScheduledRun[] {
  const runs: ScheduledRun[] = [];
  const startMinutes = program.startSlot * MINUTES_PER_SLOT;
  // Anchor the program's start to the wall-clock time on this calendar day in the
  // configured zone. Setting hour/minute (rather than adding a minute *duration*
  // to midnight) yields the intended wall-clock time even across a DST transition:
  // Luxon resolves the correct UTC instant for that local time.
  const startOfRun = dayStartInZone.set({
    hour: Math.floor(startMinutes / 60),
    minute: startMinutes % 60,
  });
  let cursor = startOfRun.toMillis();
  for (const step of program.steps) {
    const durationMs = step.durationMinutes * MS_PER_MINUTE;
    runs.push({
      circuit: step.circuit,
      start: cursor,
      end: cursor + durationMs,
      // Provisional: no settle gap yet. serialize() sets the real actualStart once
      // it knows whether this run abuts the previous one.
      actualStart: cursor,
      programId: program.id,
    });
    cursor += durationMs;
  }
  return runs;
}

/**
 * Serialize candidate runs so none overlap: sort by intended start (stable across
 * equal starts), then push any run that would begin before the previous ends to
 * start exactly when the previous ends, preserving each run's full planned
 * duration.
 *
 * The {@link SETTLE_MS} gap moves only `actualStart`, never the planned
 * `start`/`end`. Taking it from the front of the following run (rather than
 * shifting the run later) keeps every run on its planned boundary, so gaps do not
 * accumulate down a program. Clamping to `end` keeps an energize from outlasting
 * its own run.
 */
function serialize(candidates: ScheduledRun[]): ScheduledRun[] {
  const sorted = [...candidates].sort((a, b) => a.start - b.start);
  const result: ScheduledRun[] = [];
  let previousEnd = -Infinity;
  for (const run of sorted) {
    const start = Math.max(run.start, previousEnd);
    const duration = run.end - run.start;
    const end = start + duration;
    // A run starting strictly after the previous end is already separated in time,
    // so it needs no gap; only a run butting up against the previous one does.
    const abutsPrevious = start === previousEnd && previousEnd !== -Infinity;
    const actualStart = abutsPrevious ? Math.min(start + SETTLE_MS, end) : start;
    result.push({
      circuit: run.circuit,
      start,
      end,
      actualStart,
      programId: run.programId,
    });
    previousEnd = end;
  }
  return result;
}

/**
 * How many calendar days the timeline spans, starting from the reference day.
 * Programs recur weekly, so covering eight days (the reference day plus the next
 * seven) guarantees the "next" run is always found — including the case where a
 * program runs only on the reference weekday and its time has already passed
 * today, in which case next week's occurrence sits a full seven days out. This can
 * include a weekday twice; that is harmless (current/next simply picks the
 * earliest upcoming run).
 */
const TIMELINE_HORIZON_DAYS = 8;

/**
 * Build the non-overlapping, sequential timeline of circuit runs for the calendar
 * day containing `referenceMs` and the following {@link TIMELINE_HORIZON_DAYS} days,
 * computed in the configuration's timezone (enough to always resolve the "next" run
 * for a weekly program, even one that runs on a single weekday). A disabled schedule
 * yields no runs.
 *
 * All day/slot math happens in the configured zone via Luxon, so the schedule fires
 * at its intended wall-clock time regardless of the server's system timezone and
 * correctly across daylight-saving transitions.
 *
 * This function is pure: given the same configuration and reference time it always
 * returns the same timeline, with no timers or I/O.
 */
export function buildTimeline(
  configuration: Configuration,
  referenceMs: number,
): ScheduledRun[] {
  if (!configuration.enabled) {
    return [];
  }

  const zone = configuration.timezone || systemTimezone();
  const startOfToday = DateTime.fromMillis(referenceMs, { zone }).startOf("day");

  const candidates: ScheduledRun[] = [];
  for (let dayOffset = 0; dayOffset < TIMELINE_HORIZON_DAYS; dayOffset++) {
    const day = startOfToday.plus({ days: dayOffset });
    const weekday = day.weekday; // Luxon: 1 = Monday ... 7 = Sunday (ISO).
    for (const program of configuration.programs) {
      if (program.days.includes(weekday)) {
        candidates.push(...expandProgramOnDay(program, day));
      }
    }
  }
  return serialize(candidates);
}

/**
 * Resolve the current and next run at `referenceMs` from a prebuilt timeline.
 *
 * Keys on `actualStart`, not the planned `start`, so "current" and "next" follow
 * when the circuit is really energized: during a settle gap no run is current,
 * matching the hardware, and the live countdown lands on the real valve transition.
 */
export function currentAndNext(
  timeline: readonly ScheduledRun[],
  referenceMs: number,
): CurrentAndNext {
  let current: ScheduledRun | undefined;
  let next: ScheduledRun | undefined;
  for (const run of timeline) {
    if (run.actualStart <= referenceMs && referenceMs < run.end) {
      current = run;
      continue;
    }
    if (
      run.actualStart >= referenceMs &&
      (!next || run.actualStart < next.actualStart)
    ) {
      next = run;
    }
  }
  return { current, next };
}

/**
 * The number of 30-minute slots in a day, re-exported for callers computing slot
 * times.
 */
export const SLOTS = SLOTS_PER_DAY;
