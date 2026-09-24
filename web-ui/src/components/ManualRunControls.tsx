import { useState } from "react";
import { api } from "../api/client";
import type { ActiveManualRun, Circuit } from "../api/types";
import { useNow } from "../hooks/useNow";
import { circuitName, formatCountdown } from "../lib/format";
import { NumberInput } from "./NumberInput";

export interface ManualRunControlsProps {
  circuits: Circuit[];
  activeManualRun: ActiveManualRun | null;
  clockOffset: number;
  /** Called after a start/stop so the parent can refresh status immediately. */
  onChanged: () => void;
}

/**
 * Start or stop a manual run: pick a circuit by name and a duration, and turn it on
 * now. Manual runs go through the backend's CircuitController, so the single-active
 * invariant and watchdog still apply. While a run is active it shows a live
 * countdown and a stop button.
 */
export function ManualRunControls({
  circuits,
  activeManualRun,
  clockOffset,
  onChanged,
}: ManualRunControlsProps) {
  const clientNow = useNow();
  const serverNow = clientNow + clockOffset;
  const [circuit, setCircuit] = useState<number>(circuits[0]?.number ?? 1);
  const [minutes, setMinutes] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function start(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await api.startManualRun(circuit, minutes);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function stop(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await api.stopManualRun();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="control-card" aria-label="Manual run">
      <h2>Manual run</h2>
      {activeManualRun ? (
        <div className="manual-active">
          <p>
            {circuitName(circuits, activeManualRun.circuit)} running —{" "}
            {formatCountdown(activeManualRun.endsAt - serverNow)} left
          </p>
          <button
            type="button"
            className="danger"
            onClick={() => void stop()}
            disabled={busy}
          >
            Stop
          </button>
        </div>
      ) : (
        <div className="manual-form">
          <label>
            <span>Circuit</span>
            <select
              aria-label="Manual run circuit"
              value={circuit}
              onChange={(event) => setCircuit(Number(event.target.value))}
              disabled={circuits.length === 0}
            >
              {circuits.map((c) => (
                <option key={c.number} value={c.number}>
                  {circuitName(circuits, c.number)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Minutes</span>
            <NumberInput
              min={1}
              ariaLabel="Manual run minutes"
              value={minutes}
              onChange={setMinutes}
            />
          </label>
          <button
            type="button"
            className="primary"
            onClick={() => void start()}
            disabled={busy || circuits.length === 0}
          >
            Start
          </button>
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
