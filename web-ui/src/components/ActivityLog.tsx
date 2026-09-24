import { useMemo } from "react";
import type { Circuit, RunRecord } from "../api/types";
import {
  circuitName,
  formatDateTime,
  formatRunDuration,
} from "../lib/format";

export interface ActivityLogProps {
  runs: RunRecord[];
  circuits: Circuit[];
  /** Canonical schedule timezone used to format timestamps. */
  timezone: string;
  /** How many recent entries to show. */
  limit?: number;
}

interface LogEntry {
  at: number;
  message: string;
}

/**
 * A readable activity log derived from run-history transitions. The backend does
 * not expose the in-memory log over REST, so we reconstruct human-readable events
 * from the recorded runs and show the most recent first. A completed run collapses
 * to a single "<circuit> watered <duration>" line at its end time; a run still in
 * progress reads "<circuit> turned on" at its start time.
 */
export function ActivityLog({
  runs,
  circuits,
  timezone,
  limit = 20,
}: ActivityLogProps) {
  const entries = useMemo(() => {
    const events: LogEntry[] = [];
    for (const run of runs) {
      const name = circuitName(circuits, run.circuit);
      if (run.end === null) {
        events.push({ at: run.start, message: `${name} turned on` });
      } else {
        const duration = formatRunDuration(run.end - run.start);
        events.push({ at: run.end, message: `${name} watered ${duration}` });
      }
    }
    return events.sort((a, b) => b.at - a.at).slice(0, limit);
  }, [runs, circuits, limit]);

  if (entries.length === 0) {
    return <p className="empty">No recent activity.</p>;
  }

  return (
    <ul className="activity-log">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`}>
          <time>{formatDateTime(entry.at, timezone)}</time>
          <span>{entry.message}</span>
        </li>
      ))}
    </ul>
  );
}
