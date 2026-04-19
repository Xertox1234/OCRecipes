/**
 * Standardized error codes used across all API error responses.
 *
 * Every `sendError()` call in a route file should include one of these codes
 * (or a domain-specific code for niche errors like CATALOG_QUOTA_EXCEEDED).
 */
export const ErrorCode = {
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  PREMIUM_REQUIRED: "PREMIUM_REQUIRED",
  LIMIT_REACHED: "LIMIT_REACHED",
  UNAUTHORIZED: "UNAUTHORIZED",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  API_KEY_INVALID: "API_KEY_INVALID",
  API_KEY_REVOKED: "API_KEY_REVOKED",
  TIER_LIMIT_EXCEEDED: "TIER_LIMIT_EXCEEDED",
  DAILY_LIMIT_REACHED: "DAILY_LIMIT_REACHED",
  CATALOG_QUOTA_EXCEEDED: "CATALOG_QUOTA_EXCEEDED",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  INGREDIENT_NOT_FOUND: "INGREDIENT_NOT_FOUND",
  IMAGE_TOO_LARGE: "IMAGE_TOO_LARGE",
  TOGGLE_FAILED: "TOGGLE_FAILED",
  DATE_RANGE_LIMIT: "DATE_RANGE_LIMIT",
  AI_NOT_CONFIGURED: "AI_NOT_CONFIGURED",
  ALREADY_CONFIRMED: "ALREADY_CONFIRMED",
  // Recipe import error codes — mirror the ImportError union in recipe-import.ts
  FETCH_FAILED: "FETCH_FAILED",
  NO_RECIPE_DATA: "NO_RECIPE_DATA",
  PARSE_ERROR: "PARSE_ERROR",
  RESPONSE_TOO_LARGE: "RESPONSE_TOO_LARGE",
} as const;

// eslint-disable-next-line @typescript-eslint/no-redeclare -- intentional: merging value + type
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
