import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";

export interface UsePendingAssistantBridgeOptions<T> {
  /** Whether an assistant response is currently streaming. */
  isStreaming: boolean;
  /**
   * The latest in-flight value to remember as "the completed response" once
   * streaming stops — e.g. the streamed text, or `{ content, recipe }`. Read
   * fresh on every render; only captured while `isStreaming` is true and
   * `hasStreamingValue` is true.
   */
  streamingValue: T;
  /** True when `streamingValue` is non-empty and worth remembering this tick. */
  hasStreamingValue: boolean;
  /**
   * True when the stream just ended without anything the server will
   * persist (a stream/request error) — the captured value must never
   * surface as a pending bubble in this case.
   */
  hasError: boolean;
  /** Number of assistant messages currently fetched from the server. */
  assistantMessageCount: number;
  /** Accessibility announcement fired when the stream ends. */
  announce: {
    message: string;
    /**
     * Fire the announcement even when no pending bubble is shown (the error
     * case). Defaults to false — announce only on the success path.
     */
    always?: boolean;
  };
}

/**
 * Bridges the gap between a stream ending and the server-persisted message
 * landing in the next fetch: remembers the last in-flight streamed value,
 * surfaces it as a "pending" bubble once streaming stops, and clears it once
 * a real assistant message has been persisted. Clearing is detected by a
 * rising assistant-message count, not content equality — a safety override
 * or server-side trim can make the persisted text diverge from the streamed
 * text, which would otherwise strand the bubble forever.
 */
export function usePendingAssistantBridge<T>({
  isStreaming,
  streamingValue,
  hasStreamingValue,
  hasError,
  assistantMessageCount,
  announce,
}: UsePendingAssistantBridgeOptions<T>): T | null {
  const [pending, setPending] = useState<T | null>(null);
  const prevStreamingRef = useRef(false);
  const lastValueRef = useRef<T | null>(null);
  const pendingBaselineAssistantCountRef = useRef(0);

  useEffect(() => {
    if (isStreaming && hasStreamingValue) {
      lastValueRef.current = streamingValue;
    }
    if (prevStreamingRef.current && !isStreaming) {
      if (announce.always) {
        AccessibilityInfo.announceForAccessibility(announce.message);
      }
      // Bridge the stream-end → message-refetch gap, but only for responses
      // that will actually persist. On stream/request error the server keeps
      // no message, so a pending bubble would never clear.
      if (lastValueRef.current !== null && !hasError) {
        pendingBaselineAssistantCountRef.current = assistantMessageCount;
        setPending(lastValueRef.current);
        if (!announce.always) {
          AccessibilityInfo.announceForAccessibility(announce.message);
        }
      }
      lastValueRef.current = null;
    }
    prevStreamingRef.current = isStreaming;
  }, [
    isStreaming,
    streamingValue,
    hasStreamingValue,
    hasError,
    assistantMessageCount,
    announce.message,
    announce.always,
  ]);

  useEffect(() => {
    if (pending === null) return;
    // Count, not content equality — see the doc comment above.
    if (assistantMessageCount > pendingBaselineAssistantCountRef.current) {
      setPending(null);
    }
  }, [assistantMessageCount, pending]);

  return pending;
}
