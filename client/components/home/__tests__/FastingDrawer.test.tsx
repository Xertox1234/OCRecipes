// @vitest-environment jsdom
import {
  formatFastingSubtitle,
  formatTimeToGoal,
  formatStartedAt,
  formatLastFastDuration,
  formatCompletionRate,
  computeFastProgress,
} from "../fasting-drawer-utils";
import type { ApiFastingLog, FastingStats } from "@shared/types/fasting";

describe("formatFastingSubtitle", () => {
  it("active fast: shows elapsed time and percent", () => {
    // 8h 14m elapsed of a 16h fast → 51%
    const result = formatFastingSubtitle(true, 8 * 60 + 14, 16);
    expect(result).toBe("● 8h 14m · 51%");
  });

  it("active fast: shows 100% when goal reached", () => {
    const result = formatFastingSubtitle(true, 16 * 60 + 30, 16);
    expect(result).toBe("● 16h 30m · 100%");
  });

  it("not fasting, schedule set: shows protocol scheduled", () => {
    const result = formatFastingSubtitle(false, 0, undefined, "16:8");
    expect(result).toBe("16:8 scheduled");
  });

  it("not fasting, no schedule: shows start prompt", () => {
    const result = formatFastingSubtitle(false, 0, undefined, undefined);
    expect(result).toBe("Start your first fast");
  });
});

describe("formatTimeToGoal", () => {
  it("returns formatted remaining time", () => {
    // 16h target, 8h 14m elapsed → 7h 46m remaining
    expect(formatTimeToGoal(8 * 60 + 14, 16)).toBe("7h 46m");
  });

  it("returns Goal reached! when elapsed >= target", () => {
    expect(formatTimeToGoal(16 * 60, 16)).toBe("Goal reached!");
    expect(formatTimeToGoal(17 * 60, 16)).toBe("Goal reached!");
  });

  it("formats sub-hour remainder correctly", () => {
    // 16h target, 15h 30m elapsed → 30m remaining
    expect(formatTimeToGoal(15 * 60 + 30, 16)).toBe("30m");
  });
});

describe("formatStartedAt", () => {
  it("formats AM time", () => {
    const d = new Date();
    d.setHours(8, 5, 0, 0);
    expect(formatStartedAt(d.toISOString())).toMatch(/8:05 (AM|PM)/);
  });

  it("formats midnight as 12:00 AM", () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    expect(formatStartedAt(d.toISOString())).toBe("12:00 AM");
  });

  it("formats noon as 12:00 PM", () => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    expect(formatStartedAt(d.toISOString())).toBe("12:00 PM");
  });
});

describe("formatLastFastDuration", () => {
  it("returns formatted duration for the most recent completed log", () => {
    const logs: ApiFastingLog[] = [
      {
        id: 1,
        userId: "u1",
        startedAt: "2024-01-01T00:00:00Z",
        endedAt: "2024-01-01T16:00:00Z",
        targetDurationHours: 16,
        actualDurationMinutes: 940,
        completed: true,
        note: null,
      },
    ];
    expect(formatLastFastDuration(logs)).toBe("15h 40m");
  });

  it("returns — when logs are empty", () => {
    expect(formatLastFastDuration([])).toBe("—");
  });

  it("returns — when first log has null duration", () => {
    const logs: ApiFastingLog[] = [
      {
        id: 1,
        userId: "u1",
        startedAt: "2024-01-01T00:00:00Z",
        endedAt: null,
        targetDurationHours: 16,
        actualDurationMinutes: null,
        completed: null,
        note: null,
      },
    ];
    expect(formatLastFastDuration(logs)).toBe("—");
  });
});

describe("formatCompletionRate", () => {
  it("formats completion rate as percentage", () => {
    const stats: FastingStats = {
      totalFasts: 10,
      completedFasts: 8,
      completionRate: 0.83,
      currentStreak: 3,
      longestStreak: 5,
      averageDurationMinutes: 900,
    };
    expect(formatCompletionRate(stats)).toBe("83%");
  });

  it("returns — when stats is undefined", () => {
    expect(formatCompletionRate(undefined)).toBe("—");
  });

  it("returns — when totalFasts is 0", () => {
    const stats: FastingStats = {
      totalFasts: 0,
      completedFasts: 0,
      completionRate: 0,
      currentStreak: 0,
      longestStreak: 0,
      averageDurationMinutes: 0,
    };
    expect(formatCompletionRate(stats)).toBe("—");
  });
});

describe("computeFastProgress", () => {
  it("returns fractional progress", () => {
    // 8h elapsed of 16h target → 0.5
    expect(computeFastProgress(8 * 60, 16)).toBeCloseTo(0.5);
  });

  it("clamps to 1 when elapsed exceeds target", () => {
    expect(computeFastProgress(20 * 60, 16)).toBe(1);
  });

  it("returns 0 at start", () => {
    expect(computeFastProgress(0, 16)).toBe(0);
  });

  it("returns 0 when targetHours is 0 or negative", () => {
    expect(computeFastProgress(60, 0)).toBe(0);
    expect(computeFastProgress(60, -1)).toBe(0);
  });
});
