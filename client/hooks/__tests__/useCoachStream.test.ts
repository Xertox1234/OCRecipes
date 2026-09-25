// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  charsToRelease,
  parseErrorCode,
  HOLD_GATE_MS,
  CHARS_PER_TICK,
  DRAIN_INTERVAL_MS,
  STREAM_INACTIVITY_MS,
  XHR_TIMEOUT_MS,
  type UseCoachStreamReturn,
} from "../useCoachStream";

// ── Pure helper tests (no timers, no XHR) ────────────────────────

describe("charsToRelease", () => {
  it("returns empty string when elapsed < holdGateMs", () => {
    expect(charsToRelease("hello world", 300, 700, CHARS_PER_TICK)).toBe("");
    expect(charsToRelease("hello world", 699, 700, CHARS_PER_TICK)).toBe("");
  });

  it("returns up to charsPerTick when elapsed >= holdGateMs", () => {
    expect(charsToRelease("hello world", 700, 700, CHARS_PER_TICK)).toBe(
      "hello world".slice(0, CHARS_PER_TICK),
    );
    expect(charsToRelease("hello world", 1500, 700, CHARS_PER_TICK)).toBe(
      "hello world".slice(0, CHARS_PER_TICK),
    );
  });

  it("returns entire buffer when buffer shorter than charsPerTick", () => {
    expect(charsToRelease("x", 700, 700, CHARS_PER_TICK)).toBe("x");
  });

  it("returns empty string for empty buffer regardless of elapsed", () => {
    expect(charsToRelease("", 5000, 700, CHARS_PER_TICK)).toBe("");
  });
});

describe("parseErrorCode", () => {
  it("extracts the code from a standard error body", () => {
    expect(
      parseErrorCode('{"error":"Daily limit","code":"DAILY_LIMIT_REACHED"}'),
    ).toBe("DAILY_LIMIT_REACHED");
  });

  it("returns undefined when the body has no code field", () => {
    expect(parseErrorCode('{"error":"oops"}')).toBeUndefined();
  });

  it("returns undefined for a non-JSON body", () => {
    expect(parseErrorCode("Internal Server Error")).toBeUndefined();
    expect(parseErrorCode("")).toBeUndefined();
  });

  it("returns undefined when code is not a string", () => {
    expect(parseErrorCode('{"code":123}')).toBeUndefined();
  });
});

// ── Hook behaviour tests (fake timers + XHR mock) ─────────────────

