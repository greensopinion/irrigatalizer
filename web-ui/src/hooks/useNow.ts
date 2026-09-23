import { useEffect, useState } from "react";

/**
 * A client-side clock that ticks at a fixed interval, driving live countdowns
 * without any server round-trip. Returns the current epoch milliseconds, updated
 * every `intervalMs` (default one second).
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs]);
  return now;
}
