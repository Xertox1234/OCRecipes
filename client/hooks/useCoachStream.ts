import { useCallback, useEffect, useRef, useState } from "react";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import {
  stripCoachBlocksFence,
  filterValidBlocks,
} from "@/components/coach/coach-chat-utils";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

// Exported so tests can import and verify against them
export const HOLD_GATE_MS = 700;
export const DRAIN_INTERVAL_MS = 50;
export const CHARS_PER_TICK = 20;

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

interface UseCoachStreamOptions {
  onDone?: (fullText: string, blocks?: CoachBlock[]) => void;
  onError?: (msg: string) => void;
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
  const firstCharDrainedRef = useRef(false); // cleared status on first drain?
  const fullTextRef = useRef(""); // fence-stripped text to pass to onDone
  const blocksRef = useRef<CoachBlock[]>([]);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
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
    stopDrain();
    bufferRef.current = "";
    isDoneRef.current = false;
    accumulatedRef.current = "";
    displayedLengthRef.current = 0;
    firstCharDrainedRef.current = false;
    setIsStreaming(false);
    setStatusText("");
    setStreamingContent("");
  }, [stopDrain]);

  // Abort XHR and drain interval on unmount
  useEffect(() => {
    return () => {
      xhrRef.current?.abort();
      stopDrain();
    };
  }, [stopDrain]);

  const startStream = useCallback(
    (
      conversationId: number,
      userMessage: string,
      extras?: { warmUpId?: string | null; screenContext?: string },
    ) => {
      // Reset all state for a fresh stream
      bufferRef.current = "";
      isDoneRef.current = false;
      accumulatedRef.current = "";
      displayedLengthRef.current = 0;
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

          let lastProcessedIndex = 0;

          xhr.onreadystatechange = () => {
            if (xhr.readyState >= 3 && xhr.responseText) {
              const newText = xhr.responseText.slice(lastProcessedIndex);
              lastProcessedIndex = xhr.responseText.length;

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
                    stopDrain();
                    setIsStreaming(false);
                    setStatusText("");
                    onErrorRef.current?.(String(data.error));
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
                    const stripped = stripCoachBlocksFence(
                      accumulatedRef.current,
                    );
                    const newChars = stripped.slice(displayedLengthRef.current);
                    displayedLengthRef.current = stripped.length;
                    bufferRef.current += newChars;
                  }
                  // Handle safety override: clear buffered content and replace with safe message
                  if (typeof data.safety_override === "string") {
                    accumulatedRef.current = "";
                    displayedLengthRef.current = 0;
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
                  }
                } catch {
                  // Ignore incomplete JSON chunks
                }
              }
            }

            if (xhr.readyState === 4 && xhr.status >= 400) {
              stopDrain();
              setIsStreaming(false);
              setStatusText("");
              onErrorRef.current?.(`${xhr.status}: ${xhr.responseText}`);
            }
          };

          xhr.onerror = () => {
            stopDrain();
            setIsStreaming(false);
            setStatusText("");
            onErrorRef.current?.("Network error");
          };

          startDrain();

          const turnKey = crypto.randomUUID();
          const body: Record<string, unknown> = {
            content: userMessage,
            turnKey,
          };
          if (extras?.warmUpId) body.warmUpId = extras.warmUpId;
          if (extras?.screenContext) body.screenContext = extras.screenContext;
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
