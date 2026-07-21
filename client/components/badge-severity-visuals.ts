/**
 * Shared severity → visuals mapping for the low-opacity "pill" badges that
 * encode a 3-level severity (AllergenBadge: severe/moderate/mild,
 * ScanFlagBadge: danger/warn/info). Both map their enum to the SAME WCAG-safe
 * text/icon token triple and use the SAME fill opacity, so the values live
 * here in ONE place — a token or opacity change can't drift between the two
 * badges. Each badge keeps its own explicit enum → visuals map (the enums are
 * genuinely different types); only the shared values are centralized.
 *
 * VerificationBadge deliberately does NOT use this module: it renders a
 * different set of tokens (neutral/info/success) at a different opacity (0.12)
 * and carries per-level labels/a11y copy — see verification-badge-utils.ts.
 */

/** Fill opacity passed to `withOpacity(color, ...)` for the severity badges. */
export const BADGE_SEVERITY_FILL_OPACITY = 0.1;

/** WCAG-safe badge text/icon color token (see client/constants/theme.ts). */
export type BadgeSeverityColorKey =
  | "badgeErrorText"
  | "badgeWarningText"
  | "badgeInfoText";

export type BadgeSeverityIcon = "alert-triangle" | "alert-circle" | "info";

export interface BadgeSeverityVisuals {
  colorKey: BadgeSeverityColorKey;
  icon: BadgeSeverityIcon;
}

/** Highest severity (danger / severe): error token + warning triangle. */
export const HIGH_SEVERITY_VISUALS: BadgeSeverityVisuals = {
  colorKey: "badgeErrorText",
  icon: "alert-triangle",
};

/** Mid severity (warn / moderate): warning token + alert circle. */
export const MEDIUM_SEVERITY_VISUALS: BadgeSeverityVisuals = {
  colorKey: "badgeWarningText",
  icon: "alert-circle",
};

/** Low severity (info / mild): info token + info glyph. */
export const LOW_SEVERITY_VISUALS: BadgeSeverityVisuals = {
  colorKey: "badgeInfoText",
  icon: "info",
};
