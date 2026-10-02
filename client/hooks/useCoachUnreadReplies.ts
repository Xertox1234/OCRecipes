import { skipToken, useQuery, type QueryClient } from "@tanstack/react-query";

// ---- Coach "reply ready" state ----
//
// A Coach reply can finish while the user is looking at something else: they
// popped back to the chat list, or switched tab. A bottom-tab screen stays
// mounted when its tab loses focus, so "the chat screen unmounted" misses the
// most common case — the signal is FOCUS, not unmount. Two pieces of session
// state let the rest of the app tell the user:
//
//  - which Coach conversation is on screen right now (ChatScreen writes it
//    while focused and clears it on blur and unmount), and
//  - which conversations hold a reply the user has not seen (the red dot on
//    the Coach tab).
//
// Both live in the TanStack Query cache under dedicated sentinel keys, never a
// bare module-level `let`/`Map`: `queryClient.clear()` already runs on every
// local auth teardown path, so nothing here can outlive a logout (see
// docs/solutions/design-patterns/query-cache-as-ephemeral-client-store-2026-09-29.md
// and docs/solutions/conventions/clear-query-cache-on-auth-teardown-2026-05-30.md).
// That doc's two gotchas apply to both keys:
//  - nothing but the tab-bar badge observes them, so `gcTime` is pinned to
//    `Infinity` before the first write (an unobserved entry's gc timer is
//    scheduled once and never rescheduled by later writes);
//  - a clear writes an empty-but-DEFINED value (`[]` / `null`) —
//    `setQueryData(key, undefined)` is a no-op that leaves the old value.
// Neither key is in App.tsx's PERSISTED_QUERY_KEYS allowlist, so both stay in
// memory and a cold start begins with no marks.

/** Conversation ids with a Coach reply the user has not seen, as `number[]`. */
export const UNREAD_COACH_REPLIES_KEY = ["__unreadCoachReplies"] as const;
/** The Coach conversation currently on screen, as `number | null`. */
export const VIEWED_COACH_CONVERSATION_KEY = [
  "__viewedCoachConversation",
] as const;

function pinSentinelKeys(queryClient: QueryClient): void {
  queryClient.setQueryDefaults(UNREAD_COACH_REPLIES_KEY, { gcTime: Infinity });
  queryClient.setQueryDefaults(VIEWED_COACH_CONVERSATION_KEY, {
    gcTime: Infinity,
  });
}

export function getUnreadCoachReplyIds(queryClient: QueryClient): number[] {
  return queryClient.getQueryData<number[]>(UNREAD_COACH_REPLIES_KEY) ?? [];
}

export function getViewedCoachConversation(
  queryClient: QueryClient,
): number | null {
  return (
    queryClient.getQueryData<number | null>(VIEWED_COACH_CONVERSATION_KEY) ??
    null
  );
}

/** Record that `conversationId` holds a reply the user has not seen. */
export function markCoachReplyUnread(
  queryClient: QueryClient,
  conversationId: number,
): void {
  pinSentinelKeys(queryClient);
  const ids = getUnreadCoachReplyIds(queryClient);
  if (ids.includes(conversationId)) return;
  queryClient.setQueryData<number[]>(UNREAD_COACH_REPLIES_KEY, [
    ...ids,
    conversationId,
  ]);
}

/**
 * Drop `conversationId`'s unread mark (the user opened it, or deleted it).
 * The last mark clearing writes `[]`, never `undefined`.
 */
export function clearCoachReplyUnread(
  queryClient: QueryClient,
  conversationId: number,
): void {
  const ids = getUnreadCoachReplyIds(queryClient);
  if (!ids.includes(conversationId)) return;
  queryClient.setQueryData<number[]>(
    UNREAD_COACH_REPLIES_KEY,
    ids.filter((id) => id !== conversationId),
  );
}

/**
 * Call from a `useFocusEffect` callback in the Coach chat screen: marks
 * `conversationId` as the one on screen (opening a conversation also clears
 * its unread mark) and returns the leave function that effect cleanup runs on
 * blur AND on unmount. `null` is the new-chat flow, which has no conversation
 * to view yet — nothing to register, and nothing to clean up.
 *
 * The leave function clears the marker only while it is still THIS
 * conversation's: a newer view (the screen re-pointed at another conversation
 * before the old cleanup ran) must survive it.
 */
export function viewCoachConversation(
  queryClient: QueryClient,
  conversationId: number | null,
): (() => void) | undefined {
  if (conversationId === null) return undefined;
  pinSentinelKeys(queryClient);
  queryClient.setQueryData<number | null>(
    VIEWED_COACH_CONVERSATION_KEY,
    conversationId,
  );
  clearCoachReplyUnread(queryClient, conversationId);
  return () => {
    if (getViewedCoachConversation(queryClient) === conversationId) {
      queryClient.setQueryData<number | null>(
        VIEWED_COACH_CONVERSATION_KEY,
        null,
      );
    }
  };
}

type CoachReplyReadyListener = (conversationId: number) => void;

const coachReplyReadyListeners = new Set<CoachReplyReadyListener>();

/**
 * Subscribe to "a Coach reply landed unseen" events. A module-level emitter
 * (same shape as `subscribeToQueryErrors` in `@/lib/query-client`) because the
 * reply finishes inside a streaming XHR callback outside the React tree, where
 * the hook-based toast cannot be called. Returns an unsubscribe function.
 */
export function subscribeToCoachReplyReady(
  listener: CoachReplyReadyListener,
): () => void {
  coachReplyReadyListeners.add(listener);
  return () => {
    coachReplyReadyListeners.delete(listener);
  };
}

/**
 * A Coach reply finished streaming. If the user is NOT on that conversation's
 * chat screen, record the unread mark (red dot) and tell subscribers (toast).
 * Call only from a reply that actually completed — never for an aborted,
 * errored or cut-off stream, which is not a reply the user is waiting on.
 */
export function noteCoachReplyFinished(
  queryClient: QueryClient,
  conversationId: number,
): void {
  if (getViewedCoachConversation(queryClient) === conversationId) return;
  markCoachReplyUnread(queryClient, conversationId);
  coachReplyReadyListeners.forEach((listener) => listener(conversationId));
}

// Module-level so `useQuery` keeps one `select` identity across renders.
const selectHasUnread = (ids: number[]): boolean => ids.length > 0;

/**
 * True while any conversation holds an unread Coach reply. A real observer, so
 * the tab bar re-renders when marks change, but with `select` collapsing the
 * ids to a boolean it re-renders only when the ANSWER flips. `skipToken`
 * (rather than `enabled: false`) also overrides the app-wide default `queryFn`,
 * so not even an explicit refetch can turn this cache-only key into an API call
 * (and a test client with no default `queryFn` gets no dev console error).
 *
 * `data` stays `undefined` until the first mark is written, and `select` does
 * not run for `undefined`, hence the `?? false`.
 *
 * Constraint: an unfiltered `resetQueries()` / `removeQueries()` would wipe the
 * marks (an unfiltered `invalidateQueries()` is harmless — a cache-only query
 * is never refetched). No client code calls either today; `queryClient.clear()`
 * on auth teardown is the one intended wipe. A mounted observer keeps stale
 * `data` across `clear()` until its host re-renders, which is moot in the app
 * because the tab navigator unmounts when `isAuthenticated` flips.
 */
export function useHasUnreadCoachReply(): boolean {
  const { data } = useQuery<number[], Error, boolean>({
    queryKey: UNREAD_COACH_REPLIES_KEY,
    queryFn: skipToken,
    gcTime: Infinity,
    select: selectHasUnread,
  });
  return data ?? false;
}
