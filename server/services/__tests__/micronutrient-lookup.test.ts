import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getDailyValueReference,
  aggregateMicronutrients,
  TRACKED_NUTRIENTS,
  lookupMicronutrientsWithCache,
  batchLookupMicronutrients,
  type MicronutrientData,
} from "../micronutrient-lookup";

vi.mock("../../storage", () => ({
  storage: {
    getMicronutrientCache: vi.fn(),
    setMicronutrientCache: vi.fn(),
  },
}));

import { storage } from "../../storage";

describe("Micronutrient Lookup", () => {
  describe("TRACKED_NUTRIENTS", () => {
    it("contains standard vitamins", () => {
      expect(TRACKED_NUTRIENTS["Vitamin A"]).toBeDefined();
      expect(TRACKED_NUTRIENTS["Vitamin C"]).toBeDefined();
      expect(TRACKED_NUTRIENTS["Vitamin D"]).toBeDefined();
      expect(TRACKED_NUTRIENTS["Vitamin E"]).toBeDefined();
      expect(TRACKED_NUTRIENTS["Vitamin K"]).toBeDefined();
      expect(TRACKED_NUTRIENTS["Vitamin B12"]).toBeDefined();
    });

    it("contains standard minerals", () => {
      expect(TRACKED_NUTRIENTS["Calcium"]).toBeDefined();
      expect(TRACKED_NUTRIENTS["Iron"]).toBeDefined();
      expect(TRACKED_NUTRIENTS["Magnesium"]).toBeDefined();
      expect(TRACKED_NUTRIENTS["Potassium"]).toBeDefined();
      expect(TRACKED_NUTRIENTS["Zinc"]).toBeDefined();
    });

    it("has positive daily values for all nutrients", () => {
      for (const [name, config] of Object.entries(TRACKED_NUTRIENTS)) {
        expect(config.dailyValue).toBeGreaterThan(0);
        expect(config.id).toBeGreaterThan(0);
        expect(config.unit).toBeTruthy();
      }
    });

    it("uses correct units for vitamins", () => {
      expect(TRACKED_NUTRIENTS["Vitamin C"].unit).toBe("mg");
      expect(TRACKED_NUTRIENTS["Vitamin D"].unit).toBe("mcg");
      expect(TRACKED_NUTRIENTS["Vitamin B12"].unit).toBe("mcg");
    });

    it("uses correct daily values for key nutrients", () => {
      expect(TRACKED_NUTRIENTS["Vitamin C"].dailyValue).toBe(90);
      expect(TRACKED_NUTRIENTS["Calcium"].dailyValue).toBe(1300);
      expect(TRACKED_NUTRIENTS["Iron"].dailyValue).toBe(18);
      expect(TRACKED_NUTRIENTS["Potassium"].dailyValue).toBe(4700);
    });
  });

  describe("getDailyValueReference", () => {
    it("returns all tracked nutrients", () => {
      const ref = getDailyValueReference();
      const trackedNames = Object.keys(TRACKED_NUTRIENTS);
      expect(Object.keys(ref)).toEqual(trackedNames);
    });

    it("returns unit and dailyValue for each nutrient", () => {
      const ref = getDailyValueReference();
      for (const [name, data] of Object.entries(ref)) {
        expect(data).toHaveProperty("unit");
        expect(data).toHaveProperty("dailyValue");
        expect(typeof data.unit).toBe("string");
        expect(typeof data.dailyValue).toBe("number");
      }
    });

    it("matches TRACKED_NUTRIENTS daily values", () => {
      const ref = getDailyValueReference();
      expect(ref["Vitamin C"].dailyValue).toBe(90);
      expect(ref["Calcium"].dailyValue).toBe(1300);
      expect(ref["Iron"].dailyValue).toBe(18);
    });
  });

  describe("aggregateMicronutrients", () => {
    it("returns empty array for empty input", () => {
      const result = aggregateMicronutrients([]);
      expect(result).toEqual([]);
    });

    it("returns single item's nutrients unchanged", () => {
      const input: MicronutrientData[][] = [
        [
          {
            nutrientName: "Vitamin C",
            amount: 45,
            unit: "mg",
            percentDailyValue: 50,
          },
        ],
      ];
      const result = aggregateMicronutrients(input);
      expect(result).toHaveLength(1);
      expect(result[0].nutrientName).toBe("Vitamin C");
      expect(result[0].amount).toBe(45);
      expect(result[0].percentDailyValue).toBe(50);
    });

    it("sums the same nutrient across multiple food items", () => {
      const input: MicronutrientData[][] = [
        [
          {
            nutrientName: "Vitamin C",
            amount: 45,
            unit: "mg",
            percentDailyValue: 50,
          },
        ],
        [
          {
            nutrientName: "Vitamin C",
            amount: 30,
            unit: "mg",
            percentDailyValue: 33,
          },
        ],
      ];
      const result = aggregateMicronutrients(input);
      expect(result).toHaveLength(1);
      expect(result[0].nutrientName).toBe("Vitamin C");
      expect(result[0].amount).toBe(75);
      // Recalculated: 75/90 * 100 = 83
      expect(result[0].percentDailyValue).toBe(83);
    });

    it("handles multiple different nutrients", () => {
      const input: MicronutrientData[][] = [
        [
          {
            nutrientName: "Vitamin C",
            amount: 45,
            unit: "mg",
            percentDailyValue: 50,
          },
          {
            nutrientName: "Iron",
            amount: 5,
            unit: "mg",
            percentDailyValue: 28,
          },
        ],
        [
          {
            nutrientName: "Calcium",
            amount: 200,
            unit: "mg",
            percentDailyValue: 15,
          },
        ],
      ];
      const result = aggregateMicronutrients(input);
      expect(result).toHaveLength(3);
      const names = result.map((r) => r.nutrientName);
      expect(names).toContain("Vitamin C");
      expect(names).toContain("Iron");
      expect(names).toContain("Calcium");
    });

    it("sorts results by percentDailyValue descending", () => {
      const input: MicronutrientData[][] = [
        [
          {
            nutrientName: "Iron",
            amount: 2,
            unit: "mg",
            percentDailyValue: 11,
          },
          {
            nutrientName: "Vitamin C",
            amount: 90,
            unit: "mg",
            percentDailyValue: 100,
          },
          {
            nutrientName: "Calcium",
            amount: 100,
            unit: "mg",
            percentDailyValue: 8,
          },
        ],
      ];
      const result = aggregateMicronutrients(input);
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].percentDailyValue).toBeGreaterThanOrEqual(
          result[i].percentDailyValue,
        );
      }
    });

    it("handles empty sub-arrays gracefully", () => {
      const input: MicronutrientData[][] = [
        [],
        [
          {
            nutrientName: "Iron",
            amount: 5,
            unit: "mg",
            percentDailyValue: 28,
          },
        ],
        [],
      ];
      const result = aggregateMicronutrients(input);
      expect(result).toHaveLength(1);
      expect(result[0].nutrientName).toBe("Iron");
    });

    it("rounds amounts to 2 decimal places", () => {
      const input: MicronutrientData[][] = [
        [
          {
            nutrientName: "Vitamin C",
            amount: 33.333,
            unit: "mg",
            percentDailyValue: 37,
          },
        ],
        [
          {
            nutrientName: "Vitamin C",
            amount: 33.333,
            unit: "mg",
            percentDailyValue: 37,
          },
        ],
      ];
      const result = aggregateMicronutrients(input);
      // 33.333 + 33.333 = 66.666, rounded to 66.67
      expect(result[0].amount).toBe(66.67);
    });
  });

  describe("lookupMicronutrientsWithCache", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.mocked(storage.getMicronutrientCache).mockReset();
      vi.mocked(storage.setMicronutrientCache).mockReset();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("returns cached data when available", async () => {
      const cachedData: MicronutrientData[] = [
        { nutrientName: "Vitamin C", amount: 90, unit: "mg", percentDailyValue: 100 },
      ];
      vi.mocked(storage.getMicronutrientCache).mockResolvedValue(cachedData);

      const result = await lookupMicronutrientsWithCache("orange");
      expect(result).toEqual(cachedData);
      expect(storage.getMicronutrientCache).toHaveBeenCalledWith("orange");
    });

    it("fetches from USDA on cache miss and caches result", async () => {
      vi.mocked(storage.getMicronutrientCache).mockResolvedValue(null);
      vi.mocked(storage.setMicronutrientCache).mockResolvedValue(undefined as any);

      const usdaResponse = {
        foods: [
          {
            fdcId: 12345,
            description: "Orange, raw",
            foodNutrients: [
              { nutrientId: 1162, nutrientName: "Vitamin C", value: 53.2, unitName: "mg" },
              { nutrientId: 1087, nutrientName: "Calcium", value: 40, unitName: "mg" },
              { nutrientId: 9999, nutrientName: "Untracked", value: 5, unitName: "mg" },
            ],
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(usdaResponse),
      });

      const result = await lookupMicronutrientsWithCache("orange");
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((n) => n.nutrientName === "Vitamin C")).toBe(true);
      expect(storage.setMicronutrientCache).toHaveBeenCalled();
    });

    it("returns empty array on USDA API failure", async () => {
      vi.mocked(storage.getMicronutrientCache).mockResolvedValue(null);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await lookupMicronutrientsWithCache("unknown food xyz");
      expect(result).toEqual([]);
    });

    it("returns empty array when USDA returns no foods", async () => {
      vi.mocked(storage.getMicronutrientCache).mockResolvedValue(null);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ foods: [] }),
      });

      const result = await lookupMicronutrientsWithCache("nonexistent");
      expect(result).toEqual([]);
    });

    it("does not cache empty results", async () => {
      vi.mocked(storage.getMicronutrientCache).mockResolvedValue(null);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ foods: [] }),
      });

      await lookupMicronutrientsWithCache("nothing");
      expect(storage.setMicronutrientCache).not.toHaveBeenCalled();
    });

    it("handles fetch error gracefully", async () => {
      vi.mocked(storage.getMicronutrientCache).mockResolvedValue(null);
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const result = await lookupMicronutrientsWithCache("error food");
      expect(result).toEqual([]);
    });
  });

  describe("batchLookupMicronutrients", () => {

    beforeEach(() => {
      vi.mocked(storage.getMicronutrientCache).mockReset();
    });

    it("returns array of results for each food name", async () => {
      const cachedA: MicronutrientData[] = [
        { nutrientName: "Iron", amount: 5, unit: "mg", percentDailyValue: 28 },
      ];
      const cachedB: MicronutrientData[] = [
        { nutrientName: "Calcium", amount: 200, unit: "mg", percentDailyValue: 15 },
      ];
      vi.mocked(storage.getMicronutrientCache)
        .mockResolvedValueOnce(cachedA)
        .mockResolvedValueOnce(cachedB);

      const results = await batchLookupMicronutrients(["spinach", "milk"]);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(cachedA);
      expect(results[1]).toEqual(cachedB);
    });

    it("handles empty food names array", async () => {
      const results = await batchLookupMicronutrients([]);
      expect(results).toEqual([]);
    });
  });
});
