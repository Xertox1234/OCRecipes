// client/camera/components/__tests__/ProductChip-utils.test.ts
import { describe, it, expect } from "vitest";
import {
  getChipAnnounceText,
  getProductChipVariant,
  getSmartConfirmLabel,
} from "../ProductChip-utils";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";
import type { ScanPhase } from "../../types/scan-phase";

const BOUNDS = { x: 0.4, y: 0.45, width: 0.2, height: 0.1 };

describe("getProductChipVariant", () => {
  it("returns null when chip should not show", () => {
    expect(getProductChipVariant({ type: "IDLE" })).toBeNull();
    expect(getProductChipVariant({ type: "HUNTING" })).toBeNull();
    expect(
      getProductChipVariant({
        type: "BARCODE_TRACKING",
        barcode: "123",
        bounds: BOUNDS,
        frameCount: 3,
      }),
    ).toBeNull();
    expect(
      getProductChipVariant({ type: "CLASSIFYING", imageUri: "x" }),
    ).toBeNull();
    expect(
      getProductChipVariant({ type: "STEP2_CAPTURING", barcode: "123" }),
    ).toBeNull();
    expect(
      getProductChipVariant({
        type: "STEP3_CAPTURING",
        barcode: "123",
        nutritionImageUri: "x",
        ocrText: "",
      }),
    ).toBeNull();
  });

  it("returns barcode_lock for BARCODE_LOCKED", () => {
    expect(
      getProductChipVariant({
        type: "BARCODE_LOCKED",
        barcode: "123",
        bounds: BOUNDS,
      }),
    ).toBe("barcode_lock");
  });

  it("returns step2_review for STEP2_REVIEWING", () => {
    expect(
      getProductChipVariant({
        type: "STEP2_REVIEWING",
        barcode: "123",
        imageUri: "x",
        ocrText: "",
      }),
    ).toBe("step2_review");
  });

  it("returns step2_confirmed for STEP2_CONFIRMED", () => {
    expect(
      getProductChipVariant({
        type: "STEP2_CONFIRMED",
        barcode: "123",
        nutritionImageUri: "x",
        ocrText: "",
      }),
    ).toBe("step2_confirmed");
  });

  it("returns step3_review for STEP3_REVIEWING", () => {
    expect(
      getProductChipVariant({
        type: "STEP3_REVIEWING",
        barcode: "123",
        nutritionImageUri: "x",
        ocrText: "",
        frontImageUri: "y",
      }),
    ).toBe("step3_review");
  });

  it("returns smart_photo for SMART_CONFIRMED", () => {
    expect(
      getProductChipVariant({
        type: "SMART_CONFIRMED",
        imageUri: "x",
        classification: {} as any,
      }),
    ).toBe("smart_photo");
  });

  it("returns smart_error for SMART_ERROR", () => {
    expect(
      getProductChipVariant({
        type: "SMART_ERROR",
        imageUri: "x",
        error: "err",
      }),
    ).toBe("smart_error");
  });

  it("returns session_complete for SESSION_COMPLETE", () => {
    expect(
      getProductChipVariant({ type: "SESSION_COMPLETE", barcode: "123" }),
    ).toBe("session_complete");
  });
});

describe("getSmartConfirmLabel", () => {
  const food = (name: string): PhotoAnalysisResponse["foods"][number] => ({
    name,
    quantity: "1 serving",
    confidence: 0.9,
    needsClarification: false,
    nutrition: null,
  });

  it("returns the first food name when foods are present", () => {
    expect(
      getSmartConfirmLabel({
        foods: [food("Grilled chicken"), food("Rice")],
        contentType: "prepared_meal",
      }),
    ).toBe("Grilled chicken");
  });

  it("ignores contentType when a food name exists", () => {
    expect(
      getSmartConfirmLabel({
        foods: [food("Spaghetti")],
        contentType: "restaurant_menu",
      }),
    ).toBe("Spaghetti");
  });

  it("derives a content-type label when foods are empty", () => {
    expect(
      getSmartConfirmLabel({ foods: [], contentType: "restaurant_menu" }),
    ).toBe("Restaurant menu detected");
    expect(
      getSmartConfirmLabel({ foods: [], contentType: "grocery_receipt" }),
    ).toBe("Grocery receipt detected");
    expect(
      getSmartConfirmLabel({ foods: [], contentType: "raw_ingredients" }),
    ).toBe("Ingredients detected");
  });

  it("falls back to 'Food detected' when no foods and no contentType", () => {
    expect(getSmartConfirmLabel({ foods: [], contentType: undefined })).toBe(
      "Food detected",
    );
    expect(getSmartConfirmLabel({ foods: [] })).toBe("Food detected");
  });
});

describe("getChipAnnounceText", () => {
  const food = (name: string): PhotoAnalysisResponse["foods"][number] => ({
    name,
    quantity: "1 serving",
    confidence: 0.9,
    needsClarification: false,
    nutrition: null,
  });

  const smartConfirmed = (
    classification: Pick<PhotoAnalysisResponse, "foods" | "contentType">,
  ): ScanPhase => ({
    type: "SMART_CONFIRMED",
    imageUri: "x",
    classification: classification as PhotoAnalysisResponse,
  });

  // Non-smart_photo variants never read `phase`, so an IDLE placeholder is fine.
  const idle: ScanPhase = { type: "IDLE" };

  it("derives the smart_photo announce from the content-type label when foods are empty", () => {
    expect(
      getChipAnnounceText(
        "smart_photo",
        smartConfirmed({ foods: [], contentType: "restaurant_menu" }),
      ),
    ).toBe("Restaurant menu detected, tap to confirm");
    expect(
      getChipAnnounceText(
        "smart_photo",
        smartConfirmed({ foods: [], contentType: "grocery_receipt" }),
      ),
    ).toBe("Grocery receipt detected, tap to confirm");
  });

  it("announces the food name for a food-bearing smart_photo classification", () => {
    expect(
      getChipAnnounceText(
        "smart_photo",
        smartConfirmed({
          foods: [food("Grilled chicken")],
          contentType: "prepared_meal",
        }),
      ),
    ).toBe("Grilled chicken, tap to confirm");
  });

  it("keeps the static announce strings for all other variants", () => {
    expect(getChipAnnounceText("barcode_lock", idle)).toBe(
      "Product found, tap to view details",
    );
    expect(getChipAnnounceText("step2_review", idle)).toBe(
      "Nutrition label scanned, review values",
    );
    expect(getChipAnnounceText("step2_confirmed", idle)).toBe(
      "Nutrition values confirmed",
    );
    expect(getChipAnnounceText("step3_review", idle)).toBe(
      "Front label scanned, review values",
    );
    expect(getChipAnnounceText("session_complete", idle)).toBe("Scan complete");
    expect(getChipAnnounceText("smart_error", idle)).toBe(
      "Couldn't identify this food, try again",
    );
  });

  it("falls back to the generic smart_photo string when the phase is not SMART_CONFIRMED", () => {
    expect(getChipAnnounceText("smart_photo", idle)).toBe(
      "Photo analyzed, tap to confirm",
    );
  });
});
