import { useMemo } from "react";
import type { Circuit, RunRecord } from "../api/types";
import { circuitName, formatDateTime } from "../lib/format";

export interface HistorySparklineProps {
  runs: RunRecord[];
  circuits: Circuit[];
  now: number;
  /** Canonical schedule timezone used to format run times in tooltips. */
  timezone: string;
  /** How far back the timeline window extends, in hours. */
  windowHours?: number;
}

const ROW_HEIGHT = 22;
const ROW_GAP = 6;
const LABEL_WIDTH = 96;
const TRACK_HEIGHT = 12;

/**
 * A legible, per-circuit history timeline. Each configured circuit gets its own
 * row; runs within the window render as bars positioned by time, so overlapping
 * reads and long runs are obvious at a glance. This replaces the old dual 36h/72h
 * SVG sparklines that were hard to interpret.
 */
export function HistorySparkline({
  runs,
  circuits,
  now,
  timezone,
  windowHours = 72,
}: HistorySparklineProps) {
  const windowMs = windowHours * 60 * 60 * 1000;
  const windowStart = now - windowMs;

  // Rows are the configured circuits; fall back to any circuit numbers that
  // appear in history but are no longer configured so nothing is silently hidden.
  const rows = useMemo(() => {
    const numbers = new Set(circuits.map((c) => c.number));
    for (const run of runs) {
      numbers.add(run.circuit);
    }
    return [...numbers].sort((a, b) => a - b);
  }, [circuits, runs]);

  const visibleRuns = useMemo(
    () => runs.filter((run) => (run.end ?? now) >= windowStart),
    [runs, now, windowStart],
  );

  if (rows.length === 0) {
    return <p className="empty">No circuits configured yet.</p>;
  }

  const height = rows.length * (ROW_HEIGHT + ROW_GAP);

  return (
    <div className="sparkline">
      <div
        className="sparkline-grid"
        style={{ height }}
        role="img"
        aria-label={`Run history for the last ${windowHours} hours`}
      >
        {rows.map((circuit, index) => {
          const top = index * (ROW_HEIGHT + ROW_GAP);
          const rowRuns = visibleRuns.filter((run) => run.circuit === circuit);
          return (
            <div key={circuit} className="sparkline-row" style={{ top }}>
              <span className="sparkline-label" style={{ width: LABEL_WIDTH }}>
                {circuitName(circuits, circuit)}
              </span>
              <div
                className="sparkline-track"
                style={{ left: LABEL_WIDTH, height: TRACK_HEIGHT }}
              >
                {rowRuns.map((run, runIndex) => {
                  const start = Math.max(run.start, windowStart);
                  const end = Math.min(run.end ?? now, now);
                  const leftPct = ((start - windowStart) / windowMs) * 100;
                  const widthPct = Math.max(
                    ((end - start) / windowMs) * 100,
                    0.5,
                  );
                  return (
                    <div
                      key={runIndex}
                      className={`sparkline-bar${run.end === null ? " active" : ""}`}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      title={`${circuitName(circuits, circuit)}: ${formatDateTime(
                        run.start,
                        timezone,
                      )}${run.end ? ` – ${formatDateTime(run.end, timezone)}` : " (running)"}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="sparkline-axis">
        <span>{windowHours}h ago</span>
        <span>now</span>
      </div>
    </div>
  );
}
