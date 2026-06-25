import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Durable-state ownership control plane.
 *
 * Several pieces of device-local state outlive a session and are stored under
 * GLOBAL (not user-namespaced) keys: the home-action history, the offline
 * mutation queue, and the persisted TanStack Query cache. On a shared device the
 * only thing keeping one account's data from surfacing under the next is the
 * teardown sweep (`clearDurableLocalState` in useAuth) — and that sweep swallows
 * `removeItem` failures (it must, to stay non-throwing). A failed wipe therefore
 * leaves the prior user's data on disk where a later read — even after an app
 * restart — resurrects it under the next user.
 *
 * The fix anchors trust on IDENTITY AT READ TIME instead of on a teardown write
 * succeeding: this marker records the user id the durable stores are CONFIRMED
 * clean-for / owned-by. It advances ONLY after a confirmed wipe, so
 * `owner === X` guarantees the stores hold no other user's data. Each durable
 * store consults this marker before trusting its on-disk data (home-actions at
 * init; the offline queue at drain; the query cache via the auth-layer sweep).
 */
const OWNER_KEY = "@ocrecipes_durable_owner";

/**
 * The cached current-user blob written by useAuth on every auth resolution.
 * Defined here (not in useAuth) so the offline-queue drain can read the active
 * user id without importing the React auth-hook module.
 */
export const AUTH_STORAGE_KEY = "@ocrecipes_auth";

/** The user id the durable stores are confirmed clean-for, or null if unset. */
export async function getDurableOwner(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

/**
 * The id (as a string) of the user whose identity is currently cached on this
 * device — i.e. who a queue drain would replay captured writes as. Null when the
 * blob is absent or unparseable. Stringified so it compares cleanly against the
 * marker regardless of whether the id is serialized as a string or a number.
 */
export async function getActiveUserId(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const id = (JSON.parse(raw) as { id?: unknown })?.id;
    return id != null ? String(id) : null;
  } catch {
    return null;
  }
}

/**
 * Reconcile durable-store ownership with the user becoming active. If the marker
 * already names this user, the stores are theirs — no-op. Otherwise run the full
 * durable wipe and advance the marker ONLY after a CONFIRMED wipe, so a failed
 * disk wipe leaves the marker stale and the next auth resolution retries.
 *
 * `wipe` is injected (it is `clearDurableLocalState`) to avoid importing the
 * useAuth module here. It reports `true` only when every store's disk removal
 * succeeded. NEVER throws — callers `await` this before flipping auth state and
 * must not be able to skip that on a storage failure.
 */
export async function reconcileDurableOwner(
  userId: string,
  wipe: () => Promise<boolean>,
): Promise<void> {
  try {
    if ((await getDurableOwner()) === userId) return;
    if (await wipe()) {
      try {
        await AsyncStorage.setItem(OWNER_KEY, userId);
      } catch {}
    }
  } catch {}
}
