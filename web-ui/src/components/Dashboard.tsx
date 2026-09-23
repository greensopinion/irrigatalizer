import type { Circuit, History, Override, Status } from "../api/types";
import { useNow } from "../hooks/useNow";
import {
  circuitName,
  formatCountdown,
  formatDateTime,
  formatTimeOfDay,
} from "../lib/format";
import { HistorySparkline } from "./HistorySparkline";
import { ActivityLog } from "./ActivityLog";

export interface DashboardProps {
  status: Status | undefined;
  history: History | undefined;
  circuits: Circuit[];
  /** Canonical schedule timezone; times are displayed in this zone. */
  timezone: string;
  /** server.now - Date.now(); added to the client clock to estimate server time. */
  clockOffset: number;
  error: string | undefined;
  loading: boolean;
}

/**
 * The at-a-glance page: what's running now with a live countdown, what's next, the
 * master enable and any active override, plus the history timeline and activity
 * log. Countdowns are computed client-side from a 1-second tick, aligned to server
 * time via `clockOffset`, so no server round-trip is needed between polls.
 */
export function Dashboard({
  status,
  history,
  circuits,
  timezone,
  clockOffset,
  error,
  loading,
}: DashboardProps) {
  const clientNow = useNow();
  const serverNow = clientNow + clockOffset;

  if (loading && !status) {
    return <p className="empty">Loading status…</p>;
  }

  if (!status) {
    return (
      <p className="error" role="alert">
        Unable to load status{error ? `: ${error}` : ""}.
      </p>
    );
  }

  const { current, next, manualRun, enabled, override, driver } = status;

  return (
    <div className="dashboard">
      {error ? (
        <p className="banner warning" role="status">
          Connection issue: {error}. Showing last known status.
        </p>
      ) : null}

      {driver === "fake" ? (
        <p className="banner simulated" role="status">
          Simulated GPIO driver — no relays are being switched. For testing only.
        </p>
      ) : null}

      {!enabled ? (
        <p className="banner disabled" role="status">
          Schedule disabled — nothing will run until it is re-enabled.
        </p>
      ) : null}

      {override ? (
        <p className="banner override" role="status">
          {describeOverride(override, serverNow, timezone)}
        </p>
      ) : null}

      <section className="status-card" aria-label="Current status">
        <h2>Now</h2>
        {manualRun ? (
          <div className="running manual">
            <span className="dot" aria-hidden="true" />
            <div>
              <p className="circuit-name">
                {circuitName(circuits, manualRun.circuit)}{" "}
                <span className="tag">manual</span>
              </p>
              <p className="countdown">
                {formatCountdown(manualRun.endsAt - serverNow)} remaining
              </p>
            </div>
          </div>
        ) : current ? (
          <div className="running">
            <span className="dot" aria-hidden="true" />
            <div>
              <p className="circuit-name">
                {circuitName(circuits, current.circuit)}
              </p>
              <p className="countdown">
                {formatCountdown(current.end - serverNow)} remaining
              </p>
            </div>
          </div>
        ) : (
          <p className="idle">Nothing running.</p>
        )}
      </section>

      <section className="status-card" aria-label="Next scheduled run">
        <h2>Next</h2>
        {next ? (
          <div className="next">
            <p className="circuit-name">{circuitName(circuits, next.circuit)}</p>
            <p className="next-time">
              starts {formatTimeOfDay(next.start, timezone)} (
              {formatCountdown(next.start - serverNow)})
            </p>
          </div>
        ) : (
          <p className="idle">Nothing scheduled.</p>
        )}
      </section>

      <section className="status-card" aria-label="Run history">
        <h2>History</h2>
        <HistorySparkline
          runs={history?.runs ?? []}
          circuits={circuits}
          now={serverNow}
          timezone={timezone}
        />
      </section>

      <section className="status-card" aria-label="Activity log">
        <h2>Activity</h2>
        <ActivityLog
          runs={history?.runs ?? []}
          circuits={circuits}
          timezone={timezone}
        />
      </section>
    </div>
  );
}

function describeOverride(
  override: Override,
  now: number,
  timezone: string,
): string {
  const label =
    override.kind === "skip-next"
      ? "Skipping the next scheduled run"
      : override.kind === "skip-24h"
        ? "Skipping runs for 24 hours"
        : "Rain delay active";
  if (override.expiresAt === null) {
    return `${label} — resumes after the next run.`;
  }
  if (override.expiresAt <= now) {
    return `${label} — resuming.`;
  }
  return `${label} — resumes ${formatDateTime(override.expiresAt, timezone)}.`;
}
