export const QUERY_KEYS = {
  scannedItems: ["/api/scanned-items"] as const,
  dailySummary: ["/api/daily-summary"] as const,
  frequentItems: ["/api/scanned-items/frequent"] as const,
  // Bare prefix: matches the undated (Home) and every dated (Plan) variant.
  dailyBudget: ["/api/daily-budget"] as const,
  dietaryProfile: ["/api/user/dietary-profile"] as const,
} as const;
