import AsyncStorage from "@react-native-async-storage/async-storage";
import { logger } from "@/lib/logger";

/**
 * The last local date (YYYY-MM-DD) a full Coach opening brief was shown on
 * this device. It decides whether opening the Coach tab is the first visit
 * of the day (open a fresh chat with the brief) and whether a later new chat
 * gets the short form. A device display memory, like the theme: losing it
 * only means one extra full brief.
 */
export const COACH_BRIEF_SEEN_KEY = "@ocrecipes/coach_brief_seen_date";

// `undefined` = not read yet this session; `null` = read, nothing saved.
// Read at sign-in (MainTabNavigator) so the Coach screen can decide on its
// first render, before the user can tap anything.
let cache: string | null | undefined;

export function getCachedLastBriefSeenDate(): string | null | undefined {
  return cache;
}

/** Reads the saved date once. A failed read stays unknown and is retried. */
export async function loadLastBriefSeenDate(): Promise<string | null> {
  if (cache !== undefined) return cache;
  try {
    const raw = await AsyncStorage.getItem(COACH_BRIEF_SEEN_KEY);
    // A mark made while the read was in flight is newer than the disk.
    if (cache === undefined) cache = raw;
    return cache;
  } catch {
    return cache ?? null;
  }
}

/** Records that today's full brief was shown. Never throws. */
export function markBriefSeen(localDate: string): void {
  cache = localDate;
  AsyncStorage.setItem(COACH_BRIEF_SEEN_KEY, localDate).catch((err: unknown) =>
    logger.warn("Failed to save the Coach brief date", err),
  );
}
