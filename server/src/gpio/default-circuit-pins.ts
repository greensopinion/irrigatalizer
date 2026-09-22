import type { CircuitPin } from "./circuit-controller";

/**
 * The default circuit-to-BCM-pin mapping carried forward from the existing system.
 * These are the defaults; the persisted configuration may override the mapping in
 * the future without changing this module.
 */
export const DEFAULT_CIRCUIT_PINS: readonly CircuitPin[] = [
  { circuit: 1, pin: 17 },
  { circuit: 2, pin: 27 },
  { circuit: 3, pin: 22 },
  { circuit: 4, pin: 5 },
  { circuit: 5, pin: 6 },
  { circuit: 6, pin: 13 },
  { circuit: 7, pin: 12 },
  { circuit: 8, pin: 16 },
];

/**
 * The maximum number of circuits the system supports.
 */
export const MAX_CIRCUITS = 8;
