import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { calculateWeeklyRate, calculateWeightTrend } from "../weight-trend";

const FIXED_NOW = new Date("2026-04-18T12:00:00.000Z");

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

function makeWeightEntry(weight: number, daysAgo: number) {
  const date = new Date(FIXED_NOW);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(8, 0, 0, 0);
  return {
    weight: weight.toString(),
    loggedAt: date,
  };
}

describe("Weight Trend", () => {
  describe("calculateWeightTrend", () => {
    it("returns null values for empty logs", () => {
      const result = calculateWeightTrend([]);

      expect(result.avg7Day).toBeNull();
      expect(result.avg30Day).toBeNull();
      expect(result.weeklyRateOfChange).toBeNull();
      expect(result.projectedGoalDate).toBeNull();
      expect(result.currentWeight).toBeNull();
      expect(result.entries).toBe(0);
    });

    it("identifies current weight as the most recent entry", () => {
      const logs = [
        makeWeightEntry(75.0, 5),
        makeWeightEntry(74.5, 3),
        makeWeightEntry(74.0, 1), // most recent
        makeWeightEntry(76.0, 10),
      ];

      const result = calculateWeightTrend(logs);

      expect(result.currentWeight).toBe(74.0);
    });

    it("returns correct entry count", () => {
      const logs = [
        makeWeightEntry(75.0, 1),
        makeWeightEntry(74.5, 2),
        makeWeightEntry(74.0, 3),
      ];

      const result = calculateWeightTrend(logs);

      expect(result.entries).toBe(3);
    });

    it("calculates 7-day average for entries within last 7 days", () => {
      const logs = [
        makeWeightEntry(74.0, 1),
        makeWeightEntry(75.0, 3),
        makeWeightEntry(76.0, 5),
      ];

      const result = calculateWeightTrend(logs);

      // All entries within last 7 days: (74 + 75 + 76) / 3 = 75
      expect(result.avg7Day).toBe(75.0);
    });

    it("excludes entries older than 7 days from 7-day average", () => {
      const logs = [
        makeWeightEntry(74.0, 1),
        makeWeightEntry(75.0, 3),
        makeWeightEntry(80.0, 10), // older than 7 days
      ];

      const result = calculateWeightTrend(logs);

      // Only entries within 7 days: (74 + 75) / 2 = 74.5
      expect(result.avg7Day).toBe(74.5);
    });

    it("calculates 30-day average for entries within last 30 days", () => {
      const logs = [
        makeWeightEntry(74.0, 1),
        makeWeightEntry(75.0, 10),
        makeWeightEntry(76.0, 20),
        makeWeightEntry(80.0, 40), // older than 30 days
      ];

      const result = calculateWeightTrend(logs);

      // Entries within 30 days: (74 + 75 + 76) / 3 = 75
      expect(result.avg30Day).toBe(75.0);
    });

    it("returns null 7-day avg when no entries in last 7 days", () => {
      const logs = [makeWeightEntry(74.0, 10), makeWeightEntry(75.0, 15)];

      const result = calculateWeightTrend(logs);

      expect(result.avg7Day).toBeNull();
    });

    it("calculates weekly rate of change when data spans 2 weeks", () => {
      // This week entries (last 7 days)
      // Last week entries (8-14 days ago)
      const logs = [
        makeWeightEntry(73.0, 1),
        makeWeightEntry(73.5, 3),
        makeWeightEntry(74.0, 5),
        // Last week
        makeWeightEntry(75.0, 8),
        makeWeightEntry(75.5, 10),
        makeWeightEntry(76.0, 12),
      ];

      const result = calculateWeightTrend(logs);

      // This week avg: (73 + 73.5 + 74) / 3 = 73.5
      // Last week avg: (75 + 75.5 + 76) / 3 = 75.5
      // Rate: 73.5 - 75.5 = -2.0
      expect(result.weeklyRateOfChange).toBe(-2.0);
    });

    it("returns null weekly rate when no data in previous week", () => {
      const logs = [makeWeightEntry(74.0, 1), makeWeightEntry(74.5, 3)];

      const result = calculateWeightTrend(logs);

      expect(result.weeklyRateOfChange).toBeNull();
    });

    it("projects goal date when losing weight toward lower goal", () => {
      const logs = [
        // This week: avg ~73.5
        makeWeightEntry(73.0, 1),
        makeWeightEntry(74.0, 5),
        // Last week: avg ~75.5
        makeWeightEntry(75.0, 8),
        makeWeightEntry(76.0, 12),
      ];

      const result = calculateWeightTrend(logs, 70.0);

      // weeklyRateOfChange = 73.5 - 75.5 = -2.0
      // currentWeight = 73.0
      // diff = 70 - 73 = -3.0
      // weeksToGoal = |-3 / -2| = 1.5
      // projectedDate = today + 1.5 * 7 = today + 10.5 days (rounded to 11)
      expect(result.projectedGoalDate).not.toBeNull();
      // Verify it's a valid date string
      expect(result.projectedGoalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("returns null projected date when rate is in wrong direction", () => {
      const logs = [
        // This week: avg ~76 (gaining)
        makeWeightEntry(76.0, 1),
        makeWeightEntry(76.0, 5),
        // Last week: avg ~74 (was lower)
        makeWeightEntry(74.0, 8),
        makeWeightEntry(74.0, 12),
      ];

      const result = calculateWeightTrend(logs, 70.0); // goal is to lose

      // Rate is +2.0 (gaining), but goal is 70 (need to lose)
      // Direction mismatch: gaining weight but goal < current
      expect(result.projectedGoalDate).toBeNull();
    });

    it("returns null projected date when no goal weight provided", () => {
      const logs = [makeWeightEntry(74.0, 1), makeWeightEntry(75.0, 8)];

      const result = calculateWeightTrend(logs);

      expect(result.projectedGoalDate).toBeNull();
    });

    it("returns null projected date when rate of change is null", () => {
      const logs = [makeWeightEntry(74.0, 1)];

      const result = calculateWeightTrend(logs, 70.0);

      expect(result.projectedGoalDate).toBeNull();
    });

    it("handles single entry gracefully", () => {
      const logs = [makeWeightEntry(74.0, 1)];

      const result = calculateWeightTrend(logs);

      expect(result.currentWeight).toBe(74.0);
      expect(result.entries).toBe(1);
      expect(result.avg7Day).toBe(74.0);
      expect(result.weeklyRateOfChange).toBeNull();
    });

    it("handles weight gain projection toward higher goal", () => {
      const logs = [
        // This week: gaining weight
        makeWeightEntry(76.0, 1),
        makeWeightEntry(75.5, 5),
        // Last week: lower
        makeWeightEntry(74.0, 8),
        makeWeightEntry(73.5, 12),
      ];

      const result = calculateWeightTrend(logs, 80.0); // goal is to gain

      // weeklyRateOfChange = positive (gaining)
      // goal > current, rate > 0 -> valid projection
      expect(result.projectedGoalDate).not.toBeNull();
      expect(result.projectedGoalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("rounds averages to 2 decimal places", () => {
      const logs = [
        makeWeightEntry(74.1, 1),
        makeWeightEntry(74.2, 2),
        makeWeightEntry(74.4, 3),
      ];

      const result = calculateWeightTrend(logs);

      // (74.1 + 74.2 + 74.4) / 3 = 74.2333... → 74.23
      expect(result.avg7Day).toBe(74.23);
    });
  });

  describe("calculateWeeklyRate", () => {
    it("returns null for empty logs", () => {
      expect(calculateWeeklyRate([])).toBeNull();
    });

    it("returns null for a single entry", () => {
      expect(calculateWeeklyRate([makeWeightEntry(75, 0)])).toBeNull();
    });

    it("returns null when span is shorter than 3 days", () => {
      // newest-first order: logs[0] is most recent
      const logs = [makeWeightEntry(74, 0), makeWeightEntry(75, 2)];
      expect(calculateWeeklyRate(logs)).toBeNull();
    });

    it("returns the weekly rate when span is 3+ days", () => {
      // newest=74 today, oldest=77 seven days ago → -3kg per week
      const logs = [makeWeightEntry(74, 0), makeWeightEntry(77, 7)];
      expect(calculateWeeklyRate(logs)).toBe(-3);
    });

    it("uses newest entry and oldest entry even with intermediate logs", () => {
      // Only the first (newest) and last (oldest) entries are used.
      const logs = [
        makeWeightEntry(74, 0),
        makeWeightEntry(100, 2), // outlier in the middle — should be ignored
        makeWeightEntry(77, 7),
      ];
      expect(calculateWeeklyRate(logs)).toBe(-3);
    });

    it("rounds to 1 decimal place", () => {
      // 74 - 75 = -1 over 7 days → -1 kg/week
      const logs = [makeWeightEntry(74, 0), makeWeightEntry(75, 7)];
      expect(calculateWeeklyRate(logs)).toBe(-1);
      // 74.55 - 75 = -0.45 over 7 days = -0.45/week → -0.5 after rounding
      const logs2 = [makeWeightEntry(74.55, 0), makeWeightEntry(75, 7)];
      expect(calculateWeeklyRate(logs2)).toBe(-0.5);
    });
  });
});
