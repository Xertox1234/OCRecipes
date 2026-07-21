import type { ScanFlagSeverity } from "@shared/types/scan-flags";
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
 * AllergenBadge via `badge-severity-visuals` so both severity badges stay in
 * lockstep. (`withOpacity` rounds the alpha to a quantized byte — an
 * immaterial sub-1% difference against the >=4.6:1 margins these tokens carry.)
 */
export const SCAN_FLAG_BADGE_FILL_OPACITY = BADGE_SEVERITY_FILL_OPACITY;

const VISUALS: Record<ScanFlagSeverity, BadgeSeverityVisuals> = {
  danger: HIGH_SEVERITY_VISUALS,
  warn: MEDIUM_SEVERITY_VISUALS,
  info: LOW_SEVERITY_VISUALS,
};

/** Maps scan-flag severity to its WCAG-safe badge color token + icon. */
export function getScanFlagBadgeVisuals(
  severity: ScanFlagSeverity,
): BadgeSeverityVisuals {
  return VISUALS[severity];
}
