import { useCallback, useEffect, useRef, useState } from "react";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { getDeviceTimezone } from "@/lib/timezone";
import { streamSse } from "@/lib/sse-xhr";
import { randomUuidV4 } from "@/lib/uuid";
import {
  stripCoachBlocksFence,
  stripCoachBlocksFenceIncremental,
  createFenceScanState,
  filterValidBlocks,
} from "@/components/coach/coach-chat-utils";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import { SSE_TIMEOUT_MS } from "@shared/constants/sse";
import type { FinderAction } from "@shared/schemas/recipe-finder";

// Exported so tests can import and verify against them
export const HOLD_GATE_MS = 700;
export const DRAIN_INTERVAL_MS = 50;
export const CHARS_PER_TICK = 20;

// Termination ceilings. Order: server SSE_TIMEOUT_MS (shared/constants/sse.ts,
// enforced by server/routes/chat.ts) < STREAM_INACTIVITY_MS < XHR_TIMEOUT_MS.
// The server sends its own `{ error: "Response timeout" }` at SSE_TIMEOUT_MS,
// so on a live connection that graceful error always arrives first; these
// fire only on a dead or half-open one. Coach Pro now flushes a status event
// immediately when a tool round is detected — before the tools run — instead
// of deferring it to the next content chunk (see
// todos/archive/P3-2026-09-25-coach-pro-flush-tool-status-immediately.md), so
// a multi-round tool turn is no longer silent for the whole server budget.
// This constant is kept at the server budget anyway: tool execution itself
// has no explicit per-call timeout, so the wire can still legitimately go
// quiet for longer than a single OpenAI call's cap while a slow tool runs.
export const STREAM_INACTIVITY_MS = SSE_TIMEOUT_MS + 5_000;
// A backstop in case the JS timer is starved. On Android, xhr.timeout is an
// OkHttp total-call cap, not an idle one.
export const XHR_TIMEOUT_MS = STREAM_INACTIVITY_MS + 25_000;

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
    extras?: {
      warmUpId?: string | null;
      screenContext?: string;
      finderAction?: FinderAction;
    },
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
  // Mirrors `isStreaming` for a synchronous, stale-closure-safe guard read in
  // startStream — see the guard there.
  const isStreamingRef = useRef(false);
  // Bumped by every startStream, abortStream and unmount. startStream's
  // token read is async; its continuation sends only if the epoch it captured
  // is still current, so an abort/unmount during the read can't leave an
  // orphaned request that races the next stream.
  const streamEpochRef = useRef(0);
  // Aborting it stops the in-flight request and its inactivity watchdog.
  const abortRef = useRef<AbortController | null>(null);
  const drainIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          isStreamingRef.current = false;
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
    streamEpochRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    stopDrain();
    bufferRef.current = "";
    isDoneRef.current = false;
    accumulatedRef.current = "";
    displayedLengthRef.current = 0;
    fenceStateRef.current = createFenceScanState();
    firstCharDrainedRef.current = false;
    isStreamingRef.current = false;
    setIsStreaming(false);
    setStatusText("");
    setStreamingContent("");
  }, [stopDrain]);

  // Abort XHR and drain interval on unmount
  useEffect(() => {
    return () => {
      streamEpochRef.current += 1;
      abortRef.current?.abort();
      stopDrain();
    };
  }, [stopDrain]);

  const startStream = useCallback(
    (
      conversationId: number,
      userMessage: string,
      extras?: {
        warmUpId?: string | null;
        screenContext?: string;
        finderAction?: FinderAction;
      },
    ) => {
      // Refuse an overlapping stream: most internal state here (buffer,
      // accumulated text, abortRef, timers) is a single shared slot, not
      // per-request, so a second concurrent startStream would corrupt or
      // orphan the first — see
      // todos/archive/P3-2026-09-24-chat-stream-hooks-xhrref-last-write-wins.md.
      if (isStreamingRef.current) return;
      isStreamingRef.current = true;
      const epoch = ++streamEpochRef.current;

      // Reset all state for a fresh stream
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
          if (epoch !== streamEpochRef.current) return;
          const controller = new AbortController();
          abortRef.current = controller;
          // A very late outcome on an already-superseded (aborted/unmounted)
          // stream must not tear down or report an error against whatever
          // stream is current now — same epoch guard as the token-read
          // continuation above. The transport delivers at most one outcome.
          const fail = (msg: string, code?: string) => {
            if (epoch !== streamEpochRef.current) return;
            stopDrain();
            isStreamingRef.current = false;
            setIsStreaming(false);
            setStatusText("");
            onErrorRef.current?.(msg, code);
          };

          // Required, not decorative: the server anchors notebook follow-up
          // dates and the coach's "today" in this zone, and falls back to UTC
          // without it. This raw XHR bypasses `apiRequest`, which adds no
          // header either — every caller passes it explicitly.
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "X-Timezone": getDeviceTimezone(),
          };
          if (token) headers["Authorization"] = `Bearer ${token}`;

          startDrain();

          const turnKey = randomUuidV4();
          const body: Record<string, unknown> = {
            content: userMessage,
            turnKey,
          };
          if (extras?.warmUpId) body.warmUpId = extras.warmUpId;
          if (extras?.screenContext) body.screenContext = extras.screenContext;
          if (extras?.finderAction) body.finderAction = extras.finderAction;

          streamSse({
            url: `${getApiUrl()}/api/chat/conversations/${conversationId}/messages`,
            body: JSON.stringify(body),
            headers,
            timeoutMs: XHR_TIMEOUT_MS,
            inactivityMs: STREAM_INACTIVITY_MS,
            signal: controller.signal,
            onEvent: (data) => {
              if (data.error) {
                fail(String(data.error));
                return "stop";
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
                isDoneRef.current = true;
                if (accumulatedRef.current) {
                  fullTextRef.current = stripCoachBlocksFence(
                    accumulatedRef.current,
                  );
                }
                // The drain now owns finishing (onDone). Nothing after
                // `done` — a late error or close — may override it.
                return "stop";
              }
            },
            onClose: (outcome) => {
              switch (outcome.kind) {
                case "http-error":
                  fail(
                    `${outcome.status}: ${outcome.responseText}`,
                    parseErrorCode(outcome.responseText),
                  );
                  break;
                case "network":
                  fail("Network error");
                  break;
                case "timeout":
                case "inactivity":
                  fail("Response timeout");
                  break;
                case "load":
                  // `load` fires only on a clean close. A clean 2xx close
                  // before `done` means the server or a proxy cut the
                  // stream: the reply was never finished or saved, so
                  // report it rather than finalize a partial.
                  if (outcome.status >= 200 && outcome.status < 300) {
                    fail("Response interrupted");
                  }
                  break;
                case "aborted":
                  // Intentional (abortStream / unmount) — already torn down.
                  break;
              }
            },
          });
        })
        .catch((err: unknown) => {
          // A stale stream's failure must not tear down the current one.
          if (epoch !== streamEpochRef.current) return;
          stopDrain();
          isStreamingRef.current = false;
          setIsStreaming(false);
          setStatusText("");
          onErrorRef.current?.(
            err instanceof Error ? err.message : "Token error",
          );
        });
    },
    [startDrain, stopDrain],
  );

  return {
    startStream,
    abortStream,
    streamingContent,
    statusText,
    isStreaming,
  };
}
