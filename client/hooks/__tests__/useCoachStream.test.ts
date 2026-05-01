// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  charsToRelease,
  HOLD_GATE_MS,
  CHARS_PER_TICK,
  DRAIN_INTERVAL_MS,
  type UseCoachStreamReturn,
} from "../useCoachStream";

// ── Pure helper tests (no timers, no XHR) ────────────────────────

describe("charsToRelease", () => {
  it("returns empty string when elapsed < holdGateMs", () => {
    expect(charsToRelease("hello world", 300, 700, 2)).toBe("");
    expect(charsToRelease("hello world", 699, 700, 2)).toBe("");
  });

  it("returns up to charsPerTick when elapsed >= holdGateMs", () => {
    expect(charsToRelease("hello world", 700, 700, 2)).toBe("he");
    expect(charsToRelease("hello world", 1500, 700, 2)).toBe("he");
  });

  it("returns entire buffer when buffer shorter than charsPerTick", () => {
    expect(charsToRelease("x", 700, 700, 2)).toBe("x");
  });

  it("returns empty string for empty buffer regardless of elapsed", () => {
    expect(charsToRelease("", 5000, 700, 2)).toBe("");
  });
});

// ── Hook behaviour tests (fake timers + XHR mock) ─────────────────

const { mockTokenStorage, mockGetApiUrl } = vi.hoisted(() => ({
  mockTokenStorage: { get: vi.fn().mockResolvedValue("test-token") },
  mockGetApiUrl: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("@/lib/token-storage", () => ({ tokenStorage: mockTokenStorage }));
vi.mock("@/lib/query-client", () => ({ getApiUrl: mockGetApiUrl }));
vi.mock("@/components/coach/coach-chat-utils", () => ({
  stripCoachBlocksFence: (s: string) => s.trim(),
  filterValidBlocks: (arr: unknown[]) => arr,
}));

/**
 * MockXHR is a plain object that the hook will receive as the XHR instance.
 * We return this same object from the XMLHttpRequest constructor so that
 * test helpers (emit, complete) operate on the exact object the hook wired.
 */
class MockXHR {
  readyState = 0;
  responseText = "";
  status = 200;
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sentBody: string | null = null;
  aborted = false;
  headers: Record<string, string> = {};

  open = vi.fn();
  setRequestHeader = vi.fn((k: string, v: string) => (this.headers[k] = v));
  send = vi.fn((body: string) => {
    this.sentBody = body;
    this.readyState = 1;
  });
  abort = vi.fn(() => {
    this.aborted = true;
  });

  /** Simulate an SSE event arriving from the server. */
  emit(payload: object) {
    this.responseText += `data: ${JSON.stringify(payload)}\n\n`;
    this.readyState = 3;
    this.onreadystatechange?.();
  }

  /** Simulate the connection completing successfully. */
  complete() {
    this.readyState = 4;
    this.status = 200;
    this.onreadystatechange?.();
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
      mockXhr.emit({ content: "A".repeat(100) });
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
