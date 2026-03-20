import type { VerificationLevel } from "@shared/types/verification";

interface BadgeConfig {
  label: string;
  icon: "help-circle" | "check-circle" | "shield";
  colorKey: "textSecondary" | "info" | "success";
  a11yLabel: string;
}

const BADGE_CONFIGS: Record<VerificationLevel, BadgeConfig> = {
  unverified: {
    label: "Unverified",
    icon: "help-circle",
    colorKey: "textSecondary",
    a11yLabel:
      "Verification: Unverified. Nutrition from database, not confirmed by label scans.",
  },
  single_verified: {
    label: "Partly Verified",
    icon: "check-circle",
    colorKey: "info",
    a11yLabel:
      "Verification: Partly verified. Confirmed by 1-2 label scans, needs more for full verification.",
  },
  verified: {
    label: "Verified",
    icon: "shield",
    colorKey: "success",
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
