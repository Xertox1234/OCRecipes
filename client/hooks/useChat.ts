import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  apiRequest,
  getApiUrl,
  type QueryErrorMeta,
  type MutationErrorMeta,
} from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { getDeviceTimezone } from "@/lib/timezone";
import {
  clearCoachReplyUnread,
  noteCoachReplyFinished,
} from "@/hooks/useCoachUnreadReplies";
import { useCallback, useEffect, useState, useRef } from "react";
import { SSE_TIMEOUT_MS } from "@shared/constants/sse";
import type { SavedRecipeLinkStatus } from "@shared/schemas/saved-items";
import {
  finderBlockSchema,
  type FinderAction,
  type FinderBlock,
} from "@shared/schemas/recipe-finder";

// Must exceed the server's SSE_TIMEOUT_MS (same route, server/routes/chat.ts):
// the server arms its timer only after auth and the daily-limit write, so an
// equal client timer fires first and the server's graceful
// `{ error: "Response timeout" }` never arrives. Same 150s ceiling as
// useCoachStream's XHR_TIMEOUT_MS; this hook has no inactivity watchdog.
export const CHAT_XHR_TIMEOUT_MS = SSE_TIMEOUT_MS + 30_000;

export interface ChatConversation {
  id: number;
  userId: string;
  title: string;
  type: string; // 'coach' | 'recipe'
  isPinned: boolean;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: unknown;
  createdAt: string;
}

/** Recipe data from SSE recipe card event */
export interface StreamingRecipe {
  title: string;
  description: string;
  difficulty: string;
  timeEstimate: string;
  servings: number;
  ingredients: { name: string; quantity: string; unit: string }[];
  instructions: string[];
  dietTags: string[];
  imageUrl?: string | null;
}

// ---- Recipe/remix post-abort poll ----
//
// The recipe/remix finish-and-save policy (server/routes/chat.ts) keeps
// generating — and saves the full reply — after the client disconnects. An
// intentional abort (RecipeChatScreen unmounting mid-stream) marks the
// conversation's queries stale with `refetchType: "none"` below, but that
// only refetches once a query OBSERVER mounts; a screen that stays mounted
// (ChatListScreen) or is reopened before generation finishes never gets a
// second look. #1096's fixed 2s settle margin (useRefreshOnFocus) covers the
// coach path (a couple of DB writes) but not this one, where generation can
// run for tens of seconds. This polls instead, bounded by a cap.
//
// Poll interval and cap: SSE_TIMEOUT_MS is the server's own ceiling on every
// chat SSE connection (coach, recipe, remix), so no post-disconnect save can
// land later than that measured from the ORIGINAL request — comfortably
// less measured from the abort, which happens partway through. The +30s
// margin covers the final DB write plus network latency, mirroring
// CHAT_XHR_TIMEOUT_MS's own margin over the same constant.
export const RECIPE_TURN_POLL_INTERVAL_MS = 5_000;
export const RECIPE_TURN_POLL_CAP_MS = SSE_TIMEOUT_MS + 30_000;

// Marks live only for the session: stored in the TanStack Query cache
// (never a bare module-level singleton — see
// docs/solutions/design-patterns/global-mutable-client-singleton-lifecycle-2026-06-19.md)
// so `queryClient.clear()` — already called on every local auth teardown
// path (logout/expireSession/deleteAccount, docs/rules/client-state.md) —
// wipes it automatically. No new teardown wiring needed, and a poll's own
// `refetchInterval` timer is owned by its query observer, so it is cleared
// by React Query itself the moment that observer unmounts.
const PENDING_RECIPE_TURNS_KEY = ["__pendingRecipeTurns"] as const;
type PendingRecipeTurns = Record<number, number>; // conversationId -> abortedAt (ms)

/**
 * Marks a recipe/remix conversation as having an outstanding server-side
 * turn after an intentional client abort. Call from the aborting screen's
 * unmount cleanup — `useChatConversations`/`useChatMessages` consumers that
 * opt into `pollPendingRecipe*` below poll until it resolves or expires.
 */
