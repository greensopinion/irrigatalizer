import { z } from "zod";
import { MAX_CIRCUITS } from "../gpio/default-circuit-pins";

/**
 * Days of the week a program can run on, as ISO weekday numbers (1 = Monday ...
 * 7 = Sunday).
 */
export const WeekdaySchema = z.number().int().min(1).max(7);

/**
 * A program's start time as a 30-minute slot index within a day: 0 = 00:00,
 * 1 = 00:30, ... 47 = 23:30. Matches the 30-minute granularity carried forward
 * from the existing system.
 */
export const SLOTS_PER_DAY = 48;
export const StartSlotSchema = z
  .number()
  .int()
  .min(0)
  .max(SLOTS_PER_DAY - 1);

/**
 * A circuit's stable identity plus its user-editable name. The number and pin are
 * the internal identity; the name is presentation.
 */
export const CircuitSchema = z.object({
  number: z.number().int().min(1).max(MAX_CIRCUITS),
  name: z.string().min(1),
  pin: z.number().int().min(0),
});

/**
 * One circuit's run within a program: which circuit and how long (minutes). Order
 * in the program's list defines execution order.
 */
export const ProgramStepSchema = z.object({
  circuit: z.number().int().min(1).max(MAX_CIRCUITS),
  durationMinutes: z.number().int().positive(),
});

/**
 * A program: the days it runs, a single 30-minute start slot, and an ordered list
 * of per-circuit durations run sequentially.
 */
export const ProgramSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  days: z.array(WeekdaySchema),
  startSlot: StartSlotSchema,
  steps: z.array(ProgramStepSchema),
});

/**
 * Override state that suppresses scheduled runs and auto-resumes. Fleshed out in
 * Task 8; modeled here as an optional, time-bounded value so it persists now.
 */
export const OverrideSchema = z.object({
  kind: z.enum(["skip-next", "skip-24h", "rain-delay"]),
  /**
   * Epoch milliseconds at which the override expires and normal scheduling
   * resumes. `skip-next` uses this as the boundary of the next run it suppresses.
   */
  expiresAt: z.number().int().nonnegative(),
});

export const ConfigurationSchema = z.object({
  circuits: z.array(CircuitSchema),
  programs: z.array(ProgramSchema),
  /**
   * Master enable/disable for the whole schedule.
   */
  enabled: z.boolean(),
  override: OverrideSchema.nullable(),
});

/**
 * A single circuit run recorded when the scheduler transitions. Times are epoch
 * milliseconds; `end` is null while a run is still in progress.
 */
export const RunRecordSchema = z.object({
  circuit: z.number().int().min(1).max(MAX_CIRCUITS),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative().nullable(),
});

export const HistorySchema = z.object({
  runs: z.array(RunRecordSchema),
});

export type Weekday = z.infer<typeof WeekdaySchema>;
export type Circuit = z.infer<typeof CircuitSchema>;
export type ProgramStep = z.infer<typeof ProgramStepSchema>;
export type Program = z.infer<typeof ProgramSchema>;
export type Override = z.infer<typeof OverrideSchema>;
export type Configuration = z.infer<typeof ConfigurationSchema>;
export type RunRecord = z.infer<typeof RunRecordSchema>;
export type History = z.infer<typeof HistorySchema>;

/**
 * The configuration a fresh install starts from: no circuits, no programs, the
 * schedule enabled, and no override. Per the requirements there is no migration of
 * old files.
 */
export function emptyConfiguration(): Configuration {
  return {
    circuits: [],
    programs: [],
    enabled: true,
    override: null,
  };
}

export function emptyHistory(): History {
  return { runs: [] };
}
