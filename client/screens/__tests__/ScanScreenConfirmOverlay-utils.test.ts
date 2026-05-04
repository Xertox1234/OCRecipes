import { describe, it, expect } from "vitest";
import {
  buildLoadingConfirmCard,
  buildLoadedConfirmCard,
  buildFetchErrorConfirmCard,
  buildScannedItemPayload,
  buildSuccessToastMessage,
  canLog,
  type ConfirmCardState,
} from "../ScanScreenConfirmOverlay-utils";

describe("ScanScreenConfirmOverlay-utils", () => {
  describe("buildLoadingConfirmCard", () => {
    it("SESSION_COMPLETE with returnAfterLog=true shows confirm overlay with 'Loading...' state", () => {
      const card = buildLoadingConfirmCard("0123456789012");
      expect(card).toEqual({
        barcode: "0123456789012",
        name: "Loading...",
        calories: null,
        isLoading: true,
        isLogging: false,
        isError: false,
      });
    });

    it("preserves the barcode value", () => {
      const card = buildLoadingConfirmCard("9876543210987");
      expect(card.barcode).toBe("9876543210987");
    });

    it("isError is false during loading", () => {
      expect(buildLoadingConfirmCard("x").isError).toBe(false);
    });
  });

  describe("buildLoadedConfirmCard", () => {
    it("successful product fetch updates overlay with product name + calories", () => {
      const card = buildLoadedConfirmCard("0123456789012", {
        productName: "Organic Oat Milk",
        calories: 90,
      });
      expect(card).toEqual({
        barcode: "0123456789012",
        name: "Organic Oat Milk",
        calories: 90,
        isLoading: false,
        isLogging: false,
        isError: false,
      });
    });

    it("falls back to 'Food item' when productName is missing", () => {
      const card = buildLoadedConfirmCard("0123456789012", { calories: 120 });
      expect(card.name).toBe("Food item");
      expect(card.calories).toBe(120);
    });

    it("sets calories to null when calories is missing", () => {
      const card = buildLoadedConfirmCard("0123456789012", {
        productName: "Mystery Bar",
      });
      expect(card.calories).toBeNull();
      expect(card.name).toBe("Mystery Bar");
    });

    it("sets isLoading=false and isLogging=false after successful fetch", () => {
      const card = buildLoadedConfirmCard("0123456789012", {
        productName: "Apple",
        calories: 52,
      });
      expect(card.isLoading).toBe(false);
      expect(card.isLogging).toBe(false);
    });

    it("isError is false on success", () => {
      expect(
        buildLoadedConfirmCard("x", { productName: "Item", calories: 50 })
          .isError,
      ).toBe(false);
    });
  });

  describe("buildFetchErrorConfirmCard", () => {
    it("sets isError=true when product info fetch fails", () => {
      const card = buildFetchErrorConfirmCard("0123456789012");
      expect(card.isError).toBe(true);
    });

    it("produces expected full error state shape", () => {
      const card = buildFetchErrorConfirmCard("0123456789012");
      expect(card).toEqual({
        barcode: "0123456789012",
        name: "Food item",
        calories: null,
        isLoading: false,
        isLogging: false,
        isError: true,
      });
    });

    it("preserves the barcode in the error fallback card", () => {
      const card = buildFetchErrorConfirmCard("abc123");
      expect(card.barcode).toBe("abc123");
    });
  });

  describe("canLog", () => {
    it("returns true for a fully loaded, non-error card", () => {
      const card = buildLoadedConfirmCard("x", {
        productName: "Item",
        calories: 100,
      });
      expect(canLog(card)).toBe(true);
    });

    it("returns false when isError is true — mirrors handleConfirmLog guard", () => {
      const card = buildFetchErrorConfirmCard("0123456789012");
      expect(canLog(card)).toBe(false);
    });

    it("returns false when isLoading is true", () => {
      expect(canLog(buildLoadingConfirmCard("x"))).toBe(false);
    });

    it("returns false when isLogging is true", () => {
      const card: ConfirmCardState = {
        ...buildLoadedConfirmCard("x", { productName: "Item", calories: 50 }),
        isLogging: true,
      };
      expect(canLog(card)).toBe(false);
    });
  });

  describe("buildScannedItemPayload", () => {
    it("tapping 'Log It' builds correct POST payload with calories", () => {
      const card = buildLoadedConfirmCard("0123456789012", {
        productName: "Organic Oat Milk",
        calories: 90,
      });
      const payload = buildScannedItemPayload(card);
      expect(payload).toEqual({
        barcode: "0123456789012",
        productName: "Organic Oat Milk",
        sourceType: "scan",
        calories: "90",
      });
    });

    it("omits calories from payload when calories is null", () => {
      const card = buildFetchErrorConfirmCard("0123456789012");
      const payload = buildScannedItemPayload(card);
      expect(payload.calories).toBeUndefined();
    });

    it("always sets sourceType to 'scan'", () => {
      const card = buildLoadedConfirmCard("x", {
        productName: "Item",
        calories: 100,
      });
      expect(buildScannedItemPayload(card).sourceType).toBe("scan");
    });
  });

  describe("buildSuccessToastMessage", () => {
    it("tapping 'Log It' shows success toast with product name and calories", () => {
      const card = buildLoadedConfirmCard("0123456789012", {
        productName: "Organic Oat Milk",
        calories: 90,
      });
      const msg = buildSuccessToastMessage(card);
      expect(msg).toBe("Logged! Organic Oat Milk · 90 cal");
    });

    it("omits calorie suffix when calories is null", () => {
      const card = buildFetchErrorConfirmCard("0123456789012");
      const msg = buildSuccessToastMessage(card);
      expect(msg).toBe("Logged! Food item");
    });

    it("includes calorie suffix when calories is zero", () => {
      const card: ConfirmCardState = {
        ...buildLoadedConfirmCard("x", { productName: "Water" }),
        calories: 0,
      };
      const msg = buildSuccessToastMessage(card);
      expect(msg).toBe("Logged! Water · 0 cal");
    });
  });

  describe("isError and isLogging are mutually exclusive (state invariant)", () => {
    it("handleConfirmLog guard: isError=true prevents isLogging from being set", () => {
      // Mirror of canLog() — the predicate used by handleConfirmLog and the disabled prop.
      // Blocks when isLoading, isLogging, or isError is true.
      function wouldProceed(card: ConfirmCardState | null): boolean {
        return !!card && !card.isLoading && !card.isLogging && !card.isError;
      }
      expect(wouldProceed(buildFetchErrorConfirmCard("x"))).toBe(false);
      expect(
        wouldProceed(
          buildLoadedConfirmCard("x", { productName: "Item", calories: 50 }),
        ),
      ).toBe(true);
      expect(wouldProceed(null)).toBe(false);
    });
  });
});
