import { useCallback, useEffect, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";

/**
 * Settle margin for the opt-in follow-up refetch (`useRefreshOnFocus`'s
 * `settleMs` option) used by the chat-list callers.
 *
 * Why a follow-up at all: the refocus this hook reacts to usually lands in the
 * SAME navigation transition as a chat-stream abort (ChatScreen popping,
 * CoachOverlayContent dismissing), whose cleanup marks the chat queries stale
 * with `invalidateQueries({ refetchType: "none" })` precisely to avoid racing
 * the server's post-disconnect settle. The immediate refetch below races it
 * anyway — and a successful refetch resets `isInvalidated`/`dataUpdatedAt`, so
 * pre-settle data would be latched as fresh for the global 5-min staleTime
 * (client/lib/query-client.ts). The follow-up re-reads after the settle.
 *
 * Why 2s (server/routes/chat.ts, the coach path's `res.on("close")` handler):
 * the close handler aborts the OpenAI stream synchronously; the stream then
 * throws out of the loop, and the H6 settle does one SELECT
 * (`getChatMessageByTurnKey`) plus one write (`createChatMessage` for a
 * partial reply, or `deleteChatMessage` to refund) before `res.end()` — no
 * title generation or cache/notebook work on that path. That is ms-scale DB
 * work, so the dominant term is the phone's TCP close reaching the server;
 * 2s sits comfortably above both. NOT covered: the recipe/remix path
 * (`isCoachPath` false) deliberately keeps generating and saving the whole
 * reply after a disconnect, which can take far longer than any fixed margin —
 * a known residual, not something a timer can bound.
 */
export const REFRESH_ON_FOCUS_SETTLE_MS = 2000;

/**
 * Calls `refetch` each time the screen gains focus, skipping the initial
 * mount (data is already fresh from useQuery).
 *
 * With `settleMs` (chat callers pass {@link REFRESH_ON_FOCUS_SETTLE_MS}), it
 * also calls `refetch` once more `settleMs` after each refocus, so a server
 * write settling just after the transition is not latched as stale-but-fresh.
 * The follow-up is cancelled if the screen blurs or unmounts first. Without
 * it (the Profile hub callers), behaviour is one refetch per refocus.
 */
export function useRefreshOnFocus(
  refetch: () => void,
  options?: { settleMs?: number },
) {
  const settleMs = options?.settleMs;
  const firstTimeRef = useRef(true);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // useFocusEffect's cleanup already runs on blur and on unmount-while-focused
  // in react-navigation; this is the belt-and-braces unmount clear so a
  // pending follow-up can never fire against an unmounted screen.
  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      if (firstTimeRef.current) {
        firstTimeRef.current = false;
        return;
      }
      refetch();
      if (settleMs === undefined) return;
      const timer = setTimeout(() => {
        settleTimerRef.current = null;
        refetch();
      }, settleMs);
      settleTimerRef.current = timer;
      return () => {
        clearTimeout(timer);
        if (settleTimerRef.current === timer) settleTimerRef.current = null;
      };
    }, [refetch, settleMs]),
  );
}
