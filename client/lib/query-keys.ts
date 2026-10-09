export const QUERY_KEYS = {
  scannedItems: ["/api/scanned-items"] as const,
  dailySummary: ["/api/daily-summary"] as const,
  frequentItems: ["/api/scanned-items/frequent"] as const,
  // Bare prefix: matches the undated (Home) and every dated (Plan) variant.
  dailyBudget: ["/api/daily-budget"] as const,
  dietaryProfile: ["/api/user/dietary-profile"] as const,
  // Last known tier: persisted (24h, cleared on logout) so a relaunch that hits
  // a 429/network error on this read still restores the previous tier.
  subscriptionStatus: ["/api/subscription/status"] as const,
} as const;
