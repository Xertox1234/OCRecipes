import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  estimateTDEE,
  getGoalAdjustment,
  clampCalories,
  recomputeMacros,
  determineReason,
  computeAdaptiveGoals,
  KCAL_PER_KG,
  WEIGHT_LOSS_DEFICIT,
  WEIGHT_GAIN_SURPLUS,
  MIN_SAFE_CALORIES,
  MAX_SAFE_CALORIES,
  PROTEIN_RATIO,
  CARBS_RATIO,
  FAT_RATIO,
  KCAL_PER_GRAM_PROTEIN,
  KCAL_PER_GRAM_CARBS,
  KCAL_PER_GRAM_FAT,
} from "../adaptive-goals";

import { storage } from "../../storage";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";

vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    getWeightLogs: vi.fn(),
    getUserProfile: vi.fn(),
  },
}));

describe("Adaptive Goals", () => {
  describe("named constants", () => {
    it("has expected nutritional constants", () => {
      expect(KCAL_PER_KG).toBe(7700);
      expect(WEIGHT_LOSS_DEFICIT).toBe(-500);
      expect(WEIGHT_GAIN_SURPLUS).toBe(300);
      expect(MIN_SAFE_CALORIES).toBe(1200);
      expect(MAX_SAFE_CALORIES).toBe(5000);
    });

    it("has expected macro split ratios that sum to 1", () => {
      expect(PROTEIN_RATIO).toBe(0.3);
      expect(CARBS_RATIO).toBe(0.4);
      expect(FAT_RATIO).toBe(0.3);
      expect(PROTEIN_RATIO + CARBS_RATIO + FAT_RATIO).toBeCloseTo(1.0);
    });

    it("has expected kcal-per-gram values", () => {
      expect(KCAL_PER_GRAM_PROTEIN).toBe(4);
      expect(KCAL_PER_GRAM_CARBS).toBe(4);
      expect(KCAL_PER_GRAM_FAT).toBe(9);
    });
  });

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

    it("returns default macro split when all macros are zero (division-by-zero guard)", () => {
      const current = { calories: 0, protein: 0, carbs: 0, fat: 0 };
      const result = recomputeMacros(current, 2000);

      // Should use default ratios: 30% protein, 40% carbs, 30% fat
      expect(result.protein).toBe(
        Math.round((2000 * PROTEIN_RATIO) / KCAL_PER_GRAM_PROTEIN),
      ); // 150
      expect(result.carbs).toBe(
        Math.round((2000 * CARBS_RATIO) / KCAL_PER_GRAM_CARBS),
      ); // 200
      expect(result.fat).toBe(
        Math.round((2000 * FAT_RATIO) / KCAL_PER_GRAM_FAT),
      ); // 67

      // Verify no NaN values
      expect(Number.isNaN(result.protein)).toBe(false);
      expect(Number.isNaN(result.carbs)).toBe(false);
      expect(Number.isNaN(result.fat)).toBe(false);
    });

    it("returns default macro split for zero macros at various calorie targets", () => {
      const zeroMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

      const at1200 = recomputeMacros(zeroMacros, 1200);
      expect(at1200.protein).toBe(Math.round((1200 * 0.3) / 4)); // 90
      expect(at1200.carbs).toBe(Math.round((1200 * 0.4) / 4)); // 120
      expect(at1200.fat).toBe(Math.round((1200 * 0.3) / 9)); // 40

      const at3000 = recomputeMacros(zeroMacros, 3000);
      expect(at3000.protein).toBe(Math.round((3000 * 0.3) / 4)); // 225
      expect(at3000.carbs).toBe(Math.round((3000 * 0.4) / 4)); // 300
      expect(at3000.fat).toBe(Math.round((3000 * 0.3) / 9)); // 100
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
      const result = determineReason("gain_weight", -1.0, -0.5, 14, 2500, 2800);

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
      const result = determineReason("lose_weight", -2.0, -1.0, 14, 2300, 1800);

      expect(result.reason).toBe("scheduled");
    });

    it("returns scheduled for gain_weight with positive change", () => {
      const result = determineReason("gain_weight", 1.0, 0.5, 14, 1800, 2100);

      expect(result.reason).toBe("scheduled");
    });

    it("requires weightChange strictly > 0 for exceeding_target (tie at 0)", () => {
      // At weightChange exactly 0 with a near-zero rate, lose_weight is a stall, not
      // exceeding. Kills the `weightChange > 0` -> `>= 0` boundary mutant.
      const result = determineReason("lose_weight", 0, 0, 14, 2000, 1700);
      expect(result.reason).toBe("weight_stall");
    });

    it("requires abs(weeklyRate) strictly < 0.1 for weight_stall (tie at 0.1)", () => {
      // At exactly 0.1 the rate is NOT a stall -> scheduled. Kills `< 0.1` -> `<= 0.1`.
      const result = determineReason("lose_weight", -0.5, 0.1, 14, 2100, 1700);
      expect(result.reason).toBe("scheduled");
    });

    it("requires weightChange strictly < 0 for undereating (tie at 0)", () => {
      // gain_weight with weightChange exactly 0 is NOT undereating -> scheduled.
      // Kills `weightChange < 0` -> `<= 0`.
      const result = determineReason("gain_weight", 0, 0, 14, 1800, 2100);
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
      vi.mocked(storage.getUser).mockResolvedValue(null as any);
      const result = await computeAdaptiveGoals("1");
      expect(result).toBeNull();
    });

    it("returns null when fewer than 4 weight logs", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: 2000,
      } as any);
      vi.mocked(storage.getWeightLogs).mockResolvedValue([
        { id: 1, userId: "1", weight: "80", loggedAt: "2025-01-01T12:00:00" },
        { id: 2, userId: "1", weight: "79.5", loggedAt: "2025-01-08T12:00:00" },
      ] as any);

      const result = await computeAdaptiveGoals("1");
      expect(result).toBeNull();
    });

    it("returns null when data span is less than 14 days", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: 2000,
      } as any);
      vi.mocked(storage.getWeightLogs).mockResolvedValue(
        makeWeightLogs([
          { weight: "80", loggedAt: "2025-01-01T12:00:00" },
          { weight: "79.8", loggedAt: "2025-01-03T12:00:00" },
          { weight: "79.6", loggedAt: "2025-01-05T12:00:00" },
          { weight: "79.4", loggedAt: "2025-01-07T12:00:00" },
        ]) as any,
      );

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
      } as any);
      vi.mocked(storage.getWeightLogs).mockResolvedValue(
        makeWeightLogs([
          { weight: "80.0", loggedAt: "2025-01-01T12:00:00" },
          { weight: "80.0", loggedAt: "2025-01-08T12:00:00" },
          { weight: "80.0", loggedAt: "2025-01-15T12:00:00" },
          { weight: "80.0", loggedAt: "2025-01-22T12:00:00" },
        ]) as any,
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        primaryGoal: "maintain",
      } as any);

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
      } as any);
      // Gained 2kg over 28 days
      vi.mocked(storage.getWeightLogs).mockResolvedValue(
        makeWeightLogs([
          { weight: "80", loggedAt: "2025-01-01T12:00:00" },
          { weight: "80.5", loggedAt: "2025-01-08T12:00:00" },
          { weight: "81", loggedAt: "2025-01-15T12:00:00" },
          { weight: "82", loggedAt: "2025-01-29T12:00:00" },
        ]) as any,
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        primaryGoal: "lose_weight",
      } as any);

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
      } as any);
      // Lost 2kg over 28 days while trying to gain
      vi.mocked(storage.getWeightLogs).mockResolvedValue(
        makeWeightLogs([
          { weight: "70", loggedAt: "2025-01-01T12:00:00" },
          { weight: "69.5", loggedAt: "2025-01-08T12:00:00" },
          { weight: "69", loggedAt: "2025-01-15T12:00:00" },
          { weight: "68", loggedAt: "2025-01-29T12:00:00" },
        ]) as any,
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        primaryGoal: "gain_weight",
      } as any);

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
      } as any);
      // Significant weight gain to trigger recommendation
      vi.mocked(storage.getWeightLogs).mockResolvedValue(
        makeWeightLogs([
          { weight: "80", loggedAt: "2025-01-01T12:00:00" },
          { weight: "81", loggedAt: "2025-01-08T12:00:00" },
          { weight: "82", loggedAt: "2025-01-15T12:00:00" },
          { weight: "84", loggedAt: "2025-01-29T12:00:00" },
        ]) as any,
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        primaryGoal: "lose_weight",
      } as any);

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
      } as any);
      // Large weight gain over 28 days → TDEE lower → deviation > 10%
      vi.mocked(storage.getWeightLogs).mockResolvedValue(
        makeWeightLogs([
          { weight: "80", loggedAt: "2025-01-01T12:00:00" },
          { weight: "81", loggedAt: "2025-01-08T12:00:00" },
          { weight: "82", loggedAt: "2025-01-15T12:00:00" },
          { weight: "84", loggedAt: "2025-01-29T12:00:00" },
        ]) as any,
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as any);

      const result = await computeAdaptiveGoals("1");
      // With maintain goal, adjustment = 0, but TDEE estimate should differ
      // enough to trigger a recommendation
      if (result) {
        expect(result.reason).toBe("scheduled");
      }
    });

    it("pins the exact recommendation for lose_weight after gaining 2kg over 28 days", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: 2500, // != default 2000, so the `|| default` is observable
        dailyProteinGoal: 150,
        dailyCarbsGoal: 250,
        dailyFatGoal: 67,
      } as any);
      vi.mocked(storage.getWeightLogs).mockResolvedValue(
        makeWeightLogs([
          { weight: "80", loggedAt: "2025-01-01T12:00:00" },
          { weight: "80.5", loggedAt: "2025-01-10T12:00:00" },
          { weight: "81.2", loggedAt: "2025-01-20T12:00:00" },
          { weight: "82", loggedAt: "2025-01-29T12:00:00" }, // +2kg over exactly 28d
        ]) as any,
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        primaryGoal: "lose_weight",
      } as any);

      const result = await computeAdaptiveGoals("1");

      // Triple-verified (hand + deterministic reference + oracle): tdee=1950,
      // rec=round(1950-500)=1450 (>=1200, no clamp), weeklyRate=(2/28)*7=0.5,
      // recompute(150,250,67 -> 1450) = 99/165/44.
      expect(result).not.toBeNull();
      expect(result!.previousCalories).toBe(2500);
      expect(result!.newCalories).toBe(1450);
      expect(result!.weightTrendRate).toBe(0.5);
      expect(result!.newProtein).toBe(99);
      expect(result!.newCarbs).toBe(165);
      expect(result!.newFat).toBe(44);
      expect(result!.reason).toBe("exceeding_target");
      expect(result!.explanation).toContain("2.0 kg");
      expect(result!.explanation).toContain("28 days");
      expect(result!.explanation).toContain("1450");

      // getWeightLogs queried with a ~28-day lookback `from` Date (kills {from}->{}
      // and the getDate()-28 window arithmetic): `from` is well in the past.
      const call = vi.mocked(storage.getWeightLogs).mock.calls[0];
      expect(call[0]).toBe("1");
      const fromArg = (call[1] as { from: Date }).from;
      expect(fromArg).toBeInstanceOf(Date);
      expect(Date.now() - fromArg.getTime()).toBeGreaterThan(20 * 86_400_000);
      expect(Date.now() - fromArg.getTime()).toBeLessThan(40 * 86_400_000);
    });

    it("proceeds at exactly 14 days of span and pins trend + macros", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: 2000,
        dailyProteinGoal: 100, // != default 150/250/67, so macro `|| default` is observable
        dailyCarbsGoal: 100,
        dailyFatGoal: 100,
      } as any);
      vi.mocked(storage.getWeightLogs).mockResolvedValue(
        makeWeightLogs([
          { weight: "80", loggedAt: "2025-01-01T12:00:00" },
          { weight: "79.3", loggedAt: "2025-01-06T12:00:00" },
          { weight: "78.6", loggedAt: "2025-01-11T12:00:00" },
          { weight: "78", loggedAt: "2025-01-15T12:00:00" }, // exactly 14 days
        ]) as any,
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        primaryGoal: "lose_weight",
      } as any);

      const result = await computeAdaptiveGoals("1");

      // daySpan = Jan1->Jan15 = exactly 14 -> `daySpan < 14` is false, proceeds;
      // the `<= 14` mutant would return null. Triple-verified: tdee=3100, rec=2600,
      // weeklyRate=(-2/14)*7=-1, recompute(100,100,100 -> 2600)=153/153/153.
      expect(result).not.toBeNull();
      expect(result!.newCalories).toBe(2600);
      expect(result!.weightTrendRate).toBe(-1);
      expect(result!.newProtein).toBe(153);
      expect(result!.newCarbs).toBe(153);
      expect(result!.newFat).toBe(153);
    });

    it("returns a recommendation at exactly 10% deviation (boundary)", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: 2000,
        dailyProteinGoal: 150,
        dailyCarbsGoal: 250,
        dailyFatGoal: 67,
      } as any);
      // maintain (adj 0); +0.726kg over 28d -> tdee≈1800.35 -> rec=1800 ->
      // deviation = |1800-2000|/2000 = exactly 0.10. `< 0.1` is false -> proceeds;
      // the `<= 0.1` mutant would return null.
      vi.mocked(storage.getWeightLogs).mockResolvedValue(
        makeWeightLogs([
          { weight: "80", loggedAt: "2025-01-01T12:00:00" },
          { weight: "80.2", loggedAt: "2025-01-10T12:00:00" },
          { weight: "80.5", loggedAt: "2025-01-20T12:00:00" },
          { weight: "80.726", loggedAt: "2025-01-29T12:00:00" },
        ]) as any,
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        primaryGoal: "maintain",
      } as any);

      const result = await computeAdaptiveGoals("1");
      expect(result).not.toBeNull();
      expect(result!.newCalories).toBe(1800);
    });

    it("sorts weight logs chronologically before picking first/last", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: 2500,
        dailyProteinGoal: 150,
        dailyCarbsGoal: 250,
        dailyFatGoal: 67,
      } as any);
      // Logs in NON-chronological array order. Correct sort -> first=Jan1(80),
      // last=Jan29(82): identical to the exact primary scenario (newCalories 1450).
      // A broken comparator picks array order and diverges.
      vi.mocked(storage.getWeightLogs).mockResolvedValue(
        makeWeightLogs([
          { weight: "82", loggedAt: "2025-01-29T12:00:00" },
          { weight: "80", loggedAt: "2025-01-01T12:00:00" },
          { weight: "81.2", loggedAt: "2025-01-20T12:00:00" },
          { weight: "80.5", loggedAt: "2025-01-10T12:00:00" },
        ]) as any,
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        primaryGoal: "lose_weight",
      } as any);

      const result = await computeAdaptiveGoals("1");
      expect(result).not.toBeNull();
      expect(result!.newCalories).toBe(1450);
      expect(result!.weightTrendRate).toBe(0.5);
    });

    it("falls back to DEFAULT_NUTRITION_GOALS when user goals are null", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: null,
        dailyProteinGoal: null,
        dailyCarbsGoal: null,
        dailyFatGoal: null,
      } as any);
      vi.mocked(storage.getWeightLogs).mockResolvedValue(
        makeWeightLogs([
          { weight: "80", loggedAt: "2025-01-01T12:00:00" },
          { weight: "81", loggedAt: "2025-01-10T12:00:00" },
          { weight: "82", loggedAt: "2025-01-20T12:00:00" },
          { weight: "84", loggedAt: "2025-01-29T12:00:00" },
        ]) as any,
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        primaryGoal: "lose_weight",
      } as any);

      const result = await computeAdaptiveGoals("1");
      // `user.X || DEFAULT.X` must fall back to the default when the user value is null;
      // the `||`->`&&` mutant would yield null here.
      expect(result).not.toBeNull();
      expect(result!.previousCalories).toBe(DEFAULT_NUTRITION_GOALS.calories);
      expect(result!.previousProtein).toBe(DEFAULT_NUTRITION_GOALS.protein);
      expect(result!.previousCarbs).toBe(DEFAULT_NUTRITION_GOALS.carbs);
      expect(result!.previousFat).toBe(DEFAULT_NUTRITION_GOALS.fat);
    });

    it("returns null with only 3 logs even when the span is >= 14 days", async () => {
      // The length guard (`< 4`) must fire BEFORE the span guard. 3 logs over 20 days
      // with a large weight change: real code returns null at the length guard; the
      // `if (false)` mutant would skip it, pass the span guard, and recommend.
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: 2000,
      } as any);
      vi.mocked(storage.getWeightLogs).mockResolvedValue(
        makeWeightLogs([
          { weight: "80", loggedAt: "2025-01-01T12:00:00" },
          { weight: "82", loggedAt: "2025-01-11T12:00:00" },
          { weight: "85", loggedAt: "2025-01-21T12:00:00" }, // 3 logs, span 20 days
        ]) as any,
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        primaryGoal: "maintain",
      } as any);

      const result = await computeAdaptiveGoals("1");
      expect(result).toBeNull();
    });

    it("treats deviation as a ratio (divide), returning null just under 10%", async () => {
      // maintain; lost 0.5kg over 28d -> tdee=2137.5 -> rec=2138 ->
      // deviation = |2138-2000|/2000 = 0.069 < 0.1 -> null. The `/ cur` -> `* cur`
      // mutant makes deviation huge (>= 0.1) and would recommend instead.
      vi.mocked(storage.getUser).mockResolvedValue({
        id: "1",
        dailyCalorieGoal: 2000,
        dailyProteinGoal: 150,
        dailyCarbsGoal: 250,
        dailyFatGoal: 67,
      } as any);
      vi.mocked(storage.getWeightLogs).mockResolvedValue(
        makeWeightLogs([
          { weight: "80", loggedAt: "2025-01-01T12:00:00" },
          { weight: "79.9", loggedAt: "2025-01-10T12:00:00" },
          { weight: "79.7", loggedAt: "2025-01-20T12:00:00" },
          { weight: "79.5", loggedAt: "2025-01-29T12:00:00" }, // -0.5kg over 28d
        ]) as any,
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        primaryGoal: "maintain",
      } as any);

      const result = await computeAdaptiveGoals("1");
      expect(result).toBeNull();
    });
  });
});
