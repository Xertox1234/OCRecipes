import { describe, it, expect } from "vitest";
import {
  valuesMatch,
  compareWithVerifications,
  nutritionMatches,
  computeConsensus,
  extractVerificationNutrition,
  CONSENSUS_THRESHOLD,
  type VerificationNutrition,
} from "../verification-comparison";

describe("verification-comparison", () => {
  describe("valuesMatch", () => {
    it("returns true for identical values", () => {
      expect(valuesMatch(200, 200)).toBe(true);
    });

    it("returns true for values within 5%", () => {
      expect(valuesMatch(200, 210)).toBe(true); // 5% of 210 = 10.5
      expect(valuesMatch(200, 190)).toBe(true); // 5% of 200 = 10
    });

    it("returns false for values outside 5%", () => {
      expect(valuesMatch(200, 220)).toBe(false); // 10% diff
      expect(valuesMatch(100, 120)).toBe(false);
    });

    it("returns true for both zero", () => {
      expect(valuesMatch(0, 0)).toBe(true);
    });

    it("handles very small values with absolute tolerance", () => {
      expect(valuesMatch(0, 1)).toBe(true); // within 1 absolute
      expect(valuesMatch(1, 0)).toBe(true);
      expect(valuesMatch(0, 2)).toBe(false); // outside 1 absolute
    });

    it("handles exact same floating point", () => {
      expect(valuesMatch(12.5, 12.5)).toBe(true);
    });
  });

  describe("nutritionMatches", () => {
    it("returns true when all fields match within tolerance", () => {
      const a: VerificationNutrition = {
        calories: 200,
        protein: 15,
        totalCarbs: 25,
        totalFat: 8,
      };
      const b: VerificationNutrition = {
        calories: 205,
        protein: 15,
        totalCarbs: 24,
        totalFat: 8,
      };
      expect(nutritionMatches(a, b)).toBe(true);
    });

    it("returns false when any field is outside tolerance", () => {
      const a: VerificationNutrition = {
        calories: 200,
        protein: 15,
        totalCarbs: 25,
        totalFat: 8,
      };
      const b: VerificationNutrition = {
        calories: 300, // 50% diff
        protein: 15,
        totalCarbs: 25,
        totalFat: 8,
      };
      expect(nutritionMatches(a, b)).toBe(false);
    });

    it("ignores null fields", () => {
      const a: VerificationNutrition = {
        calories: 200,
        protein: null,
        totalCarbs: 25,
        totalFat: null,
      };
      const b: VerificationNutrition = {
        calories: 205,
        protein: 30, // would mismatch but a.protein is null
        totalCarbs: 24,
        totalFat: 10,
      };
      expect(nutritionMatches(a, b)).toBe(true);
    });

    it("returns true when all fields are null", () => {
      const a: VerificationNutrition = {
        calories: null,
        protein: null,
        totalCarbs: null,
        totalFat: null,
      };
      const b: VerificationNutrition = {
        calories: null,
        protein: null,
        totalCarbs: null,
        totalFat: null,
      };
      expect(nutritionMatches(a, b)).toBe(true);
    });
  });

  describe("compareWithVerifications", () => {
    it("returns match for first verification (empty existing)", () => {
      const extracted: VerificationNutrition = {
        calories: 200,
        protein: 15,
        totalCarbs: 25,
        totalFat: 8,
      };
      const result = compareWithVerifications(extracted, []);
      expect(result.isMatch).toBe(true);
      expect(result.matchCount).toBe(0);
    });

    it("returns match when values agree with existing", () => {
      const extracted: VerificationNutrition = {
        calories: 200,
        protein: 15,
        totalCarbs: 25,
        totalFat: 8,
      };
      const existing: VerificationNutrition[] = [
        { calories: 205, protein: 15, totalCarbs: 24, totalFat: 8 },
      ];
      const result = compareWithVerifications(extracted, existing);
      expect(result.isMatch).toBe(true);
      expect(result.matchCount).toBe(1);
    });

    it("returns no match when values disagree", () => {
      const extracted: VerificationNutrition = {
        calories: 200,
        protein: 15,
        totalCarbs: 25,
        totalFat: 8,
      };
      const existing: VerificationNutrition[] = [
        { calories: 400, protein: 30, totalCarbs: 50, totalFat: 16 },
      ];
      const result = compareWithVerifications(extracted, existing);
      expect(result.isMatch).toBe(false);
      expect(result.matchCount).toBe(0);
    });

    it("matches against multiple existing and counts matches", () => {
      const extracted: VerificationNutrition = {
        calories: 200,
        protein: 15,
        totalCarbs: 25,
        totalFat: 8,
      };
      const existing: VerificationNutrition[] = [
        { calories: 205, protein: 15, totalCarbs: 24, totalFat: 8 }, // matches
        { calories: 400, protein: 30, totalCarbs: 50, totalFat: 16 }, // doesn't match
      ];
      const result = compareWithVerifications(extracted, existing);
      expect(result.isMatch).toBe(true);
      expect(result.matchCount).toBe(1);
    });
  });

  describe("computeConsensus", () => {
    it("averages values from multiple verifications", () => {
      const verifications: VerificationNutrition[] = [
        { calories: 200, protein: 15, totalCarbs: 25, totalFat: 8 },
        { calories: 210, protein: 15, totalCarbs: 24, totalFat: 8 },
        { calories: 205, protein: 16, totalCarbs: 25, totalFat: 9 },
      ];
      const consensus = computeConsensus(verifications);
      expect(consensus.calories).toBe(205); // (200+210+205)/3 = 205
      expect(consensus.protein).toBeCloseTo(15.3, 1);
      expect(consensus.carbs).toBeCloseTo(24.7, 1);
      expect(consensus.fat).toBeCloseTo(8.3, 1);
    });

    it("handles null values by averaging only non-null entries", () => {
      const verifications: VerificationNutrition[] = [
        { calories: 200, protein: null, totalCarbs: 25, totalFat: 8 },
        { calories: 210, protein: 15, totalCarbs: null, totalFat: 8 },
      ];
      const consensus = computeConsensus(verifications);
      expect(consensus.calories).toBe(205);
      expect(consensus.protein).toBe(15); // only one value
      expect(consensus.carbs).toBe(25); // only one value
      expect(consensus.fat).toBe(8);
    });

    it("returns zeros for empty verifications", () => {
      const consensus = computeConsensus([]);
      expect(consensus).toEqual({
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
      });
    });
  });

  describe("extractVerificationNutrition", () => {
    it("extracts core 4 fields from label data", () => {
      const result = extractVerificationNutrition({
        calories: 200,
        protein: 15,
        totalCarbs: 25,
        totalFat: 8,
      });
      expect(result).toEqual({
        calories: 200,
        protein: 15,
        totalCarbs: 25,
        totalFat: 8,
      });
    });

    it("converts undefined to null", () => {
      const result = extractVerificationNutrition({});
      expect(result).toEqual({
        calories: null,
        protein: null,
        totalCarbs: null,
        totalFat: null,
      });
    });
  });

  describe("CONSENSUS_THRESHOLD", () => {
    it("is 3", () => {
      expect(CONSENSUS_THRESHOLD).toBe(3);
    });
  });
});
