import { describe, it, expect } from "vitest";
import {
  deriveLogGate,
  getServingContextLabel,
  roundToOneDecimal,
} from "../nutrition-detail-utils";

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

  describe("roundToOneDecimal", () => {
    it("rounds to the nearest one-decimal value", () => {
      expect(roundToOneDecimal(2.34)).toBe(2.3);
      expect(roundToOneDecimal(2.36)).toBe(2.4);
    });

    it("preserves a value that already has one decimal", () => {
      expect(roundToOneDecimal(3.5)).toBe(3.5);
    });

    it("does not round a sub-one-gram value down to zero", () => {
      expect(roundToOneDecimal(0.4)).toBe(0.4);
    });

    it("passes through a whole number unchanged", () => {
      expect(roundToOneDecimal(40)).toBe(40);
    });
  });

  describe("deriveLogGate", () => {
    it("stays open when the label was read and used", () => {
      expect(
        deriveLogGate({ ocrText: "Calories 140", labelUsed: true }),
      ).toEqual({ kind: "open" });
    });

    it("requires acknowledgement when a label was captured but unreadable", () => {
      expect(deriveLogGate({ ocrText: null, labelUsed: false })).toEqual({
        kind: "needsAcknowledgement",
        buttonLabel: "Review values before logging",
      });
    });

    it("requires acknowledgement when a label was read but the values were unusable", () => {
      expect(
        deriveLogGate({ ocrText: "Nutrition Facts", labelUsed: false }),
      ).toEqual({
        kind: "needsAcknowledgement",
        buttonLabel: "Review values before logging",
      });
    });

    // Load-bearing. A barcode-only session never promised to use a label, so
    // gating it would warn on the happy path and train the user to dismiss the
    // warning — which is exactly how the silent wrong-calorie path stayed
    // invisible. `undefined` means no label step ran.
    it("stays open for a barcode-only session", () => {
      expect(deriveLogGate({ ocrText: undefined, labelUsed: false })).toEqual({
        kind: "open",
      });
    });

    it("stays open for a barcode-only session even if labelUsed is somehow true", () => {
      expect(deriveLogGate({ ocrText: undefined, labelUsed: true })).toEqual({
        kind: "open",
      });
    });
  });
});
