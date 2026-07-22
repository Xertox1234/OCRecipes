/**
 * Pure styling utilities for NutriScoreChip.
 * Extracted for testability — no React or RN dependencies.
 *
 * Unlike the severity badges (AllergenBadge/ScanFlagBadge/VerificationBadge),
 * which render a low-opacity tinted fill, NutriScoreChip is a SOLID pill —
 * `bg`/`fg` are both fully-opaque theme colors, so the WCAG check in
 * `__tests__/nutri-score-chip-contrast.test.ts` compares them directly (no
 * `compositeOver`).
 *
 * Nutri-Score has 5 grades but the theme only carries 3 relevant semantic
 * colors, so grades share: A/B -> success (green), C -> warning (amber),
 * D/E -> error (red). `bg` uses the theme's `badge*Text` tokens (already
 * vetted as the dark/saturated end of each hue for AA use — see
 * client/constants/theme.ts) and `fg` uses `backgroundRoot` (the app's
 * page-background token, at the opposite lightness from `badge*Text` in
 * both themes). That pairing clears >=5.4:1 in EVERY theme/grade
 * combination (measured), well above the 4.5:1 AA floor.
 */
import type { Colors } from "@/constants/theme";

export type NutriScoreGrade = "a" | "b" | "c" | "d" | "e";

type Theme = (typeof Colors)["light"];

export interface NutriScoreVisuals {
  bg: string;
  fg: string;
  label: string;
}

type NutriScoreColorKey =
  | "badgeSuccessText"
  | "badgeWarningText"
  | "badgeErrorText";

const COLOR_KEY_BY_GRADE: Record<NutriScoreGrade, NutriScoreColorKey> = {
  a: "badgeSuccessText",
  b: "badgeSuccessText",
  c: "badgeWarningText",
  d: "badgeErrorText",
  e: "badgeErrorText",
};

/** Maps a Nutri-Score grade to its WCAG-AA solid pill colors + label. */
export function getNutriScoreVisuals(
  grade: NutriScoreGrade,
  theme: Theme,
): NutriScoreVisuals {
  const colorKey = COLOR_KEY_BY_GRADE[grade];
  return {
    bg: theme[colorKey],
    fg: theme.backgroundRoot,
    label: grade.toUpperCase(),
  };
}