export function useMarkPendingRecipeTurn() {
  const queryClient = useQueryClient();
  // The pollers below never subscribe to this key via `useQuery` (they only
  // read/write it directly), so its default gcTime (5 min) would otherwise
  // garbage-collect the WHOLE map on a timer rooted at its first-ever write
  // and never rescheduled by later writes — shorter than two marks can
  // legitimately span in one session, and unrelated to how fresh any single
  // mark still is. Pin it before the first write (below) ever happens; a
  // per-render call is idempotent and cheap.
  queryClient.setQueryDefaults(PENDING_RECIPE_TURNS_KEY, { gcTime: Infinity });
  return useCallback(
    (conversationId: number) => {
      queryClient.setQueryData<PendingRecipeTurns>(
        PENDING_RECIPE_TURNS_KEY,
        (prev) => ({ ...(prev ?? {}), [conversationId]: Date.now() }),
      );
    },
    [queryClient],
  );
}

/**
 * Shared `refetchInterval` decision for a query that should keep polling
 * while a pending recipe turn relevant to it hasn't resolved yet. Every
 * pending id past `RECIPE_TURN_POLL_CAP_MS` is dropped unconditionally
 * (safety net). `relevant` scopes which ids matter to THIS query — `"all"`
 * for the conversation list (any pending id might settle there), or a
 * specific `conversationId` for a messages query (only its own turn does) —
 * so an unrelated pending id can't keep an uninvolved query polling.
 * `isResolved` inspects the freshly-fetched data to decide whether a given
 * pending id has settled; once true (or expired) that id's mark clears.
 */
function pollRecipeTurn<TData>(
  queryClient: QueryClient,
  relevant: "all" | number,
  data: TData | undefined,
  isResolved: (
    data: TData,
    conversationId: number,
    abortedAt: number,
  ) => boolean,
): number | false {
  const pending = queryClient.getQueryData<PendingRecipeTurns>(
    PENDING_RECIPE_TURNS_KEY,
  );
  if (!pending || Object.keys(pending).length === 0) return false;

  const now = Date.now();
  const next: PendingRecipeTurns = {};
  let changed = false;
  for (const [idStr, abortedAt] of Object.entries(pending)) {
    const conversationId = Number(idStr);
    const expired = now - abortedAt > RECIPE_TURN_POLL_CAP_MS;
    const resolved =
      !expired &&
      data !== undefined &&
      isResolved(data, conversationId, abortedAt);
    if (expired || resolved) {
      changed = true;
      continue;
    }
    next[conversationId] = abortedAt;
  }
  if (changed) {
    // `setQueryData` treats a resulting value of `undefined` as a no-op (it
    // leaves the previous data in place) — write `{}` instead so an
    // emptied-out map actually clears the stale entries.
    queryClient.setQueryData<PendingRecipeTurns>(
      PENDING_RECIPE_TURNS_KEY,
      next,
    );
  }

  const stillRelevant = Object.keys(next)
    .map(Number)
    .some((id) => relevant === "all" || relevant === id);
  return stillRelevant ? RECIPE_TURN_POLL_INTERVAL_MS : false;
}

