import type { ScanFlagSeverity } from "@shared/types/scan-flags";

/**
 * Fill opacity for `withOpacity(color, ...)` on the badge background — a
 * named export (not an inline literal in the component) so the WCAG
 * contrast test in `__tests__/badge-contrast.test.ts` asserts against the
 * value passed to `withOpacity`, with no risk of the two drifting apart.
 * (`withOpacity` itself rounds the alpha to a quantized byte — an
 * immaterial sub-1% difference against the >=4.6:1 margins these tokens
 * carry.)
 */
export const SCAN_FLAG_BADGE_FILL_OPACITY = 0.1;

/** WCAG-safe badge text/icon token (see client/constants/theme.ts). */
export type ScanFlagBadgeColorKey =
  | "badgeErrorText"
  | "badgeWarningText"
  | "badgeInfoText";

export type ScanFlagBadgeIcon = "alert-triangle" | "alert-circle" | "info";

interface ScanFlagBadgeVisuals {
  colorKey: ScanFlagBadgeColorKey;
  icon: ScanFlagBadgeIcon;
}

const VISUALS: Record<ScanFlagSeverity, ScanFlagBadgeVisuals> = {
  danger: { colorKey: "badgeErrorText", icon: "alert-triangle" },
  warn: { colorKey: "badgeWarningText", icon: "alert-circle" },
  info: { colorKey: "badgeInfoText", icon: "info" },
};

/** Maps scan-flag severity to its WCAG-safe badge color token + icon. */
export function getScanFlagBadgeVisuals(
  severity: ScanFlagSeverity,
): ScanFlagBadgeVisuals {
  return VISUALS[severity];
}
