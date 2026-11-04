import { describe, it, expect } from "vitest";
import { getCookPhotoAllergenState } from "../CookSessionCaptureScreen-utils";
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
