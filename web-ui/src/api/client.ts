import type {
  ActiveManualRun,
  Configuration,
  History,
  Override,
  OverrideRequest,
  Status,
} from "./types";

/**
 * Thrown when the backend responds with a non-2xx status. Carries the HTTP status
 * and the server's `{ error }` message when present, so callers can surface a
 * clear reason.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, await extractError(response));
  }
  return (await response.json()) as T;
}

async function extractError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (body && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Fall through to a generic message when the body is not JSON.
  }
  return `Request failed with status ${response.status}`;
}

/**
 * Typed wrapper over the backend REST API. All methods accept an optional
 * AbortSignal so polling and unmounts can cancel in-flight requests.
 */
export const api = {
  getStatus(signal?: AbortSignal): Promise<Status> {
    return request<Status>("/api/status", undefined, signal);
  },
  getConfiguration(signal?: AbortSignal): Promise<Configuration> {
    return request<Configuration>("/api/configuration", undefined, signal);
  },
  putConfiguration(configuration: Configuration): Promise<Configuration> {
    return request<Configuration>("/api/configuration", {
      method: "PUT",
      body: JSON.stringify(configuration),
    });
  },
  getHistory(signal?: AbortSignal): Promise<History> {
    return request<History>("/api/history", undefined, signal);
  },
  startManualRun(
    circuit: number,
    durationMinutes: number,
  ): Promise<{ manualRun: ActiveManualRun | null }> {
    return request("/api/manual-run", {
      method: "POST",
      body: JSON.stringify({ circuit, durationMinutes }),
    });
  },
  stopManualRun(): Promise<{ manualRun: null }> {
    return request("/api/manual-run/stop", { method: "POST" });
  },
  setOverride(override: OverrideRequest): Promise<{ override: Override }> {
    return request("/api/override", {
      method: "POST",
      body: JSON.stringify(override),
    });
  },
  clearOverride(): Promise<{ override: null }> {
    return request("/api/override", { method: "DELETE" });
  },
};
