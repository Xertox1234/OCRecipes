import { useState, useEffect, useCallback } from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  apiRequest,
  getApiUrl,
  queryClient,
  notifySessionExpired,
} from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { User } from "@shared/types/auth";
import { registerPushToken } from "@/lib/push-token-registration";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AUTH_STORAGE_KEY = "@ocrecipes_auth";
const QUERY_CACHE_KEY = "@ocrecipes_query_cache";

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
    async (username: string, password: string, ageConfirmed: boolean) => {
      const response = await apiRequest("POST", "/api/auth/register", {
        username,
        password,
        // COPPA 13+ age attestation — caller forwards user's actual checkbox
        // state; server enforces with `z.literal(true)` (zero trust on client).
        ageConfirmed,
      });
      const { user, token } = await response.json();
      await tokenStorage.set(token);
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
      setState({ user, isLoading: false, isAuthenticated: true });
      // Register push token after registration (fire-and-forget, non-fatal)
      registerPushToken().catch(() => {});
      return user;
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
    // Clear cached query data so the next sign-in can't read the previous
    // session's data. Guarded so a throw can't skip the setState logout below.
    try {
      await AsyncStorage.removeItem(QUERY_CACHE_KEY);
      queryClient.clear();
    } catch {}
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
    // Guarded: a throw here (unlikely) must not skip the setState below — that
    // is the actual logout, and the function is contractually non-throwing.
    try {
      await AsyncStorage.removeItem(QUERY_CACHE_KEY);
      queryClient.clear();
    } catch {}
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
    // Drop the deleted account's cached query data so it can't be read by
    // whoever signs in next on this device. Guarded so it can't skip the
    // setState below (same non-throwing contract as the storage clears above).
    try {
      await AsyncStorage.removeItem(QUERY_CACHE_KEY);
      queryClient.clear();
    } catch {}
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

  return {
    ...state,
    login,
    register,
    logout,
    expireSession,
    deleteAccount,
    updateUser,
    checkAuth,
  };
}
