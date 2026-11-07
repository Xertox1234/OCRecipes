import AsyncStorage from "@react-native-async-storage/async-storage";
import { logger } from "@/lib/logger";

/**
 * Whether the Coach screen's dashboard card is folded — a device display
 * preference (like Home's section state), so it is not per-user and is not
 * cleared on sign-out.
 */
export const COACH_DASHBOARD_FOLDED_KEY = "@ocrecipes/coach_dashboard_folded";

// Once read (or set) this session, later mounts open in the right state at
// once instead of flashing the open card first.
let cache: boolean | null = null;

/** The known choice, or null until it has been read this session. */
export function getCachedCoachDashboardFolded(): boolean | null {
  return cache;
}

/**
 * Reads the saved choice. Nothing saved, or a failed read, opens the card;
 * a failed read is not cached, so the next mount tries again.
 */
export async function loadCoachDashboardFolded(): Promise<boolean> {
  if (cache !== null) return cache;
  try {
    const raw = await AsyncStorage.getItem(COACH_DASHBOARD_FOLDED_KEY);
    // A choice made while the read was in flight is newer than the disk.
    if (cache === null) cache = raw === "true";
    return cache;
  } catch {
    return cache ?? false;
  }
}

/** Saves the choice. Never throws: the card has already moved. */
export function setCoachDashboardFolded(folded: boolean): void {
  cache = folded;
  AsyncStorage.setItem(COACH_DASHBOARD_FOLDED_KEY, String(folded)).catch(
    (err: unknown) => logger.warn("Failed to save the Coach card fold", err),
  );
}
