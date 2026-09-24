import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityLog } from "./ActivityLog";
import type { Circuit, RunRecord } from "../api/types";

const circuits: Circuit[] = [
  { number: 1, name: "Trees", pin: 17 },
  { number: 2, name: "Lawn", pin: 27 },
];

const TZ = "UTC";

function at(minutesFromEpoch: number): number {
  return minutesFromEpoch * 60 * 1000;
}

describe("ActivityLog", () => {
  it("shows nothing when there are no runs", () => {
    render(<ActivityLog runs={[]} circuits={circuits} timezone={TZ} />);
    expect(screen.getByText("No recent activity.")).toBeInTheDocument();
  });

  it("collapses a completed run to a single duration line", () => {
    const runs: RunRecord[] = [
      { circuit: 1, start: at(0), end: at(15) },
    ];
    render(<ActivityLog runs={runs} circuits={circuits} timezone={TZ} />);

    expect(screen.getByText("Trees watered 15m")).toBeInTheDocument();
    expect(screen.queryByText("Trees turned on")).not.toBeInTheDocument();
    expect(screen.queryByText("Trees turned off")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("shows an in-progress run as turned on", () => {
    const runs: RunRecord[] = [{ circuit: 2, start: at(0), end: null }];
    render(<ActivityLog runs={runs} circuits={circuits} timezone={TZ} />);

    expect(screen.getByText("Lawn turned on")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("orders the most recent entry first and respects the limit", () => {
    const runs: RunRecord[] = [
      { circuit: 1, start: at(0), end: at(10) },
      { circuit: 2, start: at(20), end: at(35) },
    ];
    render(
      <ActivityLog runs={runs} circuits={circuits} timezone={TZ} limit={1} />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Lawn watered 15m");
  });

  it("falls back to a generic name for unknown circuits", () => {
    const runs: RunRecord[] = [{ circuit: 9, start: at(0), end: at(5) }];
    render(<ActivityLog runs={runs} circuits={circuits} timezone={TZ} />);

    expect(screen.getByText("Circuit 9 watered 5m")).toBeInTheDocument();
  });
});
