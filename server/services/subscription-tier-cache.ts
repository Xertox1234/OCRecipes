/**
 * Subscription-tier cache service.
 *
 * Caches resolved PremiumFeatures per user for a short TTL so frequently
 * polled endpoints (generation status banners, header counters) don't hit
 * the database on every request. The cache invalidates naturally after 60 s;
 * tier changes take effect on the next IAP confirmation cycle.
 *
 * Resolved features include verification-streak unlocks (see
 * `applyStreakUnlocks`) — a streak crossing the threshold takes effect on the
 * next cache-miss, within one TTL window.
 *
 * Extracted from server/routes/recipes.ts (M6 — 2026-04-28 audit).
 */

import { storage } from "../storage";
import {
  TIER_FEATURES,
  isValidSubscriptionTier,
  applyStreakUnlocks,
  resolveEffectiveTier,
  type PremiumFeatures,
} from "@shared/types/premium";

const TTL_MS = 60_000;
const MAX_CACHE_SIZE = 10_000;

const tierCache = new Map<
  string,
  { features: PremiumFeatures; expiresAt: number }
>();

function getCached(userId: string): PremiumFeatures | null {
  const entry = tierCache.get(userId);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.features;
}

function setCached(userId: string, features: PremiumFeatures): void {
  // Evict oldest entry (first key in iteration order) when cache is full.
  if (tierCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = tierCache.keys().next().value;
    if (oldestKey !== undefined) {
      tierCache.delete(oldestKey);
    }
  }
  tierCache.set(userId, { features, expiresAt: Date.now() + TTL_MS });
}

// Periodic sweep to remove expired entries (every 5 minutes).
// The cast to NodeJS.Timeout is needed because the shared tsconfig
// resolves setInterval to the DOM overload (returns number).
const sweepInterval = setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of tierCache) {
      if (now > entry.expiresAt) {
        tierCache.delete(key);
      }
    }
  },
  5 * 60 * 1000,
) as unknown as NodeJS.Timeout;
sweepInterval.unref();

/**
 * Evict the cached tier features for a user. Call after a mutation that changes
 * the resolved features (IAP upgrade/restore, verification streak crossing a
 * threshold) so the change takes effect immediately rather than after the TTL.
 */
export function invalidateCache(userId: string): void {
  tierCache.delete(userId);
}

/**
 * Resolve the PremiumFeatures for a user, using an in-memory 60-second cache.
 * Safe to call on every request — cache misses hit the DB once per TTL window.
 */
export async function resolveSubscriptionTierFeatures(
  userId: string,
): Promise<PremiumFeatures> {
  const cached = getCached(userId);
  if (cached) return cached;
  const [subscription, stats] = await Promise.all([
    storage.getSubscriptionStatus(userId),
    storage.getUserVerificationStats(userId),
  ]);
  const storedTier = subscription?.tier ?? "free";
  // Downgrade an expired-premium subscription to free before resolving
  // features — the stored DB tier is never reset on expiry. Shared with
  // GET /api/subscription/status so the two cannot drift.
  const { effectiveTier } = resolveEffectiveTier(
    isValidSubscriptionTier(storedTier) ? storedTier : "free",
    subscription?.expiresAt ?? null,
  );
  const baseFeatures = TIER_FEATURES[effectiveTier];
  const features = applyStreakUnlocks(baseFeatures, stats.streak);
  setCached(userId, features);
  return features;
}

/** Exported for testing — allows inspecting/clearing the cache. */
export const _testInternals = {
  tierCache,
  TTL_MS,
  MAX_CACHE_SIZE,
};
