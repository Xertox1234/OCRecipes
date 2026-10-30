import { onlineManager, type Mutation } from "@tanstack/react-query";
import { queryClient, markQueryCacheRestored } from "./query-client";
import { logger } from "./logger";

/**
 * Paused-mutation signal and persisted-cache lifecycle handlers, split out of
 * `query-client.ts` (which owns the singletons, fetch helpers and the restore
 * gate). This module depends on `query-client`, never the reverse.
 */

/**
 * Paused-mutation signal (R19). Only the three food-log hooks are backed by the
 * durable offline queue (networkMode "always"); every other mutation fired
 * offline is PAUSED by TanStack's default networkMode "online" — its button
 * sits pending with no explanation. Emit once per offline stretch when a
 * mutation pauses, so `QueryErrorToastBridge` can say what is happening.
 * (Durable resume across a restart needs per-mutation setMutationDefaults —
 * see shouldDehydrateResumableMutation.)
 */
type PausedMutationListener = () => void;
const pausedMutationListeners = new Set<PausedMutationListener>();
let pausedNoticeSentThisOfflineStretch = false;

export function subscribeToPausedMutations(
  listener: PausedMutationListener,
): () => void {
  pausedMutationListeners.add(listener);
  return () => {
    pausedMutationListeners.delete(listener);
  };
}

queryClient.getMutationCache().subscribe((event) => {
  if (event.type !== "updated" || event.action.type !== "pause") return;
  if (pausedNoticeSentThisOfflineStretch) return;
  pausedNoticeSentThisOfflineStretch = true;
  pausedMutationListeners.forEach((listener) => listener());
});

// A reconnect ends the offline stretch: the next pause notifies again.
onlineManager.subscribe((isOnline) => {
  if (isOnline) pausedNoticeSentThisOfflineStretch = false;
});

/**
 * Persist a paused mutation only if it can actually RESUME after a restart
 * (N4). A dehydrated mutation keeps its key and variables but not its
 * `mutationFn`; on restore it gets one only from `setMutationDefaults` for its
 * `mutationKey`. Without one, resuming it rejects "No mutationFn found" — a
 * spurious global error toast for a write that silently never happened. To
 * make a mutation durable across restarts, give it a `mutationKey` and register
 * `queryClient.setMutationDefaults(key, { mutationFn })`; it is then persisted
 * and resumed automatically.
 */
export function shouldDehydrateResumableMutation(mutation: {
  state: Pick<Mutation["state"], "isPaused">;
  options: Pick<Mutation["options"], "mutationKey">;
}): boolean {
  if (!mutation.state.isPaused) return false;
  const key = mutation.options.mutationKey;
  if (!key) return false;
  return queryClient.getMutationDefaults(key).mutationFn !== undefined;
}

/**
 * The persister's `onSuccess`: release the durable-sweep restore gate, then
 * resume the paused mutations the restore brought back (N4). Without this they
 * only resume on a later offline→online TRANSITION — a cold start while online
 * never produces one, so they would sit paused until the next connectivity
 * blip. Offline, resumePausedMutations leaves them paused (they resume on
 * reconnect via the onlineManager subscription).
 */
export function handleQueryCacheRestored(): void {
  markQueryCacheRestored();
  queryClient.resumePausedMutations().catch(() => {
    // Best-effort, like the reconnect resume: each mutation's own error
    // handling (and the MutationCache net) surfaces failures.
  });
}

/**
 * The persister's `onError`: the restore failed (corrupt/oversized blob — the
 * library has discarded the persisted cache). Report it (R47; the provider
 * passes no error argument, hence the fixed one) and release the restore gate
 * so a failed restore can never wedge a session teardown.
 */
export function handleQueryCacheRestoreFailed(): void {
  logger.error(
    "Persisted query cache restore failed; cache discarded",
    new Error("PersistQueryClientProvider restore failed"),
  );
  markQueryCacheRestored();
}
