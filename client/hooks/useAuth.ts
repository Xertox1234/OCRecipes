import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest, getApiUrl } from "@/lib/query-client";

interface User {
  id: string;
  username: string;
  displayName?: string;
  dailyCalorieGoal?: number;
  onboardingCompleted?: boolean;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AUTH_STORAGE_KEY = "@nutriscan_auth";

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const checkAuth = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const localUser = JSON.parse(stored);
        try {
          const response = await fetch(`${getApiUrl()}/api/auth/me`, {
            credentials: "include",
          });
          if (response.ok) {
            const freshUser = await response.json();
            await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(freshUser));
            setState({ user: freshUser, isLoading: false, isAuthenticated: true });
          } else {
            setState({ user: localUser, isLoading: false, isAuthenticated: true });
          }
        } catch {
          setState({ user: localUser, isLoading: false, isAuthenticated: true });
        }
      } else {
        setState({ user: null, isLoading: false, isAuthenticated: false });
      }
    } catch {
      setState({ user: null, isLoading: false, isAuthenticated: false });
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await apiRequest("POST", "/api/auth/login", {
      username,
      password,
    });
    const user = await response.json();
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    setState({ user, isLoading: false, isAuthenticated: true });
    return user;
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const response = await apiRequest("POST", "/api/auth/register", {
      username,
      password,
    });
    const user = await response.json();
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    setState({ user, isLoading: false, isAuthenticated: true });
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
    } catch {
    }
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    setState({ user: null, isLoading: false, isAuthenticated: false });
  }, []);

  const updateUser = useCallback(async (updates: Partial<User>) => {
    if (!state.user) return;
    const response = await apiRequest("PUT", "/api/auth/profile", updates);
    const updatedUser = await response.json();
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updatedUser));
    setState((prev) => ({ ...prev, user: updatedUser }));
    return updatedUser;
  }, [state.user]);

  return {
    ...state,
    login,
    register,
    logout,
    updateUser,
    checkAuth,
  };
}
