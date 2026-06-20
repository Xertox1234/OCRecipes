import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@ocrecipes_offline_queue";
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DEPTH = 50;

export interface QueuedMutation {
  id: string;
  endpoint: string;
  method: string;
  body: unknown;
  attempts: number;
  savedAt: number;
}

let queue: QueuedMutation[] = [];

async function persist(): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue)).catch(
    () => {},
  );
}

// Per-item shape guard for persisted entries. A valid-JSON-but-non-array blob
// (e.g. "5", {}) or a schema-skewed item from an older app version must NOT crash
// startup (clearStale → queue.filter) or feed a malformed mutation into the drain.
function isQueuedMutation(value: unknown): value is QueuedMutation {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.endpoint === "string" &&
    typeof o.method === "string" &&
    typeof o.attempts === "number" &&
    typeof o.savedAt === "number"
  );
}

function parseQueue(raw: string | null): QueuedMutation[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  // Lenient per-item: drop entries that don't match the current shape; keep good
  // ones (version skew shouldn't discard a whole queue of valid pending writes).
  return parsed.filter(isQueuedMutation);
}

export async function initOfflineQueue(): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  // Merge persisted entries with anything enqueued during the getItem await
  // window (L2: don't clobber an enqueue that landed mid-load). IDs are unique
  // UUIDs so the two sets are disjoint; persisted (older) first, then cap depth.
  const merged = [...parseQueue(raw), ...queue];
  queue =
    merged.length > MAX_DEPTH
      ? merged.slice(merged.length - MAX_DEPTH)
      : merged;
  // Persist the merged set UNCONDITIONALLY before clearStale: a mid-load enqueue
  // already clobbered storage to just its own entry (its persist() ran while
  // getItem was awaiting), so without this write the merged result lives only in
  // memory and the persisted-older entries are lost on the next force-quit.
  // clearStale persists only when it actually filters, so it can't be relied on.
  await persist();
  await clearStale();
}

export async function clearStale(): Promise<void> {
  const now = Date.now();
  const fresh = queue.filter((item) => now - item.savedAt <= TTL_MS);
  if (fresh.length !== queue.length) {
    queue = fresh;
    await persist();
  }
}

export async function enqueue(
  item: Omit<QueuedMutation, "id" | "attempts" | "savedAt">,
): Promise<void> {
  const entry: QueuedMutation = {
    ...item,
    id: crypto.randomUUID(),
    attempts: 0,
    savedAt: Date.now(),
  };
  const next = [...queue, entry];
  queue = next.length > MAX_DEPTH ? next.slice(next.length - MAX_DEPTH) : next;
  await persist();
}

export async function dequeue(id: string): Promise<void> {
  queue = queue.filter((item) => item.id !== id);
  await persist();
}

export function loadQueue(): QueuedMutation[] {
  return [...queue];
}

export async function incrementAttempts(id: string): Promise<void> {
  queue = queue.map((item) =>
    item.id === id ? { ...item, attempts: item.attempts + 1 } : item,
  );
  await persist();
}

export async function clearOfflineQueue(): Promise<void> {
  queue = [];
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
