/**
 * Why someone hid a For You recipe. Stored on `recipe_dismissals.reason`
 * (null = hidden by an app version that never asked). The server validates
 * against this list; the client owns the words shown for each id.
 */
export const RECIPE_DISMISS_REASONS = [
  "contains_avoided",
  "diet_mismatch",
  "cuisine_disliked",
  "not_interested",
] as const;

export type RecipeDismissReason = (typeof RECIPE_DISMISS_REASONS)[number];
