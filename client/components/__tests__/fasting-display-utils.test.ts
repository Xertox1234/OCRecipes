import { describe, it, expect } from "vitest";

import {
  calculateFastingProgress,
  formatFastingTimeDisplay,
  formatStreakLabel,
  isHighStreak,
  getFastingPhase,
  getNextPhaseBoundary,
  getMilestoneHours,
  milestoneToAngle,
  FASTING_PHASES,
  FASTING_TIPS,
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

  // ========================================================================
  // Fasting Phases
  // ========================================================================

  describe("getFastingPhase", () => {
    it("returns Fed State at 0 minutes", () => {
      expect(getFastingPhase(0).name).toBe("Fed State");
    });

    it("returns Fed State just before 4h", () => {
      expect(getFastingPhase(239).name).toBe("Fed State");
    });

    it("returns Early Fasting at exactly 4h", () => {
      expect(getFastingPhase(240).name).toBe("Early Fasting");
    });

    it("returns Fat Burning at 8h", () => {
      expect(getFastingPhase(480).name).toBe("Fat Burning");
    });

    it("returns Ketosis at 12h", () => {
      expect(getFastingPhase(720).name).toBe("Ketosis");
    });

    it("returns Autophagy at 16h", () => {
      expect(getFastingPhase(960).name).toBe("Autophagy");
    });

    it("returns Deep Autophagy at 24h", () => {
      expect(getFastingPhase(1440).name).toBe("Deep Autophagy");
    });

    it("returns Deep Autophagy at 48h", () => {
      expect(getFastingPhase(2880).name).toBe("Deep Autophagy");
    });

    it("returns Fed State for negative minutes", () => {
      expect(getFastingPhase(-10).name).toBe("Fed State");
    });
  });

  describe("getNextPhaseBoundary", () => {
    it("returns Early Fasting boundary at 0 minutes", () => {
      const result = getNextPhaseBoundary(0);
      expect(result).not.toBeNull();
      expect(result!.phase.name).toBe("Early Fasting");
      expect(result!.minutes).toBe(240);
    });

    it("returns Fat Burning boundary at 5h", () => {
      const result = getNextPhaseBoundary(300);
      expect(result!.phase.name).toBe("Fat Burning");
      expect(result!.minutes).toBe(480);
    });

    it("returns null at Deep Autophagy (last phase)", () => {
      expect(getNextPhaseBoundary(1500)).toBeNull();
    });
  });

  // ========================================================================
  // Milestone Markers
  // ========================================================================

  describe("getMilestoneHours", () => {
    it("returns milestones up to target for 16:8", () => {
      expect(getMilestoneHours(16)).toEqual([12, 16]);
    });

    it("returns milestones up to target for 20:4", () => {
      expect(getMilestoneHours(20)).toEqual([12, 16, 20]);
    });

    it("returns all standard milestones for 24h", () => {
      expect(getMilestoneHours(24)).toEqual([12, 16, 20, 24]);
    });

    it("includes target even if not a standard milestone (18:6)", () => {
      expect(getMilestoneHours(18)).toEqual([12, 16, 18]);
    });

    it("includes target for custom short fast (10h)", () => {
      expect(getMilestoneHours(10)).toEqual([10]);
    });

    it("includes 12h for 14h custom fast", () => {
      expect(getMilestoneHours(14)).toEqual([12, 14]);
    });
  });

  describe("milestoneToAngle", () => {
    it("returns -90 at 0 hours (12 o'clock)", () => {
      expect(milestoneToAngle(0, 16)).toBe(-90);
    });

    it("returns 270 at full target (back to 12 o'clock)", () => {
      expect(milestoneToAngle(16, 16)).toBe(270);
    });

    it("returns 0 at 25% of target (3 o'clock)", () => {
      expect(milestoneToAngle(4, 16)).toBe(0);
    });

    it("returns 90 at 50% of target (6 o'clock)", () => {
      expect(milestoneToAngle(8, 16)).toBe(90);
    });
  });

  // ========================================================================
  // Data constants
  // ========================================================================

  describe("FASTING_PHASES", () => {
    it("has phases in ascending startHour order", () => {
      for (let i = 1; i < FASTING_PHASES.length; i++) {
        expect(FASTING_PHASES[i].startHour).toBeGreaterThan(
          FASTING_PHASES[i - 1].startHour,
        );
      }
    });

    it("starts at hour 0", () => {
      expect(FASTING_PHASES[0].startHour).toBe(0);
    });
  });

  describe("FASTING_TIPS", () => {
    it("has at least 5 tips", () => {
      expect(FASTING_TIPS.length).toBeGreaterThanOrEqual(5);
    });

    it("each tip has text and icon", () => {
      for (const tip of FASTING_TIPS) {
        expect(tip.text.length).toBeGreaterThan(0);
        expect(tip.icon.length).toBeGreaterThan(0);
      }
    });
  });
});
