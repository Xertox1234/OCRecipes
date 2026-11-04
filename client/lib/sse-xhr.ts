/**
 * Shared SSE-over-XHR transport for the two streaming chat clients
 * (`useChat.sendMessage`, `useCoachStream`).
 *
 * XHR is used instead of fetch because React Native's fetch polyfill returns
 * `response.body = null` for text/event-stream responses on iOS/Android.
 *
 * The transport owns: the request, the incremental `responseText` slicing, the
 * partial-line buffer, `data:` parsing, the optional inactivity watchdog, and
 * the mapping of every terminal XHR event to ONE outcome. It does not know
 * what any event means — each caller keeps its own reducer and decides what
 * each outcome says to the user.
 *
 * Single-terminal-outcome guard: React Native dispatches `readystatechange`
 * at DONE before `timeout` / `error` / `abort`, so one stream can emit
 * several terminal-looking events. Only the first wins; everything after is
 * dropped.
 */

import { AppState } from "react-native";
import { onlineManager, type QueryClient } from "@tanstack/react-query";

export type SseEventData = Record<string, unknown>;

export type SseOutcome =
  /** Clean close (`load`). The caller decides whether `status` is acceptable. */
  | { kind: "load"; status: number; responseText: string }
  /** readyState 4 with status >= 400, seen before `load`. */
  | { kind: "http-error"; status: number; responseText: string }
  | { kind: "network" }
  /** `xhr.timeout` elapsed. */
  | { kind: "timeout" }
  /** No bytes for `inactivityMs`; the request has been aborted. */
  | { kind: "inactivity" }
  /** Aborted via `signal` (or an `abort` event from elsewhere). */
  | { kind: "aborted" };

export interface StreamSseOptions {
  url: string;
  body: string;
  headers: Record<string, string>;
  /** `xhr.timeout` — a total-call backstop, not an idle timer. */
  timeoutMs: number;
  /** Idle watchdog, re-armed whenever new bytes arrive. Off when omitted. */
  inactivityMs?: number;
  /**
   * Called once per parsed `data:` JSON object (non-objects and invalid JSON
   * are skipped). Return `"stop"` to end the stream quietly: no further event
   * and no outcome is delivered. A throw is swallowed like a bad chunk.
   */
  onEvent: (data: SseEventData) => void | "stop";
  /**
   * Called whenever new bytes arrive, including `: ping` keep-alive comments
   * that produce no event. Feeds `watchStreamHealth`'s dead-socket check.
   */
  onBytes?: () => void;
  /** Called at most once with the stream's terminal outcome. */
  onClose: (outcome: SseOutcome) => void;
  /** Aborting calls `xhr.abort()` and delivers `{ kind: "aborted" }`. */
  signal: AbortSignal;
}

export function streamSse({
  url,
  body,
  headers,
  timeoutMs,
  inactivityMs,
  onEvent,
  onBytes,
  onClose,
  signal,
}: StreamSseOptions): void {
  if (signal.aborted) {
    onClose({ kind: "aborted" });
    return;
  }

  const xhr = new XMLHttpRequest();
  xhr.open("POST", url, true);
  for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
  xhr.timeout = timeoutMs;

  let processedLength = 0;
  // A chunk can end mid-line; carry the partial tail to the next chunk
  // instead of dropping the event it belongs to.
  let lineBuffer = "";
  let closed = false;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  const clearInactivity = () => {
    if (inactivityTimer !== null) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  };

  // Ends the stream with no outcome (caller returned "stop").
  const closeQuietly = () => {
    closed = true;
    clearInactivity();
  };

  const finish = (outcome: SseOutcome) => {
    if (closed) return;
    closeQuietly();
    onClose(outcome);
  };

  // Reset on every chunk, status events included: a stalled socket never
  // closes or errors on its own, so without this the stream hangs.
  const armInactivity = () => {
    clearInactivity();
    if (!inactivityMs || closed) return;
    inactivityTimer = setTimeout(() => {
      // Settle before aborting: abort() re-dispatches readystatechange.
      finish({ kind: "inactivity" });
      xhr.abort();
    }, inactivityMs);
  };

  const deliver = () => {
    if (closed) return;
    const text = xhr.responseText;
    const newText = text ? text.slice(processedLength) : "";
    processedLength = text ? text.length : processedLength;
    if (!newText) return;
    armInactivity();
    onBytes?.();

    lineBuffer += newText;
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (closed) break;
      if (!line.startsWith("data: ")) continue;
      try {
        const raw: unknown = JSON.parse(line.slice(6));
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
          continue;
        }
        if (onEvent(raw as SseEventData) === "stop") {
          closeQuietly();
          break;
        }
      } catch {
        // Incomplete or invalid JSON, or a throwing handler — skip silently.
      }
    }
  };

  // Both progress surfaces feed the same slice, so double delivery is a no-op.
  xhr.onprogress = deliver;

  xhr.onreadystatechange = () => {
    if (closed) return;
    if (xhr.readyState >= 3) deliver();
    if (closed) return;
    if (xhr.readyState === 4 && xhr.status >= 400) {
      finish({
        kind: "http-error",
        status: xhr.status,
        responseText: xhr.responseText,
      });
    }
  };

  xhr.onload = () => {
    // Flush anything not yet delivered via a progress surface.
    deliver();
    finish({
      kind: "load",
      status: xhr.status,
      responseText: xhr.responseText,
    });
  };

  xhr.onerror = () => finish({ kind: "network" });
  // RN dispatches `timeout`, not `error`, when xhr.timeout elapses.
  xhr.ontimeout = () => finish({ kind: "timeout" });
  xhr.onabort = () => finish({ kind: "aborted" });

  signal.addEventListener("abort", () => {
    const wasClosed = closed;
    closeQuietly();
    // Always forwarded, even after the stream ended: a no-op on a finished
    // XHR, and the only way to stop one that is still open.
    xhr.abort();
    if (!wasClosed) onClose({ kind: "aborted" });
  });

  armInactivity();
  xhr.send(body);
}