export function useChatConversations(
  type?: "coach" | "recipe",
  opts?: {
    search?: string;
    page?: number;
    /** Poll while any recipe/remix turn is pending a post-abort save (see above). */
    pollPendingRecipeTurns?: boolean;
  },
) {
  const queryClient = useQueryClient();
  // pollPendingRecipeTurns configures polling BEHAVIOR only — excluded from
  // the query key so opting a caller into it doesn't fragment a cache entry
  // another caller already shares (e.g. CoachProScreen's identical "coach"
  // fetch) into a second, separately-fetched entry.
  const { pollPendingRecipeTurns, ...keyOpts } = opts ?? {};
  const queryKey = type
    ? ["/api/chat/conversations", { type, ...keyOpts }]
    : ["/api/chat/conversations", opts ? keyOpts : undefined];

  return useQuery<ChatConversation[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (opts?.search) params.set("search", opts.search);
      if (opts?.page) params.set("page", String(opts.page));
      const query = params.toString();
      const url = `/api/chat/conversations${query ? `?${query}` : ""}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
    ...(pollPendingRecipeTurns && {
      refetchInterval: (query) =>
        pollRecipeTurn(
          queryClient,
          "all",
          query.state.data,
          (conversations, conversationId, abortedAt) => {
            const convo = conversations.find((c) => c.id === conversationId);
            return !!convo && new Date(convo.updatedAt).getTime() > abortedAt;
          },
        ),
    }),
  });
}

export function useChatMessages(
  conversationId: number | null,
  meta?: QueryErrorMeta,
  opts?: {
    /** Poll while THIS conversation's recipe/remix turn is pending a post-abort save (see above). */
    pollPendingRecipeTurn?: boolean;
  },
) {
  const queryClient = useQueryClient();
  return useQuery<ChatMessage[]>({
    queryKey: [`/api/chat/conversations/${conversationId}/messages`],
    enabled: !!conversationId,
    meta,
    ...(opts?.pollPendingRecipeTurn &&
      conversationId !== null && {
        refetchInterval: (query) =>
          pollRecipeTurn(
            queryClient,
            conversationId,
            query.state.data,
            (messages, id, abortedAt) =>
              id === conversationId &&
              messages.some(
                (m) =>
                  m.role === "assistant" &&
                  new Date(m.createdAt).getTime() > abortedAt,
              ),
          ),
      }),
  });
}

/**
 * `meta` is threaded (not hardcoded) because this hook is shared by 5
 * screens with different error-handling conventions: pass
 * `{ silentError: true }` from a caller that already shows its own visible
 * error on a conversation-create failure (ChatScreen, ChatListScreen,
 * CoachProScreen via CoachChat's own catch, CoachOverlayContent). Leave it
 * unset for a caller with no local handling — the global net now covers it.
 */
export function useCreateConversation(meta?: MutationErrorMeta) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data?: {
      title?: string;
      type?: "coach" | "recipe" | "remix";
      sourceRecipeId?: number;
    }) => {
      const res = await apiRequest("POST", "/api/chat/conversations", {
        title: data?.title,
        type: data?.type,
        ...(data?.sourceRecipeId && { sourceRecipeId: data.sourceRecipeId }),
      });
      return (await res.json()) as ChatConversation;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["/api/chat/conversations"],
      });
    },
    meta,
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/chat/conversations/${id}`);
    },
    onSuccess: (_data, id) => {
      // A deleted conversation can never be opened, so nothing else would clear
      // its "unread Coach reply" mark and the Coach tab dot would stick.
      clearCoachReplyUnread(queryClient, id);
      void queryClient.invalidateQueries({
        queryKey: ["/api/chat/conversations"],
      });
    },
    // Both call sites (ChatListScreen, AllConversationsScreen) already show
    // a visible toast via a per-call onError — the global net would double it.
    meta: { silentError: true },
  });
}

