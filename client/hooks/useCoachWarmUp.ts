import { useRef, useCallback, useMemo } from "react";
import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";

/**
 * Warm-up is a best-effort prefetch: offline (a network TypeError) and 4xx
 * (rate limit, gating) misses are expected and stay quiet. A server error or
 * an unexpected failure (bad JSON, contract break) is reported, so a systematic
 * break is visible off-device instead of silently swallowed (R48).
 */
function reportWarmUpFailure(err: unknown): void {
  if (err instanceof TypeError) return;
  if (err instanceof ApiError && err.status !== undefined && err.status < 500) {
    return;
  }
  logger.error("Coach warm-up failed", err);
}

export function useCoachWarmUp(conversationId: number | null) {
  const warmUpIdRef = useRef<string | null>(null);
  const lastTranscriptRef = useRef<string>("");
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendWarmUp = useCallback(
    (interimTranscript: string) => {
      if (!conversationId || pendingRef.current) return;
      if (interimTranscript.length < 20) return;
      if (interimTranscript === lastTranscriptRef.current) return;

      lastTranscriptRef.current = interimTranscript;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void (async () => {
          pendingRef.current = true;
          try {
            const res = await apiRequest("POST", "/api/coach/warm-up", {
              conversationId,
              interimTranscript,
            });
            const data = await res.json();
            warmUpIdRef.current = data.warmUpId;
          } catch (err) {
            warmUpIdRef.current = null;
            reportWarmUpFailure(err);
          } finally {
            pendingRef.current = false;
          }
        })();
      }, 500);
    },
    [conversationId],
  );

  const getWarmUpId = useCallback(() => {
    const id = warmUpIdRef.current;
    warmUpIdRef.current = null;
    return id;
  }, []);

  const sendTextWarmUp = useCallback(
    (text: string) => {
      if (!conversationId || pendingRef.current) return;
      if (text.length < 3) return;
      if (text === lastTranscriptRef.current) return;

      lastTranscriptRef.current = text;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void (async () => {
          pendingRef.current = true;
          try {
            const res = await apiRequest("POST", "/api/coach/warm-up", {
              conversationId,
              interimTranscript: text,
            });
            const data = await res.json();
            warmUpIdRef.current = data.warmUpId;
          } catch (err) {
            warmUpIdRef.current = null;
            reportWarmUpFailure(err);
          } finally {
            pendingRef.current = false;
          }
        })();
      }, 500);
    },
    [conversationId],
  );

  const reset = useCallback(() => {
    warmUpIdRef.current = null;
    lastTranscriptRef.current = "";
    pendingRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Stable object: CoachChat's handleSend depends on it, so a fresh literal
  // per render re-created every chat row's renderItem on parent re-renders.
  return useMemo(
    () => ({ sendWarmUp, sendTextWarmUp, getWarmUpId, reset }),
    [sendWarmUp, sendTextWarmUp, getWarmUpId, reset],
  );
}
