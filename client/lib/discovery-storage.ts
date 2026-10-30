import AsyncStorage from "@react-native-async-storage/async-storage";
import { logger } from "@/lib/logger";

const DISMISSED_KEY = "@ocrecipes_dismissed_discovery_cards";

let dismissedCache: Set<string> | null = null;

export async function initDiscoveryCache(): Promise<void> {
  const raw = await AsyncStorage.getItem(DISMISSED_KEY).catch(() => null);
  try {
    // Shape-validate (R24): only an array of ids is a dismissed set.
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    dismissedCache = new Set<string>(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    dismissedCache = new Set();
  }
}

export function getDismissedCardIds(): Set<string> {
  return new Set(dismissedCache ?? []);
}

export async function dismissCard(id: string): Promise<void> {
  const updated = new Set(dismissedCache ?? []);
  updated.add(id);
  dismissedCache = updated;
  // Never reject (R50): useDiscoveryCards.dismiss updates React state after
  // awaiting this, so a rejected write left the card on screen (and raised an
  // unhandled rejection). The card stays dismissed for this session regardless.
  await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify([...updated])).catch(
    (err: unknown) => logger.error("Failed to persist dismissed card", err),
  );
}
