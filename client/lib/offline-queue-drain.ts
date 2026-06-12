import { apiRequest, queryClient } from "@/lib/query-client";
import {
  loadQueue,
  dequeue,
  incrementAttempts,
  type QueuedMutation,
} from "@/lib/offline-queue";
import { QUERY_KEYS } from "@/lib/query-keys";

type DrainErrorListener = (message: string) => void;
const drainErrorListeners = new Set<DrainErrorListener>();

export function subscribeToQueueDrainErrors(
  listener: DrainErrorListener,
): () => void {
  drainErrorListeners.add(listener);
  return () => drainErrorListeners.delete(listener);
}

function emitDrainError(): void {
  drainErrorListeners.forEach((l) =>
    l("A queued item couldn't be synced and was discarded."),
  );
}

let isDraining = false;
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [0, 2000, 4000, 8000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptDrain(item: QueuedMutation): Promise<void> {
  let done = false;
  while (!done) {
    // Increment before the request — survives force-quit mid-drain
    await incrementAttempts(item.id);
    const current = loadQueue().find((i) => i.id === item.id);
    if (!current) return; // dequeued externally

    const delayMs = RETRY_DELAYS_MS[Math.max(0, current.attempts - 1)] ?? 8000;
    if (delayMs > 0) await wait(delayMs);

    const init: RequestInit = {};
    if (current.method === "POST") {
      init.headers = { "X-Idempotency-Key": current.id };
    }

    try {
      await apiRequest(current.method, current.endpoint, current.body, init);
      await dequeue(current.id);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.frequentItems,
      });
      done = true;
    } catch (error) {
      const is4xx = error instanceof Error && /^4\d\d:/.test(error.message);
      if (is4xx || current.attempts >= MAX_ATTEMPTS) {
        await dequeue(current.id);
        emitDrainError();
        done = true;
      }
      // 5xx with remaining attempts: loop
    }
  }
}

export async function drainQueue(): Promise<void> {
  if (isDraining) return;
  isDraining = true;
  try {
    const sorted = [...loadQueue()].sort((a, b) => a.savedAt - b.savedAt);
    for (const item of sorted) {
      const exists = loadQueue().find((i) => i.id === item.id);
      if (exists) await attemptDrain(item);
    }
  } finally {
    isDraining = false;
  }
}
