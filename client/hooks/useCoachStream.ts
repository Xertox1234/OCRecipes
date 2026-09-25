import { useCallback, useEffect, useRef, useState } from "react";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { getDeviceTimezone } from "@/lib/timezone";
import { randomUuidV4 } from "@/lib/uuid";
import {
  stripCoachBlocksFence,
  stripCoachBlocksFenceIncremental,
  createFenceScanState,
  filterValidBlocks,
} from "@/components/coach/coach-chat-utils";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

// Exported so tests can import and verify against them
export const HOLD_GATE_MS = 700;
export const DRAIN_INTERVAL_MS = 50;
export const CHARS_PER_TICK = 20;

// Termination ceilings. Order: server SSE_TIMEOUT_MS (120s,
// server/routes/chat.ts) < STREAM_INACTIVITY_MS < XHR_TIMEOUT_MS.
// The server sends its own `{ error: "Response timeout" }` at 120s, so on a
// live connection that graceful error always arrives first; these fire only
// on a dead or half-open one. The inactivity window can't be shorter:
// Coach Pro flushes tool-status labels only with the next content chunk, so a
// multi-round tool turn is legitimately silent on the wire for up to the whole
// server budget (5 tool calls, each a 30s-capped OpenAI call).
export const STREAM_INACTIVITY_MS = 125_000;
// A backstop in case the JS timer is starved. On Android, xhr.timeout is an
// OkHttp total-call cap, not an idle one.
export const XHR_TIMEOUT_MS = 150_000;

/**
 * Pure helper — returns the slice of buffer to release this drain tick.
 * Returns "" when the hold gate has not elapsed yet.
 */
export function charsToRelease(
  buffer: string,
  elapsedMs: number,
  holdGateMs: number,
  charsPerTick: number,
): string {
  if (elapsedMs < holdGateMs) return "";
  return buffer.slice(0, charsPerTick);
}

/**
 * Extract the machine-readable `code` from a non-200 stream response body.
 * The server's `sendError` returns `{ error, code }`; a pre-stream 429
 * (daily limit) is delivered this way before the SSE stream starts. Returns
 * undefined when the body is non-JSON or carries no string `code`.
 */
export function parseErrorCode(responseText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(responseText);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { code?: unknown }).code === "string"
    ) {
      return (parsed as { code: string }).code;
    }
  } catch {
    // Non-JSON body — no machine-readable code to extract.
  }
  return undefined;
}

interface UseCoachStreamOptions {
  onDone?: (fullText: string, blocks?: CoachBlock[]) => void;
  // `code` is the machine-readable ApiError code parsed from a non-200 stream
  // response body (e.g. "DAILY_LIMIT_REACHED"); undefined for SSE-level errors
  // and network/token failures that carry no code. Consumers should branch on
  // `code`, never on the raw `msg` (which is the raw "<status>: <body>" wire
  // format).
  onError?: (msg: string, code?: string) => void;
}

export interface UseCoachStreamReturn {
  startStream: (
    conversationId: number,
    userMessage: string,
    extras?: { warmUpId?: string | null; screenContext?: string },
  ) => void;
  abortStream: () => void;
  streamingContent: string;
  statusText: string;
  isStreaming: boolean;
}

