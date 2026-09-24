import { useMemo, useState } from "react";
import type {
  Circuit,
  Configuration,
  Program,
  ProgramStep,
  Weekday,
} from "../api/types";
import {
  SLOTS_PER_DAY,
  WEEKDAYS,
  circuitName,
  slotLabel,
  weekdayLabel,
} from "../lib/format";
import { NumberInput } from "./NumberInput";

export interface ScheduleEditorProps {
  configuration: Configuration;
  onSave: (configuration: Configuration) => Promise<void>;
}

/**
 * The schedule/program editor: the master enable and the programs (each with its
 * days, start slot, and ordered per-circuit durations). Circuit setup and the
 * timezone live on the Settings tab, since they are wired once rather than tuned
 * regularly. Edits a local draft of the whole configuration and saves it in one
 * PUT (which safely restarts the scheduler on the backend). The draft resets
 * whenever a freshly loaded configuration arrives.
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
          <label className="toggle">
            <input
              type="checkbox"
              role="switch"
              aria-label="Schedule enabled"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, enabled: event.target.checked }))
              }
            />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-thumb" />
            </span>
            <span className="toggle-label">
              {draft.enabled ? "Enabled" : "Disabled"}
            </span>
          </label>
        </div>
        <p className="hint">
          When disabled, no programs run. Set up circuits and the timezone on the
          Settings tab.
        </p>
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
                  <NumberInput
                    min={1}
                    ariaLabel={`Duration in minutes for step ${index + 1}`}
                    value={step.durationMinutes}
                    onChange={(durationMinutes) =>
                      updateStep(index, { durationMinutes })
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
