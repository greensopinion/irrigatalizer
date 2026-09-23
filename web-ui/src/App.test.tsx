import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { Configuration, History, Status } from "./api/types";

const configuration: Configuration = {
  circuits: [{ number: 1, name: "Front lawn", pin: 17 }],
  programs: [],
  enabled: true,
  override: null,
  timezone: "UTC",
};

const history: History = { runs: [] };

function status(): Status {
  return {
    now: Date.now(),
    enabled: true,
    override: null,
    manualRun: null,
    current: null,
    next: null,
    driver: "gpiod",
  };
}

/**
 * Stub `fetch` so the App's on-mount loads (status/configuration/history) resolve
 * against in-memory fixtures instead of hitting the network.
 */
function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = url.includes("/api/configuration")
        ? configuration
        : url.includes("/api/history")
          ? history
          : status();
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
}

describe("App", () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the application title", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Irrigatalizer" }),
    ).toBeInTheDocument();
  });

  it("shows the section tabs", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Controls" })).toBeInTheDocument();
  });

  it("renders live status from the polled endpoint", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Nothing running.")).toBeInTheDocument(),
    );
  });
});
