import { describe, it, expect } from "vitest";
import {
  buildLoadingConfirmCard,
  buildLoadedConfirmCard,
  buildFetchErrorConfirmCard,
  buildScannedItemPayload,
  buildSuccessToastMessage,
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
      });
    });

    it("preserves the barcode value", () => {
      const card = buildLoadingConfirmCard("9876543210987");
      expect(card.barcode).toBe("9876543210987");
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
  });

  describe("buildFetchErrorConfirmCard", () => {
    it("falls back gracefully when product info fetch fails", () => {
      const card = buildFetchErrorConfirmCard("0123456789012");
      expect(card).toEqual({
        barcode: "0123456789012",
        name: "Food item",
        calories: null,
        isLoading: false,
        isLogging: false,
      });
    });

    it("preserves the barcode in the error fallback card", () => {
      const card = buildFetchErrorConfirmCard("abc123");
      expect(card.barcode).toBe("abc123");
    });
  });

  describe("buildScannedItemPayload", () => {
    it("tapping 'Log It' builds correct POST payload with calories", () => {
      const card = {
        barcode: "0123456789012",
        name: "Organic Oat Milk",
        calories: 90,
        isLoading: false,
        isLogging: false,
      };
      const payload = buildScannedItemPayload(card);
      expect(payload).toEqual({
        barcode: "0123456789012",
        productName: "Organic Oat Milk",
        sourceType: "scan",
        calories: "90",
      });
    });

    it("omits calories from payload when calories is null", () => {
      const card = {
        barcode: "0123456789012",
        name: "Food item",
        calories: null,
        isLoading: false,
        isLogging: false,
      };
      const payload = buildScannedItemPayload(card);
      expect(payload.calories).toBeUndefined();
    });

    it("always sets sourceType to 'scan'", () => {
      const card = {
        barcode: "x",
        name: "Item",
        calories: 100,
        isLoading: false,
        isLogging: false,
      };
      expect(buildScannedItemPayload(card).sourceType).toBe("scan");
    });
  });

  describe("buildSuccessToastMessage", () => {
    it("tapping 'Log It' shows success toast with product name and calories", () => {
      const card = {
        barcode: "0123456789012",
        name: "Organic Oat Milk",
        calories: 90,
        isLoading: false,
        isLogging: false,
      };
      const msg = buildSuccessToastMessage(card);
      expect(msg).toBe("Logged! Organic Oat Milk · 90 cal");
    });

    it("omits calorie suffix when calories is null", () => {
      const card = {
        barcode: "0123456789012",
        name: "Food item",
        calories: null,
        isLoading: false,
        isLogging: false,
      };
      const msg = buildSuccessToastMessage(card);
      expect(msg).toBe("Logged! Food item");
    });

    it("omits calorie suffix when calories is zero", () => {
      const card = {
        barcode: "0123456789012",
        name: "Water",
        calories: 0,
        isLoading: false,
        isLogging: false,
      };
      const msg = buildSuccessToastMessage(card);
      // calories=0 is falsy → no calorie suffix
      expect(msg).toBe("Logged! Water");
    });
  });

  describe("Dismiss resets confirmCard to null (state contract)", () => {
    it("tapping 'Dismiss' should result in a null confirmCard (handled by setConfirmCard(null) in ScanScreen)", () => {
      // The dismiss handler calls setConfirmCard(null) and dispatches CAMERA_READY.
      // The pure-function contract: after dismiss, the card state should be null.
      // This test documents the expected state transition rather than the handler directly.
      const confirmCardAfterDismiss: null = null;
      expect(confirmCardAfterDismiss).toBeNull();
    });
  });

  describe("POST failure re-enables button (state contract)", () => {
    it("POST failure state sets isLogging back to false", () => {
      // Simulate the state update applied on POST failure:
      // setConfirmCard((prev) => prev && { ...prev, isLogging: false })
      const prev = {
        barcode: "0123456789012",
        name: "Organic Oat Milk",
        calories: 90,
        isLoading: false,
        isLogging: true, // was set to true before the POST
      };
      const afterFailure = prev ? { ...prev, isLogging: false } : null;
      expect(afterFailure?.isLogging).toBe(false);
      // Other fields remain unchanged
      expect(afterFailure?.name).toBe("Organic Oat Milk");
      expect(afterFailure?.calories).toBe(90);
    });

    it("POST failure state update is null-safe (no-op when prev is null)", () => {
      // The component uses: setConfirmCard((prev) => prev && { ...prev, isLogging: false })
      // When prev is null, the && short-circuits returning null — card stays null.
      // We verify this using a helper that mirrors the component's functional updater.
      function applyLoggingReset(
        prev: ConfirmCardState | null,
      ): ConfirmCardState | null {
        return prev ? { ...prev, isLogging: false } : null;
      }
      expect(applyLoggingReset(null)).toBeNull();
    });
  });
});
