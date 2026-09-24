import { useState } from "react";
import { api } from "../api/client";
import type { Override } from "../api/types";
import { formatDateTime } from "../lib/format";
import { NumberInput } from "./NumberInput";

export interface OverrideControlsProps {
  override: Override | null;
  /** Canonical schedule timezone used to format the resume time. */
  timezone: string;
  /** Called after applying/clearing an override so status refreshes immediately. */
  onChanged: () => void;
}

/**
 * Skip / pause controls: skip the next run, skip 24 hours, or set a rain delay of
 * N days. Overrides auto-resume on the backend; this shows the active override and
 * a clear button.
 */
export function OverrideControls({
  override,
  timezone,
  onChanged,
}: OverrideControlsProps) {
  const [days, setDays] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="control-card" aria-label="Skip and pause">
      <h2>Skip &amp; pause</h2>
      {override ? (
        <div className="override-active">
          <p>{describeActive(override, timezone)}</p>
          <button
            type="button"
            onClick={() => void run(() => api.clearOverride())}
            disabled={busy}
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="override-form">
          <button
            type="button"
            onClick={() => void run(() => api.setOverride({ kind: "skip-next" }))}
            disabled={busy}
          >
            Skip next run
          </button>
          <button
            type="button"
            onClick={() => void run(() => api.setOverride({ kind: "skip-24h" }))}
            disabled={busy}
          >
            Skip 24 hours
          </button>
          <div className="rain-delay">
            <label>
              <span>Rain delay</span>
              <NumberInput
                min={1}
                ariaLabel="Rain delay days"
                value={days}
                onChange={setDays}
              />
              <span>days</span>
            </label>
            <button
              type="button"
              onClick={() =>
                void run(() => api.setOverride({ kind: "rain-delay", days }))
              }
              disabled={busy}
            >
              Apply
            </button>
          </div>
        </div>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function describeActive(override: Override, timezone: string): string {
  const label =
    override.kind === "skip-next"
      ? "Skipping the next run"
      : override.kind === "skip-24h"
        ? "Skipping runs for 24 hours"
        : "Rain delay active";
  if (override.expiresAt === null) {
    return `${label}. Resumes after the next scheduled run.`;
  }
  return `${label}. Resumes ${formatDateTime(override.expiresAt, timezone)}.`;
}
