/**
 * Module-level session plumbing for useAuth: the cold-start / foreground
 * session check, the pending-revoke retry and its sign-in exclusion, and the
 * durable local-state wipe every session-ending path runs. Moved out of
 * useAuth.ts unchanged (600-line bar); the module-level state below is still a
 * single instance per app.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  apiRequest,
  getApiUrl,
  queryClient,
  notifySessionExpired,
  whenQueryCacheRestored,
} from "@/lib/query-client";
import { tokenStorage, pendingRevokeStorage } from "@/lib/token-storage";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { logger } from "@/lib/logger";
import type { User } from "@shared/types/auth";
import { registerPushToken } from "@/lib/push-token-registration";
import { clearOfflineQueue } from "@/lib/offline-queue";
import { clearHomeActionsState } from "@/lib/home-actions-storage";
import { clearFeatureTipsState } from "@/lib/feature-tips-storage";
import { clearRecentSearches } from "@/lib/recent-recipe-searches-storage";
import { clearScheduledCoachReminders } from "@/hooks/useNotebookNotifications";
import { reconcileDurableOwner, AUTH_STORAGE_KEY } from "@/lib/durable-owner";

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const QUERY_CACHE_KEY = "@ocrecipes_query_cache";

/**
 * Deadline for the cold-start / foreground `/api/auth/me` check (R16). RN fetch
 * has no default timeout, so on a captive portal or half-open connection the
 * check would hang forever — the root navigator spins indefinitely and the
 * cached-user offline fallback in the catch is never reached. Short, because
 * this gates app launch and the fallback is a good answer.
 */
export const AUTH_ME_TIMEOUT_MS = 10_000;

/**
 * Retry a server logout that failed (offline, 5xx), using the OLD token kept
 * in pendingRevokeStorage. The server logout bumps the user's tokenVersion,
 * which revokes EVERY token that user holds — so on this device it is never
 * sent while that same user is signed in again, or while a sign-in is in
 * progress (it would end the new session); their record is dropped instead,
 * and the old token simply expires as before. Another user's old token is safe
 * to revoke: tokenVersion is per user.
 *
 * Known gap (owner ruling 2026-11-04, accepted): a session the same user opened
 * on ANOTHER device after the failed logout also ends when the retry lands —
 * as it would have, had the logout succeeded after that sign-in. Closing it
 * needs a server-side cutoff (revoke only tokens issued before the logout).
 *
 * Plain fetch with the old token, never apiRequest: apiRequest attaches the
 * CURRENT token and its 401 handling would expire the current session. 2xx or
 * 401 (already revoked/expired) forgets the record; anything else keeps it for
 * the next launch or foreground. Never throws. Concurrent triggers share one run.
 */
let pendingRevokeRun: Promise<void> | null = null;

/**
 * Sign-ins in progress. The server issues the new token BEFORE establishSession
 * drops the pending record, so a retry and a sign-in must never overlap: a
 * revoke landing after the login would end the new session. A sign-in first
 * waits out a retry already on the wire; a retry does not start while a
 * sign-in is in progress (a later trigger handles the record).
 */
let signInsInFlight = 0;
export async function withSignInExclusion<T>(
  signIn: () => Promise<T>,
): Promise<T> {
  signInsInFlight += 1;
  try {
    await pendingRevokeRun; // never rejects
    return await signIn();
  } finally {
    signInsInFlight -= 1;
  }
}

export function retryPendingRevoke(
  currentUserId: string | undefined,
): Promise<void> {
  if (signInsInFlight > 0) return Promise.resolve();
  if (pendingRevokeRun) return pendingRevokeRun;
  pendingRevokeRun = (async () => {
    try {
      const pending = await pendingRevokeStorage.get();
      if (!pending) return;
      if (currentUserId !== undefined && pending.userId === currentUserId) {
        await pendingRevokeStorage.clear();
        return;
      }
      const response = await fetchWithTimeout(
        `${getApiUrl()}/api/auth/logout`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${pending.token}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        },
        AUTH_ME_TIMEOUT_MS,
      );
      if (response.ok || response.status === 401) {
        await pendingRevokeStorage.clear();
      }
    } catch {
      // Offline or timed out: keep the record for the next try.
    }
  })().finally(() => {
    pendingRevokeRun = null;
  });
  return pendingRevokeRun;
}

