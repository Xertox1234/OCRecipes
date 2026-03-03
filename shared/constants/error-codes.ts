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
} as const;

// eslint-disable-next-line @typescript-eslint/no-redeclare -- intentional: merging value + type
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
