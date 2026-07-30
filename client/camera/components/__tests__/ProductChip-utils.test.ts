// client/camera/components/__tests__/ProductChip-utils.test.ts
import { describe, it, expect } from "vitest";
import {
  getBarcodeLockActions,
  getChipAnnounceText,
  getProductChipVariant,
  getShutterClearanceStyle,
  getSmartConfirmLabel,
  getChipConfidenceLabel,
  getChipConfidenceColor,
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

  // Deliberate, not incidental: LABEL_PROMPTED means "chip collapsed, go frame
  // the panel". A null variant hides the chip, which is exactly the intent — so
  // assert it rather than leaving it to the `default` arm by accident.
  it("returns null for LABEL_PROMPTED so the chip collapses out of the way", () => {
    expect(
      getProductChipVariant({ type: "LABEL_PROMPTED", barcode: "123" }),
    ).toBeNull();
  });
});

describe("getShutterClearanceStyle", () => {
  // Regression guard for P2-2026-07-15: session_complete used to stay
  // flush-bottom (no `bottom` override), which both left the shutter overlap
  // unresolved for that phase and caused an instant jump on the transition
  // into it. The function no longer takes a `variant` param at all — every
  // phase (including session_complete) now gets this same insets-derived
  // offset, which is what makes both bugs disappear.
  it("raises the chip by insetsBottom + 96", () => {
    expect(getShutterClearanceStyle(0)).toEqual({ bottom: 96 });
    expect(getShutterClearanceStyle(34)).toEqual({ bottom: 130 });
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
      "Product found, choose how to continue",
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

describe("getChipConfidenceLabel", () => {
  it("returns High confidence at and above 0.8", () => {
    expect(getChipConfidenceLabel(0.8)).toBe("High confidence");
    expect(getChipConfidenceLabel(1)).toBe("High confidence");
  });

  it("returns Good match at and above 0.5, below 0.8", () => {
    expect(getChipConfidenceLabel(0.5)).toBe("Good match");
    expect(getChipConfidenceLabel(0.79)).toBe("Good match");
  });

  it("returns Possible match below 0.5", () => {
    expect(getChipConfidenceLabel(0.49)).toBe("Possible match");
    expect(getChipConfidenceLabel(0)).toBe("Possible match");
  });
});

describe("getChipConfidenceColor", () => {
  it("returns green for high confidence", () => {
    expect(getChipConfidenceColor(0.9)).toBe("#4CD964");
  });

  it("returns amber for medium confidence", () => {
    expect(getChipConfidenceColor(0.6)).toBe("#FFD60A");
  });

  it("returns a neutral overlay tone for low confidence, not an alarming color", () => {
    expect(getChipConfidenceColor(0.2)).toBe("rgba(255,255,255,0.5)");
  });
});

describe("getBarcodeLockActions", () => {
  it("offers the fast path as primary when the product is already verified", () => {
    const actions = getBarcodeLockActions("verified");
    expect(actions.primary).toEqual({
      label: "Use verified data →",
      intent: "confirmProduct",
    });
    expect(actions.secondary).toEqual({
      label: "Photograph label instead",
      intent: "proceedToLabel",
    });
  });

  it("requires the label step as primary when the data is unverified", () => {
    const actions = getBarcodeLockActions("unverified");
    expect(actions.primary).toEqual({
      label: "Scan Nutrition Facts →",
      intent: "proceedToLabel",
    });
    expect(actions.secondary).toEqual({
      label: "Use database data anyway",
      intent: "confirmProduct",
    });
  });

  // The chip renders BEFORE the product fetch resolves, so this is a real
  // runtime state, not a defensive branch. Defaulting to the verified fast path
  // would let a user one-tap past the label step on a product whose data is
  // actually unverified — reintroducing the wrong-calorie bug through a race.
  it("treats an unloaded verificationLevel as unverified, never as verified", () => {
    expect(getBarcodeLockActions(undefined)).toEqual(
      getBarcodeLockActions("unverified"),
    );
  });

  // `VerificationLevel` is `"unverified" | "single_verified" | "verified"`
  // (shared/types/verification.ts). Only the fully-verified state earns the fast
  // path — matching how NutritionDetailScreen already gates on `!== "verified"`.
  it("requires the label step for single_verified, not just unverified", () => {
    expect(getBarcodeLockActions("single_verified")).toEqual(
      getBarcodeLockActions("unverified"),
    );
  });

  // The old announcement told screen-reader users that tapping views details.
  // It ended the session instead.
  it("announces the barcode_lock chip as an action on the product, not a detail view", () => {
    const phase: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
      product: { name: "Cherry Coke" },
    };
    expect(getChipAnnounceText("barcode_lock", phase)).toBe(
      "Product found, choose how to continue",
    );
  });
});
