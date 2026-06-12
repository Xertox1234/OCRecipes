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

export async function initOfflineQueue(): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  try {
    queue = raw ? (JSON.parse(raw) as QueuedMutation[]) : [];
  } catch {
    queue = [];
  }
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
