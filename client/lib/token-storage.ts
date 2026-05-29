import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "@ocrecipes_token";

// In-memory cache to avoid AsyncStorage read on every request
let cachedToken: string | null = null;
let cacheInitialized = false;

export const tokenStorage = {
  async get(): Promise<string | null> {
    if (!cacheInitialized) {
      try {
        cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
      } catch (error) {
        console.error("Failed to read token from storage:", error);
        cachedToken = null;
      }
      cacheInitialized = true;
    }
    return cachedToken;
  },

  async set(token: string): Promise<void> {
    if (!token || typeof token !== "string") {
      throw new Error("Token must be a non-empty string");
    }
    cachedToken = token;
    cacheInitialized = true;
    try {
      await AsyncStorage.setItem(TOKEN_KEY, token);
    } catch (error) {
      // The in-memory cache is already set, so the current session works; a
      // failed write only means the token won't survive a cold start. Surface
      // it rather than failing login on a transient storage hiccup.
      console.error("Failed to persist token to storage:", error);
    }
  },

  async clear(): Promise<void> {
    cachedToken = null;
    cacheInitialized = true;
    try {
      await AsyncStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      // Asymmetric with set(): a failed clear leaves the token on disk, so a
      // cold restart could re-read it and silently re-authenticate. The current
      // session is still logged out (cache cleared), and a later set() overwrites
      // it. Hardening this (fully-cleared logout) is part of the deferred auth-
      // lifecycle work (todos/2026-05-29-iap-auth-lifecycle-hitl.md). Never throw.
      console.error("Failed to clear token from storage:", error);
    }
  },

  // For testing or forced refresh
  invalidateCache(): void {
    cacheInitialized = false;
    cachedToken = null;
  },
};
