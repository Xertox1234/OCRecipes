import { describe, it, expect } from "vitest";

import {
  calculateFastingProgress,
  formatFastingTimeDisplay,
  formatStreakLabel,
  isHighStreak,
} from "../fasting-display-utils";

describe("fasting-display-utils", () => {
  describe("calculateFastingProgress", () => {
    it("returns ratio of elapsed to target", () => {
      expect(calculateFastingProgress(30, 60)).toBe(0.5);
    });

    it("clamps to 1 when elapsed exceeds target", () => {
      expect(calculateFastingProgress(120, 60)).toBe(1);
    });

    it("returns 0 when no time has elapsed", () => {
      expect(calculateFastingProgress(0, 60)).toBe(0);
    });

    it("returns 0 when target is zero", () => {
      expect(calculateFastingProgress(30, 0)).toBe(0);
    });
  });

  describe("formatFastingTimeDisplay", () => {
    it("shows remaining time when before target", () => {
      const result = formatFastingTimeDisplay(30, 120);
      expect(result.main).toBe("01:30");
      expect(result.label).toBe("Remaining");
    });

    it("shows +00:00 at exact target", () => {
      const result = formatFastingTimeDisplay(120, 120);
      expect(result.main).toBe("+00:00");
      expect(result.label).toBe("Past target");
    });

    it("shows time past target", () => {
      const result = formatFastingTimeDisplay(150, 120);
      expect(result.main).toBe("+00:30");
      expect(result.label).toBe("Past target");
    });

    it("shows multi-hour past target", () => {
      const result = formatFastingTimeDisplay(300, 120);
      expect(result.main).toBe("+03:00");
      expect(result.label).toBe("Past target");
    });

    it("pads single-digit values", () => {
      const result = formatFastingTimeDisplay(0, 65);
      expect(result.main).toBe("01:05");
    });

    it("shows full target time when nothing elapsed", () => {
      const result = formatFastingTimeDisplay(0, 960); // 16 hours
      expect(result.main).toBe("16:00");
      expect(result.label).toBe("Remaining");
    });
  });

  describe("formatStreakLabel", () => {
    it("returns null for zero streak", () => {
      expect(formatStreakLabel(0)).toBeNull();
    });

    it("returns null for negative streak", () => {
      expect(formatStreakLabel(-1)).toBeNull();
    });

    it("uses singular for 1 day", () => {
      expect(formatStreakLabel(1)).toBe("1 day");
    });

    it("uses plural for multiple days", () => {
      expect(formatStreakLabel(5)).toBe("5 days");
    });
  });

  describe("isHighStreak", () => {
    it("returns false for streak below 7", () => {
      expect(isHighStreak(6)).toBe(false);
    });

    it("returns true for streak of 7", () => {
      expect(isHighStreak(7)).toBe(true);
    });

    it("returns true for streak above 7", () => {
      expect(isHighStreak(30)).toBe(true);
    });
  });
});
