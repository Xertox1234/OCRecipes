import { describe, it, expect } from "vitest";
import { parseTimeEstimateMinutes, toTotalTimeMinutes } from "../recipe-time";

describe("parseTimeEstimateMinutes", () => {
  it.each([
    ["30 min", 30],
    ["45 minutes", 45],
    ["10 mins", 10],
    ["1 hour", 60],
    ["1 hr 15 min", 75],
    ["2 hours 5 minutes", 125],
    ["1.5 hours", 90],
    ["20-30 min", 30],
    ["20 min to 30 min", 30],
    ["Prep 10 min, cook 25 min", 35],
    ["prep 10 min + cook 1 hr", 70],
    ["1 hr 15 min", 75],
  ])("%s → %d", (text, minutes) => {
    expect(parseTimeEstimateMinutes(text)).toBe(minutes);
  });

  it.each([null, undefined, "", "quick", "30", "0 min", "a while"])(
    "returns null for %s",
    (text) => {
      expect(parseTimeEstimateMinutes(text)).toBeNull();
    },
  );
});

describe("toTotalTimeMinutes", () => {
  it("sums prep and cook when both are known", () => {
    expect(
      toTotalTimeMinutes({ prepTimeMinutes: 10, cookTimeMinutes: 20 }),
    ).toBe(30);
  });
  it("never treats half a time as the whole", () => {
    expect(
      toTotalTimeMinutes({ prepTimeMinutes: 10, cookTimeMinutes: null }),
    ).toBeNull();
    expect(
      toTotalTimeMinutes({ prepTimeMinutes: null, cookTimeMinutes: 20 }),
    ).toBeNull();
  });
  it("falls back to the timeEstimate text", () => {
    expect(
      toTotalTimeMinutes({ prepTimeMinutes: 10, timeEstimate: "25 min" }),
    ).toBe(25);
    expect(toTotalTimeMinutes({ timeEstimate: "1 hour" })).toBe(60);
  });
  it("returns null when nothing is readable", () => {
    expect(toTotalTimeMinutes({})).toBeNull();
  });
});
