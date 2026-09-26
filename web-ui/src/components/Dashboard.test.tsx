import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";
import type { Circuit, History, Status } from "../api/types";

const circuits: Circuit[] = [
  { number: 1, name: "Front lawn", pin: 17 },
  { number: 2, name: "Back beds", pin: 27 },
];

const NOW = 1_700_000_000_000;

function baseStatus(overrides: Partial<Status> = {}): Status {
  return {
    now: NOW,
    enabled: true,
    override: null,
    manualRun: null,
    current: null,
    next: null,
    driver: "gpiod",
    ...overrides,
  };
}

const emptyHistory: History = { runs: [] };

describe("Dashboard", () => {
  beforeEach(() => {
    // Freeze the client clock so clockOffset math is deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the running circuit by name with a remaining countdown", () => {
    const status = baseStatus({
      current: {
        circuit: 1,
        start: NOW - 60_000,
        end: NOW + 5 * 60_000,
        programId: "p1",
      },
    });
    render(
      <Dashboard
        status={status}
        history={emptyHistory}
        circuits={circuits}
        timezone="UTC"
        clockOffset={0}
        error={undefined}
        loading={false}
      />,
    );
    const now = screen.getByLabelText("Current status");
    expect(within(now).getByText("Front lawn")).toBeInTheDocument();
    expect(within(now).getByText("5m 00s remaining")).toBeInTheDocument();
  });

  it("labels a manual run and shows its countdown", () => {
    const status = baseStatus({
      manualRun: { circuit: 2, endsAt: NOW + 2 * 60_000 },
    });
    render(
      <Dashboard
        status={status}
        history={emptyHistory}
        circuits={circuits}
        timezone="UTC"
        clockOffset={0}
        error={undefined}
        loading={false}
      />,
    );
    const now = screen.getByLabelText("Current status");
    expect(within(now).getByText("manual")).toBeInTheDocument();
    expect(within(now).getByText("Back beds")).toBeInTheDocument();
    expect(within(now).getByText("2m 00s remaining")).toBeInTheDocument();
  });

  it("shows the next scheduled run", () => {
    const status = baseStatus({
      next: {
        circuit: 2,
        start: NOW + 30 * 60_000,
        end: NOW + 40 * 60_000,
        programId: "p1",
      },
    });
    render(
      <Dashboard
        status={status}
        history={emptyHistory}
        circuits={circuits}
        timezone="UTC"
        clockOffset={0}
        error={undefined}
        loading={false}
      />,
    );
    const next = screen.getByLabelText("Next scheduled run");
    expect(next).toHaveTextContent("Back beds");
    expect(next).toHaveTextContent("30m 00s");
  });

  it("indicates when the schedule is disabled", () => {
    render(
      <Dashboard
        status={baseStatus({ enabled: false })}
        history={emptyHistory}
        circuits={circuits}
        timezone="UTC"
        clockOffset={0}
        error={undefined}
        loading={false}
      />,
    );
    expect(screen.getByText(/schedule disabled/i)).toBeInTheDocument();
  });

  it("warns when running on the simulated GPIO driver", () => {
    render(
      <Dashboard
        status={baseStatus({ driver: "fake" })}
        history={emptyHistory}
        circuits={circuits}
        timezone="UTC"
        clockOffset={0}
        error={undefined}
        loading={false}
      />,
    );
    expect(screen.getByText(/simulated gpio driver/i)).toBeInTheDocument();
  });

  it("does not warn about the driver when running on real hardware", () => {
    render(
      <Dashboard
        status={baseStatus({ driver: "gpiod" })}
        history={emptyHistory}
        circuits={circuits}
        timezone="UTC"
        clockOffset={0}
        error={undefined}
        loading={false}
      />,
    );
    expect(screen.queryByText(/simulated gpio driver/i)).not.toBeInTheDocument();
  });

  it("describes an active skip-24h override with its resume time", () => {
    const status = baseStatus({
      override: {
        kind: "skip-24h",
        createdAt: NOW,
        expiresAt: NOW + 24 * 60 * 60_000,
      },
    });
    render(
      <Dashboard
        status={status}
        history={emptyHistory}
        circuits={circuits}
        timezone="UTC"
        clockOffset={0}
        error={undefined}
        loading={false}
      />,
    );
    expect(screen.getByText(/skipping runs for 24 hours/i)).toBeInTheDocument();
  });

  it("renders the next start time in the configured timezone, not the browser's", () => {
    // 2026-01-01 18:00 UTC. In America/Vancouver (UTC-8 in January) that is 10:00
    // AM; the label must reflect the configured zone regardless of the test host's
    // timezone.
    const startUtc = Date.UTC(2026, 0, 1, 18, 0);
    const status = baseStatus({
      now: startUtc - 60 * 60_000,
      next: {
        circuit: 1,
        start: startUtc,
        end: startUtc + 10 * 60_000,
        programId: "p1",
      },
    });
    render(
      <Dashboard
        status={status}
        history={emptyHistory}
        circuits={circuits}
        timezone="America/Vancouver"
        clockOffset={0}
        error={undefined}
        loading={false}
      />,
    );
    const next = screen.getByLabelText("Next scheduled run");
    expect(next).toHaveTextContent(/10:00\s*AM/);
  });

  it("reports nothing running or scheduled when idle", () => {
    render(
      <Dashboard
        status={baseStatus()}
        history={emptyHistory}
        circuits={circuits}
        timezone="UTC"
        clockOffset={0}
        error={undefined}
        loading={false}
      />,
    );
    expect(screen.getByText("Nothing running.")).toBeInTheDocument();
    expect(screen.getByText("Nothing scheduled.")).toBeInTheDocument();
  });
});
