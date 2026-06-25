import { describe, it, expect, vi } from "vitest";
import {
  getRouteForContentType,
  shouldAutoRoute,
  getConfirmationMessage,
  getContentTypeLabel,
  getPremiumGate,
  resolveMenuLocalOCRText,
  resolveSmartConfirmAction,
} from "../scan-screen-utils";
import { logger } from "@/lib/logger";
import { TIER_FEATURES } from "@shared/types/premium";

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

    it("routes restaurant_menu to the dedicated MenuScanResult screen", () => {
      const route = getRouteForContentType(
        "restaurant_menu",
        "/tmp/menu.jpg",
        null,
        null,
      );
      expect(route).toEqual({
        screen: "MenuScanResult",
        params: { imageUri: "/tmp/menu.jpg", localOCRText: undefined },
      });
    });

    it("forwards localOCRText to MenuScanResult when provided", () => {
      const route = getRouteForContentType(
        "restaurant_menu",
        "/tmp/menu.jpg",
        null,
        null,
        "Burger $10\nFries $4",
      );
      expect(route).toEqual({
        screen: "MenuScanResult",
        params: {
          imageUri: "/tmp/menu.jpg",
          localOCRText: "Burger $10\nFries $4",
        },
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
        params: undefined,
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
        params: undefined,
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

  describe("resolveMenuLocalOCRText", () => {
    it("returns recognized text for restaurant_menu", async () => {
      const recognize = vi
        .fn()
        .mockResolvedValue({ text: "Burger $10\nFries $4" });
      const result = await resolveMenuLocalOCRText(
        "restaurant_menu",
        "/tmp/menu.jpg",
        recognize,
      );
      expect(recognize).toHaveBeenCalledWith("/tmp/menu.jpg");
      expect(result).toBe("Burger $10\nFries $4");
    });

    it("skips OCR and returns undefined for non-menu content", async () => {
      const recognize = vi.fn();
      const result = await resolveMenuLocalOCRText(
        "prepared_meal",
        "/tmp/meal.jpg",
        recognize,
      );
      expect(recognize).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("returns undefined when OCR yields empty text", async () => {
      const recognize = vi.fn().mockResolvedValue({ text: "" });
      const result = await resolveMenuLocalOCRText(
        "restaurant_menu",
        "/tmp/menu.jpg",
        recognize,
      );
      expect(result).toBeUndefined();
    });

    it("returns undefined and logs when OCR throws (non-fatal)", async () => {
      const errorSpy = vi
        .spyOn(logger, "error")
        .mockImplementation(() => undefined);
      const recognize = vi.fn().mockRejectedValue(new Error("mlkit boom"));
      const result = await resolveMenuLocalOCRText(
        "restaurant_menu",
        "/tmp/menu.jpg",
        recognize,
      );
      expect(result).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledOnce();
      errorSpy.mockRestore();
    });
  });

  describe("resolveSmartConfirmAction", () => {
    const menuAllowed = { ...TIER_FEATURES.free, menuScanner: true };
    const menuBlocked = { ...TIER_FEATURES.free, menuScanner: false };
    const live = () => true;

    it("navigates to PhotoAnalysis (no OCR) when contentType is absent", async () => {
      const recognize = vi.fn();
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: undefined,
          resolvedIntent: "log",
          barcode: null,
        },
        imageUri: "/tmp/x.jpg",
        features: menuAllowed,
        recognizeText: recognize,
        isStillLive: live,
      });
      expect(recognize).not.toHaveBeenCalled();
      expect(action).toEqual({
        kind: "navigate",
        route: {
          screen: "PhotoAnalysis",
          params: { imageUri: "/tmp/x.jpg", intent: "log" },
        },
      });
    });

    it("returns blocked (no OCR) when the content type's premium feature is off", async () => {
      const recognize = vi.fn();
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "restaurant_menu",
          resolvedIntent: null,
          barcode: null,
        },
        imageUri: "/tmp/menu.jpg",
        features: menuBlocked,
        recognizeText: recognize,
        isStillLive: live,
      });
      expect(recognize).not.toHaveBeenCalled();
      expect(action).toEqual({
        kind: "blocked",
        gate: { feature: "menuScanner", label: "Menu scanning" },
      });
    });

    it("computes OCR and navigates to MenuScanResult with localOCRText for an allowed menu", async () => {
      const recognize = vi.fn().mockResolvedValue({ text: "Burger $10" });
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "restaurant_menu",
          resolvedIntent: null,
          barcode: null,
        },
        imageUri: "/tmp/menu.jpg",
        features: menuAllowed,
        recognizeText: recognize,
        isStillLive: live,
      });
      expect(recognize).toHaveBeenCalledWith("/tmp/menu.jpg");
      expect(action).toEqual({
        kind: "navigate",
        route: {
          screen: "MenuScanResult",
          params: { imageUri: "/tmp/menu.jpg", localOCRText: "Burger $10" },
        },
      });
    });

    it("aborts (no navigation) when the user left the screen during OCR", async () => {
      const recognize = vi.fn().mockResolvedValue({ text: "Burger $10" });
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "restaurant_menu",
          resolvedIntent: null,
          barcode: null,
        },
        imageUri: "/tmp/menu.jpg",
        features: menuAllowed,
        recognizeText: recognize,
        isStillLive: () => false,
      });
      expect(recognize).toHaveBeenCalled();
      expect(action).toEqual({ kind: "abort" });
    });

    it("navigates a non-menu type without invoking OCR", async () => {
      const recognize = vi.fn();
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "prepared_meal",
          resolvedIntent: "log",
          barcode: null,
        },
        imageUri: "/tmp/meal.jpg",
        features: menuAllowed,
        recognizeText: recognize,
        isStillLive: live,
      });
      expect(recognize).not.toHaveBeenCalled();
      expect(action).toEqual({
        kind: "navigate",
        route: {
          screen: "PhotoAnalysis",
          params: { imageUri: "/tmp/meal.jpg", intent: "log" },
        },
      });
    });

    it("returns unrecognized when the route resolves to null (has_barcode without a barcode)", async () => {
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "has_barcode",
          resolvedIntent: null,
          barcode: null,
        },
        imageUri: "/tmp/x.jpg",
        features: menuAllowed,
        recognizeText: vi.fn(),
        isStillLive: live,
      });
      expect(action).toEqual({ kind: "unrecognized" });
    });

    it("returns unrecognized (no OCR) for non_food content", async () => {
      const recognize = vi.fn();
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "non_food",
          resolvedIntent: null,
          barcode: null,
        },
        imageUri: "/tmp/x.jpg",
        features: menuAllowed,
        recognizeText: recognize,
        isStillLive: live,
      });
      expect(recognize).not.toHaveBeenCalled();
      expect(action).toEqual({ kind: "unrecognized" });
    });

    it("navigates without localOCRText when menu OCR throws (non-fatal)", async () => {
      const errorSpy = vi
        .spyOn(logger, "error")
        .mockImplementation(() => undefined);
      const recognize = vi.fn().mockRejectedValue(new Error("boom"));
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "restaurant_menu",
          resolvedIntent: null,
          barcode: null,
        },
        imageUri: "/tmp/menu.jpg",
        features: menuAllowed,
        recognizeText: recognize,
        isStillLive: live,
      });
      expect(action).toEqual({
        kind: "navigate",
        route: {
          screen: "MenuScanResult",
          params: { imageUri: "/tmp/menu.jpg", localOCRText: undefined },
        },
      });
      errorSpy.mockRestore();
    });
  });
});
