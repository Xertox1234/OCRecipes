import AsyncStorage from "@react-native-async-storage/async-storage";

/** Every in-context tip and teaching toast (spec 2026-10-30). */
export type TipId =
  | "home-scan"
  | "quicklog-camera"
  | "pantry-receipt"
  | "plan-import"
  | "toast-camera"
  | "toast-import";

/** Features a tip teaches; once used, its tips never show. */
export type TaughtFeature = "scan" | "receiptScan" | "import";

const KEY = "@ocrecipes_feature_tips";

interface TipState {
  seen: TipId[];
  used: TaughtFeature[];
  typedLogs: number;
}

const empty = (): TipState => ({ seen: [], used: [], typedLogs: 0 });

// The owner is saved inside the blob, so one phone shared by two accounts never
// hands the second person the first person's seen tips or typed-log count.
let owner: string | null = null;
let cache: TipState = empty();

export async function initFeatureTipsCache(
  userId: string | null,
): Promise<void> {
  owner = userId;
  cache = empty();
  if (userId === null) return;
  const raw = await AsyncStorage.getItem(KEY).catch(() => null);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<TipState> & { owner?: string };
    if (parsed.owner !== userId) return;
    cache = {
      seen: Array.isArray(parsed.seen) ? parsed.seen : [],
      used: Array.isArray(parsed.used) ? parsed.used : [],
      typedLogs: typeof parsed.typedLogs === "number" ? parsed.typedLogs : 0,
    };
  } catch {
    // Unreadable data starts the person fresh; tips are low-stakes.
  }
}

async function persist(): Promise<void> {
  if (owner === null) return;
  await AsyncStorage.setItem(KEY, JSON.stringify({ owner, ...cache })).catch(
    () => {},
  );
}

export function hasSeenTip(id: TipId): boolean {
  return cache.seen.includes(id);
}

export async function markTipSeen(id: TipId): Promise<void> {
  if (hasSeenTip(id)) return;
  cache = { ...cache, seen: [...cache.seen, id] };
  await persist();
}

export function hasUsedFeature(feature: TaughtFeature): boolean {
  return cache.used.includes(feature);
}

export async function markFeatureUsed(feature: TaughtFeature): Promise<void> {
  if (hasUsedFeature(feature)) return;
  cache = { ...cache, used: [...cache.used, feature] };
  await persist();
}

/** Returns the new count of foods this person has logged by typing. */
export async function incrementTypedLogCount(): Promise<number> {
  cache = { ...cache, typedLogs: cache.typedLogs + 1 };
  await persist();
  return cache.typedLogs;
}

/** Sign-out cleanup. Never throws; returns whether the disk removal succeeded. */
export async function clearFeatureTipsState(): Promise<boolean> {
  owner = null;
  cache = empty();
  try {
    await AsyncStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
