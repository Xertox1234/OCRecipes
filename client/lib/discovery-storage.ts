import AsyncStorage from "@react-native-async-storage/async-storage";

const DISMISSED_KEY = "@ocrecipes_dismissed_discovery_cards";

let dismissedCache: Set<string> | null = null;

export async function initDiscoveryCache(): Promise<void> {
  const raw = await AsyncStorage.getItem(DISMISSED_KEY).catch(() => null);
  try {
    dismissedCache = new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    dismissedCache = new Set();
  }
}

export function getDismissedCardIds(): Set<string> {
  return dismissedCache ?? new Set();
}

export async function dismissCard(id: string): Promise<void> {
  const updated = new Set(getDismissedCardIds());
  updated.add(id);
  dismissedCache = updated;
  await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify([...updated]));
}