const { mockTokenStorage, mockGetApiUrl } = vi.hoisted(() => ({
  mockTokenStorage: { get: vi.fn().mockResolvedValue("test-token") },
  mockGetApiUrl: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("@/lib/token-storage", () => ({ tokenStorage: mockTokenStorage }));
vi.mock("@/lib/query-client", () => ({ getApiUrl: mockGetApiUrl }));
// An explicit zone, not the ambient one: a test that reads the runner's own
// zone passes on a UTC CI box whether or not the header is sent.
vi.mock("@/lib/timezone", () => ({
  getDeviceTimezone: () => "America/Los_Angeles",
}));
// The hook now also imports stripCoachBlocksFenceIncremental and
// createFenceScanState (perf fix — see coach-chat-utils.ts). None of this
// file's fixtures include a coach_blocks fence, so the real strip functions
// behave identically to the old `(s) => s.trim()` stub for them; only
// filterValidBlocks stays overridden, as before.
vi.mock("@/components/coach/coach-chat-utils", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/coach/coach-chat-utils")
    >();
  return {
    ...actual,
    filterValidBlocks: (arr: unknown[]) => arr,
  };
});

/**
 * MockXHR is a plain object that the hook will receive as the XHR instance.
 * We return this same object from the XMLHttpRequest constructor so that
 * test helpers (emit, complete) operate on the exact object the hook wired.
 */
class MockXHR {
  readyState = 0;
  responseText = "";
  status = 200;
  timeout = 0;
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onload: (() => void) | null = null;
  sentBody: string | null = null;
  aborted = false;
  headers: Record<string, string> = {};

  open = vi.fn();
  setRequestHeader = vi.fn((k: string, v: string) => (this.headers[k] = v));
  send = vi.fn((body: string) => {
    this.sentBody = body;
    this.readyState = 1;
  });
  // RN's abort() (XMLHttpRequest.js `abort`) zeroes status, then dispatches
  // readystatechange at DONE before `abort`. Model it, or a hook that treats
  // any readyState 4 as a finish passes here and misfires on device.
  abort = vi.fn(() => {
    this.aborted = true;
    if (this.readyState === 0 || this.readyState === 4) return;
    this.status = 0;
    this.responseText = "";
    this.readyState = 4;
    this.onreadystatechange?.();
  });

  /** Simulate an SSE event arriving from the server. */
  emit(payload: object) {
    this.responseText += `data: ${JSON.stringify(payload)}\n\n`;
    this.readyState = 3;
    this.onreadystatechange?.();
  }

  /** Simulate the connection completing cleanly: readystatechange, then load. */
  complete() {
    this.readyState = 4;
    this.status = 200;
    this.onreadystatechange?.();
    this.onload?.();
  }

  /**
   * Simulate a native failure after headers arrived, in RN's order
   * (`__didCompleteResponse` → `setReadyState(DONE)`): the response text is
   * replaced by the error string, status stays 200, readystatechange fires
   * FIRST, and only then `timeout` or `error`. No `load`.
   */
  private failNatively(kind: "timeout" | "error") {
    this.responseText = kind === "timeout" ? "timed out" : "network lost";
    this.readyState = 4;
    this.onreadystatechange?.();
    if (kind === "timeout") this.ontimeout?.();
    else this.onerror?.();
  }

  fireTimeout() {
    this.failNatively("timeout");
  }

  fireNetworkError() {
    this.failNatively("error");
  }
}

let mockXhr: MockXHR;

beforeEach(() => {
  vi.useFakeTimers();
  mockXhr = new MockXHR();
  // Return the SAME mockXhr instance from the constructor so hooks wire up
  // their event handlers on the same object our helpers call emit() on.
  const instance = mockXhr;
  vi.stubGlobal(
    "XMLHttpRequest",

    // `this: any` required — jsdom's XHR interface can't be matched structurally
    function (this: any) {
      return instance;
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setupHook() {
  const onDone = vi.fn();
  const onError = vi.fn();
  const { useCoachStream } = await import("../useCoachStream");
  const { result } = renderHook(() => useCoachStream({ onDone, onError }));
  return { result, onDone, onError };
}

/**
 * Call startStream and flush the internal tokenStorage.get() promise so the
 * XHR is fully wired before we emit events.
 */
async function startAndFlush(result: { current: UseCoachStreamReturn }) {
  await act(async () => {
    result.current.startStream(1, "test");
    // Flush the tokenStorage.get() microtask so xhr is set up
    await Promise.resolve();
  });
}

describe("useCoachStream hold gate", () => {
  it("does not render content before 700ms even if buffer fills instantly", async () => {
    const { result } = await setupHook();

    await startAndFlush(result);

    // Server sends content immediately
    act(() => {
      mockXhr.emit({ content: "Hello world" });
    });

    // Advance 600ms — hold gate not elapsed
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.streamingContent).toBe("");

    // Advance past the gate
    act(() => {
      vi.advanceTimersByTime(200);
    }); // total 800ms
    expect(result.current.streamingContent.length).toBeGreaterThan(0);
  });
});

describe("useCoachStream throttle rate", () => {
  it("drains approximately CHARS_PER_TICK chars per DRAIN_INTERVAL_MS tick", async () => {
    const { result } = await setupHook();

    await startAndFlush(result);
    act(() => {
      mockXhr.emit({ content: "A".repeat(400) });
    });

    // Advance past hold gate — the tick firing exactly at HOLD_GATE_MS also
    // releases chars (elapsed >= holdGateMs), so we get 1 extra tick here.
    act(() => {
      vi.advanceTimersByTime(HOLD_GATE_MS);
    });
    const afterGate = result.current.streamingContent.length;

    // Now advance 5 drain ticks beyond the gate
    act(() => {
      vi.advanceTimersByTime(DRAIN_INTERVAL_MS * 5);
    });

    // Should have drained exactly 5 additional CHARS_PER_TICK chars after gate
    expect(result.current.streamingContent.length).toBe(
      afterGate + 5 * CHARS_PER_TICK,
    );
  });
});

describe("useCoachStream status text", () => {
  it("shows 'Thinking…' immediately on startStream", async () => {
    const { result } = await setupHook();
    await startAndFlush(result);
    expect(result.current.statusText).toBe("Thinking…");
  });

  it("updates statusText when data.status event arrives", async () => {
    const { result } = await setupHook();
    await startAndFlush(result);
    act(() => {
      mockXhr.emit({ status: "Checking your pantry…" });
    });
    expect(result.current.statusText).toBe("Checking your pantry…");
  });

  it("clears statusText when first char drains", async () => {
    const { result } = await setupHook();
    await startAndFlush(result);
    act(() => {
      mockXhr.emit({ content: "Hello" });
    });

    expect(result.current.statusText).toBe("Thinking…");

    act(() => {
      vi.advanceTimersByTime(HOLD_GATE_MS + DRAIN_INTERVAL_MS);
    });
    expect(result.current.statusText).toBe("");
  });

  it("does not update statusText after first char has drained", async () => {
    const { result } = await setupHook();
    await startAndFlush(result);
    act(() => {
      mockXhr.emit({ content: "Hello" });
    });

    // Drain the first char
    act(() => {
      vi.advanceTimersByTime(HOLD_GATE_MS + DRAIN_INTERVAL_MS);
    });
    expect(result.current.statusText).toBe("");

    // Late-arriving status event — should NOT update statusText
    act(() => {
      mockXhr.emit({ status: "Working on it…" });
    });
    expect(result.current.statusText).toBe("");
  });
});

describe("useCoachStream abort", () => {
  it("sets isStreaming false and clears content after abortStream", async () => {
    const { result } = await setupHook();
    await startAndFlush(result);
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      result.current.abortStream();
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toBe("");
    expect(result.current.statusText).toBe("");
    expect(mockXhr.abort).toHaveBeenCalled();
  });
});

describe("useCoachStream onDone", () => {
  it("calls onDone with full text after buffer drains", async () => {
    const { result, onDone } = await setupHook();
    await startAndFlush(result);

    act(() => {
      mockXhr.emit({ content: "Hi" });
      mockXhr.emit({ done: true });
      mockXhr.complete();
    });

    // Advance past hold gate and drain all 2 chars
    act(() => {
      vi.advanceTimersByTime(HOLD_GATE_MS + DRAIN_INTERVAL_MS * 5);
    });

    expect(onDone).toHaveBeenCalledWith("Hi", undefined);
    expect(result.current.isStreaming).toBe(false);
  });
});

describe("useCoachStream safety_override", () => {
  it("clears streamingContent when safety_override arrives", async () => {
    const { result } = await setupHook();
    await startAndFlush(result);

    // Stream some content and drain it
    act(() => {
      mockXhr.emit({ content: "unsafe content here" });
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_GATE_MS + DRAIN_INTERVAL_MS * 2);
    });
    expect(result.current.streamingContent.length).toBeGreaterThan(0);

    // Safety override arrives
    act(() => {
      mockXhr.emit({ safety_override: "Safe message." });
    });

    // streamingContent should be cleared immediately
    expect(result.current.streamingContent).toBe("");
  });

  it("drains the safe message after safety_override", async () => {
    const { result } = await setupHook();
    await startAndFlush(result);

    act(() => {
      mockXhr.emit({ content: "unsafe" });
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_GATE_MS + DRAIN_INTERVAL_MS * 5);
    });

    act(() => {
      mockXhr.emit({ safety_override: "Safe." });
    });
    act(() => {
      mockXhr.emit({ done: true });
      mockXhr.complete();
    });

    // Drain the safe message
    act(() => {
      vi.advanceTimersByTime(HOLD_GATE_MS + DRAIN_INTERVAL_MS * 10);
    });

    expect(result.current.streamingContent).toContain("Safe.");
    expect(result.current.isStreaming).toBe(false);
  });

  it("calls onDone with the safe message text, not original content", async () => {
    const { result, onDone } = await setupHook();
    await startAndFlush(result);

    act(() => {
      mockXhr.emit({ content: "harmful advice" });
    });
    act(() => {
      mockXhr.emit({ safety_override: "I cannot help with that." });
    });
    act(() => {
      mockXhr.emit({ done: true });
      mockXhr.complete();
    });

    act(() => {
      vi.advanceTimersByTime(HOLD_GATE_MS + DRAIN_INTERVAL_MS * 20);
    });

    expect(onDone).toHaveBeenCalledWith(
      expect.stringContaining("I cannot help with that."),
      undefined,
    );
    expect(onDone).not.toHaveBeenCalledWith(
      expect.stringContaining("harmful advice"),
      undefined,
    );
  });
});

describe("useCoachStream request headers", () => {
  // The server anchors notebook follow-up dates and the coach's "today" in
  // the zone this header names. Without it `parseTimezone` falls back to
  // UTC, so every UTC-negative user's follow-up fires hours early.
  it("sends X-Timezone with the device timezone", async () => {
    const { result } = await setupHook();
    await startAndFlush(result);

    expect(mockXhr.headers["X-Timezone"]).toBe("America/Los_Angeles");
  });
});

describe("useCoachStream on a runtime with no global crypto", () => {
  // Hermes (the app's JS engine) has no global `crypto`. A bare
  // `crypto.randomUUID()` threw inside startStream's `.then`, so the XHR was
  // never sent and every coach message failed with "Response interrupted" on
  // device — while this suite, running in Node, stayed green.
  it("still sends the request, with a v4 turnKey", async () => {
    vi.stubGlobal("crypto", undefined);
    const { result, onError } = await setupHook();
    await startAndFlush(result);

    expect(onError).not.toHaveBeenCalled();
    expect(mockXhr.send).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockXhr.sentBody ?? "{}") as { turnKey?: string };
    expect(body.turnKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("useCoachStream guaranteed termination", () => {
  // Before this, the hook cleared isStreaming only on a `done` event, a
  // `data.error` event, a status >= 400, or `onerror`. A stalled socket, a
  // native timeout (RN dispatches `timeout`, not `error`), or a clean close
  // without `done` left it true forever, and CoachChat.handleSend refuses to
  // send while streaming, so the user was stuck until an app restart.
  // Every cell asserts the terminal callback fired exactly ONCE: RN dispatches
  // readystatechange before timeout/error, so a hook with two terminal paths
  // double-fires while still ending with isStreaming === false.

  it("orders the ceilings: server SSE cap < inactivity < XHR timeout", () => {
    // server/routes/chat.ts SSE_TIMEOUT_MS. The server sends its own
    // `{ error: "Response timeout" }` at this cap, so on a live connection that
    // graceful error must arrive before either client ceiling fires.
    const SERVER_SSE_TIMEOUT_MS = 120_000;
    expect(STREAM_INACTIVITY_MS).toBeGreaterThan(SERVER_SSE_TIMEOUT_MS);
    expect(XHR_TIMEOUT_MS).toBeGreaterThan(STREAM_INACTIVITY_MS);
  });

  it("sets xhr.timeout on the request", async () => {
    const { result } = await setupHook();
    await startAndFlush(result);
    expect(mockXhr.timeout).toBe(XHR_TIMEOUT_MS);
  });

  it("a native timeout mid-stream ends the stream with one error", async () => {
    const { result, onDone, onError } = await setupHook();
    await startAndFlush(result);

    act(() => {
      mockXhr.emit({ content: "Partial answer" });
      mockXhr.fireTimeout();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a network error mid-stream ends the stream with one error", async () => {
    const { result, onDone, onError } = await setupHook();
    await startAndFlush(result);

    act(() => {
      mockXhr.emit({ content: "Partial answer" });
      mockXhr.fireNetworkError();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a clean close without `done` after content ends the stream with one error", async () => {
    const { result, onDone, onError } = await setupHook();
    await startAndFlush(result);

    act(() => {
      mockXhr.emit({ content: "Half an ans" });
      mockXhr.complete();
    });
    act(() => {
      vi.advanceTimersByTime(HOLD_GATE_MS + DRAIN_INTERVAL_MS * 10);
    });

    expect(result.current.isStreaming).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a clean close without `done` and no content ends the stream with one error", async () => {
    const { result, onDone, onError } = await setupHook();
    await startAndFlush(result);

    act(() => {
      mockXhr.complete();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a stalled stream is aborted after the inactivity window, which any event resets", async () => {
    const { result, onDone, onError } = await setupHook();
    await startAndFlush(result);

    // A status event counts as activity, not just content.
    act(() => {
      vi.advanceTimersByTime(STREAM_INACTIVITY_MS - 1);
      mockXhr.emit({ status: "Checking your pantry…" });
    });
    act(() => {
      vi.advanceTimersByTime(STREAM_INACTIVITY_MS - 1);
      mockXhr.emit({ content: "Here is" });
    });
    act(() => {
      vi.advanceTimersByTime(STREAM_INACTIVITY_MS - 1);
    });
    expect(result.current.isStreaming).toBe(true);
    expect(onError).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2);
    });

    expect(result.current.isStreaming).toBe(false);
    // The abort also dispatches readystatechange at DONE; it must not re-enter.
    expect(mockXhr.abort).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a server `data.error` followed by the clean close fires one error", async () => {
    const { result, onError } = await setupHook();
    await startAndFlush(result);

    act(() => {
      mockXhr.emit({ error: "Response timeout" });
      mockXhr.complete();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe("Response timeout");
  });

  it("control: `done` then a clean close fires onDone once and no error, even after a long drain", async () => {
    const { result, onDone, onError } = await setupHook();
    await startAndFlush(result);

    act(() => {
      mockXhr.emit({ content: "Hi" });
      mockXhr.emit({ done: true });
      mockXhr.complete();
    });
    act(() => {
      vi.advanceTimersByTime(STREAM_INACTIVITY_MS * 2);
    });

    expect(result.current.isStreaming).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("Hi", undefined);
    expect(onError).not.toHaveBeenCalled();
  });

  it("abortStream fires no error, and its inactivity timer does not fire later", async () => {
    const { result, onDone, onError } = await setupHook();
    await startAndFlush(result);

    act(() => {
      mockXhr.emit({ content: "Some" });
      result.current.abortStream();
    });
    act(() => {
      vi.advanceTimersByTime(STREAM_INACTIVITY_MS * 2);
    });

    expect(result.current.isStreaming).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("unmount mid-stream fires no error, and its inactivity timer does not fire later", async () => {
    const onDone = vi.fn();
    const onError = vi.fn();
    const { useCoachStream } = await import("../useCoachStream");
    const { result, unmount } = renderHook(() =>
      useCoachStream({ onDone, onError }),
    );
    await startAndFlush(result);

    act(() => {
      mockXhr.emit({ content: "Some" });
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(STREAM_INACTIVITY_MS * 2);
    });

    expect(mockXhr.abort).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
