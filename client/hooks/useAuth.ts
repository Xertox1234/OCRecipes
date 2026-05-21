import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { User } from "@shared/types/auth";
import { registerPushToken } from "@/lib/push-token-registration";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AUTH_STORAGE_KEY = "@ocrecipes_auth";

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
          // Token invalid/expired
          await tokenStorage.clear();
          await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
          setState({ user: null, isLoading: false, isAuthenticated: false });
        }
      } catch {
        // Network error - use cached data if available
        const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        if (stored) {
          setState({
            user: JSON.parse(stored),
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
    try {
      await apiRequest("POST", "/api/auth/logout", {});
    } catch {}
    await tokenStorage.clear();
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
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
    deleteAccount,
    updateUser,
    checkAuth,
  };
}
