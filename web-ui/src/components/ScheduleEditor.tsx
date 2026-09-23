import { useMemo, useState } from "react";
import type {
  Circuit,
  Configuration,
  Program,
  ProgramStep,
  Weekday,
} from "../api/types";
import {
  MAX_CIRCUITS,
  SLOTS_PER_DAY,
  WEEKDAYS,
  circuitName,
  defaultPin,
  nextCircuitNumber,
  slotLabel,
  timezoneOptions,
  weekdayLabel,
} from "../lib/format";

export interface ScheduleEditorProps {
  configuration: Configuration;
  onSave: (configuration: Configuration) => Promise<void>;
}

/**
 * The schedule/program editor, built around named circuits and programs rather
 * than the old 7×48 grid. It edits a local draft of the whole configuration —
 * master enable, circuit names, and each program's days, start slot, and ordered
 * per-circuit durations — and saves it in one PUT (which safely restarts the
 * scheduler on the backend). The draft resets whenever a freshly loaded
 * configuration arrives.
 */
export function ScheduleEditor({ configuration, onSave }: ScheduleEditorProps) {
  const [draft, setDraft] = useState<Configuration>(configuration);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [savedAt, setSavedAt] = useState<number | undefined>();

  // Reset the draft when a freshly loaded configuration arrives. Storing the last
  // seen prop in state and adjusting during render is React's documented
  // alternative to a resync effect: it re-renders immediately with the new draft
  // and avoids a wasted render pass. (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
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

  function updateProgram(id: string, patch: Partial<Program>): void {
    setDraft((prev) => ({
      ...prev,
      programs: prev.programs.map((program) =>
        program.id === id ? { ...program, ...patch } : program,
      ),
    }));
  }

  function addProgram(): void {
    const program: Program = {
      id: `program-${Date.now()}`,
      name: `Program ${draft.programs.length + 1}`,
      days: [],
      startSlot: 12, // 06:00
      steps: [],
    };
    setDraft((prev) => ({ ...prev, programs: [...prev.programs, program] }));
  }

  function removeProgram(id: string): void {
    setDraft((prev) => ({
      ...prev,
      programs: prev.programs.filter((program) => program.id !== id),
    }));
  }

  return (
    <div className="editor">
      <section className="editor-card">
        <div className="editor-header">
          <h2>Schedule</h2>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, enabled: event.target.checked }))
              }
            />
            <span>{draft.enabled ? "Enabled" : "Disabled"}</span>
          </label>
        </div>
        <label className="timezone-picker">
          <span>Timezone</span>
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

      <section className="editor-card">
        <div className="editor-header">
          <h2>Circuits</h2>
          <button
            type="button"
            onClick={addCircuit}
            disabled={draft.circuits.length >= MAX_CIRCUITS}
          >
            Add circuit
          </button>
        </div>
        <p className="hint">
          Each circuit number maps to a fixed BCM GPIO pin (shown per circuit).
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
        {draft.circuits.length >= MAX_CIRCUITS ? (
          <p className="empty">Maximum of {MAX_CIRCUITS} circuits reached.</p>
        ) : null}
      </section>

      <section className="editor-card">
        <div className="editor-header">
          <h2>Programs</h2>
          <button type="button" onClick={addProgram}>
            Add program
          </button>
        </div>
        {draft.programs.length === 0 ? (
          <p className="empty">No programs yet. Add one to schedule watering.</p>
        ) : (
          draft.programs.map((program) => (
            <ProgramCard
              key={program.id}
              program={program}
              circuits={draft.circuits}
              onChange={(patch) => updateProgram(program.id, patch)}
              onRemove={() => removeProgram(program.id)}
            />
          ))
        )}
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

interface ProgramCardProps {
  program: Program;
  circuits: Circuit[];
  onChange: (patch: Partial<Program>) => void;
  onRemove: () => void;
}

function ProgramCard({
  program,
  circuits,
  onChange,
  onRemove,
}: ProgramCardProps) {
  function toggleDay(day: Weekday): void {
    const days = program.days.includes(day)
      ? program.days.filter((d) => d !== day)
      : [...program.days, day].sort((a, b) => a - b);
    onChange({ days });
  }

  function updateStep(index: number, patch: Partial<ProgramStep>): void {
    onChange({
      steps: program.steps.map((step, i) =>
        i === index ? { ...step, ...patch } : step,
      ),
    });
  }

  function addStep(): void {
    const firstCircuit = circuits[0]?.number ?? 1;
    onChange({
      steps: [...program.steps, { circuit: firstCircuit, durationMinutes: 10 }],
    });
  }

  function removeStep(index: number): void {
    onChange({ steps: program.steps.filter((_, i) => i !== index) });
  }

  function moveStep(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= program.steps.length) {
      return;
    }
    const steps = [...program.steps];
    const [moved] = steps.splice(index, 1);
    steps.splice(target, 0, moved!);
    onChange({ steps });
  }

  return (
    <article className="program-card">
      <div className="program-header">
        <input
          type="text"
          aria-label={`Program name`}
          className="program-name"
          value={program.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <button
          type="button"
          className="danger"
          aria-label={`Remove ${program.name}`}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>

      <fieldset className="days">
        <legend>Days</legend>
        {WEEKDAYS.map((day) => (
          <label key={day} className="day-toggle">
            <input
              type="checkbox"
              checked={program.days.includes(day)}
              onChange={() => toggleDay(day)}
            />
            <span>{weekdayLabel(day)}</span>
          </label>
        ))}
      </fieldset>

      <label className="start-time">
        <span>Start time</span>
        <select
          aria-label={`Start time for ${program.name}`}
          value={program.startSlot}
          onChange={(event) =>
            onChange({ startSlot: Number(event.target.value) })
          }
        >
          {Array.from({ length: SLOTS_PER_DAY }, (_, slot) => (
            <option key={slot} value={slot}>
              {slotLabel(slot)}
            </option>
          ))}
        </select>
      </label>

      <div className="steps">
        <div className="steps-header">
          <span>Circuits (run in order)</span>
          <button type="button" onClick={addStep} disabled={circuits.length === 0}>
            Add step
          </button>
        </div>
        {program.steps.length === 0 ? (
          <p className="empty">No circuits in this program.</p>
        ) : (
          <ol className="step-list">
            {program.steps.map((step, index) => (
              <li key={index} className="step">
                <select
                  aria-label={`Circuit for step ${index + 1}`}
                  value={step.circuit}
                  onChange={(event) =>
                    updateStep(index, { circuit: Number(event.target.value) })
                  }
                >
                  {circuits.map((circuit) => (
                    <option key={circuit.number} value={circuit.number}>
                      {circuitName(circuits, circuit.number)}
                    </option>
                  ))}
                </select>
                <label className="duration">
                  <input
                    type="number"
                    min={1}
                    aria-label={`Duration in minutes for step ${index + 1}`}
                    value={step.durationMinutes}
                    onChange={(event) =>
                      updateStep(index, {
                        durationMinutes: Math.max(1, Number(event.target.value)),
                      })
                    }
                  />
                  <span>min</span>
                </label>
                <div className="step-actions">
                  <button
                    type="button"
                    aria-label={`Move step ${index + 1} up`}
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move step ${index + 1} down`}
                    onClick={() => moveStep(index, 1)}
                    disabled={index === program.steps.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="danger"
                    aria-label={`Remove step ${index + 1}`}
                    onClick={() => removeStep(index)}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  );
}
