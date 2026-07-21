import type { AllergySeverity } from "@shared/constants/allergens";

/**
 * Fill opacity for `withOpacity(color, ...)` on the badge background — a
 * named export (not an inline literal in the component) so the WCAG
 * contrast test in `__tests__/badge-contrast.test.ts` asserts against the
 * value passed to `withOpacity`, with no risk of the two drifting apart.
 * (`withOpacity` itself rounds the alpha to a quantized byte — an
 * immaterial sub-1% difference against the >=4.6:1 margins these tokens
 * carry.)
 */
export const ALLERGEN_BADGE_FILL_OPACITY = 0.1;

/** WCAG-safe badge text/icon token (see client/constants/theme.ts). */
export type AllergenBadgeColorKey =
  | "badgeErrorText"
  | "badgeWarningText"
  | "badgeInfoText";

export type AllergenBadgeIcon = "alert-triangle" | "alert-circle" | "info";

interface AllergenBadgeVisuals {
  colorKey: AllergenBadgeColorKey;
  icon: AllergenBadgeIcon;
}

const VISUALS: Record<AllergySeverity, AllergenBadgeVisuals> = {
  severe: { colorKey: "badgeErrorText", icon: "alert-triangle" },
  moderate: { colorKey: "badgeWarningText", icon: "alert-circle" },
  mild: { colorKey: "badgeInfoText", icon: "info" },
};

/** Maps allergen severity to its WCAG-safe badge color token + icon. */
export function getAllergenBadgeVisuals(
  severity: AllergySeverity,
): AllergenBadgeVisuals {
  return VISUALS[severity];
}
