export interface HealthStatus {
  status: "ok";
  timestamp: number;
}

export function currentHealth(now: Date = new Date()): HealthStatus {
  return {
    status: "ok",
    timestamp: now.getTime(),
  };
}
