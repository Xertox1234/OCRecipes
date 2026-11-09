import { describe, it, expect } from "vitest";
import { applyMoodDelta, decayedMood, moodBand } from "../mood";

const NOW = new Date("2026-11-08T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("decayedMood", () => {
  it("halves every 3 days", () => {
    expect(decayedMood(2, daysAgo(3), NOW)).toBeCloseTo(1);
    expect(decayedMood(-2, daysAgo(6), NOW)).toBeCloseTo(-0.5);
  });

  it("does not decay without a timestamp or a future one", () => {
    expect(decayedMood(1.5, null, NOW)).toBe(1.5);
    expect(decayedMood(1.5, new Date(NOW.getTime() + 60_000), NOW)).toBe(1.5);
  });
});

describe("applyMoodDelta", () => {
  it("decays first, then adds", () => {
    expect(applyMoodDelta(2, daysAgo(3), -0.5, NOW)).toBeCloseTo(0.5);
  });

  it("clamps to −2…+2", () => {
    expect(applyMoodDelta(1.8, NOW, 1, NOW)).toBe(2);
    expect(applyMoodDelta(-1.8, NOW, -1, NOW)).toBe(-2);
  });
});

describe("moodBand", () => {
  it("splits at ±0.75", () => {
    expect(moodBand(-0.76)).toBe("low");
    expect(moodBand(-0.75)).toBe("neutral");
    expect(moodBand(0.75)).toBe("neutral");
    expect(moodBand(0.76)).toBe("good");
  });
});
