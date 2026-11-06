import type { AllergenMatch } from "@shared/constants/allergens";

/** Shown when the server could not run the allergen check for a cook photo. */
export const ALLERGEN_CHECK_FAILED_NOTICE =
  "Couldn't check these ingredients against your allergies. Review them yourself before cooking.";

export type CookPhotoAllergenState = {
  warnings: AllergenMatch[];
  /** True only when the check could not run AND nothing was matched. */
  checkFailed: boolean;
};

/**
 * Maps the photo-upload response's allergen fields to screen state. Missing
 * fields (older server) default to "nothing matched, check ran". Matches
 * still show when the check also failed; a failed check with no matches is
 * never presented as "no allergens".
 */
export function getCookPhotoAllergenState(result: {
  allergenWarnings?: AllergenMatch[];
  allergenCheckFailed?: boolean;
}): CookPhotoAllergenState {
  const warnings = result.allergenWarnings ?? [];
  return {
    warnings,
    checkFailed: result.allergenCheckFailed === true && warnings.length === 0,
  };
}

/**
 * What a screen reader hears when a cook photo finishes analysing — the
 * screen's only other result signal is a haptic. The allergen-check-failed
 * notice carries an assertive live region, which only Android speaks, so the
 * notice is appended on iOS alone (no double announce on Android). Allergen
 * matches are announced by AllergenWarningBanner itself — on iOS from an
 * effect a commit later, and VoiceOver does not queue, so it would cut this
 * off: return null there and let the safety warning speak alone.
 */
export function getCookPhotoResultAnnouncement(
  ingredientCount: number,
  allergenState: CookPhotoAllergenState,
  platform: string,
): string | null {
  if (platform === "ios" && allergenState.warnings.length > 0) return null;
  const count =
    ingredientCount === 0
      ? "No ingredients detected."
      : `${ingredientCount} ingredient${ingredientCount === 1 ? "" : "s"} detected.`;
  return allergenState.checkFailed && platform === "ios"
    ? `${count} ${ALLERGEN_CHECK_FAILED_NOTICE}`
    : count;
}
