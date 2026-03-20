import { describe, it, expect } from "vitest";
import {
  getRouteForContentType,
  shouldAutoRoute,
  getConfirmationMessage,
  getContentTypeLabel,
  getPremiumGate,
} from "../scan-screen-utils";

describe("scan-screen-utils", () => {
  describe("getRouteForContentType", () => {
    it("routes prepared_meal to PhotoAnalysis with log intent", () => {
      const route = getRouteForContentType(
        "prepared_meal",
        "/tmp/photo.jpg",
        "log",
        null,
      );
      expect(route).toEqual({
        screen: "PhotoAnalysis",
        params: { imageUri: "/tmp/photo.jpg", intent: "log" },
      });
    });

    it("routes nutrition_label to LabelAnalysis", () => {
      const route = getRouteForContentType(
        "nutrition_label",
        "/tmp/label.jpg",
        "label",
        null,
      );
      expect(route).toEqual({
        screen: "LabelAnalysis",
        params: { imageUri: "/tmp/label.jpg" },
      });
    });

    it("routes restaurant_menu to PhotoAnalysis with menu intent", () => {
      const route = getRouteForContentType(
        "restaurant_menu",
        "/tmp/menu.jpg",
        "menu",
        null,
      );
      expect(route).toEqual({
        screen: "PhotoAnalysis",
        params: { imageUri: "/tmp/menu.jpg", intent: "menu" },
      });
    });

    it("routes raw_ingredients to CookSessionCapture", () => {
      const route = getRouteForContentType(
        "raw_ingredients",
        "/tmp/ingredients.jpg",
        "recipe",
        null,
      );
      expect(route).toEqual({
        screen: "CookSessionCapture",
        params: { initialPhotoUri: "/tmp/ingredients.jpg" },
      });
    });

    it("routes has_barcode to NutritionDetail when barcode present", () => {
      const route = getRouteForContentType(
        "has_barcode",
        "/tmp/barcode.jpg",
        null,
        "0123456789012",
      );
      expect(route).toEqual({
        screen: "NutritionDetail",
        params: { barcode: "0123456789012" },
      });
    });

    it("returns null for has_barcode without barcode value", () => {
      const route = getRouteForContentType(
        "has_barcode",
        "/tmp/barcode.jpg",
        null,
        null,
      );
      expect(route).toBeNull();
    });

    it("returns null for non_food", () => {
      const route = getRouteForContentType(
        "non_food",
        "/tmp/cat.jpg",
        null,
        null,
      );
      expect(route).toBeNull();
    });

    it("routes grocery_receipt to ReceiptCapture", () => {
      const route = getRouteForContentType(
        "grocery_receipt",
        "/tmp/receipt.jpg",
        null,
        null,
      );
      expect(route).toEqual({
        screen: "ReceiptCapture",
        params: {},
      });
    });

    it("routes restaurant_receipt to ReceiptCapture", () => {
      const route = getRouteForContentType(
        "restaurant_receipt",
        "/tmp/receipt.jpg",
        null,
        null,
      );
      expect(route).toEqual({
        screen: "ReceiptCapture",
        params: {},
      });
    });

    it("defaults to log intent when resolvedIntent is null for prepared_meal", () => {
      const route = getRouteForContentType(
        "prepared_meal",
        "/tmp/photo.jpg",
        null,
        null,
      );
      expect(route?.params).toEqual({
        imageUri: "/tmp/photo.jpg",
        intent: "log",
      });
    });
  });

  describe("shouldAutoRoute", () => {
    it("returns true for confidence >= 0.7", () => {
      expect(shouldAutoRoute(0.7)).toBe(true);
      expect(shouldAutoRoute(0.85)).toBe(true);
      expect(shouldAutoRoute(1.0)).toBe(true);
    });

    it("returns false for confidence < 0.7", () => {
      expect(shouldAutoRoute(0.69)).toBe(false);
      expect(shouldAutoRoute(0.5)).toBe(false);
      expect(shouldAutoRoute(0)).toBe(false);
    });
  });

  describe("getConfirmationMessage", () => {
    it("returns a user-friendly confirmation for each content type", () => {
      expect(getConfirmationMessage("prepared_meal")).toContain("meal");
      expect(getConfirmationMessage("nutrition_label")).toContain("label");
      expect(getConfirmationMessage("restaurant_menu")).toContain("menu");
      expect(getConfirmationMessage("non_food")).toContain("not food");
    });

    it("asks if the classification is correct", () => {
      const msg = getConfirmationMessage("prepared_meal");
      expect(msg).toContain("Is that right?");
    });
  });

  describe("getContentTypeLabel", () => {
    it("returns readable labels for all content types", () => {
      expect(getContentTypeLabel("prepared_meal")).toBe("Meal");
      expect(getContentTypeLabel("nutrition_label")).toBe("Nutrition label");
      expect(getContentTypeLabel("restaurant_menu")).toBe("Restaurant menu");
      expect(getContentTypeLabel("raw_ingredients")).toBe("Ingredients");
      expect(getContentTypeLabel("grocery_receipt")).toBe("Grocery receipt");
      expect(getContentTypeLabel("restaurant_receipt")).toBe(
        "Restaurant receipt",
      );
      expect(getContentTypeLabel("non_food")).toBe("Not food");
      expect(getContentTypeLabel("has_barcode")).toBe("Barcode");
    });
  });

  describe("getPremiumGate", () => {
    it("returns gate info for premium content types", () => {
      expect(getPremiumGate("restaurant_menu")).toEqual({
        feature: "menuScanner",
        label: "Menu scanning",
      });
      expect(getPremiumGate("raw_ingredients")).toEqual({
        feature: "cookAndTrack",
        label: "Cook & Track",
      });
      expect(getPremiumGate("grocery_receipt")).toEqual({
        feature: "receiptScanner",
        label: "Receipt scanning",
      });
    });

    it("returns null for non-premium content types", () => {
      expect(getPremiumGate("prepared_meal")).toBeNull();
      expect(getPremiumGate("nutrition_label")).toBeNull();
      expect(getPremiumGate("non_food")).toBeNull();
      expect(getPremiumGate("has_barcode")).toBeNull();
    });
  });
});