export function useSendMessage(
  conversationId: number | null,
  options?: {
    /**
     * Coach chat (ChatScreen) only. When a reply finishes while the user is
     * NOT on that conversation's chat screen — they popped back, or switched
     * tab — record an unread mark (Coach tab dot) and raise the "Coach
     * replied" toast; see `useCoachUnreadReplies`. Off by default: the other
     * consumer, RecipeChatScreen, never registers a viewed conversation, so
     * with this on every recipe reply would flag itself unread while the user
     * is looking at it. (Recipe/remix replies also have their own post-abort
     * poll.)
     */
    notifyWhenAway?: boolean;
  },
) {
  const queryClient = useQueryClient();
  const notifyWhenAway = options?.notifyWhenAway ?? false;
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingRecipe, setStreamingRecipe] =
    useState<StreamingRecipe | null>(null);
  const [allergenWarning, setAllergenWarning] = useState<string | null>(null);
  const [streamingFinder, setStreamingFinder] = useState<FinderBlock | null>(
    null,
  );
  // Recipe finder progress ("Searching community recipes…") for the thinking bubble.
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  // Refs for stale-closure-safe access inside streaming callbacks
  const isStreamingRef = useRef(false);
  const streamingContentRef = useRef("");
  // The in-flight XHR, exposed so a caller (e.g. a screen's unmount cleanup)
  // can abort it from outside sendMessage.
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  // Bumped by every sendMessage call, by abortStream, and on unmount.
  // sendMessage's token read is async; its continuation — and its `finally`
  // teardown — only touch this hook's shared, single-slot UI state when the
  // epoch they captured is still current, so an abort (or a newer send)
  // can't leave an orphaned request or clobber whichever request is current
  // now. Same pattern as useCoachStream's streamEpochRef.
  const sendEpochRef = useRef(0);

  const abortStream = useCallback(() => {
    if (!isStreamingRef.current) return; // nothing in flight — no-op
    sendEpochRef.current += 1;
    xhrRef.current?.abort();
    xhrRef.current = null;
    isStreamingRef.current = false;
    setIsStreaming(false);
    setStreamingContent("");
    setStreamingRecipe(null);
    setAllergenWarning(null);
    setStreamingFinder(null);
    setStreamingStatus(null);
  }, []);

  // On unmount, stop a send that has NOT gone out yet: bumping the epoch
  // makes sendMessage's token-read continuation return instead of sending
  // an orphaned request once the token resolves. A reply that is already
  // streaming is deliberately left running (user ruling 2026-09-29): its
  // done handler still refreshes the conversation, so the full answer is
  // there on return. Screens that want to stop the reply on leave call
  // abortStream in their own cleanup. No setState here: the component is
  // gone.
  useEffect(() => {
    return () => {
      sendEpochRef.current += 1;
    };
  }, []);

  const sendMessage = useCallback(
    async (
      content: string,
      screenContext?: string,
      conversationIdOverride?: number,
      options?: { finderAction?: FinderAction },
    ) => {
      const effectiveId = conversationIdOverride ?? conversationId;
      if (!effectiveId) return;
      // Refuse an overlapping send: `xhrRef`/`isStreamingRef` are single-slot
      // state for this hook instance, so a second concurrent call would
      // overwrite (and orphan) the first in-flight request's XHR reference —
      // see todos/archive/P3-2026-09-24-chat-stream-hooks-xhrref-last-write-wins.md.
      if (isStreamingRef.current) return;
      isStreamingRef.current = true;
      const epoch = ++sendEpochRef.current;
      streamingContentRef.current = "";
      setIsStreaming(true);
      setStreamingContent("");
      setStreamingRecipe(null);
      setAllergenWarning(null);
      setStreamingFinder(null);
      setStreamingStatus(null);
      setStreamError(false);
      setRequestError(null);

      let receivedDone = false;
      // Captured separately from xhrRef so the `finally` below (outside this
      // `try` block's own scope) can tell whether xhrRef still points at
      // THIS request's XHR before nulling it — defense in depth alongside
      // the isStreamingRef guard above.
      let ownXhr: XMLHttpRequest | null = null;

      try {
        const baseUrl = getApiUrl();
        const url = new URL(
          `/api/chat/conversations/${effectiveId}/messages`,
          baseUrl,
        );
        const token = await tokenStorage.get();
        if (epoch !== sendEpochRef.current) {
          // Aborted (or superseded by a newer send) while awaiting the
          // token — no XHR was ever created, so there's nothing to cancel.
          // Whoever bumped the epoch (abortStream, unmount, or a newer
          // sendMessage) already reset — or now owns — the shared UI
          // state; this call must not touch it or send a request.
          return;
        }
        // X-Timezone is required, not decorative: a coach conversation's
        // notebook follow-up dates and "today" are anchored in this zone on
        // the server, which falls back to UTC without it.
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Timezone": getDeviceTimezone(),
        };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const requestBody = JSON.stringify({
          content,
          ...(screenContext && { screenContext }),
          ...(options?.finderAction && { finderAction: options.finderAction }),
        });

        // XHR is used instead of fetch because React Native's fetch polyfill
        // returns response.body = null for text/event-stream responses on iOS/Android.
        // XMLHttpRequest.onprogress fires incrementally and is the established
        // pattern for SSE in React Native.
        let pendingFlush = false;
        let sseErrorReceived = false;
        let sseBuffer = "";
        let yieldForRender = false;

        const processLine = (line: string) => {
          if (!line.startsWith("data: ")) return;
          try {
            const data = JSON.parse(line.slice(6));

            if (typeof data.status === "string") {
              setStreamingStatus(data.status);
            }
            if (data.finder) {
              // An old or malformed block is dropped, never rendered.
              const parsed = finderBlockSchema.safeParse(data.finder);
              if (parsed.success) setStreamingFinder(parsed.data);
            }
            if (data.recipe) {
              setStreamingRecipe(data.recipe);
              if (data.allergenWarning) {
                setAllergenWarning(data.allergenWarning);
              }
            }
            if (data.imageUrl) {
              setStreamingRecipe((prev) =>
                prev ? { ...prev, imageUrl: data.imageUrl } : null,
              );
            }
            if (data.imageUnavailable) {
              setStreamingRecipe((prev) =>
                prev ? { ...prev, imageUrl: null } : null,
              );
            }
            if (data.content) {
              streamingContentRef.current += data.content;
              if (!pendingFlush) {
                pendingFlush = true;
                setTimeout(() => {
                  if (isStreamingRef.current) {
                    setStreamingContent(streamingContentRef.current);
                  }
                  pendingFlush = false;
                }, 16);
              }
            }
            if (data.done) {
              receivedDone = true;
              // End-of-stream flush: `done` can arrive before the 16 ms timer
              // above fires (e.g. a {finder, content} offer event), and the
              // stream state is cleared right after — publish the pending
              // content now so the pending-bubble bridge can capture it.
              if (isStreamingRef.current) {
                setStreamingContent(streamingContentRef.current);
                // Only when the timer had not published it yet; see the
                // yield after the stream promise below.
                if (pendingFlush) yieldForRender = true;
              }
              void queryClient.invalidateQueries({
                queryKey: [`/api/chat/conversations/${effectiveId}/messages`],
              });
              void queryClient.invalidateQueries({
                queryKey: ["/api/chat/conversations"],
              });
              // Here, not in `finally`: an aborted, errored or cut-off stream
              // is not a reply the user is waiting on. Placed after the
              // refresh so the conversation is already marked stale by the
              // time anyone acts on the toast.
              //
              // Only the session that sent the message may record or announce
              // its reply. The stream is deliberately not aborted on leave
              // (#1183) or on sign-out, so it can finish after logout has
              // cleared the query cache, or after another account signed in.
              // The token this send went out with identifies its session: it
              // is written only at login/register and every teardown nulls it
              // before the cache is cleared, so a late `done` sees a different
              // token (or none) and stays quiet instead of re-creating a mark
              // for a conversation the current user may not own.
              if (notifyWhenAway) {
                void tokenStorage.get().then(
                  (current) => {
                    if (current === token) {
                      noteCoachReplyFinished(queryClient, effectiveId);
                    }
                  },
                  () => {
                    // Unreadable token: the session can't be told apart, so
                    // stay quiet rather than risk a mark for someone else.
                  },
                );
              }
            }
            // Server-sent application error — surface via requestError instead
            // of throwing, so callers that don't await sendMessage still see it.
            if (data.error) {
              setRequestError(
                typeof data.error === "string"
                  ? data.error
                  : "Something went wrong. Please try again.",
              );
              sseErrorReceived = true;
            }
          } catch {
            // Incomplete or invalid JSON chunk — skip silently
          }
        };

        const processChunk = (chunk: string) => {
          sseBuffer += chunk;
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";
          for (const line of lines) {
            if (sseErrorReceived) break;
            processLine(line);
          }
        };

        let aborted = false;

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          ownXhr = xhr;
          xhrRef.current = xhr;
          xhr.open("POST", url.href, true);
          xhr.timeout = CHAT_XHR_TIMEOUT_MS;
          Object.entries(headers).forEach(([k, v]) =>
            xhr.setRequestHeader(k, v),
          );

          let processedLength = 0;

          xhr.onprogress = () => {
            const chunk = xhr.responseText.slice(processedLength);
            processedLength = xhr.responseText.length;
            processChunk(chunk);
          };

          xhr.onload = () => {
            // Flush any data not yet delivered via onprogress
            const remaining = xhr.responseText.slice(processedLength);
            if (remaining) processChunk(remaining);

            if (xhr.status < 200 || xhr.status >= 300) {
              let errorMsg = "Something went wrong. Please try again.";
              try {
                const parsed = JSON.parse(xhr.responseText);
                if (typeof parsed.error === "string") errorMsg = parsed.error;
              } catch {
                // ignore parse errors
              }
              setRequestError(errorMsg);
            }
            resolve();
          };

          xhr.onerror = () =>
            reject(
              new Error(
                "Network error. Please check your connection and try again.",
              ),
            );
          xhr.ontimeout = () =>
            reject(new Error("Request timed out. Please try again."));
          xhr.onabort = () => {
            aborted = true;
            resolve();
          };

          xhr.send(requestBody);
        });

        // On the onload-only path the done-flush, this continuation and the
        // `finally` clear would otherwise land in one React batch, with the
        // clear winning and no render ever seeing the content. Yield one
        // macrotask so that render happens while isStreaming is still true.
        if (yieldForRender) await new Promise((r) => setTimeout(r, 0));

        // Stream ended — check if it completed normally
        if (aborted) {
          // The XHR was intentionally aborted (e.g. RecipeChatScreen
          // unmounted). Recipe/remix generation keeps running and saves the
          // reply server-side after a disconnect (finish-and-save policy —
          // see server/routes/chat.ts); this used to be skipped entirely
          // back when the server also stopped on disconnect and there was
          // nothing new to fetch. Mark both queries stale so the next view
          // refetches the finished reply instead of serving this pre-settle
          // cache. `refetchType: "none"` defers the refetch instead of
          // racing the server's still-in-flight write (same pattern as
          // CoachOverlayContent / CoachChat, #1060).
          void queryClient.invalidateQueries({
            queryKey: [`/api/chat/conversations/${effectiveId}/messages`],
            refetchType: "none",
          });
          void queryClient.invalidateQueries({
            queryKey: ["/api/chat/conversations"],
            refetchType: "none",
          });
        } else if (!receivedDone && streamingContentRef.current.length > 0) {
          setStreamError(true);
          void queryClient.invalidateQueries({
            queryKey: [`/api/chat/conversations/${effectiveId}/messages`],
          });
          void queryClient.invalidateQueries({
            queryKey: ["/api/chat/conversations"],
          });
        }
      } catch (e) {
        // Catch-all: network errors from xhr.onerror/ontimeout propagate
        // here, as does a rejected tokenStorage.get(). A stale call's
        // failure (e.g. the token read rejected after this call was
        // aborted or superseded) must not report an error for whichever
        // request is current now.
        if (epoch === sendEpochRef.current) {
          setRequestError(
            e instanceof Error && e.message
              ? e.message
              : "Something went wrong. Please try again.",
          );
        }
      } finally {
        // Ownership-scoped: only the call that still owns the current
        // epoch may reset this hook's shared, single-slot UI state. A
        // stale call's finally can run after a newer call has already
        // started (abortStream and a fresh sendMessage both bump the
        // epoch synchronously) — resetting unconditionally here would
        // tear down whichever request is current now.
        if (epoch === sendEpochRef.current) {
          // Only clear the ref if it still points at this request's XHR —
          // a guard against a future caller that bypasses the
          // isStreamingRef check above and starts a second request;
          // without this, the second request's cleanup could null out the
          // first request's still-live reference (or vice versa).
          if (xhrRef.current === ownXhr) xhrRef.current = null;
          isStreamingRef.current = false;
          setIsStreaming(false);
          setStreamingContent("");
          setStreamingRecipe(null);
          setAllergenWarning(null);
          setStreamingFinder(null);
          setStreamingStatus(null);
        }
        // requestError is intentionally NOT cleared here: clearing in the same
        // synchronous finally frame as setRequestError(errorMsg) batches to null
        // before the component re-renders (React 19 automatic batching). It is
        // cleared at the start of the next sendMessage call instead — that
        // holds for every consumer of this hook regardless of screen
        // lifetime: ChatScreen is a persistent tab screen that never unmounts
        // between sends, and RecipeChatScreen is a fullScreenModal that
        // unmounts on dismiss, but neither relies on unmount to clear stale
        // requestError state.
      }
    },
    [conversationId, queryClient, notifyWhenAway],
  );

  return {
    sendMessage,
    abortStream,
    streamingContent,
    streamingRecipe,
    allergenWarning,
    streamingFinder,
    streamingStatus,
    isStreaming,
    streamError,
    requestError,
  };
}

