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
