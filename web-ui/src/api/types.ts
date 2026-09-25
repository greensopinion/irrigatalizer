/**
 * Types mirroring the backend REST contract (see `server/src/api/app.ts` and
 * `server/src/persistence/schema.ts`). The SPA is a separate build, so these are
 * hand-mirrored rather than imported; they must stay in sync with the server
 * schema.
 */

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Circuit {
  number: number;
  name: string;
  pin: number;
}

export interface ProgramStep {
  circuit: number;
  durationMinutes: number;
}

export interface Program {
  id: string;
  name: string;
  days: Weekday[];
  /** 30-minute slot index within a day: 0 = 00:00 ... 47 = 23:30. */
  startSlot: number;
  steps: ProgramStep[];
}

export type OverrideKind = "skip-next" | "skip-24h" | "rain-delay";

export interface Override {
  kind: OverrideKind;
  createdAt: number;
  /** Null for skip-next, which is bounded by the next session rather than a time. */
  expiresAt: number | null;
}

export interface Configuration {
  circuits: Circuit[];
  programs: Program[];
  enabled: boolean;
  override: Override | null;
  /** Canonical IANA timezone the schedule is defined and displayed in. */
  timezone: string;
}

export interface RunRecord {
  circuit: number;
  start: number;
  /** Null while the run is still in progress. */
  end: number | null;
}

export interface History {
  runs: RunRecord[];
}

export interface ScheduledRun {
  circuit: number;
  /** Planned (slot-derived) start; what history records and the schedule shows. */
  start: number;
  /** Planned end of the run. */
  end: number;
  /**
   * When the circuit is actually energized: `start` plus any settle gap. Live
   * status and countdown key on this so they match the real valve transition.
   */
  actualStart: number;
  programId: string;
}

export interface ActiveManualRun {
  circuit: number;
  endsAt: number;
}

/** Which GPIO driver the backend is running. */
export type DriverKind = "fake" | "gpiod";

export interface Status {
  now: number;
  enabled: boolean;
  override: Override | null;
  manualRun: ActiveManualRun | null;
  current: ScheduledRun | null;
  next: ScheduledRun | null;
  /** The GPIO driver in use; "fake" means no real relays are switched. */
  driver: DriverKind;
}

/** Request body for POST /api/override. */
export type OverrideRequest =
  | { kind: "skip-next" }
  | { kind: "skip-24h" }
  | { kind: "rain-delay"; days: number };
