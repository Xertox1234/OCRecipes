/**
 * Debounced AsyncStorage persistence for cook session recovery.
 * Stores the current session ID and ingredient list so the user can resume
 * if the app backgrounds or crashes.
 *
 * Uses in-memory cache to avoid repeated AsyncStorage reads.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CookingSessionIngredient } from "@shared/types/cook-session";

const STORAGE_KEY = "cook_session_backup";
const TTL_MS = 30 * 60 * 1000; // 30 minutes (matches server TTL)

interface CookSessionBackup {
  sessionId: string;
  ingredients: CookingSessionIngredient[];
  savedAt: number;
}

// In-memory cache to avoid repeated AsyncStorage reads
let cachedBackup: CookSessionBackup | null = null;
let cacheInitialized = false;

export async function saveCookSessionBackup(
  sessionId: string,
  ingredients: CookingSessionIngredient[],
): Promise<void> {
  const backup: CookSessionBackup = {
    sessionId,
    ingredients,
    savedAt: Date.now(),
  };
  cachedBackup = backup;
  cacheInitialized = true;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(backup));
}

export async function loadCookSessionBackup(): Promise<CookSessionBackup | null> {
  if (cacheInitialized) {
    if (!cachedBackup) return null;
    // Check TTL on cached value
    if (Date.now() - cachedBackup.savedAt > TTL_MS) {
      await clearCookSessionBackup();
      return null;
    }
    return cachedBackup;
  }

  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  cacheInitialized = true;

  if (!raw) {
    cachedBackup = null;
    return null;
  }

  try {
    const backup: CookSessionBackup = JSON.parse(raw);
    // Reject stale sessions
    if (Date.now() - backup.savedAt > TTL_MS) {
      await clearCookSessionBackup();
      return null;
    }
    cachedBackup = backup;
    return backup;
  } catch {
    await clearCookSessionBackup();
    return null;
  }
}

export async function clearCookSessionBackup(): Promise<void> {
  cachedBackup = null;
  cacheInitialized = true;
  await AsyncStorage.removeItem(STORAGE_KEY);
}