// ---- Offline / dead-socket guards -----------------------------------------

/** No bytes (data or `: ping`) this long after an app resume = dead socket. */
export const RESUME_DEAD_SOCKET_MS = 20_000;

export type StreamHealthTrip = "offline" | "dead-socket";

/**
 * Watches one in-flight stream for the two cases the XHR never reports
 * promptly: the device going offline, and the app returning from background
 * onto a half-open socket. The server pings every 15 s while a reply is in
 * flight, so a live stream always delivers a byte inside the 20 s window.
 * Calls `onTrip` at most once; the caller aborts the stream. Call
 * `noteBytes` from `streamSse`'s `onBytes`, and `dispose` wherever the
 * stream ends.
 */
export function watchStreamHealth(onTrip: (reason: StreamHealthTrip) => void): {
  noteBytes: () => void;
  dispose: () => void;
} {
  let tripped = false;
  let wentAway = false;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;

  const clearResume = () => {
    if (resumeTimer !== null) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  };
  const trip = (reason: StreamHealthTrip) => {
    if (tripped) return;
    tripped = true;
    dispose();
    onTrip(reason);
  };

  const unsubscribeOnline = onlineManager.subscribe((isOnline) => {
    if (!isOnline) trip("offline");
  });
  const appStateSub = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      if (!wentAway) return;
      wentAway = false;
      clearResume();
      resumeTimer = setTimeout(
        () => trip("dead-socket"),
        RESUME_DEAD_SOCKET_MS,
      );
    } else {
      wentAway = true;
      clearResume();
    }
  });

  function dispose() {
    clearResume();
    unsubscribeOnline();
    appStateSub.remove();
  }

  return {
    // Any byte after a resume proves the socket is live; the inactivity
    // watchdog covers it from there.
    noteBytes: clearResume,
    dispose,
  };
}

// ---- Post-abort reconciliation ---------------------------------------------

export const SETTLE_POLL_INTERVAL_MS = 5_000;
export const SETTLE_POLL_CAP_MS = 60_000;

/**
 * After a quiet abort the server may not have saved yet (recipe chat still
 * generating; coach settles only once it notices the close). Refetch the
 * conversation's messages now, then every 5 s for at most 60 s, until the
 * turn is settled: the last message is no longer the user's question (a
 * saved reply, or a refunded turn that deleted it). Returns a cancel
 * function — call it when the conversation leaves the screen.
 */
export function pollUntilTurnSettled(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const startedAt = Date.now();

  const tick = async () => {
    try {
      await queryClient.refetchQueries({ queryKey, exact: true });
    } catch {
      // A failed refetch is retried on the next tick.
    }
    if (cancelled) return;
    const rows = queryClient.getQueryData<{ role: string }[]>(queryKey);
    const last = rows?.[rows.length - 1];
    if (!last || last.role !== "user") return;
    if (Date.now() - startedAt >= SETTLE_POLL_CAP_MS) return;
    timer = setTimeout(() => void tick(), SETTLE_POLL_INTERVAL_MS);
  };
  void tick();

  return () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
  };
}
