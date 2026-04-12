/**
 * Coach Warm-Up Cache Service
 *
 * In-memory warm-up cache for Coach Pro — stores pre-fetched conversation
 * history so the final message send can skip the DB round-trip.
 *
 * Extracted from server/routes/coach-context.ts to avoid cross-route imports.
 */

// In-memory warm-up cache: userId → { warmUpId, messages, preparedAt }
const warmUpCache = new Map<
  string,
  {
    warmUpId: string;
    messages: { role: string; content: string }[];
    preparedAt: number;
  }
>();

export const WARM_UP_TTL_MS = 30_000;

// Periodic sweep to remove expired warm-up entries (every 60s).
// Entries expire after WARM_UP_TTL_MS but are only cleaned on consumption;
// this sweep catches entries from users who never sent the final message.
const warmUpSweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of warmUpCache) {
    if (now - entry.preparedAt > WARM_UP_TTL_MS) {
      warmUpCache.delete(key);
    }
  }
}, 60_000) as unknown as NodeJS.Timeout;
warmUpSweepInterval.unref();

/**
 * Store a warm-up entry for a user. Evicts any existing entry.
 */
export function setWarmUp(
  userId: string,
  warmUpId: string,
  messages: { role: string; content: string }[],
): void {
  warmUpCache.delete(userId);
  warmUpCache.set(userId, {
    warmUpId,
    messages,
    preparedAt: Date.now(),
  });
}

/**
 * Consume (and delete) a warm-up entry for a user.
 * Returns null if no matching entry exists or the entry has expired.
 */
export function consumeWarmUp(
  userId: string,
  warmUpId: string,
): { role: string; content: string }[] | null {
  const cached = warmUpCache.get(userId);
  if (!cached || cached.warmUpId !== warmUpId) return null;
  if (Date.now() - cached.preparedAt > WARM_UP_TTL_MS) {
    warmUpCache.delete(userId);
    return null;
  }
  warmUpCache.delete(userId);
  return cached.messages;
}
