import { describe, it, expect } from "vitest";

import { Colors } from "@/constants/theme";
import {
  contrastRatio,
  compositeOver,
} from "../../../test/utils/wcag-contrast";
import {
  getAllergenBadgeVisuals,
  ALLERGEN_BADGE_FILL_OPACITY,
} from "../allergen-badge-utils";
import {
  getScanFlagBadgeVisuals,
  SCAN_FLAG_BADGE_FILL_OPACITY,
} from "../scan-flag-badge-utils";
import {
  getBadgeConfig,
  VERIFICATION_BADGE_FILL_OPACITY,
} from "../verification-badge-utils";
import { allergySeverities } from "@shared/constants/allergens";
import { verificationLevels } from "@shared/types/verification";
import type { ScanFlagSeverity } from "@shared/types/scan-flags";

/**
 * WCAG AA requires >= 4.5:1 contrast for normal (non-large) text. All three
 * badge components render their `color` at full strength as BOTH the
 * icon/text color AND (via `withOpacity(color, opacity)`) the pill fill —
 * so the "background" the text actually sits against is the fill color
 * alpha-composited over whichever page surface is behind the badge.
 */
const AA_NORMAL_TEXT_THRESHOLD = 4.5;

const scanFlagSeverities: readonly ScanFlagSeverity[] = [
  "danger",
  "warn",
  "info",
];

const themeNames = ["light", "dark"] as const;
const surfaceNames = ["backgroundRoot", "surface"] as const;

interface Case {
  label: string;
  colorKey: keyof (typeof Colors)["light"];
  opacity: number;
}

function allergenCases(): Case[] {
  return allergySeverities.map((severity) => {
    const { colorKey } = getAllergenBadgeVisuals(severity);
    return {
      label: `AllergenBadge severity=${severity}`,
      colorKey,
      opacity: ALLERGEN_BADGE_FILL_OPACITY,
    };
  });
}

function scanFlagCases(): Case[] {
  return scanFlagSeverities.map((severity) => {
    const { colorKey } = getScanFlagBadgeVisuals(severity);
    return {
      label: `ScanFlagBadge severity=${severity}`,
      colorKey,
      opacity: SCAN_FLAG_BADGE_FILL_OPACITY,
    };
  });
}

function verificationCases(): Case[] {
  return verificationLevels.map((level) => {
    const { colorKey } = getBadgeConfig(level);
    return {
      label: `VerificationBadge level=${level}`,
      colorKey,
      opacity: VERIFICATION_BADGE_FILL_OPACITY,
    };
  });
}

describe("badge family WCAG AA contrast", () => {
  const allCases = [
    ...allergenCases(),
    ...scanFlagCases(),
    ...verificationCases(),
  ];

  for (const themeName of themeNames) {
    const theme = Colors[themeName];

    for (const surfaceName of surfaceNames) {
      const surfaceHex = theme[surfaceName];

      for (const { label, colorKey, opacity } of allCases) {
        it(`${label} passes ${AA_NORMAL_TEXT_THRESHOLD}:1 on ${themeName}/${surfaceName}`, () => {
          const textHex = theme[colorKey];
          const effectiveBackground = compositeOver(
            textHex,
            opacity,
            surfaceHex,
          );
          const ratio = contrastRatio(textHex, effectiveBackground);

          expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_THRESHOLD);
        });
      }
    }
  }
});
