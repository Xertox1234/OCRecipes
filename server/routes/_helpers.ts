/**
 * Generic utility functions used across route modules.
 *
 * Domain-specific concerns have been split into focused modules:
 * - `./_rate-limiters` — Rate limiter factory + instances
 * - `./_schemas` — Zod validation schemas
 * - `./_upload` — Multer upload configuration
 * - `./_admin` — Admin authorization
 */
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth";
import { ZodError } from "zod";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { TIER_FEATURES, type PremiumFeatures } from "@shared/types/premium";
import { ErrorCode } from "@shared/constants/error-codes";
import { isAiConfigured } from "../lib/openai";
import { logger, toError } from "../lib/logger";

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Resolve the current user's premium features object.
 * Delegates tier resolution (including expired-premium downgrade) to the
 * canonical `storage.getEffectiveTierForUser` helper — the raw stored tier is
 * never reset on expiry and must not gate features directly.
 * Use this when you need the features object without gating on a specific boolean feature.
 */
export async function getPremiumFeatures(
  req: AuthenticatedRequest,
): Promise<PremiumFeatures> {
  const effectiveTier = await storage.getEffectiveTierForUser(req.userId);
  return TIER_FEATURES[effectiveTier];
}

/**
 * Guard that returns false (and sends 503) if AI features are not configured.
 * Use at the top of route handlers that depend on OpenAI.
 */
export function checkAiConfigured(res: Response): boolean {
  if (!isAiConfigured) {
    sendError(
      res,
      503,
      "AI features are not available. Please try again later.",
      ErrorCode.AI_NOT_CONFIGURED,
    );
    return false;
  }
  return true;
}

/**
 * Check if the user has a premium feature. Returns the features object if granted,
 * or sends a 403 response and returns null if not.
 */
export async function checkPremiumFeature(
  req: Request,
  res: Response,
  featureKey: keyof PremiumFeatures,
  featureLabel: string,
): Promise<PremiumFeatures | null> {
  const features = await getPremiumFeatures(req);
  if (!features[featureKey]) {
    sendError(
      res,
      403,
      `${featureLabel} requires a premium subscription`,
      ErrorCode.PREMIUM_REQUIRED,
    );
    return null;
  }
  return features;
}

/**
 * Parse a route parameter as a positive integer. Returns the parsed number,
 * or null if the value is not a valid positive integer (rejects NaN, 0, and negatives).
 * Accepts `string | string[]` to match Express 5's req.params type without requiring `as string` casts.
 */
export function parsePositiveIntParam(value: string | string[]): number | null {
  const str = Array.isArray(value) ? value[0] : value;
  if (!str) return null;
  const num = parseInt(str, 10);
  if (isNaN(num) || num <= 0) return null;
  return num;
}

/**
 * Parse a query string parameter as an integer with default, min, and max clamping.
 * Handles the `as string` cast internally so callers don't need it.
 */
export function parseQueryInt(
  value: unknown,
  options: { default: number; min?: number; max?: number },
): number {
  const num = typeof value === "string" ? parseInt(value, 10) : NaN;
  let result = isNaN(num) ? options.default : num;
  if (options.min !== undefined) result = Math.max(result, options.min);
  if (options.max !== undefined) result = Math.min(result, options.max);
  return result;
}

/**
 * Parse a query string parameter as a Date. Returns undefined if the value
 * is missing or not a valid date string.
 */
export function parseQueryDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  if (isNaN(date.getTime())) return undefined;
  return date;
}

/**
 * Parse an IANA timezone string from a request header or query param.
 * Returns the validated tz string, or `"UTC"` if missing or unrecognised.
 * Validation uses `Intl.DateTimeFormat` which throws on invalid identifiers —
 * the try/catch here keeps callers safe from malformed client-supplied values.
 */
export function parseTimezone(value: unknown): string {
  if (typeof value !== "string" || !value) return "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

/**
 * Parse a query string parameter as a trimmed string. Returns undefined if the
 * value is missing or not a string. Handles Express 5's `unknown` query type
 * without requiring an `as string` cast.
 */
export function parseQueryString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value;
}

/**
 * Parse a route parameter as a string. Handles Express 5's `string | string[]`
 * param type without requiring an `as string` cast.
 */
export function parseStringParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Format Zod validation errors as a simple string */
export function formatZodError(error: ZodError): string {
  return error.errors
    .map((e) =>
      e.path.length ? `${e.path.join(".")}: ${e.message}` : e.message,
    )
    .join("; ");
}

/**
 * Standard catch handler for route endpoints with Zod validation.
 * Handles ZodError → 400, everything else → 500 with logging.
 */
export function handleRouteError(
  res: Response,
  error: unknown,
  context: string,
): void {
  if (error instanceof ZodError) {
    sendError(res, 400, formatZodError(error), ErrorCode.VALIDATION_ERROR);
    return;
  }
  logger.error({ err: toError(error) }, `${context} error`);
  sendError(res, 500, `Failed to ${context}`, ErrorCode.INTERNAL_ERROR);
}
