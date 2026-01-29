import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "@nutriscan_token";

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
    await AsyncStorage.setItem(TOKEN_KEY, token);
  },

  async clear(): Promise<void> {
    cachedToken = null;
    cacheInitialized = true;
    await AsyncStorage.removeItem(TOKEN_KEY);
  },

  // For testing or forced refresh
  invalidateCache(): void {
    cacheInitialized = false;
    cachedToken = null;
  },
};
