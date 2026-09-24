import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("shows the section tabs plus a compact Settings icon", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("opens the Settings tab, showing circuit setup and the timezone picker", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Name for circuit 1")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Schedule timezone")).toBeInTheDocument();
  });

  it("renders live status from the polled endpoint", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Nothing running.")).toBeInTheDocument(),
    );
  });
});
