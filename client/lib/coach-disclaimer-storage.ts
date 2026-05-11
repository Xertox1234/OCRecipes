import AsyncStorage from "@react-native-async-storage/async-storage";

export const COACH_DISCLAIMER_STORAGE_KEY =
  "@ocrecipes/coach_disclaimer_dismissed";

/**
 * Returns whether the medical disclaimer has been previously dismissed by
 * the user on this device. Defaults to `false` (not dismissed) on storage
 * read failure so the disclaimer is shown by default.
 */
export async function isCoachDisclaimerDismissed(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(COACH_DISCLAIMER_STORAGE_KEY);
    return value === "true";
  } catch {
    return false;
  }
}

/**
 * Persists that the user dismissed the medical disclaimer. Swallows write
 * errors — worst case the disclaimer reappears on the next session.
 */
export async function setCoachDisclaimerDismissed(): Promise<void> {
  try {
    await AsyncStorage.setItem(COACH_DISCLAIMER_STORAGE_KEY, "true");
  } catch {
    // Swallow — UI has already updated, persistence is best-effort.
  }
}
