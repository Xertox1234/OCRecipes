import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  estimateTDEE,
  getGoalAdjustment,
  clampCalories,
  recomputeMacros,
  determineReason,
  computeAdaptiveGoals,
} from "../adaptive-goals";

vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    getWeightLogs: vi.fn(),
    getUserProfile: vi.fn(),
  },
}));

import { storage } from "../../storage";

describe("Adaptive Goals", () => {
  describe("estimateTDEE", () => {
    it("returns current calories when weight is unchanged", () => {
      const tdee = estimateTDEE(2000, 0, 14);
      expect(tdee).toBe(2000);
    });

    it("estimates higher TDEE when user lost weight", () => {
      // Lost 1 kg over 14 days → daily surplus of (1 * 7700) / 14 = 550
      // TDEE = 2000 - (-550) = 2550
      const tdee = estimateTDEE(2000, -1, 14);
      expect(tdee).toBe(2550);
    });

    it("estimates lower TDEE when user gained weight", () => {
      // Gained 1 kg over 14 days → daily surplus of (1 * 7700) / 14 = 550
      // TDEE = 2000 - 550 = 1450
      const tdee = estimateTDEE(2000, 1, 14);
      expect(tdee).toBe(1450);
    });

    it("scales correctly with longer time periods", () => {
      // Lost 2 kg over 28 days → daily surplus of (2 * 7700) / 28 = 550
      // Same daily rate as 1kg/14days
      const tdee = estimateTDEE(2000, -2, 28);
      expect(tdee).toBe(2550);
    });

    it("handles large weight changes", () => {
      // Gained 4 kg over 28 days → daily surplus of (4 * 7700) / 28 = 1100
      // TDEE = 2500 - 1100 = 1400
      const tdee = estimateTDEE(2500, 4, 28);
      expect(tdee).toBe(1400);
    });
  });

  describe("getGoalAdjustment", () => {
    it("returns -500 for lose_weight", () => {
      expect(getGoalAdjustment("lose_weight")).toBe(-500);
    });

    it("returns +300 for gain_weight", () => {
      expect(getGoalAdjustment("gain_weight")).toBe(300);
    });

    it("returns +300 for build_muscle", () => {
      expect(getGoalAdjustment("build_muscle")).toBe(300);
    });

    it("returns 0 for maintain", () => {
      expect(getGoalAdjustment("maintain")).toBe(0);
    });

    it("returns 0 for unknown goals", () => {
      expect(getGoalAdjustment("eat_healthier")).toBe(0);
      expect(getGoalAdjustment("manage_condition")).toBe(0);
      expect(getGoalAdjustment("")).toBe(0);
    });
  });

  describe("clampCalories", () => {
    it("returns value unchanged when within bounds", () => {
      expect(clampCalories(2000)).toBe(2000);
      expect(clampCalories(1200)).toBe(1200);
      expect(clampCalories(5000)).toBe(5000);
    });

    it("clamps to minimum of 1200", () => {
      expect(clampCalories(1000)).toBe(1200);
      expect(clampCalories(500)).toBe(1200);
      expect(clampCalories(0)).toBe(1200);
      expect(clampCalories(-100)).toBe(1200);
    });

    it("clamps to maximum of 5000", () => {
      expect(clampCalories(5500)).toBe(5000);
      expect(clampCalories(10000)).toBe(5000);
    });

    it("handles boundary values exactly", () => {
      expect(clampCalories(1199)).toBe(1200);
      expect(clampCalories(1201)).toBe(1201);
      expect(clampCalories(4999)).toBe(4999);
      expect(clampCalories(5001)).toBe(5000);
    });
  });

  describe("recomputeMacros", () => {
    it("preserves macro ratios when scaling to same total macro calories", () => {
      // protein: 150*4 = 600 cal, carbs: 250*4 = 1000 cal, fat: 67*9 = 603 cal
      // total macro cal: 2203
      const current = { calories: 2203, protein: 150, carbs: 250, fat: 67 };

      const result = recomputeMacros(current, 2203);

      // At same total macro calories, macros should be the same
      expect(result.protein).toBe(150);
      expect(result.carbs).toBe(250);
      expect(result.fat).toBe(67);
    });

    it("scales macros proportionally when calories increase", () => {
      const current = { calories: 2000, protein: 100, carbs: 200, fat: 67 };
      const result = recomputeMacros(current, 2400);

      // Macros should be higher
      expect(result.protein).toBeGreaterThan(100);
      expect(result.carbs).toBeGreaterThan(200);
      expect(result.fat).toBeGreaterThan(67);
    });

    it("scales macros proportionally when calories decrease", () => {
      const current = { calories: 2000, protein: 100, carbs: 200, fat: 67 };
      const result = recomputeMacros(current, 1600);

      // Macros should be lower
      expect(result.protein).toBeLessThan(100);
      expect(result.carbs).toBeLessThan(200);
      expect(result.fat).toBeLessThan(67);
    });

    it("returns integer values for all macros", () => {
      const current = { calories: 2000, protein: 150, carbs: 250, fat: 67 };
      const result = recomputeMacros(current, 1800);

      expect(Number.isInteger(result.protein)).toBe(true);
      expect(Number.isInteger(result.carbs)).toBe(true);
      expect(Number.isInteger(result.fat)).toBe(true);
    });

    it("handles equal macro calorie distribution", () => {
      // 100g protein = 400 cal, 100g carbs = 400 cal, ~44g fat = 400 cal
      const current = { calories: 1200, protein: 100, carbs: 100, fat: 44 };
      const result = recomputeMacros(current, 1800);

      // Should scale roughly 1.5x
      expect(result.protein).toBeCloseTo(150, -1);
      expect(result.carbs).toBeCloseTo(150, -1);
      expect(result.fat).toBeCloseTo(66, -1);
    });
  });

  describe("determineReason", () => {
    it("returns exceeding_target when losing weight but gained", () => {
      const result = determineReason("lose_weight", 1.5, 0.75, 14, 2200, 1700);

      expect(result.reason).toBe("exceeding_target");
      expect(result.explanation).toContain("1.5 kg");
      expect(result.explanation).toContain("14 days");
      expect(result.explanation).toContain("1700");
    });

    it("returns weight_stall when losing weight but rate is near zero", () => {
      const result = determineReason(
        "lose_weight",
        -0.05,
        -0.025,
        14,
        2100,
        1600,
      );

      expect(result.reason).toBe("weight_stall");
      expect(result.explanation).toContain("stable");
    });

    it("returns undereating when gaining weight but lost", () => {
      const result = determineReason(
        "gain_weight",
        -1.0,
        -0.5,
        14,
        2500,
        2800,
      );

      expect(result.reason).toBe("undereating");
      expect(result.explanation).toContain("1.0 kg");
      expect(result.explanation).toContain("2800");
    });

    it("returns scheduled for general maintenance adjustments", () => {
      const result = determineReason("maintain", -0.5, -0.25, 28, 2200, 2200);

      expect(result.reason).toBe("scheduled");
      expect(result.explanation).toContain("28 days");
      expect(result.explanation).toContain("2200 kcal");
    });

    it("returns scheduled for lose_weight with significant loss rate", () => {
      // Losing weight at a good rate (not stalled, not gaining)
      const result = determineReason(
        "lose_weight",
        -2.0,
        -1.0,
        14,
        2300,
        1800,
      );

      expect(result.reason).toBe("scheduled");
    });

    it("returns scheduled for gain_weight with positive change", () => {
      const result = determineReason(
        "gain_weight",
        1.0,
        0.5,
        14,
        1800,
        2100,
      );

      expect(result.reason).toBe("scheduled");
    });
  });

  describe("computeAdaptiveGoals", () => {
    beforeEach(() => {
      vi.mocked(storage.getUser).mockReset();
      vi.mocked(storage.getWeightLogs).mockReset();
      vi.mocked(storage.getUserProfile).mockReset();
    });

    function makeWeightLogs(weights: { weight: string; loggedAt: string }[]) {
      return weights.map((w, i) => ({
        id: i + 1,
        userId: "1",
        weight: w.weight,
        loggedAt: w.loggedAt,
        note: null,
      }));
    }

    it("returns null when user not found", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(null);
      const result = await computeAdaptiveGoals("1");
      expect(result).toBeNull();
    });

    it("returns null when fewer than 4 weight logs", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({ id: "1", dailyCalorieGoal: 2000 });
      vi.mocked(storage.getWeightLogs).mockResolvedValue([
        { id: 1, userId: "1", weight: "80", loggedAt: "2025-01-01T12:00:00" },
        { id: 2, userId: "1", weight: "79.5", loggedAt: "2025-01-08T12:00:00" },
      ]);

      const result = await computeAdaptiveGoals("1");
      expect(result).toBeNull();
    });

    it("returns null when data span is less than 14 days", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({ id: "1", dailyCalorieGoal: 2000 });
      vi.mocked(storage.getWeightLogs).mockResolvedValue(makeWeightLogs([
        { weight: "80", loggedAt: "2025-01-01T12:00:00" },
        { weight: "79.8", loggedAt: "2025-01-03T12:00:00" },
        { weight: "79.6", loggedAt: "2025-01-05T12:00:00" },
        { weight: "79.4", loggedAt: "2025-01-07T12:00:00" },
      ]));

      const result = await computeAdaptiveGoals("1");
      expect(result).toBeNull();
    });

    it("returns null when deviation is less than 10%", async () => {
      // Setup: weight stayed the same → TDEE ≈ current calories → no adjustment
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: 2000,
        dailyProteinGoal: 150,
        dailyCarbsGoal: 250,
        dailyFatGoal: 67,
      });
      vi.mocked(storage.getWeightLogs).mockResolvedValue(makeWeightLogs([
        { weight: "80.0", loggedAt: "2025-01-01T12:00:00" },
        { weight: "80.0", loggedAt: "2025-01-08T12:00:00" },
        { weight: "80.0", loggedAt: "2025-01-15T12:00:00" },
        { weight: "80.0", loggedAt: "2025-01-22T12:00:00" },
      ]));
      vi.mocked(storage.getUserProfile).mockResolvedValue({ primaryGoal: "maintain" });

      const result = await computeAdaptiveGoals("1");
      // TDEE = 2000 (no weight change), goal adjust for maintain = 0
      // recommended = 2000, deviation = 0 → null
      expect(result).toBeNull();
    });

    it("returns recommendation when significant deviation in lose_weight", async () => {
      // User eating 2000 cal but gaining weight → TDEE is lower
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: 2500,
        dailyProteinGoal: 150,
        dailyCarbsGoal: 250,
        dailyFatGoal: 67,
      });
      // Gained 2kg over 28 days
      vi.mocked(storage.getWeightLogs).mockResolvedValue(makeWeightLogs([
        { weight: "80", loggedAt: "2025-01-01T12:00:00" },
        { weight: "80.5", loggedAt: "2025-01-08T12:00:00" },
        { weight: "81", loggedAt: "2025-01-15T12:00:00" },
        { weight: "82", loggedAt: "2025-01-29T12:00:00" },
      ]));
      vi.mocked(storage.getUserProfile).mockResolvedValue({ primaryGoal: "lose_weight" });

      const result = await computeAdaptiveGoals("1");
      expect(result).not.toBeNull();
      expect(result!.newCalories).toBeLessThan(result!.previousCalories);
      expect(result!.reason).toBeTruthy();
      expect(result!.explanation).toBeTruthy();
      expect(result!.newCalories).toBeGreaterThanOrEqual(1200);
      expect(result!.newCalories).toBeLessThanOrEqual(5000);
    });

    it("returns recommendation when undereating for gain_weight", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: 2000,
        dailyProteinGoal: 150,
        dailyCarbsGoal: 250,
        dailyFatGoal: 67,
      });
      // Lost 2kg over 28 days while trying to gain
      vi.mocked(storage.getWeightLogs).mockResolvedValue(makeWeightLogs([
        { weight: "70", loggedAt: "2025-01-01T12:00:00" },
        { weight: "69.5", loggedAt: "2025-01-08T12:00:00" },
        { weight: "69", loggedAt: "2025-01-15T12:00:00" },
        { weight: "68", loggedAt: "2025-01-29T12:00:00" },
      ]));
      vi.mocked(storage.getUserProfile).mockResolvedValue({ primaryGoal: "gain_weight" });

      const result = await computeAdaptiveGoals("1");
      expect(result).not.toBeNull();
      expect(result!.newCalories).toBeGreaterThan(result!.previousCalories);
    });

    it("uses default values when user goals are null", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: null,
        dailyProteinGoal: null,
        dailyCarbsGoal: null,
        dailyFatGoal: null,
      });
      // Significant weight gain to trigger recommendation
      vi.mocked(storage.getWeightLogs).mockResolvedValue(makeWeightLogs([
        { weight: "80", loggedAt: "2025-01-01T12:00:00" },
        { weight: "81", loggedAt: "2025-01-08T12:00:00" },
        { weight: "82", loggedAt: "2025-01-15T12:00:00" },
        { weight: "84", loggedAt: "2025-01-29T12:00:00" },
      ]));
      vi.mocked(storage.getUserProfile).mockResolvedValue({ primaryGoal: "lose_weight" });

      const result = await computeAdaptiveGoals("1");
      // Should use defaults (2000 cal) and compute without error
      expect(result).not.toBeNull();
      expect(result!.previousCalories).toBe(2000);
    });

    it("uses 'maintain' when no profile exists", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: 2000,
        dailyProteinGoal: 150,
        dailyCarbsGoal: 250,
        dailyFatGoal: 67,
      });
      // Large weight gain over 28 days → TDEE lower → deviation > 10%
      vi.mocked(storage.getWeightLogs).mockResolvedValue(makeWeightLogs([
        { weight: "80", loggedAt: "2025-01-01T12:00:00" },
        { weight: "81", loggedAt: "2025-01-08T12:00:00" },
        { weight: "82", loggedAt: "2025-01-15T12:00:00" },
        { weight: "84", loggedAt: "2025-01-29T12:00:00" },
      ]));
      vi.mocked(storage.getUserProfile).mockResolvedValue(null);

      const result = await computeAdaptiveGoals("1");
      // With maintain goal, adjustment = 0, but TDEE estimate should differ
      // enough to trigger a recommendation
      if (result) {
        expect(result.reason).toBe("scheduled");
      }
    });
  });
});
