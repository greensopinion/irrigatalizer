import { SLOTS_PER_DAY } from "../persistence/schema";
import type { Configuration, Program } from "../persistence/schema";

const MINUTES_PER_SLOT = 30;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/**
 * A concrete, absolute-time run of a single circuit: the circuit number, the epoch
 * milliseconds it starts and ends, and the program it came from. Runs in a
 * timeline never overlap.
 */
export interface ScheduledRun {
  circuit: number;
  start: number;
  end: number;
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
 * Local-time helpers. The Pi runs in the household's local timezone, so day-of-
 * week and slot times are computed against local time.
 */
function isoWeekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function startOfLocalDay(epochMs: number): number {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Expand one program on a specific local day into candidate runs, with each step
 * running back-to-back from the program's start slot. These candidates carry the
 * program's intended start time and may overlap other programs' candidates; the
 * timeline serializes them afterwards.
 */
function expandProgramOnDay(
  program: Program,
  dayStartMs: number,
): ScheduledRun[] {
  const runs: ScheduledRun[] = [];
  let cursor =
    dayStartMs + program.startSlot * MINUTES_PER_SLOT * MS_PER_MINUTE;
  for (const step of program.steps) {
    const durationMs = step.durationMinutes * MS_PER_MINUTE;
    runs.push({
      circuit: step.circuit,
      start: cursor,
      end: cursor + durationMs,
      programId: program.id,
    });
    cursor += durationMs;
  }
  return runs;
}

/**
 * Serialize candidate runs so none overlap: sort by intended start (stable across
 * equal starts), then push any run that would begin before the previous ends to
 * start exactly when the previous ends, preserving each run's full duration.
 */
function serialize(candidates: ScheduledRun[]): ScheduledRun[] {
  const sorted = [...candidates].sort((a, b) => a.start - b.start);
  const result: ScheduledRun[] = [];
  let previousEnd = -Infinity;
  for (const run of sorted) {
    const start = Math.max(run.start, previousEnd);
    const duration = run.end - run.start;
    const placed: ScheduledRun = {
      circuit: run.circuit,
      start,
      end: start + duration,
      programId: run.programId,
    };
    result.push(placed);
    previousEnd = placed.end;
  }
  return result;
}

/**
 * Build the non-overlapping, sequential timeline of circuit runs for the local day
 * containing `referenceMs` and the following day (enough to always resolve the
 * "next" run across a midnight boundary). A disabled schedule yields no runs.
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

  const today = startOfLocalDay(referenceMs);
  const candidates: ScheduledRun[] = [];
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    const dayStart = today + dayOffset * MS_PER_DAY;
    const weekday = isoWeekday(new Date(dayStart));
    for (const program of configuration.programs) {
      if (program.days.includes(weekday)) {
        candidates.push(...expandProgramOnDay(program, dayStart));
      }
    }
  }
  return serialize(candidates);
}

/**
 * Resolve the current and next run at `referenceMs` from a prebuilt timeline. A run
 * is current when `start <= referenceMs < end`; the next run is the earliest run
 * that starts at or after `referenceMs`.
 */
export function currentAndNext(
  timeline: readonly ScheduledRun[],
  referenceMs: number,
): CurrentAndNext {
  let current: ScheduledRun | undefined;
  let next: ScheduledRun | undefined;
  for (const run of timeline) {
    if (run.start <= referenceMs && referenceMs < run.end) {
      current = run;
      continue;
    }
    if (run.start >= referenceMs && (!next || run.start < next.start)) {
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
