import AsyncStorage from "@react-native-async-storage/async-storage";

/** Every in-context tip and teaching toast (spec 2026-10-30). */
export type TipId =
  | "home-scan"
  | "quicklog-camera"
  | "pantry-receipt"
  | "plan-import"
  | "toast-camera"
  | "toast-import"
  | "scan-tips-carousel";

/** Features a tip teaches; once used, its tips never show. */
export type TaughtFeature = "scan" | "receiptScan" | "import";

const KEY = "@ocrecipes_feature_tips";

interface TipState {
  seen: TipId[];
  used: TaughtFeature[];
  typedLogs: number;
  /** How many times each scan example card has been shown. */
  exampleViews: Record<string, number>;
}

/** Scan example cards that count their showings. Stage 2 adds keys here. */
export type ScanExampleKey = "barcode" | "barcode-nutrition" | "barcode-front";

/** An example card stops showing once it has been seen this many times. */
export const EXAMPLE_CARD_SHOWS = 3;

const empty = (): TipState => ({
  seen: [],
  used: [],
  typedLogs: 0,
  exampleViews: {},
});

// The owner is saved inside the blob, so one phone shared by two accounts never
// hands the second person the first person's seen tips or typed-log count.
let owner: string | null = null;
let cache: TipState = empty();
// Nothing is written until the saved data has loaded: a tip marked during the
// load is kept in memory and merged in, never written over what was saved.
let ready = false;
const readyListeners = new Set<() => void>();

export function isFeatureTipsReady(): boolean {
  return ready;
}

export function onFeatureTipsReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

function parseExampleViews(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      out[key] = count;
    }
  }
  return out;
}

function parseSaved(raw: string | null, userId: string): TipState {
  if (!raw) return empty();
  try {
    const parsed = JSON.parse(raw) as Partial<TipState> & { owner?: string };
    if (parsed.owner !== userId) return empty();
    return {
      seen: Array.isArray(parsed.seen) ? parsed.seen : [],
      used: Array.isArray(parsed.used) ? parsed.used : [],
      typedLogs: typeof parsed.typedLogs === "number" ? parsed.typedLogs : 0,
      exampleViews: parseExampleViews(parsed.exampleViews),
    };
  } catch {
    // Unreadable data starts the person fresh; tips are low-stakes.
    return empty();
  }
}

function sumCounts(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out = { ...a };
  for (const [key, count] of Object.entries(b)) {
    out[key] = (out[key] ?? 0) + count;
  }
  return out;
}

export async function initFeatureTipsCache(
  userId: string | null,
): Promise<void> {
  owner = userId;
  ready = false;
  cache = empty();
  if (userId === null) return;
  const raw = await AsyncStorage.getItem(KEY).catch(() => null);
  if (owner !== userId) return; // a newer init or sign-out took over
  const saved = parseSaved(raw, userId);
  const pending = cache;
  cache = {
    seen: [...new Set([...saved.seen, ...pending.seen])],
    used: [...new Set([...saved.used, ...pending.used])],
    typedLogs: saved.typedLogs + pending.typedLogs,
    exampleViews: sumCounts(saved.exampleViews, pending.exampleViews),
  };
  ready = true;
  const hadPending =
    pending.seen.length +
      pending.used.length +
      pending.typedLogs +
      Object.keys(pending.exampleViews).length >
    0;
  if (hadPending) await persist();
  for (const listener of readyListeners) listener();
}

async function persist(): Promise<void> {
  if (!ready || owner === null) return;
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

export function getExampleViewCount(key: ScanExampleKey): number {
  return cache.exampleViews[key] ?? 0;
}

/** Returns the new number of times this example card has been shown. */
export async function incrementExampleViewCount(
  key: ScanExampleKey,
): Promise<number> {
  const next = getExampleViewCount(key) + 1;
  cache = { ...cache, exampleViews: { ...cache.exampleViews, [key]: next } };
  await persist();
  return next;
}

/** null until the saved counts have loaded, so a card never flashes early. */
export function shouldShowExampleCard(key: ScanExampleKey): boolean | null {
  if (!isFeatureTipsReady()) return null;
  return getExampleViewCount(key) < EXAMPLE_CARD_SHOWS;
}

/** Sign-out cleanup. Never throws; returns whether the disk removal succeeded. */
export async function clearFeatureTipsState(): Promise<boolean> {
  owner = null;
  ready = false;
  cache = empty();
  try {
    await AsyncStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
