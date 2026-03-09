/**
 * Debounced AsyncStorage persistence for cook session recovery.
 * Stores the current session ID and ingredient list so the user can resume
 * if the app backgrounds or crashes.
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

export async function saveCookSessionBackup(
  sessionId: string,
  ingredients: CookingSessionIngredient[],
): Promise<void> {
  const backup: CookSessionBackup = {
    sessionId,
    ingredients,
    savedAt: Date.now(),
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(backup));
}

export async function loadCookSessionBackup(): Promise<CookSessionBackup | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const backup: CookSessionBackup = JSON.parse(raw);
    // Reject stale sessions
    if (Date.now() - backup.savedAt > TTL_MS) {
      await clearCookSessionBackup();
      return null;
    }
    return backup;
  } catch {
    await clearCookSessionBackup();
    return null;
  }
}

export async function clearCookSessionBackup(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