export function useDeleteChatMessageForRetry() {
  return useMutation({
    mutationFn: async (messageId: number) => {
      await apiRequest("DELETE", `/api/chat/messages/${messageId}`);
    },
    onSuccess: () => {
      // Intentionally no cache invalidation — CoachChat manages
      // message state directly during retry to avoid UI flicker.
    },
    // Its one call site (CoachChat.handleRetry) already sets a visible
    // streamingError in its own catch — the global net would double it.
    meta: { silentError: true },
  });
}

export function usePinConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isPinned }: { id: number; isPinned: boolean }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/chat/conversations/${id}/pin`,
        { isPinned },
      );
      return (await res.json()) as ChatConversation;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["/api/chat/conversations"],
      });
    },
    // Its one call site (AllConversationsScreen) already toasts on failure.
    meta: { silentError: true },
  });
}

/**
 * Save a recipe from a chat message to the user's library.
 *
 * No opt-out: the one call site (RecipeChatScreen.handleSaveRecipe) only
 * plays a haptic + an iOS-only VoiceOver announce on failure, which this
 * project's convention treats as NOT visible feedback (haptics/console/
 * iOS-only-announce alone don't count — see the mutation rule in
 * docs/rules/client-state.md). The global toast is a genuine improvement
 * here, not a double-report.
 */
export function useSaveRecipeFromChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      conversationId,
      messageId,
    }: {
      conversationId: number;
      messageId: number;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/chat/conversations/${conversationId}/save-recipe`,
        { messageId },
      );
      return res.json() as Promise<{
        id: number;
        savedItemStatus?: SavedRecipeLinkStatus;
      }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["/api/chat/conversations"],
      });
      // The server also puts the recipe into Saved Items.
      void queryClient.invalidateQueries({ queryKey: ["/api/saved-items"] });
      void queryClient.invalidateQueries({
        queryKey: ["/api/saved-items/count"],
      });
    },
  });
}