export function useCoachStream({
  onDone,
  onError,
}: UseCoachStreamOptions): UseCoachStreamReturn {
  const [streamingContent, setStreamingContent] = useState("");
  const [statusText, setStatusText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  // Callback refs — keep latest values without triggering re-renders
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Mutable refs — no re-renders needed for these internal values
  const bufferRef = useRef(""); // chars waiting to be drained to screen
  const isDoneRef = useRef(false); // true when server sent data.done
  const startedAtRef = useRef(0); // Date.now() when startStream was called
  const accumulatedRef = useRef(""); // full raw text from server (may contain fence)
  const displayedLengthRef = useRef(0); // chars of stripped text already pushed to buffer
  // Scan-offset state for the incremental fence stripper — must be reset
  // alongside accumulatedRef everywhere accumulatedRef is reset, or stale
  // offsets from a prior stream corrupt the next one's fence detection.
  const fenceStateRef = useRef(createFenceScanState());
  const firstCharDrainedRef = useRef(false); // cleared status on first drain?
  const fullTextRef = useRef(""); // fence-stripped text to pass to onDone
  const blocksRef = useRef<CoachBlock[]>([]);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const drainIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearInactivity = useCallback(() => {
    if (inactivityTimerRef.current !== null) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  const stopDrain = useCallback(() => {
    if (drainIntervalRef.current !== null) {
      clearInterval(drainIntervalRef.current);
      drainIntervalRef.current = null;
    }
  }, []);

  const startDrain = useCallback(() => {
    if (drainIntervalRef.current !== null) return; // already running
    drainIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      const chunk = charsToRelease(
        bufferRef.current,
        elapsed,
        HOLD_GATE_MS,
        CHARS_PER_TICK,
      );

      if (chunk.length === 0) {
        // Nothing to drain this tick
        if (isDoneRef.current && bufferRef.current.length === 0) {
          // Buffer exhausted and server is done — finish
          stopDrain();
          setIsStreaming(false);
          setStatusText("");
          onDoneRef.current?.(
            fullTextRef.current,
            blocksRef.current.length > 0 ? blocksRef.current : undefined,
          );
        }
        return;
      }

      bufferRef.current = bufferRef.current.slice(chunk.length);

      if (!firstCharDrainedRef.current) {
        firstCharDrainedRef.current = true;
        setStatusText(""); // clear status as text starts appearing
      }
      setStreamingContent((prev) => prev + chunk);
    }, DRAIN_INTERVAL_MS);
  }, [stopDrain]);

  const abortStream = useCallback(() => {
    xhrRef.current?.abort();
    xhrRef.current = null;
    clearInactivity();
    stopDrain();
    bufferRef.current = "";
    isDoneRef.current = false;
    accumulatedRef.current = "";
    displayedLengthRef.current = 0;
    fenceStateRef.current = createFenceScanState();
    firstCharDrainedRef.current = false;
    setIsStreaming(false);
    setStatusText("");
    setStreamingContent("");
  }, [clearInactivity, stopDrain]);

  // Abort XHR and drain interval on unmount
  useEffect(() => {
    return () => {
      xhrRef.current?.abort();
      clearInactivity();
      stopDrain();
    };
  }, [clearInactivity, stopDrain]);

  const startStream = useCallback(
    (
      conversationId: number,
      userMessage: string,
      extras?: { warmUpId?: string | null; screenContext?: string },
    ) => {
      // Reset all state for a fresh stream
      clearInactivity();
      bufferRef.current = "";
      isDoneRef.current = false;
      accumulatedRef.current = "";
      displayedLengthRef.current = 0;
      fenceStateRef.current = createFenceScanState();
      firstCharDrainedRef.current = false;
      fullTextRef.current = "";
      blocksRef.current = [];
      startedAtRef.current = Date.now();

      setStreamingContent("");
      setStatusText("Thinking…");
      setIsStreaming(true);

      tokenStorage
        .get()
        .then((token) => {
          const xhr = new XMLHttpRequest();
          xhrRef.current = xhr;
          const url = `${getApiUrl()}/api/chat/conversations/${conversationId}/messages`;
          xhr.open("POST", url, true);
          xhr.setRequestHeader("Content-Type", "application/json");
          if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          // Required, not decorative: the server anchors notebook follow-up
          // dates and the coach's "today" in this zone, and falls back to UTC
          // without it. This raw XHR bypasses `apiRequest`, which adds no
          // header either — every caller passes it explicitly.
          xhr.setRequestHeader("X-Timezone", getDeviceTimezone());

          let lastProcessedIndex = 0;
          // Once a terminal outcome is chosen, every later event is ignored.
          // RN dispatches readystatechange at DONE before timeout/error (and
          // on abort), so without this one stream can report twice.
          let settled = false;
          const fail = (msg: string, code?: string) => {
            if (settled) return;
            settled = true;
            clearInactivity();
            stopDrain();
            setIsStreaming(false);
            setStatusText("");
            onErrorRef.current?.(msg, code);
          };
          // Reset on every event, status included: a stalled socket never
          // closes or errors on its own, so without this the stream hangs.
          const armInactivity = () => {
            clearInactivity();
            inactivityTimerRef.current = setTimeout(() => {
              // Settle before aborting: abort() re-dispatches readystatechange.
              fail("Response timeout");
              xhr.abort();
            }, STREAM_INACTIVITY_MS);
          };

          xhr.onreadystatechange = () => {
            if (settled) return;
            if (xhr.readyState >= 3 && xhr.responseText) {
              const newText = xhr.responseText.slice(lastProcessedIndex);
              lastProcessedIndex = xhr.responseText.length;
              if (newText) armInactivity();

              for (const line of newText.split("\n")) {
                if (!line.startsWith("data: ")) continue;
                try {
                  const raw = JSON.parse(line.slice(6));
                  if (
                    typeof raw !== "object" ||
                    raw === null ||
                    Array.isArray(raw)
                  )
                    continue;
                  const data = raw as Record<string, unknown>;
                  if (data.error) {
                    fail(String(data.error));
                    return;
                  }
                  if (
                    typeof data.status === "string" &&
                    !firstCharDrainedRef.current
                  ) {
                    setStatusText(data.status);
                  }
                  if (typeof data.content === "string") {
                    accumulatedRef.current += data.content;
                    // Incremental: tracks scan offsets in fenceStateRef so
                    // this doesn't re-scan the full accumulated text from
                    // position 0 on every event (see coach-chat-utils.ts).
                    const stripped = stripCoachBlocksFenceIncremental(
                      accumulatedRef.current,
                      fenceStateRef.current,
                    );
                    const newChars = stripped.slice(displayedLengthRef.current);
                    displayedLengthRef.current = stripped.length;
                    bufferRef.current += newChars;
                  }
                  // Handle safety override: clear buffered content and replace with safe message
                  if (typeof data.safety_override === "string") {
                    accumulatedRef.current = "";
                    displayedLengthRef.current = 0;
                    fenceStateRef.current = createFenceScanState();
                    firstCharDrainedRef.current = false;
                    fullTextRef.current = data.safety_override;
                    setStreamingContent("");
                    bufferRef.current = data.safety_override;
                  }
                  if (data.blocks && Array.isArray(data.blocks)) {
                    blocksRef.current = filterValidBlocks(data.blocks);
                  }
                  if (data.done) {
                    // The drain now owns finishing (onDone). Nothing after
                    // `done` — a late error or close — may override it.
                    settled = true;
                    clearInactivity();
                    isDoneRef.current = true;
                    if (accumulatedRef.current) {
                      fullTextRef.current = stripCoachBlocksFence(
                        accumulatedRef.current,
                      );
                    }
                  }
                } catch {
                  // Ignore incomplete JSON chunks
                }
              }
            }

            if (xhr.readyState === 4 && xhr.status >= 400) {
              fail(
                `${xhr.status}: ${xhr.responseText}`,
                parseErrorCode(xhr.responseText),
              );
            }
          };

          xhr.onerror = () => fail("Network error");
          // RN dispatches `timeout`, not `error`, when xhr.timeout elapses.
          xhr.ontimeout = () => fail("Response timeout");
          // `load` fires only on a clean close (never after timeout, error or
          // abort, unlike readyState 4). A clean 2xx close before `done` means
          // the server or a proxy cut the stream: the reply was never
          // finished or saved, so report it rather than finalize a partial.
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              fail("Response interrupted");
            }
          };
          xhr.timeout = XHR_TIMEOUT_MS;

          startDrain();

          const turnKey = randomUuidV4();
          const body: Record<string, unknown> = {
            content: userMessage,
            turnKey,
          };
          if (extras?.warmUpId) body.warmUpId = extras.warmUpId;
          if (extras?.screenContext) body.screenContext = extras.screenContext;
          armInactivity();
          xhr.send(JSON.stringify(body));
        })
        .catch((err: unknown) => {
          stopDrain();
          setIsStreaming(false);
          setStatusText("");
          onErrorRef.current?.(
            err instanceof Error ? err.message : "Token error",
          );
        });
    },
    [clearInactivity, startDrain, stopDrain],
  );

  return {
    startStream,
    abortStream,
    streamingContent,
    statusText,
    isStreaming,
  };
}
