import { describe, it, expect } from "vitest";
import {
  contentTypes,
  contentTypeSchema,
  classifiedResultSchema,
  isValidBarcode,
  CONTENT_TYPE_TO_INTENT,
} from "../classification";

describe("classification constants", () => {
  describe("contentTypes", () => {
    it("includes all expected content types", () => {
      expect(contentTypes).toContain("prepared_meal");
      expect(contentTypes).toContain("nutrition_label");
      expect(contentTypes).toContain("restaurant_menu");
      expect(contentTypes).toContain("raw_ingredients");
      expect(contentTypes).toContain("grocery_receipt");
      expect(contentTypes).toContain("restaurant_receipt");
      expect(contentTypes).toContain("non_food");
      expect(contentTypes).toContain("has_barcode");
    });
  });

  describe("contentTypeSchema", () => {
    it("accepts valid content types", () => {
      expect(contentTypeSchema.safeParse("prepared_meal").success).toBe(true);
      expect(contentTypeSchema.safeParse("non_food").success).toBe(true);
    });

    it("rejects invalid content types", () => {
      expect(contentTypeSchema.safeParse("invalid").success).toBe(false);
      expect(contentTypeSchema.safeParse("").success).toBe(false);
    });
  });

  describe("classifiedResultSchema", () => {
    it("validates a complete classification result", () => {
      const result = classifiedResultSchema.safeParse({
        contentType: "prepared_meal",
        confidence: 0.85,
        barcode: null,
      });
      expect(result.success).toBe(true);
    });

    it("validates result with barcode", () => {
      const result = classifiedResultSchema.safeParse({
        contentType: "has_barcode",
        confidence: 0.92,
        barcode: "0123456789012",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.barcode).toBe("0123456789012");
      }
    });

    it("defaults barcode to null when not provided", () => {
      const result = classifiedResultSchema.safeParse({
        contentType: "prepared_meal",
        confidence: 0.8,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.barcode).toBeNull();
      }
    });

    it("rejects confidence out of range", () => {
      expect(
        classifiedResultSchema.safeParse({
          contentType: "prepared_meal",
          confidence: 1.5,
        }).success,
      ).toBe(false);

      expect(
        classifiedResultSchema.safeParse({
          contentType: "prepared_meal",
          confidence: -0.1,
        }).success,
      ).toBe(false);
    });

    it("rejects invalid content type", () => {
      expect(
        classifiedResultSchema.safeParse({
          contentType: "unknown",
          confidence: 0.5,
        }).success,
      ).toBe(false);
    });
  });

  describe("isValidBarcode", () => {
    it("accepts valid EAN-13", () => {
      expect(isValidBarcode("4006381333931")).toBe(true);
    });

    it("accepts valid EAN-8", () => {
      expect(isValidBarcode("96385074")).toBe(true);
    });

    it("accepts valid UPC-A", () => {
      expect(isValidBarcode("036000291452")).toBe(true);
    });

    it("accepts valid UPC-E (6 digits)", () => {
      expect(isValidBarcode("123456")).toBe(true);
    });

    it("rejects barcodes with letters", () => {
      expect(isValidBarcode("abc123")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isValidBarcode("")).toBe(false);
    });

    it("rejects too-long barcodes", () => {
      expect(isValidBarcode("12345678901234")).toBe(false);
    });
  });

  describe("CONTENT_TYPE_TO_INTENT", () => {
    it("maps prepared_meal to log", () => {
      expect(CONTENT_TYPE_TO_INTENT.prepared_meal).toBe("log");
    });

    it("maps nutrition_label to label", () => {
      expect(CONTENT_TYPE_TO_INTENT.nutrition_label).toBe("label");
    });

    it("maps restaurant_menu to menu", () => {
      expect(CONTENT_TYPE_TO_INTENT.restaurant_menu).toBe("menu");
    });

    it("maps raw_ingredients to recipe", () => {
      expect(CONTENT_TYPE_TO_INTENT.raw_ingredients).toBe("recipe");
    });

    it("maps receipts and non_food to null", () => {
      expect(CONTENT_TYPE_TO_INTENT.grocery_receipt).toBeNull();
      expect(CONTENT_TYPE_TO_INTENT.restaurant_receipt).toBeNull();
      expect(CONTENT_TYPE_TO_INTENT.non_food).toBeNull();
      expect(CONTENT_TYPE_TO_INTENT.has_barcode).toBeNull();
    });
  });
});
