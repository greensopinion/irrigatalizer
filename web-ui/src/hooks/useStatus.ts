import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Status } from "../api/types";

export interface StatusPoll {
  status: Status | undefined;
  /** The most recent polling error, cleared on the next successful poll. */
  error: string | undefined;
  /** True until the first poll resolves (success or failure). */
  loading: boolean;
  /**
   * Difference between the server clock and this client's clock, in milliseconds
   * (`server.now - Date.now()` at poll time). Adding this to `Date.now()` yields an
   * estimate of the server's current time, keeping countdowns aligned with the
   * backend even if the client clock is skewed.
   */
  clockOffset: number;
  /** Force an immediate refresh, e.g. after an action changes server state. */
  refresh: () => void;
}

/**
 * Poll `/api/status` on an interval, exposing the latest status plus a
 * server/client clock offset so live countdowns track server time. Requests are
 * aborted on unmount, and a manual `refresh` triggers an out-of-band poll (used
 * right after an action so the UI reflects the new state without waiting for the
 * next tick).
 */
export function useStatus(pollMs = 5000): StatusPoll {
  const [status, setStatus] = useState<Status | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [clockOffset, setClockOffset] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const next = await api.getStatus(controller.signal);
        if (cancelled) {
          return;
        }
        setStatus(next);
        setClockOffset(next.now - Date.now());
        setError(undefined);
      } catch (cause) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void poll();
    const handle = setInterval(() => void poll(), pollMs);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(handle);
    };
  }, [pollMs, refreshToken]);

  return { status, error, loading, clockOffset, refresh };
}
