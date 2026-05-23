/**
 * Verification-streak cache service.
 *
 * Caches the user's current verification streak for a short TTL so endpoints
 * that resolve streak-based feature unlocks (`/api/subscription/status`,
 * grocery-list generation) don't issue a `getUserVerificationStats` query on
 * every request. The cache invalidates naturally after 60 s; a freshly earned
 * streak therefore takes effect within one TTL window.
 *
 * Mirrors the Map+TTL pattern in server/services/subscription-tier-cache.ts.
 */

import { storage } from "../storage";

const TTL_MS = 60_000;
const MAX_CACHE_SIZE = 10_000;

const streakCache = new Map<string, { streak: number; expiresAt: number }>();

function getCached(userId: string): number | null {
  const entry = streakCache.get(userId);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.streak;
}

function setCached(userId: string, streak: number): void {
  // Evict oldest entry (first key in iteration order) when cache is full.
  if (streakCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = streakCache.keys().next().value;
    if (oldestKey !== undefined) {
      streakCache.delete(oldestKey);
    }
  }
  streakCache.set(userId, { streak, expiresAt: Date.now() + TTL_MS });
}

// Periodic sweep to remove expired entries (every 5 minutes).
// The cast to NodeJS.Timeout is needed because the shared tsconfig
// resolves setInterval to the DOM overload (returns number).
const sweepInterval = setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of streakCache) {
      if (now > entry.expiresAt) {
        streakCache.delete(key);
      }
    }
  },
  5 * 60 * 1000,
) as unknown as NodeJS.Timeout;
sweepInterval.unref();

/**
 * Evict the cached streak for a user. Call after a verification submission so a
 * freshly-earned streak takes effect immediately rather than after the TTL.
 */
export function invalidateCache(userId: string): void {
  streakCache.delete(userId);
}

/**
 * Resolve the user's current verification streak, using an in-memory
 * 60-second cache. Safe to call on every request — cache misses hit the DB
 * once per TTL window.
 */
export async function resolveVerificationStreak(
  userId: string,
): Promise<number> {
  const cached = getCached(userId);
  if (cached !== null) return cached;
  const { streak } = await storage.getUserVerificationStats(userId);
  setCached(userId, streak);
  return streak;
}

/** Exported for testing — allows inspecting/clearing the cache. */
export const _testInternals = {
  streakCache,
  TTL_MS,
};
