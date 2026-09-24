import { useState } from "react";

export interface NumberInputProps {
  value: number;
  min: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  className?: string;
  id?: string;
}

/**
 * A numeric text input that stays out of the way while you edit. It reports each
 * valid number as you type, but only clamps to `min` when editing finishes (blur).
 *
 * A naive `Math.max(min, Number(text))` on every keystroke rewrites the field the
 * moment it drops below the minimum — clearing a single digit snaps it back to
 * `min`, so replacing one digit with another means typing the new digit first and
 * then deleting the leftover. Deferring the clamp lets the field be transiently
 * empty (or below the minimum) mid-edit, so a plain backspace-then-type works.
 */
export function NumberInput({
  value,
  min,
  onChange,
  ariaLabel,
  className,
  id,
}: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);

  function handleChange(next: string): void {
    setDraft(next);
    const parsed = Number(next);
    if (next.trim() !== "" && Number.isFinite(parsed) && parsed >= min) {
      onChange(parsed);
    }
  }

  function commit(): void {
    const parsed = Number(text);
    const clamped =
      text.trim() === "" || !Number.isFinite(parsed)
        ? min
        : Math.max(min, Math.floor(parsed));
    onChange(clamped);
    setDraft(null);
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      id={id}
      className={className}
      aria-label={ariaLabel}
      value={text}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={commit}
    />
  );
}
