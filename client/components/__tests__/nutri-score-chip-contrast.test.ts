import { describe, it, expect } from "vitest";

import { Colors } from "@/constants/theme";
import { contrastRatio } from "../../../test/utils/wcag-contrast";
import { getNutriScoreVisuals } from "../nutri-score-chip-utils";
import type { NutriScoreGrade } from "../nutri-score-chip-utils";

/**
 * WCAG AA requires >= 4.5:1 contrast for normal (non-large) text. Unlike the
 * severity badges (AllergenBadge/ScanFlagBadge/VerificationBadge), the
 * NutriScoreChip renders as a SOLID pill — `bg`/`fg` are both fully-opaque
 * theme colors, so the contrast check is a direct two-hex comparison (no
 * `compositeOver` needed).
 */
const AA_NORMAL_TEXT_THRESHOLD = 4.5;

const grades: readonly NutriScoreGrade[] = ["a", "b", "c", "d", "e"];
const themeNames = ["light", "dark"] as const;

describe("NutriScore chip contrast (WCAG AA)", () => {
  for (const grade of grades) {
    for (const themeName of themeNames) {
      it(`grade ${grade} fg/bg >= ${AA_NORMAL_TEXT_THRESHOLD}:1 on ${themeName}`, () => {
        const theme = Colors[themeName];
        const v = getNutriScoreVisuals(grade, theme);
        expect(contrastRatio(v.fg, v.bg)).toBeGreaterThanOrEqual(
          AA_NORMAL_TEXT_THRESHOLD,
        );
      });
    }
  }
});
