import { describe, it, expect } from "vitest";
import {
  getCookPhotoAllergenState,
  getCookPhotoResultAnnouncement,
  ALLERGEN_CHECK_FAILED_NOTICE,
} from "../CookSessionCaptureScreen-utils";
import type { AllergenMatch } from "@shared/constants/allergens";

const match: AllergenMatch = {
  allergenId: "peanuts",
  severity: "severe",
  ingredientName: "peanut butter",
  matchedKeyword: "peanut",
  isDerived: false,
};

describe("getCookPhotoAllergenState", () => {
  it("is clear when the check ran and found nothing", () => {
    expect(
      getCookPhotoAllergenState({
        allergenWarnings: [],
        allergenCheckFailed: false,
      }),
    ).toEqual({ warnings: [], checkFailed: false });
  });

  it("defaults a legacy response missing both fields to clear", () => {
    expect(getCookPhotoAllergenState({})).toEqual({
      warnings: [],
      checkFailed: false,
    });
  });

  it("flags a failed check with no matches", () => {
    expect(
      getCookPhotoAllergenState({
        allergenWarnings: [],
        allergenCheckFailed: true,
      }),
    ).toEqual({ warnings: [], checkFailed: true });
  });

  it("passes matches through", () => {
    expect(
      getCookPhotoAllergenState({
        allergenWarnings: [match],
        allergenCheckFailed: false,
      }),
    ).toEqual({ warnings: [match], checkFailed: false });
  });

  it("shows matches rather than the failed notice when both are present", () => {
    expect(
      getCookPhotoAllergenState({
        allergenWarnings: [match],
        allergenCheckFailed: true,
      }),
    ).toEqual({ warnings: [match], checkFailed: false });
  });
});

// Accessibility audit 2026-11-06 H4/H5: the detection result was silent
// (haptic only), and the allergen-check-failed notice relied on an alert role
// + live region that only Android speaks.
describe("getCookPhotoResultAnnouncement", () => {
  const ok = { warnings: [], checkFailed: false };

  it("speaks the ingredient count, singular and plural", () => {
    expect(getCookPhotoResultAnnouncement(1, ok, "ios")).toBe(
      "1 ingredient detected.",
    );
    expect(getCookPhotoResultAnnouncement(3, ok, "android")).toBe(
      "3 ingredients detected.",
    );
  });

  it("says when no ingredients were found", () => {
    expect(getCookPhotoResultAnnouncement(0, ok, "ios")).toBe(
      "No ingredients detected.",
    );
  });

  it("adds the failed allergen check on iOS, where the notice's live region is silent", () => {
    const failed = { warnings: [], checkFailed: true };
    expect(getCookPhotoResultAnnouncement(2, failed, "ios")).toBe(
      `2 ingredients detected. ${ALLERGEN_CHECK_FAILED_NOTICE}`,
    );
  });

  // Phase 6 review: AllergenWarningBanner announces its matches on iOS from an
  // effect a commit later, and VoiceOver does not queue — it would cut the
  // count off. Leave the safety warning to speak alone.
  it("stays silent on iOS when the allergen banner will announce matches", () => {
    const matched = {
      warnings: [match],
      checkFailed: false,
    };
    expect(getCookPhotoResultAnnouncement(2, matched, "ios")).toBeNull();
    expect(getCookPhotoResultAnnouncement(2, matched, "android")).toBe(
      "2 ingredients detected.",
    );
  });

  it("leaves the failed allergen check to the notice's live region on Android", () => {
    const failed = { warnings: [], checkFailed: true };
    expect(getCookPhotoResultAnnouncement(2, failed, "android")).toBe(
      "2 ingredients detected.",
    );
  });
});
