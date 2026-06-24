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

// Tracks the LATEST in-flight initHomeActionsCache() so a concurrent
// clearHomeActionsState() (session teardown) can serialize strictly AFTER it.
// The bleed vector here is IN-MEMORY only: init reads disk into the caches but
// never re-persists (no setItem), so clear's removeItem authoritatively wipes disk
// regardless of ordering — UNLIKE clearOfflineQueue, whose init re-persists and so
// needs serialization to prevent a DISK resurrection. The lock instead guards a
// late init read repopulating recentCache/usageCountsCache (which the sync getters
// return to the Home UI) AFTER the sweep nulled them. It closes the
// init-in-flight-before-clear case; the mirror case (init STARTING during clear's
// removeItem await) is currently unreachable only because the authenticated Home
// tree unmounts on the auth-state flip, so no init runs during teardown — a
// dependency on that gate, not a structural guarantee (see
// todos/P3-2026-06-24-harden-home-actions-init-memoize-or-document-auth-gate.md).
// Reset to null on settle (NOT memoized) so each Home mount re-reads this device's
// disk for the current session.
let initInFlight: Promise<void> | null = null;

export function initHomeActionsCache(): Promise<void> {
  // Capture the load promise SYNCHRONOUSLY (before the first await is observable
  // to any other code) so a concurrent clearHomeActionsState() always sees and
  // awaits it rather than racing the cache-populate below.
  const load = (async () => {
    const [sectionsRaw, recentRaw, usageCountsRaw] = await Promise.all([
      AsyncStorage.getItem(SECTIONS_KEY).catch(() => null),
      AsyncStorage.getItem(RECENT_KEY).catch(() => null),
      AsyncStorage.getItem(USAGE_COUNTS_KEY).catch(() => null),
    ]);

    try {
      sectionCache = sectionsRaw
        ? { ...DEFAULT_SECTIONS, ...JSON.parse(sectionsRaw) }
        : { ...DEFAULT_SECTIONS };
    } catch {
      sectionCache = { ...DEFAULT_SECTIONS };
    }

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
  })();
  initInFlight = load;
  void load.finally(() => {
    if (initInFlight === load) initInFlight = null;
  });
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
 * Serializes against an in-flight initHomeActionsCache() FIRST (lock-before-await)
 * so a late init read can't repopulate the in-memory caches after this reset.
 * Unlike clearOfflineQueue this guards only that in-memory window — init never
 * re-persists, so removeItem authoritatively clears disk regardless of timing.
 * Section-expansion state is a device-display pref, intentionally retained.
 * Contractually NON-THROWING so a removeItem failure can't skip the auth-state
 * reset that follows it in teardown.
 */
export async function clearHomeActionsState(): Promise<void> {
  if (initInFlight) {
    try {
      await initInFlight;
    } catch {}
  }
  recentCache = null;
  usageCountsCache = null;
  await Promise.all([
    AsyncStorage.removeItem(RECENT_KEY).catch(() => {}),
    AsyncStorage.removeItem(USAGE_COUNTS_KEY).catch(() => {}),
  ]);
}
