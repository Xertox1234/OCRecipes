import { useState, useEffect, useCallback } from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  apiRequest,
  getApiUrl,
  queryClient,
  notifySessionExpired,
  whenQueryCacheRestored,
} from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { User } from "@shared/types/auth";
import { registerPushToken } from "@/lib/push-token-registration";
import { clearOfflineQueue } from "@/lib/offline-queue";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AUTH_STORAGE_KEY = "@ocrecipes_auth";
const QUERY_CACHE_KEY = "@ocrecipes_query_cache";

/**
 * Best-effort teardown of every piece of device-local state that outlives a
 * session: the durable offline mutation queue, the persisted TanStack Query
 * cache, and the in-memory query cache. EVERY session-ending path — logout,
 * expireSession, deleteAccount, and the checkAuth dead-token branch — must call
 * this so the prior session's queued writes can't replay, and its cached data
 * can't rehydrate, under whoever signs in next on this device. The queue/cache
 * keys are global (not user-namespaced) and login() does not clear them, so
 * this is the only thing standing between two accounts on a shared device.
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
 */
async function clearDurableLocalState(): Promise<void> {
  try {
    await clearOfflineQueue();
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
    } catch {}
    await AsyncStorage.removeItem(QUERY_CACHE_KEY);
  } catch {}
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const checkAuth = useCallback(async () => {
    try {
      const token = await tokenStorage.get();
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
        const response = await fetch(`${getApiUrl()}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const freshUser = await response.json();
          await AsyncStorage.setItem(
            AUTH_STORAGE_KEY,
            JSON.stringify(freshUser),
          );
          setState({
            user: freshUser,
            isLoading: false,
            isAuthenticated: true,
          });
        } else {
          // Token invalid/expired (e.g. detected on foreground resume). Route a
          // 401 through the shared session-expiry signal so the
          // SessionExpiryBridge shows the "session expired" toast instead of a
          // silent drop. The bridge's isAuthenticated gate keeps a cold-launch
          // expired token silent. Non-401 failures are not session death.
          if (response.status === 401) {
            notifySessionExpired();
          }
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
        // Network error - use cached data if available
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
        if (cachedUser) {
          setState({
            user: cachedUser,
            isLoading: false,
            isAuthenticated: true,
          });
        } else {
          setState({ user: null, isLoading: false, isAuthenticated: false });
        }
      }
    } catch {
      setState({ user: null, isLoading: false, isAuthenticated: false });
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  // Re-validate auth when the app returns to the foreground, so a session that
  // expired (or was revoked) while backgrounded is caught on resume rather than
  // surfacing as a stale-looking failure on the next user action.
  //
  // A `hasBeenBackgrounded` latch — not a "previous === active" check — is the
  // correct cross-platform guard. iOS resumes via `background → inactive →
  // active` (two events), so a `prev === "background"` check would miss it; and
  // both the spurious mount-time `active` (common on Android) and iOS
  // `active → inactive → active` churn (control center, notification shade)
  // must NOT trigger a re-check. The latch only fires after a real background.
  // The in-flight guard collapses rapid app-switching into a single re-check.
  useEffect(() => {
    let hasBeenBackgrounded = false;
    let recheckInFlight = false;
    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "background") {
          hasBeenBackgrounded = true;
          return;
        }
        if (nextState === "active" && hasBeenBackgrounded && !recheckInFlight) {
          hasBeenBackgrounded = false;
          recheckInFlight = true;
          void checkAuth().finally(() => {
            recheckInFlight = false;
          });
        }
      },
    );
    return () => subscription.remove();
  }, [checkAuth]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await apiRequest("POST", "/api/auth/login", {
      username,
      password,
    });
    const { user, token } = await response.json();
    await tokenStorage.set(token);
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    setState({ user, isLoading: false, isAuthenticated: true });
    // Register push token after login (fire-and-forget, non-fatal)
    registerPushToken().catch(() => {});
    return user;
  }, []);

  const register = useCallback(
    async (
      username: string,
      password: string,
      email: string,
      ageConfirmed: boolean,
    ): Promise<
      | { status: "authenticated"; user: User }
      | { status: "verification_pending" }
    > => {
      const response = await apiRequest("POST", "/api/auth/register", {
        username,
        password,
        email,
        // COPPA 13+ age attestation — caller forwards user's actual checkbox
        // state; server enforces with `z.literal(true)` (zero trust on client).
        ageConfirmed,
      });
      const data = await response.json();
      // Verification OFF (fail-open) → server returns a token → auto-login,
      // preserving the pre-feature behavior.
      if (data.token) {
        await tokenStorage.set(data.token);
        await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data.user));
        setState({ user: data.user, isLoading: false, isAuthenticated: true });
        // Register push token after registration (fire-and-forget, non-fatal)
        registerPushToken().catch(() => {});
        return { status: "authenticated", user: data.user };
      }
      // Verification ON → no token issued; the caller routes to the verify
      // screen. The user is NOT authenticated yet.
      return { status: "verification_pending" };
    },
    [],
  );

  const logout = useCallback(async () => {
    // Edge: if the token already expired, this POST 401s with a TOKEN_* code →
    // the global interceptor fires the session-expiry toast. Accepted by design
    // — the user is logging out anyway, so "session expired" then Login is benign.
    try {
      await apiRequest("POST", "/api/auth/logout", {});
    } catch {}
    await tokenStorage.clear();
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    await clearDurableLocalState();
    setState({ user: null, isLoading: false, isAuthenticated: false });
  }, []);

  /**
   * Local-only session teardown for an expired/revoked token (a token-bearing
   * request came back 401). Distinct from `logout()`: it makes NO server call.
   * The token is already dead, so POSTing `/api/auth/logout` with it would 401
   * and re-trigger the global 401 interceptor — an expiry loop. We also clear
   * the TanStack Query cache so a subsequent sign-in does not read another
   * session's stale data. Local-cleanup failures are swallowed (never throw —
   * this runs from the `SessionExpiryBridge` event handler).
   *
   * MUST stay idempotent: concurrent 401s can fire the bridge more than once
   * (the bridge reads `isAuthenticated` from a render closure that hasn't yet
   * updated), so this may be called repeatedly. All operations here are no-ops
   * the second time, so the repeat is harmless.
   */
  const expireSession = useCallback(async () => {
    try {
      await tokenStorage.clear();
    } catch {}
    try {
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {}
    await clearDurableLocalState();
    setState({ user: null, isLoading: false, isAuthenticated: false });
  }, []);

  /**
   * Permanently deletes the authenticated user's account.
   * Requires the user's current password for confirmation (CCPA/PIPEDA right
   * to erasure). On success, clears local auth state — the root navigator
   * gate switches to the auth stack when `isAuthenticated` flips to false.
   *
   * Throws if the password is wrong or the API request fails. Once the server
   * confirms deletion, local-cleanup failures (token storage, AsyncStorage)
   * are swallowed — the account is gone, so we must NOT surface a retryable
   * error to the user. Auth state is always cleared on success.
   */
  const deleteAccount = useCallback(async (password: string) => {
    // Surface server-side errors (wrong password, network, etc.) to the caller
    // — the account is still intact and the user can retry.
    await apiRequest("DELETE", "/api/auth/account", { password });

    // Server confirmed deletion. Any local-cleanup failures past this point
    // must NOT propagate — the account no longer exists, so retrying would
    // just hit a 401. Best-effort clear, then always flip auth state to false.
    try {
      await tokenStorage.clear();
    } catch {}
    try {
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {}
    // A queued write would otherwise resurrect the "erased" account's data under
    // the new user, authenticated as them — so the durable sweep is mandatory on
    // the right-to-erasure path too.
    await clearDurableLocalState();
    setState({ user: null, isLoading: false, isAuthenticated: false });
  }, []);

  const updateUser = useCallback(
    async (updates: Partial<User>) => {
      if (!state.user) return;
      const response = await apiRequest("PUT", "/api/auth/profile", updates);
      const updatedUser = await response.json();
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updatedUser));
      setState((prev) => ({ ...prev, user: updatedUser }));
      return updatedUser;
    },
    [state.user],
  );

  /**
   * Change the authenticated user's account email. The server re-authenticates
   * with `password` before accepting the change. Two server modes:
   *  - verification OFF (fail-open) → the response is the updated user; cache it.
   *  - verification ON → the response is a neutral `{ status:
   *    "verification_pending" }` (anti-enumeration), so re-fetch `/api/auth/me`
   *    to surface a successful change (the new, now-unverified address) while a
   *    neutral no-op (duplicate / unchanged) leaves state as-is.
   * Throws on wrong password / duplicate (gate OFF) / rate-limit so the caller
   * can surface the error and keep the dialog open.
   */
  const changeEmail = useCallback(
    async (
      newEmail: string,
      password: string,
    ): Promise<
      { status: "updated"; user: User } | { status: "verification_pending" }
    > => {
      const response = await apiRequest("POST", "/api/auth/change-email", {
        newEmail,
        password,
      });
      const data = await response.json();
      // Gate OFF echoes the updated user (has an `id`); gate ON returns the
      // neutral pending status with no user object. `data` is the parsed JSON
      // (Response.json → any), matching how updateUser consumes it uncast.
      if (data && typeof data === "object" && "id" in data) {
        await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
        setState((prev) => ({ ...prev, user: data }));
        return { status: "updated", user: data };
      }
      await checkAuth();
      return { status: "verification_pending" };
    },
    [checkAuth],
  );

  return {
    ...state,
    login,
    register,
    logout,
    expireSession,
    deleteAccount,
    updateUser,
    changeEmail,
    checkAuth,
  };
}
