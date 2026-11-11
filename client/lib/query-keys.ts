export const QUERY_KEYS = {
  scannedItems: ["/api/scanned-items"] as const,
  dailySummary: ["/api/daily-summary"] as const,
  frequentItems: ["/api/scanned-items/frequent"] as const,
  // Bare prefix: matches the undated (Home) and every dated (Plan) variant.
  dailyBudget: ["/api/daily-budget"] as const,
  dietaryProfile: ["/api/user/dietary-profile"] as const,
  aiSharing: ["/api/user/ai-sharing"] as const,
  // Last known tier: persisted (24h, cleared on logout) so a relaunch that hits
  // a 429/network error on this read still restores the previous tier.
  subscriptionStatus: ["/api/subscription/status"] as const,
} as const;

/**
 * A community recipe's stats (tried count, triedByMe). A per-recipe key, so
 * deliberately NOT a QUERY_KEYS entry — App.tsx persists every QUERY_KEYS key.
 */
export function recipeStatsKey(recipeId: number) {
  return [`/api/recipes/${recipeId}/stats`] as const;
}

/**
 * A chat conversation's messages. One builder for every reader and writer of
 * this key (useChat's query, invalidations and cache reads, CoachChat), so a
 * hand-typed copy can't drift. Not a QUERY_KEYS entry: never persisted.
 * Accepts `null` for a disabled query with no conversation yet — the key is
 * then the same string the hand-typed template produced.
 */
export function chatMessagesKey(conversationId: number | null) {
  return [`/api/chat/conversations/${conversationId}/messages`] as const;
}