// ---- NOTEBOOK ----

export interface NotebookEntry {
  id: number;
  userId: string;
  type: string;
  content: string;
  status: string;
  followUpDate: string | null;
  sourceConversationId: number | null;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useNotebookEntries(opts?: {
  type?: string;
  status?: string;
  page?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.page) params.set("page", String(opts.page));
  const query = params.toString();
  return useQuery<NotebookEntry[]>({
    queryKey: ["/api/coach/notebook", opts],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/coach/notebook${query ? `?${query}` : ""}`,
      );
      return res.json();
    },
  });
}

export function useCreateNotebookEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      type: string;
      content: string;
      followUpDate?: string | null;
    }) => {
      // X-Timezone is required here, not decorative: the server anchors
      // `followUpDate` (a calendar day) at local midnight in THIS zone, the
      // same basis the chat-extraction writer uses. `apiRequest` does not
      // add the header automatically, so omitting it silently anchors at
      // UTC midnight and the reminder fires early for UTC-negative users.
      const res = await apiRequest("POST", "/api/coach/notebook", data, {
        headers: { "X-Timezone": getDeviceTimezone() },
      });
      return (await res.json()) as NotebookEntry;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/coach/notebook"] });
    },
    // Its one call site (NotebookEntryScreen) already toasts on failure.
    meta: { silentError: true },
  });
}

export function useUpdateNotebookEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: number;
      content?: string;
      type?: string;
      followUpDate?: string | null;
      status?: string;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/coach/notebook/${id}`,
        updates,
        // Same reason as useCreateNotebookEntry: the server anchors an edited
        // `followUpDate` in this zone.
        { headers: { "X-Timezone": getDeviceTimezone() } },
      );
      return (await res.json()) as NotebookEntry;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/coach/notebook"] });
    },
    // Every call site (NotebookEntryScreen x3, NotebookScreen) already
    // toasts on failure.
    meta: { silentError: true },
  });
}

export function useDeleteNotebookEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/coach/notebook/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/coach/notebook"] });
    },
    // Its one call site (NotebookScreen) already toasts on failure.
    meta: { silentError: true },
  });
}
