import type { VerificationLevel } from "@shared/types/verification";

/**
 * Fill opacity for `withOpacity(color, ...)` on the badge background — a
 * named export (not an inline literal in the component) so the WCAG
 * contrast test in `__tests__/badge-contrast.test.ts` asserts against the
 * value passed to `withOpacity`, with no risk of the two drifting apart.
 * (`withOpacity` itself rounds the alpha to a quantized byte — an
 * immaterial sub-1% difference against the >=4.6:1 margins these tokens
 * carry.)
 */
export const VERIFICATION_BADGE_FILL_OPACITY = 0.12;

interface BadgeConfig {
  label: string;
  icon: "help-circle" | "check-circle" | "shield";
  /** WCAG-safe badge text/icon token (see client/constants/theme.ts). */
  colorKey: "badgeNeutralText" | "badgeInfoText" | "badgeSuccessText";
  a11yLabel: string;
}

const BADGE_CONFIGS: Record<VerificationLevel, BadgeConfig> = {
  unverified: {
    label: "Unverified",
    icon: "help-circle",
    colorKey: "badgeNeutralText",
    a11yLabel:
      "Verification: Unverified. Nutrition from database, not confirmed by label scans.",
  },
  single_verified: {
    label: "Partly Verified",
    icon: "check-circle",
    colorKey: "badgeInfoText",
    a11yLabel:
      "Verification: Partly verified. Confirmed by 1-2 label scans, needs more for full verification.",
  },
  verified: {
    label: "Verified",
    icon: "shield",
    colorKey: "badgeSuccessText",
    a11yLabel:
      "Verification: Community Verified. Confirmed by 3+ independent label scans.",
  },
};

export function getBadgeConfig(level: VerificationLevel): BadgeConfig {
  return BADGE_CONFIGS[level];
}

/** Gamification badge tiers based on number of verifications submitted */
const BADGE_TIERS = [1, 5, 10, 25, 50, 100] as const;

export function getVerificationTier(
  count: number,
): (typeof BADGE_TIERS)[number] | null {
  for (let i = BADGE_TIERS.length - 1; i >= 0; i--) {
    if (count >= BADGE_TIERS[i]) return BADGE_TIERS[i];
  }
  return null;
}

export function getNextTier(
  count: number,
): (typeof BADGE_TIERS)[number] | null {
  for (const tier of BADGE_TIERS) {
    if (count < tier) return tier;
  }
  return null;
}

/** Tier label for gamification display */
const TIER_LABELS: Record<(typeof BADGE_TIERS)[number], string> = {
  1: "Newcomer",
  5: "Contributor",
  10: "Bronze Verifier",
  25: "Silver Verifier",
  50: "Gold Verifier",
  100: "Platinum Verifier",
};

export function getTierLabel(count: number): string | null {
  const tier = getVerificationTier(count);
  return tier ? TIER_LABELS[tier] : null;
}
