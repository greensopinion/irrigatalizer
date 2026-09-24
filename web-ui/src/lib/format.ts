import { DateTime } from "luxon";
import type { Circuit, Weekday } from "../api/types";

/**
 * The 30-minute-slot count in a day, matching the backend's SLOTS_PER_DAY.
 */
export const SLOTS_PER_DAY = 48;

/**
 * The maximum number of circuits the system supports, matching the backend's
 * MAX_CIRCUITS.
 */
export const MAX_CIRCUITS = 8;

/**
 * The default circuit-to-BCM-pin mapping, mirrored from the backend
 * `DEFAULT_CIRCUIT_PINS`. Used to assign a sensible pin when adding a circuit in
 * the UI. The backend remains the source of truth for the mapping the controller
 * drives; there is intentionally no pin-editing UI (per the requirements), so the
 * UI only needs these defaults to seed a new circuit.
 */
export const DEFAULT_CIRCUIT_PINS: Record<number, number> = {
  1: 17,
  2: 27,
  3: 22,
  4: 5,
  5: 6,
  6: 13,
  7: 12,
  8: 16,
};

/**
 * The next unused circuit number (1..MAX_CIRCUITS) given the circuits already
 * configured, or undefined when all slots are taken.
 */
export function nextCircuitNumber(circuits: Circuit[]): number | undefined {
  const used = new Set(circuits.map((c) => c.number));
  for (let number = 1; number <= MAX_CIRCUITS; number++) {
    if (!used.has(number)) {
      return number;
    }
  }
  return undefined;
}

/**
 * The default BCM pin for a circuit number, falling back to 0 for out-of-range
 * numbers (which the backend schema will still accept as a valid pin).
 */
export function defaultPin(circuitNumber: number): number {
  return DEFAULT_CIRCUIT_PINS[circuitNumber] ?? 0;
}

const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export function weekdayLabel(day: Weekday): string {
  return WEEKDAY_LABELS[day];
}

/**
 * Format a 30-minute slot index (0..47) as a 24-hour HH:MM label.
 */
export function slotLabel(slot: number): string {
  const totalMinutes = slot * 30;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${pad(hours)}:${pad(minutes)}`;
}

/**
 * Format a millisecond countdown as a compact clock. Long spans break out days
 * from hours (e.g. "4d 8h 55m"); once the span reaches an hour the seconds are
 * dropped as noise, so an hours-scale value reads "1h 5m" and a sub-hour value
 * keeps seconds as "4m 30s". Only the seconds are zero-padded. Negative values
 * clamp to zero.
 */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${pad(seconds)}s`;
}

/**
 * Format a run's elapsed time as a compact, whole-unit label, e.g. "15m", "1h 5m",
 * or "45s" for sub-minute runs. Negative spans clamp to zero. Used for completed
 * activity-log entries where a rough "how long it ran" reads better than a clock.
 */
export function formatRunDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * Format an epoch millisecond as a time-of-day in the given zone, e.g. "6:30 AM".
 * The zone is the schedule's canonical timezone, so displayed times match when
 * watering actually happens regardless of the viewing device's own timezone. Falls
 * back to the browser's local zone when none is provided.
 */
export function formatTimeOfDay(epochMs: number, timezone?: string): string {
  return inZone(epochMs, timezone).toLocaleString(DateTime.TIME_SIMPLE);
}

/**
 * Format an epoch millisecond as a short date + time in the given zone, e.g.
 * "Mon, 6:30 AM". See {@link formatTimeOfDay} for the zone rationale.
 */
export function formatDateTime(epochMs: number, timezone?: string): string {
  return inZone(epochMs, timezone).toLocaleString({
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function inZone(epochMs: number, timezone?: string): DateTime {
  const dt = DateTime.fromMillis(epochMs);
  return timezone ? dt.setZone(timezone) : dt;
}

/**
 * Resolve a circuit's display name from the configured circuits, falling back to
 * "Circuit N" when the number is unknown (e.g. history from an older config).
 */
export function circuitName(circuits: Circuit[], number: number): string {
  return circuits.find((c) => c.number === number)?.name ?? `Circuit ${number}`;
}

/**
 * The list of IANA timezone names to offer in the picker, always including
 * `current` even if the runtime's supported list omits it (so a saved value is
 * never dropped from the dropdown). Sorted for predictable scanning.
 */
export function timezoneOptions(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  const set = new Set<string>(supported);
  if (current) {
    set.add(current);
  }
  return [...set].sort();
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