/** Drop a pending revoke that belongs to the user now signing in (see above). */
export async function dropPendingRevokeFor(
  userId: string | number,
): Promise<void> {
  const pending = await pendingRevokeStorage.get();
  if (pending && pending.userId === String(userId)) {
    await pendingRevokeStorage.clear();
  }
}

/**
 * Best-effort teardown of every piece of device-local state that outlives a
 * session: the durable offline mutation queue, the persisted TanStack Query
 * cache, the in-memory query cache, and the per-user home-action history (recent
 * actions + usage counts). EVERY session-ending path — logout, expireSession,
 * deleteAccount, and the checkAuth dead-token branch — must call this so the
 * prior session's queued writes can't replay, and its cached/behavioral data
 * can't rehydrate, under whoever signs in next on this device. These keys are
 * all global (not user-namespaced) and login() does not clear them, so this is
 * the only thing standing between two accounts on a shared device.
 *
 * Contractually NON-THROWING: callers rely on this never rejecting so a clear
 * failure can't skip the auth-state reset that follows it. Clears the offline
 * queue FIRST so the privacy-critical replay fix always runs even if a later
 * removeItem rejects (clearOfflineQueue swallows its own errors, can't throw).
 *
 * clearOfflineQueue() serializes against the startup queue load, and the query
 * cache clear waits on whenQueryCacheRestored(), so neither a concurrent
 * initOfflineQueue() re-persist nor an in-flight PersistQueryClientProvider
 * restore can resurrect the prior session's durable state AFTER this sweep,
 * closing the cross-user replay/rehydrate race on a shared device. The queue
 * close is fully deterministic (a hard promise dependency); the query-cache
 * close holds as long as the restore settles within the gate's safety timeout
 * (whenQueryCacheRestored), which it always does outside of broken provider
 * wiring — see that function for the bound.
 *
 * Returns whether EVERY store's disk wipe was confirmed (no swallowed
 * `removeItem` failure). `reconcileDurableOwner` advances the durable-owner
 * marker only on a `true` return, so a failed disk wipe leaves the marker stale
 * and the next auth resolution retries — making the no-cross-user-resurrection
 * guarantee survive an app restart, not just an in-session timing window. The
 * five teardown callers ignore the return (they only need the best-effort wipe);
 * it is the reconcile path that reads it.
 */
export async function clearDurableLocalState(): Promise<boolean> {
  let ok = true;
  try {
    if (!(await clearOfflineQueue())) ok = false;
    // Clear this device's per-user home-action history (recent-actions list +
    // per-action usage counts). These are global, non-namespaced keys that would
    // otherwise seed the next user's Home UI on a shared device. Placed right
    // after the queue clear so it still runs if the query-cache block below
    // throws; it serializes against its own startup init and is non-throwing.
    // (Section-expansion state stays — a device-display pref; theme is its own module.)
    if (!(await clearHomeActionsState())) ok = false;
    // Which teaching tips were seen / features used: same shared-device bleed.
    if (!(await clearFeatureTipsState())) ok = false;
    // Recent recipe searches: same global, non-namespaced key with the same
    // cross-user bleed risk on a shared device; clear them on every session-ending
    // path. Non-throwing; a failed wipe feeds `ok` so the durable-owner marker is
    // not advanced past this user (the next auth resolution retries).
    if (!(await clearRecentSearches())) ok = false;
    // OS-scheduled coach reminders carry this user's journal text and outlive
    // the session in the OS; cancel them and drop their global id map.
    if (!(await clearScheduledCoachReminders())) ok = false;
    // Gate on the persisted-cache restore: a teardown that races a cold-start
    // restore could otherwise clear() the cache before the restore rehydrates the
    // prior user's data into memory, re-exposing it under the next user. Resolves
    // immediately once restore has settled (bounded by a safety timeout).
    await whenQueryCacheRestored();
    // Clear the in-memory cache FIRST, then remove the disk key. The throttled
    // persister reads the LIVE cache when it fires, so clearing memory first means
    // any re-persist (pending, or scheduled by clear() itself) only ever writes an
    // EMPTY cache — never re-persisting A's data in the gap before removeItem.
    // Guard clear() independently so a (pathological) throw can't skip the disk
    // removal — the original ordering relied on clear() being last for this.
    try {
      queryClient.clear();
    } catch (err) {
      // Not fatal to the sweep (the disk removal below still runs), but a
      // failed privacy wipe must leave an off-device signal (R47).
      logger.error("Durable local state wipe: query cache clear failed", err);
    }
    // Guard the disk removal independently so its failure feeds `ok` (gating the
    // owner-marker advance) without aborting — and without poisoning the marker
    // into never advancing if some OTHER step throws.
    try {
      await AsyncStorage.removeItem(QUERY_CACHE_KEY);
    } catch (err) {
      logger.error("Durable local state wipe: query cache removal failed", err);
      ok = false;
    }
  } catch (err) {
    logger.error("Durable local state wipe threw", err);
    ok = false;
  }
  // The non-throwing clear* steps report failure only as `false`. The retry on
  // the next auth resolution limits user impact, but a failed privacy wipe must
  // still be visible off-device (R47) — logger.error routes to the reporter.
  if (!ok) {
    logger.error(
      "Durable local state wipe incomplete",
      new Error(
        "clearDurableLocalState: a wipe step failed; retried next auth",
      ),
    );
  }
  return ok;
}

