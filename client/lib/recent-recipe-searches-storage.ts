import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDurableOwner } from "@/lib/durable-owner";

const RECENT_SEARCHES_KEY = "@ocrecipes_recent_recipe_searches";
const MAX_RECENT_SEARCHES = 8;

// In-memory cache for synchronous reads after init.
let cache: string[] | null = null;

// Same two-guard cross-user discipline as home-actions-storage (see that file's
// long comment for the proof). The vector is IN-MEMORY only: init reads disk into
// `cache` but never re-persists (no setItem), so clear's removeItem authoritatively
// wipes disk regardless of ordering. The guards protect `cache` (the per-user
// history the sync getter feeds the Home UI) from a late init repopulating it
// after a teardown sweep nulled it:
//   sweepEpoch    — bumped synchronously by each clearRecentSearches(). init
//                   snapshots it before its disk read and commits only if it is
//                   unchanged afterward (forward-race guard).
//   sweepInFlight — the latest sweep's removeItem promise. init AWAITS it before
//                   reading disk so an init that STARTS during a sweep can't read
//                   pre-wipe stale history (mirror-race guard). Awaited in a
//                   `while`, NOT an `if`: a second sweep can begin while we await
//                   the first — do not "simplify" it to an `if`.
let sweepEpoch = 0;
let sweepInFlight: Promise<void> | null = null;

/**
 * Load this device's recent recipe searches into the in-memory cache for the
 * active user. The history is committed only when the persisted durable-owner
 * marker matches `userId` — the cross-restart durability layer. The in-memory
 * `sweepEpoch`/`sweepInFlight` guards reset to 0 on relaunch, so they alone can't
 * stop a previously-failed teardown wipe from resurfacing a prior user's history
 * on the next cold start; the marker check does.
 *
 * @param userId the active user's id (stringified), or null when unauthenticated.
 */
export function initRecentSearchesCache(userId: string | null): Promise<void> {
  return (async () => {
    // Mirror-race guard: never read disk while a teardown sweep's removeItem is in
    // flight, or we'd read pre-wipe stale history and repopulate the cache it just
    // cleared. Loop (not `if`) so a sweep that starts while we await an earlier one
    // is also waited out.
    while (sweepInFlight) {
      try {
        await sweepInFlight;
      } catch {}
    }
    // Forward-race guard: snapshot the epoch AFTER the in-flight wait but BEFORE
    // the disk read, so a sweep that starts DURING the read invalidates our commit.
    const startEpoch = sweepEpoch;

    const [raw, owner] = await Promise.all([
      AsyncStorage.getItem(RECENT_SEARCHES_KEY).catch(() => null),
      getDurableOwner(),
    ]);

    // Only commit if no sweep ran during our read (forward-race guard) AND the
    // on-disk history is owned by this user (cross-restart durability guard). A
    // different/absent owner means the disk holds another user's history or a
    // legacy/unconfirmed-wipe blob — never resurrect it; leave the cache empty.
    const ownsHistory = userId !== null && owner === userId;
    if (sweepEpoch === startEpoch) {
      if (ownsHistory) {
        try {
          cache = raw ? (JSON.parse(raw) as string[]) : [];
        } catch {
          cache = [];
        }
      } else {
        cache = [];
      }
    }
  })();
}

export function getRecentSearches(): string[] {
  return cache ?? [];
}

export async function pushRecentSearch(query: string): Promise<void> {
  const q = query.trim();
  if (!q) return;
  const current = getRecentSearches().filter(
    (s) => s.toLowerCase() !== q.toLowerCase(),
  );
  const updated = [q, ...current].slice(0, MAX_RECENT_SEARCHES);
  cache = updated;
  await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
}

/**
 * Clears this device's recent recipe searches from BOTH the in-memory cache and
 * disk. The key is global (not user-namespaced) and login() does not reset it, so
 * without this a prior user's searches seed the next user's Home search drawer on
 * a shared device (cross-user bleed). Wired into the auth teardown sweep
 * (`clearDurableLocalState` in useAuth) on every session-ending path.
 *
 * Bumps `sweepEpoch` and nulls `cache` SYNCHRONOUSLY (before any await) so a
 * concurrent in-flight init sees the bump and skips its commit, and the sync
 * getter returns empty immediately. Publishes its removeItem as `sweepInFlight`
 * so an init that STARTS during this sweep waits it out before reading disk.
 * Contractually NON-THROWING (the removeItem is caught) so a failure can't skip
 * the auth-state reset that follows it in teardown. Returns whether the disk
 * removal succeeded; a swallowed failure returns `false` so the durable-owner
 * marker is not advanced past this user (see `reconcileDurableOwner`).
 */
export async function clearRecentSearches(): Promise<boolean> {
  sweepEpoch++;
  cache = null;
  let ok = true;
  const sweep = AsyncStorage.removeItem(RECENT_SEARCHES_KEY)
    .catch(() => {
      ok = false;
    })
    .then(() => {});
  sweepInFlight = sweep;
  void sweep.finally(() => {
    if (sweepInFlight === sweep) sweepInFlight = null;
  });
  await sweep;
  return ok;
}
