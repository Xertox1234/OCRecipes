export const TIER_FEATURES = {
  free: { requestsPerMonth: 500, includesVerified: false },
  starter: { requestsPerMonth: 10_000, includesVerified: true },
  pro: { requestsPerMonth: 100_000, includesVerified: true },
} as const;

export type ApiTier = keyof typeof TIER_FEATURES;

export const API_TIERS = Object.keys(TIER_FEATURES) as ApiTier[];
