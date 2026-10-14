import { describe, it, expect } from "vitest";
import { formatMinutes } from "../suggestion-card-utils";

describe("formatMinutes", () => {
  it("formats minutes and hours", () => {
    expect(formatMinutes(25)).toBe("25 min");
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(formatMinutes(120)).toBe("2 h");
  });
});
