import { describe, it, expect } from "vitest";
import { photoPollInterval, formatMinutes } from "../suggestion-card-utils";

describe("photoPollInterval", () => {
  it("polls every 2s while any photo is missing", () => {
    expect(photoPollInterval([null, "a"], 0, 1000)).toBe(2000);
  });
  it("stops when all photos are present", () => {
    expect(photoPollInterval(["a", "b"], 0, 1000)).toBe(false);
  });
  it("stops after 60s regardless", () => {
    expect(photoPollInterval([null], 0, 60_001)).toBe(false);
  });
  it("a new listing gets a fresh 60s window (caller passes its own startedAt)", () => {
    const later = 10 * 60_000;
    expect(photoPollInterval([null], later, later + 61_000)).toBe(false);
    expect(photoPollInterval([null], later + 61_000, later + 62_000)).toBe(
      2000,
    );
  });
  it("stops for an empty list", () => {
    expect(photoPollInterval([], 0, 0)).toBe(false);
  });
});

describe("formatMinutes", () => {
  it("formats minutes and hours", () => {
    expect(formatMinutes(25)).toBe("25 min");
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(formatMinutes(120)).toBe("2 h");
  });
});
