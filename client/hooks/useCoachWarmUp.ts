import { useRef, useCallback, useEffect, useMemo } from "react";
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
  // Bumped by reset(): a warm-up still in flight then belongs to the message
  // just sent, so its reply must not ride on the next one (audit M17).
  const generationRef = useRef(0);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const schedule = useCallback(
    (text: string, minLength: number) => {
      if (!conversationId || pendingRef.current) return;
      if (text.length < minLength) return;
      if (text === lastTranscriptRef.current) return;

      lastTranscriptRef.current = text;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const generation = generationRef.current;
        const current = () => generation === generationRef.current;
        pendingRef.current = true;
        apiRequest("POST", "/api/coach/warm-up", {
          conversationId,
          interimTranscript: text,
        })
          .then((res) => res.json())
          .then(
            (data: { warmUpId?: string | null }) => {
              if (current()) warmUpIdRef.current = data.warmUpId ?? null;
            },
            (err: unknown) => {
              if (current()) warmUpIdRef.current = null;
              reportWarmUpFailure(err);
            },
          )
          .finally(() => {
            if (current()) pendingRef.current = false;
          });
      }, 500);
    },
    [conversationId],
  );

  const sendWarmUp = useCallback(
    (interimTranscript: string) => schedule(interimTranscript, 20),
    [schedule],
  );

  const sendTextWarmUp = useCallback(
    (text: string) => schedule(text, 3),
    [schedule],
  );

  const getWarmUpId = useCallback(() => {
    const id = warmUpIdRef.current;
    warmUpIdRef.current = null;
    return id;
  }, []);

  const reset = useCallback(() => {
    generationRef.current += 1;
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
