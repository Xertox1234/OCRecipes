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
