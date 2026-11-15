import type { AllergySeverity } from "@shared/constants/allergens";
import {
  BADGE_SEVERITY_FILL_OPACITY,
  HIGH_SEVERITY_VISUALS,
  MEDIUM_SEVERITY_VISUALS,
  LOW_SEVERITY_VISUALS,
  type BadgeSeverityVisuals,
} from "./badge-severity-visuals";

/**
 * Fill opacity for `withOpacity(color, ...)` on the badge background — a named
 * export (not an inline literal in the component) so the WCAG contrast test in
 * `__tests__/badge-contrast.test.ts` asserts against the value passed to
 * `withOpacity`, with no risk of the two drifting apart. Shared with
 * ScanFlagBadge via `badge-severity-visuals` so both severity badges stay in
 * lockstep. (`withOpacity` rounds the alpha to a quantized byte — an
 * immaterial sub-1% difference against the >=4.6:1 margins these tokens carry.)
 */
export const ALLERGEN_BADGE_FILL_OPACITY = BADGE_SEVERITY_FILL_OPACITY;

const VISUALS: Record<AllergySeverity, BadgeSeverityVisuals> = {
  severe: HIGH_SEVERITY_VISUALS,
  moderate: MEDIUM_SEVERITY_VISUALS,
  mild: LOW_SEVERITY_VISUALS,
};

/** Maps allergen severity to its WCAG-safe badge color token + icon. */
export function getAllergenBadgeVisuals(
  severity: AllergySeverity,
): BadgeSeverityVisuals {
  return VISUALS[severity];
}

/**
 * Screen-reader label for an ingredient's allergen badge. A possible match
 * says "possible" at every severity: the ingredient may or may not carry the
 * allergen, so it never reads as "Contains" or "Allergen".
 */
export function getAllergenBadgeLabel(
  allergenLabel: string,
  severity: AllergySeverity,
  possible: boolean | undefined,
): string {
  if (possible === true) return `Possible allergen: ${allergenLabel}`;
  return severity === "severe"
    ? `Severe allergen: ${allergenLabel}`
    : severity === "moderate"
      ? `Allergen: ${allergenLabel}`
      : `Contains: ${allergenLabel}`;
}

/**
 * Banner text above an ingredient list. An ingredient with any definite match
 * counts as "contains"; one with only possible matches counts as "may
 * contain". `isPossible` is absent on matches from an older server — read as
 * definite.
 */
export function getAllergenBannerMessage(
  matches: readonly { ingredientName: string; isPossible?: boolean }[],
): string {
  const definite = new Set<string>();
  const all = new Set<string>();
  for (const m of matches) {
    all.add(m.ingredientName);
    if (m.isPossible !== true) definite.add(m.ingredientName);
  }
  const possibleCount = all.size - definite.size;
  const noun = (n: number) => (n === 1 ? "ingredient" : "ingredients");

  if (possibleCount === 0) {
    return `${definite.size} ${noun(definite.size)} ${
      definite.size === 1 ? "contains" : "contain"
    } your allergens`;
  }
  if (definite.size === 0) {
    return `${possibleCount} ${noun(possibleCount)} may contain your allergens`;
  }
  return `${definite.size} ${noun(definite.size)} ${
    definite.size === 1 ? "contains" : "contain"
  } your allergens, ${possibleCount} more may contain them`;
}
