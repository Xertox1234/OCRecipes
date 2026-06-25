import { apiRequest, queryClient } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import {
  loadQueue,
  dequeue,
  incrementAttempts,
  type QueuedMutation,
} from "@/lib/offline-queue";
import { QUERY_KEYS } from "@/lib/query-keys";
import { tokenStorage } from "@/lib/token-storage";
import { getDurableOwner, getActiveUserId } from "@/lib/durable-owner";

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

// Tracks server-error attempts separately from total attempts so that
// network-layer TypeErrors (device still offline) do not consume the retry
// budget. Reset when the item is successfully drained or permanently evicted.
const serverAttempts = new Map<string, number>();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resolves to true when the item was actually synced server-side (a real write
// happened — success, or an idempotent-DELETE 404), so the caller can invalidate
// affected queries once after the whole drain rather than per item (L7). Returns
// false when the item was left queued (still offline) or discarded as failed.
async function attemptDrain(item: QueuedMutation): Promise<boolean> {
  let done = false;
  let synced = false;
  // Capture the token of the user who is draining (defense-in-depth #2). If a
  // logout + relogin straddles a backoff `wait` below, the token changes
  // underneath us; we abort rather than replay this item under the new user.
  const tokenAtStart = await tokenStorage.get();
  while (!done) {
    // Increment before the request — survives force-quit mid-drain
    await incrementAttempts(item.id);
    const current = loadQueue().find((i) => i.id === item.id);
    if (!current) {
      serverAttempts.delete(item.id); // item dequeued externally — clean up
      return false;
    }

    const delayMs = RETRY_DELAYS_MS[Math.max(0, current.attempts - 1)] ?? 8000;
    if (delayMs > 0) await wait(delayMs);

    // Re-validate AFTER the backoff wait, right before dispatch (defense-in-
    // depth #2). The wait can be straddled by a teardown + relogin: apiRequest
    // reads tokenStorage at dispatch time, so without this re-check we would
    // POST this captured body under the NEW user's token. Abort the item if it
    // was cleared from the queue (e.g. clearOfflineQueue on logout), the token
    // changed underneath us, OR there is no token at all — never dispatch a
    // captured write with a null/missing bearer (a session-expiry that races
    // the drain would otherwise POST unauthenticated and falsely evict on 401).
    const stillQueued = loadQueue().find((i) => i.id === item.id);
    const tokenNow = await tokenStorage.get();
    if (!stillQueued || !tokenNow || tokenNow !== tokenAtStart) {
      serverAttempts.delete(item.id);
      return false;
    }

    const init: RequestInit = {};
    if (current.method === "POST") {
      init.headers = { "X-Idempotency-Key": current.id };
    }

    try {
      // Pin the token validated by the post-wait re-check above (tokenNow ===
      // tokenAtStart) as an explicit bearer. Without this, apiRequest re-reads
      // tokenStorage at dispatch time, leaving a microtask TOCTOU between the
      // re-check and that read where a logout+relogin could repoint the bearer.
      await apiRequest(
        current.method,
        current.endpoint,
        current.body,
        init,
        tokenAtStart,
      );
      await dequeue(current.id);
      serverAttempts.delete(current.id);
      synced = true;
      done = true;
    } catch (error) {
      // React Native's fetch throws a native `TypeError` when the request never
      // leaves the device (still offline). This typed check replaces the former
      // `/network request failed/i` message regex (the device-offline path
      // always surfaces as a TypeError, never an ApiError with a status).
      if (error instanceof TypeError) {
        // Device is still offline — do not consume a retry budget slot.
        // Leave the item in the queue; the next reconnect event will retry.
        return false;
      }
      // From here the error reached the server: it is an `ApiError` carrying a
      // numeric `status`. Branch on the status class instead of regexing the
      // message. A non-ApiError (or one without a status) is treated as a
      // server-side failure so it still consumes the retry budget and the
      // `while (!done)` loop stays bounded.
      const status = error instanceof ApiError ? error.status : undefined;
      // A replayed DELETE whose original response was lost returns 404 (the row
      // is already gone). That is the idempotent-success case the queue exists
      // for — treat it as a successful sync, NOT a failure (M1: otherwise the
      // drain discarded an already-completed delete and toasted a false error).
      if (status === 404 && current.method === "DELETE") {
        await dequeue(current.id);
        serverAttempts.delete(current.id);
        synced = true;
        done = true;
        break;
      }
      const is4xx = status !== undefined && status >= 400 && status < 500;
      const svrCount = (serverAttempts.get(current.id) ?? 0) + 1;
      serverAttempts.set(current.id, svrCount);
      if (is4xx || svrCount >= MAX_ATTEMPTS) {
        await dequeue(current.id);
        serverAttempts.delete(current.id);
        emitDrainError();
        done = true;
      }
      // 5xx with remaining server attempts: loop
    }
  }
  return synced;
}

export async function drainQueue(): Promise<void> {
  if (isDraining) return;
  // Set the concurrency lock SYNCHRONOUSLY, before the first `await` below.
  // The auth gate reads tokenStorage (async); if the lock were set after that
  // await, two near-simultaneous reconnect events could both pass the
  // `isDraining` check before either set the flag, defeating the single-drain
  // guard. Lock first, then gate inside try/finally so the lock always releases.
  isDraining = true;
  let anySynced = false;
  try {
    // Auth gate (defense-in-depth #1): never drain while unauthenticated. The
    // queue is a global, non-namespaced singleton and apiRequest attaches the
    // CURRENT bearer token at dispatch time, so draining with no session (or as
    // a different user) would replay the prior user's captured writes under
    // whoever is logged in next. H1 clears the queue on teardown; this closes
    // the window where a drain begins after logout but before the next login.
    if (!(await tokenStorage.get())) return;
    // Owner gate (cross-restart durability): skip when the queue isn't this
    // device's confirmed durable owner. The cold-start drain (App.tsx) fires
    // BEFORE checkAuth reconciles ownership, so a prior teardown whose wipe failed
    // could otherwise replay user A's surviving queue under user B's bearer token
    // here. getActiveUserId() is who we'd drain as (the cached auth blob);
    // getDurableOwner() is who the durable stores are confirmed clean-for. A
    // mismatch (incl. a legacy/absent owner) means don't replay — the auth-layer
    // reconcile will wipe it. The symmetric counterpart of home-actions' init gate.
    const owner = await getDurableOwner();
    if (!owner || owner !== (await getActiveUserId())) return;
    const sorted = [...loadQueue()].sort((a, b) => a.savedAt - b.savedAt);
    for (const item of sorted) {
      const exists = loadQueue().find((i) => i.id === item.id);
      if (exists && (await attemptDrain(item))) anySynced = true;
    }
  } finally {
    isDraining = false;
  }
  // L7: invalidate affected queries ONCE after the drain rather than per drained
  // item (was 3 invalidations × N items → a refetch storm on a full-queue
  // reconnect). Only when at least one item actually synced.
  if (anySynced) {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.frequentItems });
  }
}
