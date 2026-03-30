import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { TIER_FEATURES, type ApiTier } from "@shared/constants/api-tiers";
import { logger, toError } from "../lib/logger";

// In-memory usage cache to avoid DB read on every request.
// DB is source of truth; this cache avoids a DB round-trip per request.
const usageCache = new Map<string, { count: number; expiresAt: number }>();
const USAGE_CACHE_TTL_MS = 60_000;
const MAX_CACHED_USAGE = 10_000;

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getNextMonthReset(): string {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.toISOString();
}

function getCacheKey(apiKeyId: number, yearMonth: string): string {
  return `${apiKeyId}:${yearMonth}`;
}

/** Clear usage cache (for testing) */
export function clearUsageCache(): void {
  usageCache.clear();
}

export async function apiRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKeyId = req.apiKeyId;
  const tier = req.apiKeyTier as ApiTier;

  if (!apiKeyId || !tier) {
    sendError(res, 401, "API key required", "API_KEY_INVALID");
    return;
  }

  const features = TIER_FEATURES[tier];
  if (!features) {
    sendError(res, 403, "Unknown API key tier", "API_KEY_INVALID");
    return;
  }

  const yearMonth = currentYearMonth();
  const cacheKey = getCacheKey(apiKeyId, yearMonth);
  const monthlyLimit = features.requestsPerMonth;

  // Check in-memory cache first
  let currentCount: number;
  const cached = usageCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    currentCount = cached.count;
  } else {
    // Cache miss or expired — read from DB
    try {
      currentCount = await storage.getApiKeyUsage(apiKeyId, yearMonth);
    } catch (err) {
      logger.error({ err: toError(err) }, "rate limit check error");
      // Fail closed — reject request when we can't verify limits
      sendError(
        res,
        503,
        "Service temporarily unavailable",
        "SERVICE_UNAVAILABLE",
      );
      return;
    }
  }

  // Set rate limit headers on every response
  res.setHeader("X-RateLimit-Limit", monthlyLimit);
  res.setHeader(
    "X-RateLimit-Remaining",
    Math.max(0, monthlyLimit - currentCount),
  );
  res.setHeader("X-RateLimit-Reset", getNextMonthReset());

  if (currentCount >= monthlyLimit) {
    sendError(
      res,
      429,
      "Monthly request limit exceeded. Upgrade your plan for more requests.",
      "TIER_LIMIT_EXCEEDED",
    );
    return;
  }

  // Increment usage — fire-and-forget (don't block response)
  storage.incrementApiKeyUsage(apiKeyId).catch((err) => {
    logger.error({ err: toError(err) }, "failed to increment API key usage");
  });

  // Update in-memory cache
  if (usageCache.size >= MAX_CACHED_USAGE) {
    const oldestKey = usageCache.keys().next().value;
    if (oldestKey !== undefined) {
      usageCache.delete(oldestKey);
    }
  }
  usageCache.set(cacheKey, {
    count: currentCount + 1,
    expiresAt: Date.now() + USAGE_CACHE_TTL_MS,
  });

  next();
}
