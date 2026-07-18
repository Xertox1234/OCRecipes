import { describe, it, expect } from "vitest";
import { getServingContextLabel } from "../nutrition-detail-utils";

const OPTIONS = [
  { label: "250 ml", grams: 250 },
  { label: "1 tbsp (12 g)", grams: 12 },
  { label: "100 g", grams: 100 },
];

describe("nutrition-detail-utils", () => {
  describe("getServingContextLabel", () => {
    it("uses the matching serving option's label with the quantity prefix", () => {
      expect(
        getServingContextLabel({
          servingQuantity: 1,
          servingSizeGrams: 250,
          servingOptions: OPTIONS,
          isPer100g: false,
        }),
      ).toBe("1 × 250 ml");
    });

    it("matches an option within the 0.1 g tolerance used by the chips", () => {
      expect(
        getServingContextLabel({
          servingQuantity: 1,
          servingSizeGrams: 250.05,
          servingOptions: OPTIONS,
          isPer100g: false,
        }),
      ).toBe("1 × 250 ml");
    });

    it("formats fractional quantities to one decimal", () => {
      expect(
        getServingContextLabel({
          servingQuantity: 1.5,
          servingSizeGrams: 12,
          servingOptions: OPTIONS,
          isPer100g: false,
        }),
      ).toBe("1.5 × 1 tbsp (12 g)");
    });

    it("falls back to raw grams for a custom serving size", () => {
      expect(
        getServingContextLabel({
          servingQuantity: 2,
          servingSizeGrams: 75,
          servingOptions: OPTIONS,
          isPer100g: false,
        }),
      ).toBe("2 × 75 g");
    });

    it("returns 100 g when no serving is selected and data is per-100g", () => {
      expect(
        getServingContextLabel({
          servingQuantity: 1,
          servingSizeGrams: null,
          servingOptions: OPTIONS,
          isPer100g: true,
        }),
      ).toBe("100 g");
    });

    it("returns serving when no serving is selected and data is per-serving", () => {
      expect(
        getServingContextLabel({
          servingQuantity: 1,
          servingSizeGrams: null,
          servingOptions: [],
          isPer100g: false,
        }),
      ).toBe("serving");
    });
  });
});