/**
 * apiRequest sends the stored bearer when there is one, so a signed-in caller
 * gets a nonce bound to its account (the server rejects public nonces for it).
 */
export async function fetchNonce(
  purpose: "sign_in" | "link" | "reauth",
): Promise<{ nonce: string; nonceHash: string }> {
  const res = await apiRequest("POST", "/api/auth/social/nonce", { purpose });
  return (await res.json()) as { nonce: string; nonceHash: string };
}

/**
 * Reconcile durable-store ownership for a user becoming active. Guards against a
 * malformed identity (missing id) writing an "undefined" owner — a no-op when the
 * id is absent. Stringifies the id so the marker compares cleanly whether the
 * server serializes it as a string or a number. `clearDurableLocalState` is the
 * confirmed-wipe the marker advance is gated on.
 */
export async function reconcileOwnerFor(id: unknown): Promise<void> {
  if (id == null) return;
  await reconcileDurableOwner(String(id), clearDurableLocalState);
}

/**
 * The auth state to resume with when /api/auth/me can't confirm the session
 * but didn't say it is dead (a network error, a 429, a 5xx): the cached
 * profile if there is one, otherwise signed out — and the token is kept either
 * way, so the next check can restore the session.
 */
async function resumeFromCachedProfile(): Promise<AuthState> {
  const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
  let cachedUser: User | null = null;
  if (stored) {
    try {
      cachedUser = JSON.parse(stored) as User;
    } catch {
      // Corrupt cache blob. This must NOT log the user out: the session
      // token is still valid — only the convenience cache is unreadable.
      // Drop the poison key so it stops re-throwing, then fall through to
      // the no-cache path WITH the token preserved. The next foreground
      // re-check / relaunch re-validates and restores the session.
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }
  if (!cachedUser) {
    return { user: null, isLoading: false, isAuthenticated: false };
  }
  // Reconcile here too: this offline-resume path runs neither a teardown
  // nor any other reconcile, and the query cache (unlike the home-actions
  // and offline-queue stores, which gate at their own read points) has no
  // independent owner gate. A user switch can't happen offline, so the
  // marker normally matches and this is a no-op that preserves the offline
  // cache; it only wipes when the marker proves the restored data isn't
  // this user's (a prior failed wipe), closing the last query-cache hole.
  await reconcileOwnerFor(cachedUser.id);
  return { user: cachedUser, isLoading: false, isAuthenticated: true };
}

/**
 * The session check behind useAuth's `checkAuth` (cold start, foreground
 * resume, after an email change). Writes the resolved state through
 * `setState`; leaves it untouched when the token changed mid-check.
 */
export async function runAuthCheck(
  setState: (next: AuthState) => void,
): Promise<void> {
  try {
    let token: string | null;
    try {
      // A failed Keychain/Keystore read is NOT "no token": retry once, and if
      // it still fails resume from the cached user WITHOUT the durable sweep
      // below — the token is most likely still there (e.g. a launch racing
      // the device lock), and sweeping would destroy un-drained offline
      // writes. tokenStorage does not cache a failed read, so later requests
      // and the next foreground re-check read it again.
      token = await tokenStorage
        .getOrThrow()
        .catch(() => tokenStorage.getOrThrow());
    } catch {
      setState(await resumeFromCachedProfile());
      return;
    }
    if (!token) {
      // Cold-start with no token is also a teardown-shaped path: a force-quit
      // can interrupt a session teardown in the gap between tokenStorage.clear()
      // and the durable sweep, leaving the durable offline queue / persisted
      // query cache on disk with no token. Sweep them here too so this branch
      // is consistent with the other four teardown paths and the prior
      // session's residual durable state is cleared. The sweep now SERIALIZES
      // against the startup initializers it used to race — clearOfflineQueue()
      // awaits the in-flight initOfflineQueue() re-persist, and the query-cache
      // clear awaits the persister's restore — so an orphaned queue / cache can
      // no longer be resurrected after the sweep (the same close applies to the
      // dead-token branch below). clearDurableLocalState() is contractually
      // non-throwing and a verified no-op on the common "fresh install, never
      // logged in" cold start.
      await clearDurableLocalState();
      setState({ user: null, isLoading: false, isAuthenticated: false });
      return;
    }

    try {
      const response = await fetchWithTimeout(
        `${getApiUrl()}/api/auth/me`,
        { headers: { Authorization: `Bearer ${token}` } },
        AUTH_ME_TIMEOUT_MS,
      );

      // The token changed while /me was in flight (sign-out + new sign-in, or
      // a 2FA token swap): this answer is about a session that already ended,
      // so it must neither clear the new token nor write the old profile
      // (auth audit 2026-10-10 L7). The new session set its own state.
      if ((await tokenStorage.get()) !== token) return;

      if (response.ok) {
        const freshUser = await response.json();
        await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(freshUser));
        // Reconcile durable-store ownership BEFORE the Home tree can mount: a
        // cold start that resolves a DIFFERENT user than the durable stores were
        // last confirmed clean-for (e.g. a prior logout's wipe failed) wipes them
        // here so the stale history/queue/cache can't surface under this user.
        // A no-op when the marker already matches (the common resume).
        await reconcileOwnerFor(freshUser.id);
        setState({
          user: freshUser,
          isLoading: false,
          isAuthenticated: true,
        });
        // A persisted session never passes through sign-in, so refresh the
        // server's push token here too (never prompts; fire-and-forget).
        registerPushToken({ prompt: false }).catch(() => {});
      } else if (response.status !== 401) {
        // Only a 401 means the token is dead. A 429 or a 5xx (a deploy, a
        // rate limiter, a proxy hiccup) is a transient failure: tearing the
        // session down here signed the user out and wiped their offline
        // queue. Treat it like a network error — keep the token and resume
        // from the cached profile. (No `throw` into the catch below: React
        // Compiler skips a function that throws inside a try.)
        setState(await resumeFromCachedProfile());
      } else {
        // Token invalid/expired (e.g. detected on foreground resume). Route
        // the 401 through the shared session-expiry signal so the
        // SessionExpiryBridge shows the "session expired" toast instead of a
        // silent drop. The bridge's isAuthenticated gate keeps a cold-launch
        // expired token silent.
        notifySessionExpired();
        await tokenStorage.clear();
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
        // Dead-token detection is a session teardown (an expired/revoked token
        // caught on cold launch or foreground resume). The SessionExpiryBridge
        // can't cover this path — its isAuthenticated gate is false on cold
        // launch — so the durable-state sweep must happen here.
        await clearDurableLocalState();
        setState({ user: null, isLoading: false, isAuthenticated: false });
      }
    } catch {
      // Network error — keep the token and resume from the cached profile.
      setState(await resumeFromCachedProfile());
    }
  } catch {
    setState({ user: null, isLoading: false, isAuthenticated: false });
  }
}
