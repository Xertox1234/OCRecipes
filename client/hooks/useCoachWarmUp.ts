import { useRef, useCallback } from "react";
import { apiRequest } from "@/lib/query-client";

export function useCoachWarmUp(conversationId: number | null) {
  const warmUpIdRef = useRef<string | null>(null);
  const lastTranscriptRef = useRef<string>("");
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendWarmUp = useCallback(
    async (interimTranscript: string) => {
      if (!conversationId || pendingRef.current) return;
      if (interimTranscript.length < 20) return;
      if (interimTranscript === lastTranscriptRef.current) return;

      lastTranscriptRef.current = interimTranscript;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        pendingRef.current = true;
        try {
          const res = await apiRequest("POST", "/api/coach/warm-up", {
            conversationId,
            interimTranscript,
          });
          const data = await res.json();
          warmUpIdRef.current = data.warmUpId;
        } catch {
          warmUpIdRef.current = null;
        } finally {
          pendingRef.current = false;
        }
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
    async (text: string) => {
      if (!conversationId || pendingRef.current) return;
      if (text.length < 3) return;
      if (text === lastTranscriptRef.current) return;

      lastTranscriptRef.current = text;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        pendingRef.current = true;
        try {
          const res = await apiRequest("POST", "/api/coach/warm-up", {
            conversationId,
            interimTranscript: text,
          });
          const data = await res.json();
          warmUpIdRef.current = data.warmUpId;
        } catch {
          warmUpIdRef.current = null;
        } finally {
          pendingRef.current = false;
        }
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

  return { sendWarmUp, sendTextWarmUp, getWarmUpId, reset };
}
