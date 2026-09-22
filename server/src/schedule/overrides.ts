import type { Configuration, Override } from "../persistence/schema";
import { buildTimeline, type ScheduledRun } from "./timeline";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Create a skip-next override: suppress the next scheduled session, then resume.
 */
export function createSkipNext(now: number): Override {
  return { kind: "skip-next", createdAt: now, expiresAt: null };
}

/**
 * Create a skip-24h override: suppress every run starting within 24 hours.
 */
export function createSkip24h(now: number): Override {
  return { kind: "skip-24h", createdAt: now, expiresAt: now + MS_PER_DAY };
}

/**
 * Create a rain-delay override: suppress every run starting within the next
 * `days` days.
 */
export function createRainDelay(now: number, days: number): Override {
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`rain-delay days must be a positive integer, got ${days}`);
  }
  return {
    kind: "rain-delay",
    createdAt: now,
    expiresAt: now + days * MS_PER_DAY,
  };
}

/**
 * Whether a time-window override is still in effect at `now`. skip-next has no
 * time expiry, so it is considered active until its session has passed (handled by
 * `applyOverride` rather than here).
 */
export function isTimeWindowActive(override: Override, now: number): boolean {
  return override.expiresAt !== null && now < override.expiresAt;
}

/**
/**
 * A "session" is a maximal group of runs that touch back-to-back (each run starts
 * exactly when the previous ends). Because the timeline is already serialized so
 * runs never overlap, a gap between runs marks a session boundary.
 */
interface Session {
  start: number;
  end: number;
}

function groupIntoSessions(timeline: readonly ScheduledRun[]): Session[] {
  const sessions: Session[] = [];
  for (const run of timeline) {
    const last = sessions.at(-1);
    if (last && run.start === last.end) {
      last.end = run.end;
    } else {
      sessions.push({ start: run.start, end: run.end });
    }
  }
  return sessions;
}

/**
 * The next session that has not yet started at `from` — i.e. the first whole
 * session whose start is at or after `from`. A session already in progress at
 * `from` is skipped, since suppressing the tail of a run that is already watering
 * is not the intent of "skip the next run".
 */
function nextWholeSession(
  timeline: readonly ScheduledRun[],
  from: number,
): Session | undefined {
  return groupIntoSessions(timeline).find((session) => session.start >= from);
}

/**
 * Apply an override to a timeline, returning the timeline with suppressed runs
 * removed. Pure: no timers or I/O.
 *
 * - Time-window overrides (`skip-24h`, `rain-delay`) drop runs that start before
 *   `expiresAt`. Once expired they suppress nothing, so scheduling auto-resumes.
 * - `skip-next` drops the runs of the next session beginning at or after the
 *   override's `createdAt`; sessions after that still run.
 */
export function applyOverride(
  timeline: readonly ScheduledRun[],
  override: Override | null,
  now: number,
): ScheduledRun[] {
  if (!override) {
    return [...timeline];
  }

  if (override.kind === "skip-next") {
    const session = nextWholeSession(timeline, override.createdAt);
    if (!session) {
      return [...timeline];
    }
    return timeline.filter(
      (run) => run.start < session.start || run.start >= session.end,
    );
  }

  if (isTimeWindowActive(override, now)) {
    const expiresAt = override.expiresAt as number;
    return timeline.filter((run) => run.start >= expiresAt);
  }

  return [...timeline];
}

/**
 * Build the timeline for a configuration and apply its override, yielding the runs
 * that will actually happen. A disabled schedule yields nothing regardless of any
 * override.
 */
export function effectiveTimeline(
  configuration: Configuration,
  now: number,
): ScheduledRun[] {
  const timeline = buildTimeline(configuration, now);
  return applyOverride(timeline, configuration.override, now);
}
