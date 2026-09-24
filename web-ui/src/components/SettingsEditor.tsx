import { useMemo, useState } from "react";
import type { Circuit, Configuration } from "../api/types";
import {
  MAX_CIRCUITS,
  defaultPin,
  nextCircuitNumber,
  timezoneOptions,
} from "../lib/format";

export interface SettingsEditorProps {
  configuration: Configuration;
  onSave: (configuration: Configuration) => Promise<void>;
}

/**
 * The installation-setup editor: the parts of the configuration that are wired
 * once and rarely revisited — the physical circuits (names + fixed BCM pins,
 * add/remove) and the canonical timezone the schedule is defined in. Kept separate
 * from the Schedule tab, which owns the frequently-changed programs and master
 * enable. Edits a local draft and saves the whole configuration in one PUT (which
 * safely restarts the scheduler on the backend); the draft resets whenever a
 * freshly loaded configuration arrives.
 */
export function SettingsEditor({ configuration, onSave }: SettingsEditorProps) {
  const [draft, setDraft] = useState<Configuration>(configuration);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [savedAt, setSavedAt] = useState<number | undefined>();

  // Reset the draft when a freshly loaded configuration arrives. Storing the last
  // seen prop in state and adjusting during render is React's documented
  // alternative to a resync effect.
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  const [lastLoaded, setLastLoaded] = useState(configuration);
  if (lastLoaded !== configuration) {
    setLastLoaded(configuration);
    setDraft(configuration);
  }

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(configuration),
    [draft, configuration],
  );

  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(undefined);
    try {
      await onSave(draft);
      setSavedAt(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  function updateCircuitName(number: number, name: string): void {
    setDraft((prev) => ({
      ...prev,
      circuits: prev.circuits.map((circuit) =>
        circuit.number === number ? { ...circuit, name } : circuit,
      ),
    }));
  }

  function addCircuit(): void {
    setDraft((prev) => {
      const number = nextCircuitNumber(prev.circuits);
      if (number === undefined) {
        return prev;
      }
      const circuit: Circuit = {
        number,
        name: `Circuit ${number}`,
        pin: defaultPin(number),
      };
      // Keep circuits ordered by number so the list reads predictably.
      const circuits = [...prev.circuits, circuit].sort(
        (a, b) => a.number - b.number,
      );
      return { ...prev, circuits };
    });
  }

  function removeCircuit(number: number): void {
    setDraft((prev) => ({
      ...prev,
      circuits: prev.circuits.filter((circuit) => circuit.number !== number),
      // Drop any program steps that referenced the removed circuit so the saved
      // configuration stays consistent.
      programs: prev.programs.map((program) => ({
        ...program,
        steps: program.steps.filter((step) => step.circuit !== number),
      })),
    }));
  }

  return (
    <div className="editor">
      <section className="editor-card">
        <h2>Circuits</h2>
        <p className="hint">
          Each circuit number maps to a fixed BCM GPIO pin (shown per circuit).
          Set these up once for your installation.
        </p>
        {draft.circuits.length === 0 ? (
          <p className="empty">
            No circuits yet. Add one to name it and use it in a program.
          </p>
        ) : (
          <ul className="circuit-list">
            {draft.circuits.map((circuit) => (
              <li key={circuit.number}>
                <label>
                  <span className="circuit-number">#{circuit.number}</span>
                  <input
                    type="text"
                    aria-label={`Name for circuit ${circuit.number}`}
                    value={circuit.name}
                    onChange={(event) =>
                      updateCircuitName(circuit.number, event.target.value)
                    }
                  />
                </label>
                <span
                  className="circuit-pin"
                  title={`Circuit ${circuit.number} drives BCM GPIO pin ${circuit.pin}`}
                >
                  GPIO {circuit.pin}
                </span>
                <button
                  type="button"
                  className="danger"
                  aria-label={`Remove circuit ${circuit.number}`}
                  onClick={() => removeCircuit(circuit.number)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="editor-header" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            onClick={addCircuit}
            disabled={draft.circuits.length >= MAX_CIRCUITS}
          >
            Add circuit
          </button>
          {draft.circuits.length >= MAX_CIRCUITS ? (
            <span className="empty">
              Maximum of {MAX_CIRCUITS} circuits reached.
            </span>
          ) : null}
        </div>
      </section>

      <section className="editor-card">
        <h2>Timezone</h2>
        <label className="timezone-picker">
          <span>Schedule timezone</span>
          <select
            aria-label="Schedule timezone"
            value={draft.timezone}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, timezone: event.target.value }))
            }
          >
            {timezoneOptions(draft.timezone).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          All schedule times are in this timezone, on the device running the
          controller and in this app.
        </p>
      </section>

      <div className="editor-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {error ? (
          <span className="error" role="alert">
            {error}
          </span>
        ) : dirty ? (
          <span className="unsaved" role="status">
            Unsaved changes
          </span>
        ) : savedAt ? (
          <span className="saved" role="status">
            All changes saved
          </span>
        ) : null}
      </div>
    </div>
  );
}
