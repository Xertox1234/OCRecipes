/**
 * Subscription-tier cache service.
 *
 * Caches resolved PremiumFeatures per user for a short TTL so frequently
 * polled endpoints (generation status banners, header counters) don't hit
 * the database on every request. The cache invalidates naturally after 60 s;
 * tier changes take effect on the next IAP confirmation cycle.
 *
 * Extracted from server/routes/recipes.ts (M6 — 2026-04-28 audit).
 */

import { storage } from "../storage";
import {
  TIER_FEATURES,
  isValidSubscriptionTier,
  type PremiumFeatures,
} from "@shared/types/premium";

const TTL_MS = 60_000;

const tierCache = new Map<
  string,
  { features: PremiumFeatures; expiresAt: number }
>();

function getCached(userId: string): PremiumFeatures | null {
  const entry = tierCache.get(userId);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.features;
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
  const subscription = await storage.getSubscriptionStatus(userId);
  const tier = subscription?.tier ?? "free";
  const features = TIER_FEATURES[isValidSubscriptionTier(tier) ? tier : "free"];
  tierCache.set(userId, { features, expiresAt: Date.now() + TTL_MS });
  return features;
}

/** Exported for testing — allows inspecting/clearing the cache. */
export const _testInternals = {
  tierCache,
  TTL_MS,
};
