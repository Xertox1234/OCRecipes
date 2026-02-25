import {
  estimateTDEE,
  getGoalAdjustment,
  clampCalories,
  recomputeMacros,
  determineReason,
} from "../adaptive-goals";

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
});
