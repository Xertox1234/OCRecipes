import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildCoachStreamBody,
  type CoachStreamExtras,
} from "@/lib/coach-stream-body";
import {
  getApiUrl,
  notifyIfStreamSessionExpired,
  queryClient,
} from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { getDeviceTimezone } from "@/lib/timezone";
import {
  streamSse,
  watchStreamHealth,
  pollUntilTurnSettled,
} from "@/lib/sse-xhr";
import { randomUuidV4 } from "@/lib/uuid";
import {
  stripCoachBlocksFence,
  stripCoachBlocksFenceIncremental,
  createFenceScanState,
  filterValidBlocks,
} from "@/components/coach/coach-chat-utils";
import {
  initialRevealState,
  nextReveal,
} from "@/components/coach/stream-reveal-utils";
import {
  enqueueStep,
  initialStepQueue,
  stepsSettled,
  tickSteps,
} from "@/components/coach/step-pacing-utils";
import { coachRevealPacing, coachStepPacing } from "@/constants/animations";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import { SSE_TIMEOUT_MS } from "@shared/constants/sse";
import { parseErrorCode } from "@/lib/chat-error-copy";
import { raiseIfAiSharingRequired } from "@/lib/ai-sharing-events";

// Exported so tests can import and verify against them. How much text each
// tick reveals is decided by `nextReveal` (stream-reveal-utils.ts), tuned by
// `coachRevealPacing`.
export const HOLD_GATE_MS = 700;
export const DRAIN_INTERVAL_MS = 50;

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
    extras?: CoachStreamExtras,
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
  // Show-the-work: Coach's steps, each held on the line for a minimum time.
  const stepQueueRef = useRef(initialStepQueue());
  const stepSeenRef = useRef(false); // a `step` arrived: ignore `status`
  const shownStepRef = useRef<string | null>(null);
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
  const revealStateRef = useRef(initialRevealState()); // word-pacing credit
  const lastTickAtRef = useRef(0); // Date.now() of the previous drain tick
  // Offline / dead-socket guard for the in-flight stream, and the post-abort
  // messages poll. Both end with the stream, a new stream, or unmount.
  const disposeHealthRef = useRef<(() => void) | null>(null);
  const cancelPollRef = useRef<(() => void) | null>(null);
  const disposeHealth = useCallback(() => {
    disposeHealthRef.current?.();
    disposeHealthRef.current = null;
  }, []);

  const stopDrain = useCallback(() => {
    if (drainIntervalRef.current !== null) {
      clearInterval(drainIntervalRef.current);
      drainIntervalRef.current = null;
    }
  }, []);

  const startDrain = useCallback(() => {
    if (drainIntervalRef.current !== null) return; // already running
    revealStateRef.current = initialRevealState();
    lastTickAtRef.current = Date.now();
    drainIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startedAtRef.current;
      // A starved JS timer must not turn into one big catch-up burst.
      const dt = Math.min(now - lastTickAtRef.current, DRAIN_INTERVAL_MS * 4);
      lastTickAtRef.current = now;
      const steps = tickSteps(
        stepQueueRef.current,
        now,
        coachStepPacing.minStepMs,
      );
      stepQueueRef.current = steps;
      const stepLabel = steps.current?.label ?? null;
      if (stepLabel !== shownStepRef.current) {
        shownStepRef.current = stepLabel;
        // A finished step keeps its words up until the reply starts; one that
        // ends under the reply clears.
        if (stepLabel) setStatusText(stepLabel);
        else if (firstCharDrainedRef.current) setStatusText("");
      }
      let chunk = "";
      // Early steps play out before the first word; later ones never pause it.
      if (
        elapsed >= HOLD_GATE_MS &&
        (firstCharDrainedRef.current ||
          stepsSettled(steps, now, coachStepPacing.minStepMs))
      ) {
        const step = nextReveal(
          bufferRef.current,
          dt,
          isDoneRef.current,
          revealStateRef.current,
          coachRevealPacing,
        );
        revealStateRef.current = step.state;
        chunk = step.release;
      }

      if (chunk.length === 0) {
        // Nothing to drain this tick
        // Every step gets its full time, even one that arrived late.
        if (
          isDoneRef.current &&
          bufferRef.current.length === 0 &&
          stepsSettled(steps, now, coachStepPacing.minStepMs)
        ) {
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
        if (!stepQueueRef.current.current) setStatusText(""); // text starts
      }
      setStreamingContent((prev) => prev + chunk);
    }, DRAIN_INTERVAL_MS);
  }, [stopDrain]);

  const abortStream = useCallback(() => {
    streamEpochRef.current += 1;
    disposeHealth();
    abortRef.current?.abort();
    abortRef.current = null;
    stopDrain();
    bufferRef.current = "";
    isDoneRef.current = false;
    accumulatedRef.current = "";
    displayedLengthRef.current = 0;
    fenceStateRef.current = createFenceScanState();
    firstCharDrainedRef.current = false;
    stepQueueRef.current = initialStepQueue();
    stepSeenRef.current = false;
    shownStepRef.current = null;
    isStreamingRef.current = false;
    setIsStreaming(false);
    setStatusText("");
    setStreamingContent("");
  }, [stopDrain, disposeHealth]);

  // Abort XHR and drain interval on unmount
  useEffect(() => {
    return () => {
      streamEpochRef.current += 1;
      disposeHealth();
      cancelPollRef.current?.();
      abortRef.current?.abort();
      stopDrain();
    };
  }, [stopDrain, disposeHealth]);

  const startStream = useCallback(
    (
      conversationId: number,
      userMessage: string,
      extras?: CoachStreamExtras,
    ) => {
      // Refuse an overlapping stream: most internal state here (buffer,
      // accumulated text, abortRef, timers) is a single shared slot, not
      // per-request, so a second concurrent startStream would corrupt or
      // orphan the first — see
      // todos/archive/P3-2026-09-24-chat-stream-hooks-xhrref-last-write-wins.md.
      if (isStreamingRef.current) return;
      isStreamingRef.current = true;
      const epoch = ++streamEpochRef.current;
      cancelPollRef.current?.();
      cancelPollRef.current = null;

      // Reset all state for a fresh stream
      bufferRef.current = "";
      isDoneRef.current = false;
      accumulatedRef.current = "";
      displayedLengthRef.current = 0;
      fenceStateRef.current = createFenceScanState();
      firstCharDrainedRef.current = false;
      stepQueueRef.current = initialStepQueue();
      stepSeenRef.current = false;
      shownStepRef.current = null;
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
            disposeHealth();
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

          // Offline fails fast with the network copy. A resume with no bytes
          // (data or server ping) for 20 s is a dead socket: abort quietly
          // and reconcile with whatever the server saved. The server's coach
          // path settles on the close: partial reply saved, or the turn
          // refunded (user message deleted) — onDone's refetch shows either.
          disposeHealth();
          const health = watchStreamHealth((reason) => {
            if (epoch !== streamEpochRef.current) return;
            if (reason === "offline") {
              controller.abort();
              fail("Network error");
              return;
            }
            const partial = stripCoachBlocksFence(accumulatedRef.current);
            abortStream();
            onDoneRef.current?.(partial);
            cancelPollRef.current?.();
            cancelPollRef.current = pollUntilTurnSettled(queryClient, [
              `/api/chat/conversations/${conversationId}/messages`,
            ]);
          });
          disposeHealthRef.current = health.dispose;

          const turnKey = randomUuidV4();
          const body = buildCoachStreamBody(userMessage, turnKey, extras);

          streamSse({
            url: `${getApiUrl()}/api/chat/conversations/${conversationId}/messages`,
            body: JSON.stringify(body),
            headers,
            timeoutMs: XHR_TIMEOUT_MS,
            inactivityMs: STREAM_INACTIVITY_MS,
            signal: controller.signal,
            onBytes: health.noteBytes,
            onEvent: (data) => {
              if (data.error) {
                fail(String(data.error));
                return "stop";
              }
              if (typeof data.step === "string") {
                stepSeenRef.current = true;
                stepQueueRef.current = enqueueStep(
                  stepQueueRef.current,
                  data.step,
                );
              } else if (
                typeof data.status === "string" &&
                !firstCharDrainedRef.current &&
                !stepSeenRef.current
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
                stepQueueRef.current = initialStepQueue();
                stepSeenRef.current = false;
                shownStepRef.current = null;
                fullTextRef.current = data.safety_override;
                setStreamingContent("");
                bufferRef.current = data.safety_override;
              }
              if (data.blocks && Array.isArray(data.blocks)) {
                blocksRef.current = filterValidBlocks(data.blocks);
              }
              if (data.done) {
                disposeHealth();
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
              if (epoch === streamEpochRef.current) disposeHealth();
              switch (outcome.kind) {
                case "http-error":
                  // This raw XHR bypasses the apiRequest 401 interceptor; a
                  // dead token must still end the session (with the toast).
                  void notifyIfStreamSessionExpired(
                    outcome.status,
                    outcome.responseText,
                    token,
                  );
                  {
                    const code = parseErrorCode(outcome.responseText);
                    // A refusal for AI being off opens the question
                    // (privacy audit H3).
                    raiseIfAiSharingRequired(code);
                    fail(`${outcome.status}: ${outcome.responseText}`, code);
                  }
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
    [startDrain, stopDrain, disposeHealth, abortStream],
  );

  return {
    startStream,
    abortStream,
    streamingContent,
    statusText,
    isStreaming,
  };
}
