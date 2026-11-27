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
  getFoundCardActionBeats,
  getSmartResultCopy,
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
  });

  it("returns classifying for CLASSIFYING", () => {
    expect(getProductChipVariant({ type: "CLASSIFYING", imageUri: "x" })).toBe(
      "classifying",
    );
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
  // the panel". A null variant hides the chip, which is exactly the intent —
  // so assert it rather than trusting it silently. `getProductChipVariant` has
  // no `default` arm; LABEL_PROMPTED is its own explicit case.
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

  it("announces the smart result copy title (no ✓) then its sub-line", () => {
    expect(
      getChipAnnounceText(
        "smart_photo",
        smartConfirmed({ foods: [], contentType: "restaurant_menu" }),
      ),
    ).toBe("Looks like a menu. We'll pull out the dishes for you");
    expect(
      getChipAnnounceText(
        "smart_photo",
        smartConfirmed({
          foods: [food("Grilled chicken")],
          contentType: "prepared_meal",
        }),
      ),
    ).toBe("Looks like a meal. We'll estimate what's on the plate");
  });

  it("announces the busy card for the classifying variant", () => {
    expect(getChipAnnounceText("classifying", idle)).toBe(
      "Working out what this is…",
    );
  });

  it("keeps the static announce strings for all other variants, with no ✓ read aloud", () => {
    expect(getChipAnnounceText("barcode_lock", idle)).toBe(
      "Barcode found, choose how to continue",
    );
    expect(getChipAnnounceText("step2_review", idle)).toBe(
      "Label captured, review or retake",
    );
    expect(getChipAnnounceText("step2_confirmed", idle)).toBe(
      "Nutrition values confirmed",
    );
    expect(getChipAnnounceText("step3_review", idle)).toBe(
      "Front captured, review or retake",
    );
    expect(getChipAnnounceText("session_complete", idle)).toBe("Scan complete");
    expect(getChipAnnounceText("smart_error", idle)).toBe(
      "Couldn't tell what this is",
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
  // QuickLogDrawer's returnAfterLog: barcode -> found card -> log, with no
  // photo steps (spec "Entry and routing").
  it("goes straight to logging for returnAfterLog, with no photo-step action", () => {
    for (const level of ["verified", "unverified", undefined] as const) {
      const actions = getBarcodeLockActions(level, { returnAfterLog: true });
      expect(actions.primary).toEqual({
        label: "Log it →",
        intent: "confirmProduct",
      });
      expect(actions.secondary).toBeNull();
    }
  });

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
      label: "Next: nutrition →",
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
      "Barcode found, choose how to continue",
    );
  });
});

describe("getFoundCardActionBeats", () => {
  // Spec motion plan, "Found card": card body first, then the buttons a beat
  // later; the reduced-motion column is "fade only".
  it("brings the button row in after the card body, then the link", () => {
    const beats = getFoundCardActionBeats(false);
    expect(beats.rowDelay).toBeGreaterThan(0);
    expect(beats.linkDelay).toBeGreaterThan(beats.rowDelay);
    expect(beats.travel).toBeGreaterThan(0);
  });

  it("settles the last button within half a second of the card starting", () => {
    // A thumb takes longer than this to reach the card, so the buttons are
    // still before anyone can press them.
    expect(getFoundCardActionBeats(false).linkDelay).toBeLessThanOrEqual(250);
  });

  it("drops the stagger and the travel under reduced motion", () => {
    expect(getFoundCardActionBeats(true)).toEqual({
      rowDelay: 0,
      linkDelay: 0,
      travel: 0,
    });
  });
});

describe("getSmartResultCopy", () => {
  const copy = (
    contentType: PhotoAnalysisResponse["contentType"],
    barcode?: string | null,
  ) => getSmartResultCopy({ contentType, barcode });

  it("prepared_meal", () => {
    expect(copy("prepared_meal")).toEqual({
      kind: "found",
      title: "Looks like a meal ✓",
      sub: "We'll estimate what's on the plate",
    });
  });
  it("nutrition_label", () => {
    expect(copy("nutrition_label")).toEqual({
      kind: "found",
      title: "Looks like a nutrition label ✓",
      sub: "We'll read the panel for you",
    });
  });
  it("restaurant_menu", () => {
    expect(copy("restaurant_menu")).toEqual({
      kind: "found",
      title: "Looks like a menu ✓",
      sub: "We'll pull out the dishes for you",
    });
  });
  it("raw_ingredients", () => {
    expect(copy("raw_ingredients")).toEqual({
      kind: "found",
      title: "Looks like ingredients ✓",
      sub: "We'll start a Cook & Track session",
    });
  });
  it("both receipt types", () => {
    const want = {
      kind: "found",
      title: "Looks like a receipt ✓",
      sub: "You'll snap it in the receipt camera",
    };
    expect(copy("grocery_receipt")).toEqual(want);
    expect(copy("restaurant_receipt")).toEqual(want);
  });
  it("has_barcode with a valid number shows the number", () => {
    expect(copy("has_barcode", "0064144043512")).toEqual({
      kind: "found",
      title: "Looks like a barcode ✓",
      sub: "0064144043512",
    });
  });
  it("has_barcode without a valid number", () => {
    expect(copy("has_barcode", "12")).toEqual({
      kind: "found",
      title: "Looks like a barcode",
      sub: "Couldn't read the number. Let's scan it live",
    });
    expect(copy("has_barcode", null).sub).toBe(
      "Couldn't read the number. Let's scan it live",
    );
  });
  it("non_food is unclear", () => {
    expect(copy("non_food")).toEqual({
      kind: "unclear",
      title: "Couldn't tell what this is",
      sub: "Try again, or pick what you're scanning",
    });
  });
  it("missing contentType falls back to food", () => {
    expect(copy(undefined)).toEqual({
      kind: "found",
      title: "Looks like food ✓",
      sub: "We'll estimate what's on the plate",
    });
  });
});
