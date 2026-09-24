import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsEditor } from "./SettingsEditor";
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

describe("SettingsEditor", () => {
  it("renders circuits by name with their fixed BCM pin", () => {
    render(<SettingsEditor configuration={configuration()} onSave={vi.fn()} />);
    expect(screen.getByLabelText("Name for circuit 1")).toHaveValue("Front lawn");
    expect(screen.getByText("GPIO 17")).toBeInTheDocument();
    expect(screen.getByText("GPIO 27")).toBeInTheDocument();
  });

  it("keeps save disabled until an edit makes the draft dirty", async () => {
    const user = userEvent.setup();
    render(<SettingsEditor configuration={configuration()} onSave={vi.fn()} />);
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    const nameInput = screen.getByLabelText("Name for circuit 1");
    await user.clear(nameInput);
    await user.type(nameInput, "Garden");
    expect(save).toBeEnabled();
  });

  it("saves the edited configuration with the new circuit name", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SettingsEditor configuration={configuration()} onSave={onSave} />);

    const nameInput = screen.getByLabelText("Name for circuit 2");
    await user.clear(nameInput);
    await user.type(nameInput, "Veggies");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as Configuration;
    expect(saved.circuits.find((c) => c.number === 2)?.name).toBe("Veggies");
  });

  it("adds a circuit with the next number, a default name, and its default pin", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    // Start with an empty configuration to prove circuits can be created from
    // scratch (the fresh-install case).
    render(
      <SettingsEditor
        configuration={{
          circuits: [],
          programs: [],
          enabled: true,
          override: null,
          timezone: "UTC",
        }}
        onSave={onSave}
      />,
    );

    expect(screen.getByText(/no circuits yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add circuit" }));
    expect(screen.getByLabelText("Name for circuit 1")).toHaveValue("Circuit 1");

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as Configuration;
    expect(saved.circuits).toEqual([{ number: 1, name: "Circuit 1", pin: 17 }]);
  });

  it("removes a circuit and drops program steps that referenced it", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SettingsEditor configuration={configuration()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Remove circuit 1" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as Configuration;
    expect(saved.circuits.map((c) => c.number)).toEqual([2]);
    // The program's step referenced circuit 1, so it should be gone.
    expect(saved.programs[0]!.steps).toEqual([]);
  });

  it("shows the configured timezone and saves a change to it", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SettingsEditor configuration={configuration()} onSave={onSave} />);

    const picker = screen.getByLabelText("Schedule timezone");
    expect(picker).toHaveValue("America/Vancouver");

    await user.selectOptions(picker, "Europe/London");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as Configuration;
    expect(saved.timezone).toBe("Europe/London");
  });
});
