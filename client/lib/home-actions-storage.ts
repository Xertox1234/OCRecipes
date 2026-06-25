import AsyncStorage from "@react-native-async-storage/async-storage";

const SECTIONS_KEY = "@ocrecipes_home_sections";
const RECENT_KEY = "@ocrecipes_recent_actions";
const USAGE_COUNTS_KEY = "@ocrecipes_action_usage_counts";
const MAX_RECENT = 4;

export type SectionKey = "scanning" | "nutrition" | "recipes" | "planning";

type SectionState = Record<SectionKey, boolean>;

const DEFAULT_SECTIONS: SectionState = {
  scanning: true,
  nutrition: true,
  recipes: true,
  planning: true,
};

// In-memory caches for synchronous reads after init
let sectionCache: SectionState | null = null;
let recentCache: string[] | null = null;
let usageCountsCache: Record<string, number> | null = null;

// Two independent guards make the no-cross-user-resurrection guarantee STRUCTURAL —
// no longer dependent on the authenticated Home tree unmounting on the auth flip, so
// a future caller that pre-warms init outside that gate cannot reopen the bleed.
// The vector is IN-MEMORY only: init reads disk into the caches but never re-persists
// (no setItem), so clear's removeItem authoritatively wipes disk regardless of
// ordering. Both guards protect only recentCache/usageCountsCache (the per-user
// history the sync getters feed to the Home UI) from a late init repopulating them
// after a teardown sweep nulled them:
//
//   sweepEpoch    — bumped synchronously by each clearHomeActionsState(). init
//                   snapshots it before its disk read and commits the per-user caches
//                   only if it is unchanged afterward, so a sweep that starts DURING
//                   init's read (init-in-flight-before-clear / forward case)
//                   invalidates init's commit.
//   sweepInFlight — the latest sweep's removeItem promise. init AWAITS it before
//                   reading disk, so an init that STARTS while a sweep's removeItem is
//                   still in flight (init-after-clear's-sync-null / mirror case)
//                   cannot read pre-wipe stale history. It is awaited in a `while`
//                   loop, NOT an `if`: a second sweep can begin while we await the
//                   first, and we must re-wait — do not "simplify" it to an `if`.
//
// sectionCache is a retained device-display pref (never swept) so init commits it
// unconditionally, outside the epoch gate.
let sweepEpoch = 0;
let sweepInFlight: Promise<void> | null = null;

export function initHomeActionsCache(): Promise<void> {
  const load = (async () => {
    // Mirror-case guard: never read disk while a teardown sweep's removeItem is in
    // flight, or we'd read pre-wipe stale history and repopulate the caches it just
    // cleared. Loop (not `if`) so a sweep that starts while we await an earlier one
    // is also waited out.
    while (sweepInFlight) {
      try {
        await sweepInFlight;
      } catch {}
    }
    // Forward-case guard: snapshot the epoch AFTER the in-flight wait but BEFORE the
    // disk read, so a sweep that starts DURING the read invalidates our commit below.
    const startEpoch = sweepEpoch;

    const [sectionsRaw, recentRaw, usageCountsRaw] = await Promise.all([
      AsyncStorage.getItem(SECTIONS_KEY).catch(() => null),
      AsyncStorage.getItem(RECENT_KEY).catch(() => null),
      AsyncStorage.getItem(USAGE_COUNTS_KEY).catch(() => null),
    ]);

    // Section state is a retained device-display pref (never swept) — always commit.
    try {
      sectionCache = sectionsRaw
        ? { ...DEFAULT_SECTIONS, ...JSON.parse(sectionsRaw) }
        : { ...DEFAULT_SECTIONS };
    } catch {
      sectionCache = { ...DEFAULT_SECTIONS };
    }

    // Per-user history caches are swept on teardown. Only commit our read if no sweep
    // ran during it; otherwise the sweep won the race → leave the nulled caches as-is
    // so we don't resurrect a prior user's history under the next user.
    if (sweepEpoch === startEpoch) {
      try {
        recentCache = recentRaw ? JSON.parse(recentRaw) : [];
      } catch {
        recentCache = [];
      }

      try {
        usageCountsCache = usageCountsRaw ? JSON.parse(usageCountsRaw) : {};
      } catch {
        usageCountsCache = {};
      }
    }
  })();
  return load;
}

export function getSectionState(): SectionState {
  return sectionCache ?? { ...DEFAULT_SECTIONS };
}

export async function setSectionExpanded(
  key: SectionKey,
  expanded: boolean,
): Promise<void> {
  const state = getSectionState();
  state[key] = expanded;
  sectionCache = { ...state };
  await AsyncStorage.setItem(SECTIONS_KEY, JSON.stringify(sectionCache));
}

export function getRecentActions(): string[] {
  return recentCache ?? [];
}

export async function pushRecentAction(actionId: string): Promise<void> {
  const current = getRecentActions().filter((id) => id !== actionId);
  const updated = [actionId, ...current].slice(0, MAX_RECENT);
  recentCache = updated;
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
}

export function getActionUsageCounts(): Record<string, number> {
  return usageCountsCache ?? {};
}

export async function incrementActionUsage(actionId: string): Promise<void> {
  const counts = getActionUsageCounts();
  const updated = { ...counts, [actionId]: (counts[actionId] ?? 0) + 1 };
  usageCountsCache = updated;
  await AsyncStorage.setItem(USAGE_COUNTS_KEY, JSON.stringify(updated));
}

/**
 * Clears this device's per-user home-action history — the recent-actions list
 * and per-action usage counts — from BOTH the in-memory caches and disk. These
 * keys are global (not user-namespaced) and login() does not reset them, so
 * without this a prior user's recent/frequent actions seed the next user's Home
 * UI on a shared device (cross-user bleed). Invoked from the auth teardown sweep
 * (`clearDurableLocalState` in useAuth) on every session-ending path.
 *
 * Bumps `sweepEpoch` and nulls the caches SYNCHRONOUSLY (before any await) so a
 * concurrent in-flight init sees the bump and skips its commit, and the sync getters
 * return empty immediately. Publishes its removeItem as `sweepInFlight` so an init
 * that STARTS during this sweep waits it out before reading disk — together these
 * make the no-resurrection guarantee structural (see the guard comment above).
 * Unlike clearOfflineQueue this guards only the in-memory window — init never
 * re-persists, so removeItem authoritatively clears disk regardless of timing.
 * Section-expansion state is a device-display pref, intentionally retained.
 * Contractually NON-THROWING (each removeItem is caught, so `sweep` never rejects)
 * so a removeItem failure can't skip the auth-state reset that follows it in teardown.
 */
export async function clearHomeActionsState(): Promise<void> {
  sweepEpoch++;
  recentCache = null;
  usageCountsCache = null;
  const sweep = Promise.all([
    AsyncStorage.removeItem(RECENT_KEY).catch(() => {}),
    AsyncStorage.removeItem(USAGE_COUNTS_KEY).catch(() => {}),
  ]).then(() => {});
  sweepInFlight = sweep;
  void sweep.finally(() => {
    if (sweepInFlight === sweep) sweepInFlight = null;
  });
  await sweep;
}
