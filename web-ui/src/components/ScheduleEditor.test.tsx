import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScheduleEditor } from "./ScheduleEditor";
import type { Configuration } from "../api/types";

function configuration(overrides: Partial<Configuration> = {}): Configuration {
  return {
    circuits: [
      { number: 1, name: "Front lawn", pin: 17 },
      { number: 2, name: "Back beds", pin: 27 },
    ],
    programs: [
      {
        id: "p1",
        name: "Morning",
        days: [1, 3, 5],
        startSlot: 12,
        steps: [{ circuit: 1, durationMinutes: 10 }],
      },
    ],
    enabled: true,
    override: null,
    timezone: "America/Vancouver",
    ...overrides,
  };
}

describe("ScheduleEditor", () => {
  it("renders programs with their steps by circuit name", () => {
    render(<ScheduleEditor configuration={configuration()} onSave={vi.fn()} />);
    expect(screen.getByDisplayValue("Morning")).toBeInTheDocument();
    // The step's circuit select shows the circuit name.
    expect(
      screen.getByLabelText("Circuit for step 1"),
    ).toHaveDisplayValue("Front lawn");
  });

  it("does not render circuit setup or the timezone picker (moved to Settings)", () => {
    render(<ScheduleEditor configuration={configuration()} onSave={vi.fn()} />);
    expect(screen.queryByLabelText("Name for circuit 1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Schedule timezone")).not.toBeInTheDocument();
  });

  it("toggles the master enable switch and saves it", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScheduleEditor configuration={configuration()} onSave={onSave} />);

    const toggle = screen.getByRole("switch", { name: "Schedule enabled" });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as Configuration;
    expect(saved.enabled).toBe(false);
  });

  it("keeps save disabled until an edit makes the draft dirty", async () => {
    const user = userEvent.setup();
    render(<ScheduleEditor configuration={configuration()} onSave={vi.fn()} />);
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole("switch", { name: "Schedule enabled" }));
    expect(save).toBeEnabled();
  });

  it("adds a program with default fields", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScheduleEditor configuration={configuration()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add program" }));
    expect(screen.getByDisplayValue("Program 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as Configuration;
    expect(saved.programs).toHaveLength(2);
  });

  it("toggles a program's day off", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScheduleEditor configuration={configuration()} onSave={onSave} />);

    const days = screen.getByRole("group", { name: "Days" });
    // Monday (1) starts checked; toggle it off.
    const monday = within(days).getByRole("checkbox", { name: "Mon" });
    expect(monday).toBeChecked();
    await user.click(monday);
    expect(monday).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as Configuration;
    expect(saved.programs[0]!.days).toEqual([3, 5]);
  });

  it("adds a circuit step to a program", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScheduleEditor configuration={configuration()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add step" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as Configuration;
    expect(saved.programs[0]!.steps).toHaveLength(2);
  });

  it("removes a program", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScheduleEditor configuration={configuration()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Remove Morning" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as Configuration;
    expect(saved.programs).toHaveLength(0);
  });
});
