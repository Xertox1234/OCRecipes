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
