import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NumberInput } from "./NumberInput";

function Harness({ initial, min = 1 }: { initial: number; min?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <NumberInput
      value={value}
      min={min}
      onChange={setValue}
      ariaLabel="Minutes"
    />
  );
}

describe("NumberInput", () => {
  it("replaces a single digit with another without a phantom clamp", async () => {
    const user = userEvent.setup();
    render(<Harness initial={5} />);
    const input = screen.getByLabelText("Minutes");

    // Backspace the sole digit (field goes empty), then type the new one.
    // The old per-keystroke clamp would have snapped the empty field back to 1.
    await user.clear(input);
    await user.type(input, "3");

    expect(input).toHaveValue(3);
  });

  it("reports a valid number as it is typed", async () => {
    const user = userEvent.setup();
    render(<Harness initial={5} />);
    const input = screen.getByLabelText("Minutes");

    await user.clear(input);
    await user.type(input, "12");

    expect(input).toHaveValue(12);
  });

  it("clamps a below-minimum value to the minimum on blur", async () => {
    const user = userEvent.setup();
    render(<Harness initial={5} min={1} />);
    const input = screen.getByLabelText("Minutes");

    await user.clear(input);
    await user.type(input, "0");
    // Still shows what was typed while focused.
    expect(input).toHaveValue(0);

    await user.tab();
    expect(input).toHaveValue(1);
  });

  it("clamps an empty field to the minimum on blur", async () => {
    const user = userEvent.setup();
    render(<Harness initial={5} min={1} />);
    const input = screen.getByLabelText("Minutes");

    await user.clear(input);
    await user.tab();

    expect(input).toHaveValue(1);
  });

  it("reflects the value provided by its parent", () => {
    render(<Harness initial={7} />);
    expect(screen.getByLabelText("Minutes")).toHaveValue(7);
  });
});
