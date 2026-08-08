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
import {
  CONCERN_LOW_VISUALS,
  BENEFIT_VISUALS,
  BENEFIT_NONE_VISUALS,
  BADGE_SEVERITY_FILL_OPACITY,
  HIGH_SEVERITY_VISUALS,
  MEDIUM_SEVERITY_VISUALS,
} from "../badge-severity-visuals";
import {
  NOTICE_FILL_OPACITY,
  NOTICE_TEXT_COLOR_KEY,
  type NoticeSeverity,
} from "../nutrition/NoticeStack-utils";
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

/**
 * NutritionPanel's band tag renders as a pill at the shared severity fill
 * opacity, exactly like ScanFlagBadge — so its text sits against the same
 * composited background and takes the same 4.5:1 bar.
 */
function panelTagCases(): Case[] {
  return [
    { label: "NutritionPanel concern LOW tag", visuals: CONCERN_LOW_VISUALS },
    { label: "NutritionPanel benefit tag", visuals: BENEFIT_VISUALS },
    { label: "NutritionPanel benefit NONE tag", visuals: BENEFIT_NONE_VISUALS },
  ].map(({ label, visuals }) => ({
    label,
    colorKey: visuals.colorKey,
    opacity: BADGE_SEVERITY_FILL_OPACITY,
  }));
}

/**
 * `NoticeStack` is not a pill, but it is the same construction: body copy at
 * full token strength on a `withOpacity(color, …)` fill of the same token's
 * family, so its text takes the identical 4.5:1 bar. It was excluded when this
 * suite was written and was shipping light-mode notice text at 2.30:1
 * (`theme.warning`) and 2.67:1 (`theme.info`).
 *
 * Derived from the component's OWN maps rather than restating the tokens here.
 * A hard-coded `{colorKey: "badgeWarningText"}` case would only prove the
 * token is AA — it would stay green if `NoticeStack` rendered its text at
 * `theme.warning` again. Deriving is what makes this suite observe the
 * component, and matches how `allergenCases()` / `scanFlagCases()` derive from
 * their own visuals functions.
 */
function noticeCases(): Case[] {
  const severities = Object.keys(NOTICE_TEXT_COLOR_KEY) as NoticeSeverity[];
  return severities.map((severity) => ({
    label: `NoticeStack ${severity} notice text`,
    colorKey: NOTICE_TEXT_COLOR_KEY[severity],
    opacity: NOTICE_FILL_OPACITY[severity],
  }));
}

describe("badge family WCAG AA contrast", () => {
  const allCases = [
    ...allergenCases(),
    ...scanFlagCases(),
    ...verificationCases(),
    ...panelTagCases(),
    ...noticeCases(),
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

/**
 * WCAG 1.4.11 — the indicator dot is a GRAPHICAL OBJECT, not text, so its bar
 * is 3:1 rather than 4.5:1, and it renders at FULL token strength (opacity 1)
 * directly on the surface rather than as a low-opacity fill. Naming only the
 * text criterion is what invites picking a lighter green that passes the wrong
 * test.
 */
const AA_GRAPHICAL_OBJECT_THRESHOLD = 3.0;

describe("NutritionPanel band indicator (WCAG 1.4.11 graphical object)", () => {
  const indicatorVisuals = [
    { label: "concern HIGH", visuals: HIGH_SEVERITY_VISUALS },
    { label: "concern MEDIUM", visuals: MEDIUM_SEVERITY_VISUALS },
    { label: "concern LOW", visuals: CONCERN_LOW_VISUALS },
    { label: "benefit GOOD/EXCELLENT", visuals: BENEFIT_VISUALS },
    { label: "benefit NONE", visuals: BENEFIT_NONE_VISUALS },
  ];

  for (const theme of themeNames) {
    for (const surface of surfaceNames) {
      for (const { label, visuals } of indicatorVisuals) {
        it(`${label} dot >= 3:1 on ${theme}/${surface}`, () => {
          const fg = Colors[theme][visuals.colorKey];
          const bg = Colors[theme][surface];
          expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(
            AA_GRAPHICAL_OBJECT_THRESHOLD,
          );
        });
      }
    }
  }
});
