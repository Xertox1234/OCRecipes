import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { logger } from "./logger";

// The session token lives in the iOS Keychain / Android Keystore via
// expo-secure-store. SecureStore keys allow only [A-Za-z0-9._-], so the key
// differs from the old AsyncStorage one.
const TOKEN_KEY = "ocrecipes_token";
// Where versions before the Keychain move kept the token. Read once to move it.
const LEGACY_TOKEN_KEY = "@ocrecipes_token";
// AsyncStorage is wiped when the app is deleted; the iOS Keychain is not. This
// marker tells a fresh install (marker absent) from an existing one, so a token
// left behind by a deleted copy of the app is dropped instead of signing in.
const INSTALL_MARKER_KEY = "@ocrecipes_install_marker";
// AFTER_FIRST_UNLOCK so a launch in the background after the first unlock can
// still read it; THIS_DEVICE_ONLY so the token never moves to another device
// through a backup.
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// In-memory cache to avoid a Keychain read on every request
let cachedToken: string | null = null;
let cacheInitialized = false;
// The first read in flight, shared by concurrent callers. set() and clear()
// wait until none is in flight, then claim the cache with no await in between,
// so a read can neither delete a newer token nor overwrite the cache after them.
let pendingLoad: Promise<string | null> | null = null;

async function markInstallSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(INSTALL_MARKER_KEY, "1");
  } catch (error) {
    logger.error("Failed to write install marker:", error);
  }
}

async function loadToken(): Promise<string | null> {
  let legacyToken: string | null = null;
  let installSeen = true;
  try {
    const [legacy, marker] = await Promise.all([
      AsyncStorage.getItem(LEGACY_TOKEN_KEY),
      AsyncStorage.getItem(INSTALL_MARKER_KEY),
    ]);
    legacyToken = legacy;
    installSeen = marker !== null;
  } catch (error) {
    // Can't tell a fresh install from an existing one, so don't wipe anything:
    // fall through to the plain Keychain read.
    logger.error("Failed to read token migration state:", error);
  }

  if (legacyToken) {
    // Signed in on a version that kept the token in AsyncStorage: move it.
    // Remove the old copy only once the Keychain holds it, so a failed write
    // retries on the next launch instead of signing the user out.
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, legacyToken, SECURE_OPTIONS);
      await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
      await markInstallSeen();
    } catch (error) {
      logger.error("Failed to move token to secure storage:", error);
    }
    return legacyToken;
  }

  if (!installSeen) {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY, SECURE_OPTIONS);
      // Only once the stale token is gone: a marker written after a failed
      // delete would make the next launch trust it.
      await markInstallSeen();
    } catch (error) {
      logger.error("Failed to drop token from a previous install:", error);
    }
    return null;
  }

  return SecureStore.getItemAsync(TOKEN_KEY, SECURE_OPTIONS);
}

export const tokenStorage = {
  async get(): Promise<string | null> {
    if (cacheInitialized) {
      return cachedToken;
    }
    if (!pendingLoad) {
      pendingLoad = loadToken()
        .then((token) => {
          cachedToken = token;
          cacheInitialized = true;
          return token;
        })
        .catch((error: unknown) => {
          // Not cached: a Keychain read can fail transiently (e.g. before the
          // first unlock), and the next call should try again.
          logger.error("Failed to read token from storage:", error);
          return null;
        })
        .finally(() => {
          pendingLoad = null;
        });
    }
    return pendingLoad;
  },

  async set(token: string): Promise<void> {
    if (!token || typeof token !== "string") {
      throw new Error("Token must be a non-empty string");
    }
    // No await between the last check and the cache write below.
    while (pendingLoad) {
      await pendingLoad;
    }
    cachedToken = token;
    cacheInitialized = true;
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token, SECURE_OPTIONS);
    } catch (error) {
      // The in-memory cache is already set, so the current session works; a
      // failed write only means the token won't survive a cold start. Surface
      // it rather than failing login on a transient storage hiccup.
      logger.error("Failed to persist token to storage:", error);
    }
    try {
      // An old copy left by a move that failed part-way would replace this
      // newer token on the next cold start.
      await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch (error) {
      logger.error("Failed to clear legacy token:", error);
    }
    await markInstallSeen();
  },

  async clear(): Promise<void> {
    // No await between the last check and the cache write below.
    while (pendingLoad) {
      await pendingLoad;
    }
    cachedToken = null;
    cacheInitialized = true;
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY, SECURE_OPTIONS);
    } catch (error) {
      // Asymmetric with set(): a failed clear leaves the token on disk, so a
      // cold restart could re-read it and silently re-authenticate. The current
      // session is still logged out (cache cleared), and a later set() overwrites
      // it. Hardening this (fully-cleared logout) is part of the deferred auth-
      // lifecycle work (todos/2026-05-29-iap-auth-lifecycle-hitl.md). Never throw.
      logger.error("Failed to clear token from storage:", error);
    }
    try {
      // A copy left by a move that failed part-way would sign the user back in.
      await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch (error) {
      logger.error("Failed to clear legacy token:", error);
    }
  },

  // For testing or forced refresh
  invalidateCache(): void {
    cacheInitialized = false;
    cachedToken = null;
  },
};
