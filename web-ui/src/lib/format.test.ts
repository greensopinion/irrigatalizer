import { describe, expect, it } from "vitest";
import { formatCountdown, formatRunDuration, slotLabel } from "./format";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatCountdown", () => {
  it("keeps seconds for sub-hour spans", () => {
    expect(formatCountdown(4 * MINUTE + 30 * SECOND)).toBe("4m 30s");
  });

  it("drops seconds once the span reaches an hour and does not pad", () => {
    expect(formatCountdown(HOUR + 5 * MINUTE + 9 * SECOND)).toBe("1h 5m");
  });

  it("breaks out days from hours for long spans without padding", () => {
    expect(formatCountdown(4 * DAY + 8 * HOUR + 55 * MINUTE + 32 * SECOND)).toBe(
      "4d 8h 55m",
    );
  });

  it("pads only the seconds for sub-hour spans", () => {
    expect(formatCountdown(4 * MINUTE + 9 * SECOND)).toBe("4m 09s");
  });

  it("clamps negative values to zero", () => {
    expect(formatCountdown(-1000)).toBe("0m 00s");
  });
});

describe("formatRunDuration", () => {
  it("formats whole minutes", () => {
    expect(formatRunDuration(15 * MINUTE)).toBe("15m");
  });

  it("formats hours with remaining minutes", () => {
    expect(formatRunDuration(HOUR + 5 * MINUTE)).toBe("1h 5m");
  });

  it("drops the minutes segment on a whole-hour span", () => {
    expect(formatRunDuration(2 * HOUR)).toBe("2h");
  });

  it("falls back to seconds for sub-minute spans", () => {
    expect(formatRunDuration(45 * 1000)).toBe("45s");
  });

  it("clamps negative spans to zero", () => {
    expect(formatRunDuration(-1000)).toBe("0s");
  });
});

describe("slotLabel", () => {
  it("formats midnight as a 12-hour AM label", () => {
    expect(slotLabel(0)).toBe("12:00 AM");
  });

  it("formats a morning half-hour slot with AM/PM", () => {
    expect(slotLabel(13)).toBe("6:30 AM");
  });

  it("formats an afternoon slot with AM/PM", () => {
    expect(slotLabel(26)).toBe("1:00 PM");
  });
});
