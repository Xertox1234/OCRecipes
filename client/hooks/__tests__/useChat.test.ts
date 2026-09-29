// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import {
  useSendMessage,
  useCreateNotebookEntry,
  useUpdateNotebookEntry,
  useChatConversations,
  useChatMessages,
  useMarkPendingRecipeTurn,
  RECIPE_TURN_POLL_INTERVAL_MS,
  RECIPE_TURN_POLL_CAP_MS,
  useSaveRecipeFromChat,
} from "../useChat";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { SSE_TIMEOUT_MS } from "@shared/constants/sse";

const { mockApiRequest, mockGetApiUrl, mockTokenStorage } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockGetApiUrl: vi.fn(() => "http://localhost:3000"),
  mockTokenStorage: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    invalidateCache: vi.fn(),
  },
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  getApiUrl: () => mockGetApiUrl(),
}));

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: mockTokenStorage,
}));

// An explicit zone, not the ambient one: a test that reads the runner's own
// zone passes on a UTC CI box whether or not the header is sent.
vi.mock("@/lib/timezone", () => ({
  getDeviceTimezone: () => "Asia/Tokyo",
}));

// XHR mock — sendMessage uses XMLHttpRequest instead of fetch for SSE streaming
// because React Native's fetch polyfill returns response.body = null on iOS/Android.
type XHRHandler = ((ev: ProgressEvent) => unknown) | null;

// Captures the instance created by `new XMLHttpRequest()` inside sendMessage.
// Must be a class (not a vi.fn arrow factory) so it is constructable.
let xhrInstance: MockXHR;
let xhrConstructorCalls = 0;

class MockXHR {
  open = vi.fn();
  setRequestHeader = vi.fn();
  timeout = 0;
  responseText = "";
  status = 200;
  onprogress: XHRHandler = null;
  onload: XHRHandler = null;
  onerror: XHRHandler = null;
  ontimeout: XHRHandler = null;
  onabort: XHRHandler = null;
  send = vi.fn();
  // Real XHR fires `onabort` when `.abort()` is called on an in-flight
  // request — this mock does so synchronously, matching how the other
  // simulate* helpers below drive their handlers.
  abort = vi.fn(() => {
    this.onabort?.(new ProgressEvent("abort"));
  });

  constructor() {
    xhrInstance = this;
    xhrConstructorCalls++;
  }

  /** Simulate incremental SSE chunks followed by a successful onload. */
  simulateChunks(chunks: string[], status = 200) {
    this.status = status;
    let accumulated = "";
    for (const chunk of chunks) {
      accumulated += chunk;
      this.responseText = accumulated;
      this.onprogress?.(new ProgressEvent("progress"));
    }
    this.onload?.(new ProgressEvent("load"));
  }

  /** Simulate a non-2xx response with a JSON error body (no onprogress). */
  simulateErrorResponse(status: number, body: object) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.(new ProgressEvent("load"));
  }

  simulateNetworkError() {
    this.onerror?.(new ProgressEvent("error"));
  }

  simulateTimeout() {
    this.ontimeout?.(new ProgressEvent("timeout"));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  xhrConstructorCalls = 0;
  vi.stubGlobal("XMLHttpRequest", MockXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSendMessage", () => {
  it("does nothing when conversationId is null", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useSendMessage(null), { wrapper });

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(xhrConstructorCalls).toBe(0);
  });

  it("streams SSE content and accumulates messages", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("test-token");

    const chunks = [
      'data: {"content":"Hello"}\n',
      'data: {"content":" world"}\n',
      'data: {"done":true}\n',
    ];

    const { result } = renderHook(() => useSendMessage(42), { wrapper });

    expect(result.current.isStreaming).toBe(false);

    await act(async () => {
      const p = result.current.sendMessage("test message");
      // Flush the tokenStorage.get() microtask so XHR is created and send() called
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.simulateChunks(chunks);
      await p;
    });

    // After streaming completes, isStreaming should be false and content cleared
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toBe("");

    // Verify XHR was configured correctly
    expect(xhrInstance.open).toHaveBeenCalledWith(
      "POST",
      expect.stringContaining("/api/chat/conversations/42/messages"),
      true,
    );
    expect(xhrInstance.setRequestHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/json",
    );
    expect(xhrInstance.setRequestHeader).toHaveBeenCalledWith(
      "Authorization",
      "Bearer test-token",
    );
    expect(xhrInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ content: "test message" }),
    );
  });

  it("sends request without auth header when no token", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue(null);

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    await act(async () => {
      const p = result.current.sendMessage("hello");
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.simulateChunks(['data: {"done":true}\n']);
      await p;
    });

    const setHeaderCalls = xhrInstance.setRequestHeader.mock.calls;
    const authCall = setHeaderCalls.find(
      ([k]: string[]) => k === "Authorization",
    );
    expect(authCall).toBeUndefined();
    expect(xhrInstance.setRequestHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/json",
    );
  });

  it("sets requestError on non-ok response", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("token");

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    await act(async () => {
      const p = result.current.sendMessage("test");
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.simulateErrorResponse(500, {
        error: "Internal Server Error",
        code: "SERVER_ERROR",
      });
      await p;
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.requestError).toBe("Internal Server Error");
  });

  it("arms the XHR timeout above the server's SSE cap, so the server's graceful timeout arrives first", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("token");

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    await act(async () => {
      const p = result.current.sendMessage("test");
      await Promise.resolve();
      await Promise.resolve();
      expect(xhrInstance.timeout).toBeGreaterThan(SSE_TIMEOUT_MS);
      xhrInstance.simulateTimeout();
      await p;
    });
  });

  it("sets requestError on timeout", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("token");

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    await act(async () => {
      const p = result.current.sendMessage("test");
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.simulateTimeout();
      await p;
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.requestError).toBe(
      "Request timed out. Please try again.",
    );
  });

  it("sets requestError on network error", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("token");

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    await act(async () => {
      const p = result.current.sendMessage("test");
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.simulateNetworkError();
      await p;
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.requestError).toBe(
      "Network error. Please check your connection and try again.",
    );
  });

  it("sets requestError on application-level error from SSE stream", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("token");

    const chunks = [
      'data: {"content":"partial"}\n',
      'data: {"error":"Rate limit exceeded"}\n',
    ];

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    await act(async () => {
      const p = result.current.sendMessage("test");
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.simulateChunks(chunks);
      await p;
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.requestError).toBe("Rate limit exceeded");
  });

  it("invalidates query cache when done signal received", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    mockTokenStorage.get.mockResolvedValue("token");

    const chunks = ['data: {"content":"response"}\n', 'data: {"done":true}\n'];

    const { result } = renderHook(() => useSendMessage(5), { wrapper });

    await act(async () => {
      const p = result.current.sendMessage("test");
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.simulateChunks(chunks);
      await p;
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/chat/conversations/5/messages"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/chat/conversations"],
    });
  });

  // P2-2026-09-24: recipe/remix generation keeps running and saves
  // server-side after the client leaves (finish-and-save policy), so an
  // intentional abort (unmount, navigating away) must mark the conversation
  // stale rather than silently skip invalidation — the OLD behavior, back
  // when the server also stopped on disconnect and there was nothing new to
  // fetch. `refetchType: "none"` defers the refetch instead of racing the
  // server's still-in-flight write (same pattern as CoachOverlayContent /
  // CoachChat, #1060).
  it("marks queries stale (not refetch) when the stream is intentionally aborted", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    mockTokenStorage.get.mockResolvedValue("token");

    const { result } = renderHook(() => useSendMessage(9), { wrapper });

    await act(async () => {
      const p = result.current.sendMessage("test");
      // Flush the tokenStorage.get() microtask so the XHR exists to abort.
      await Promise.resolve();
      await Promise.resolve();
      result.current.abortStream();
      await p;
    });

    expect(xhrInstance.abort).toHaveBeenCalledOnce();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/chat/conversations/9/messages"],
      refetchType: "none",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/chat/conversations"],
      refetchType: "none",
    });
    // Aborting is not a stream error — no error bubble should show.
    expect(result.current.streamError).toBe(false);
  });

  it("abortStream is a no-op when no stream is in flight", () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    expect(() => result.current.abortStream()).not.toThrow();
  });

  // P3-2026-09-26: sendMessage's token read (`await tokenStorage.get()`) is
  // async, same shape as useCoachStream's startStream. An abort/unmount
  // that lands while it is still pending must stop its continuation from
  // sending an orphaned request later — see useCoachStream's own
  // "overlapping starts" describe block for the precedent this mirrors.
  describe("token-read epoch guard", () => {
    function deferToken() {
      let resolve!: (token: string | null) => void;
      mockTokenStorage.get.mockImplementationOnce(
        () => new Promise<string | null>((r) => (resolve = r)),
      );
      return (token: string | null = "test-token") => resolve(token);
    }

    it("does not send a request when aborted before the token read resolves", async () => {
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useSendMessage(1), { wrapper });
      const resolveToken = deferToken();

      act(() => {
        void result.current.sendMessage("first");
      });
      act(() => {
        result.current.abortStream();
      });
      await act(async () => {
        resolveToken();
        await Promise.resolve();
      });

      expect(xhrConstructorCalls).toBe(0);
      expect(result.current.isStreaming).toBe(false);
    });

    it("sends only the new stream's request after an abort-then-restart during the token read", async () => {
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useSendMessage(1), { wrapper });
      const resolveFirst = deferToken();
      const resolveSecond = deferToken();

      act(() => {
        void result.current.sendMessage("first");
      });
      act(() => {
        result.current.abortStream();
      });
      act(() => {
        void result.current.sendMessage("second");
      });
      await act(async () => {
        resolveFirst();
        resolveSecond();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(xhrConstructorCalls).toBe(1);
      expect(xhrInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ content: "second" }),
      );
    });

    it("ignores a stale token-read failure from an aborted send while a new one runs", async () => {
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useSendMessage(1), { wrapper });
      let rejectFirst!: (err: Error) => void;
      mockTokenStorage.get.mockImplementationOnce(
        () => new Promise<string | null>((_, reject) => (rejectFirst = reject)),
      );
      const resolveSecond = deferToken(); // the second send's read stays pending

      act(() => {
        void result.current.sendMessage("first");
      });
      act(() => {
        result.current.abortStream();
      });
      act(() => {
        void result.current.sendMessage("second");
      });
      await act(async () => {
        rejectFirst(new Error("keychain locked"));
        await Promise.resolve();
      });

      expect(result.current.requestError).toBeNull();
      expect(result.current.isStreaming).toBe(true);

      // Let the second (current) send finish cleanly.
      await act(async () => {
        resolveSecond();
        await Promise.resolve();
        await Promise.resolve();
        xhrInstance.simulateChunks(['data: {"done":true}\n']);
      });
      expect(result.current.isStreaming).toBe(false);
    });

    it("does not send a request when unmounted before the token read resolves", async () => {
      const { wrapper } = createQueryWrapper();
      const { result, unmount } = renderHook(() => useSendMessage(1), {
        wrapper,
      });
      const resolveToken = deferToken();

      act(() => {
        void result.current.sendMessage("first");
      });
      unmount();
      await act(async () => {
        resolveToken();
        await Promise.resolve();
      });

      expect(xhrConstructorCalls).toBe(0);
    });

    // User ruling 2026-09-29: leaving a chat mid-reply keeps the reply
    // running, so the full answer is there on return (ChatScreen never aborts
    // on unmount; the screens that do call abortStream in their own cleanup).
    // Unmount only stops a send that has not been sent yet (the case above).
    it("keeps an already-sent reply running when unmounted, and refreshes the conversation when it finishes", async () => {
      const { wrapper, queryClient } = createQueryWrapper();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      mockTokenStorage.get.mockResolvedValue("token");
      const { result, unmount } = renderHook(() => useSendMessage(5), {
        wrapper,
      });

      let p!: Promise<void>;
      await act(async () => {
        p = result.current.sendMessage("hello");
        await Promise.resolve();
        await Promise.resolve();
      });
      const xhr = xhrInstance;
      expect(xhrConstructorCalls).toBe(1);

      unmount();
      expect(xhr.abort).not.toHaveBeenCalled();

      await act(async () => {
        xhr.simulateChunks([
          'data: {"content":"Hi"}\n',
          'data: {"done":true}\n',
        ]);
        await p;
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/chat/conversations/5/messages"],
      });
    });

    // AC2: the harder case — abortStream() on an ALREADY in-flight XHR
    // (token read already resolved, xhr created and sent), then an
    // immediate same-tick restart. This is what the finally block's
    // "ownership-scoped" epoch gate exists for: without it, the first
    // call's finally (which runs asynchronously once its aborted XHR
    // settles) would unconditionally tear down the second call's
    // just-started state.
    it("restarts cleanly after aborting an already-in-flight XHR in the same tick", async () => {
      const { wrapper } = createQueryWrapper();
      mockTokenStorage.get.mockResolvedValue("token");

      const { result } = renderHook(() => useSendMessage(1), { wrapper });

      let p1!: Promise<void>;
      await act(async () => {
        p1 = result.current.sendMessage("first");
        // Flush the tokenStorage.get() microtask so the first XHR is created.
        await Promise.resolve();
        await Promise.resolve();
      });
      const firstXhr = xhrInstance;
      expect(xhrConstructorCalls).toBe(1);

      let p2!: Promise<void>;
      act(() => {
        // Synchronously resets isStreamingRef, so the restart below (same
        // tick) is accepted rather than refused by the overlap guard.
        result.current.abortStream();
      });
      act(() => {
        p2 = result.current.sendMessage("second");
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(firstXhr.abort).toHaveBeenCalledOnce();
      expect(xhrConstructorCalls).toBe(2);
      const secondXhr = xhrInstance;
      expect(secondXhr).not.toBe(firstXhr);
      expect(secondXhr.send).toHaveBeenCalledWith(
        JSON.stringify({ content: "second" }),
      );

      // The aborted first call has settled (its XHR fired onabort) while the
      // second is still in flight. Its `finally` must not tear down the
      // second call's state: this is what pins the ownership-scoped epoch
      // gate in useSendMessage's finally (an unconditional reset there turns
      // isStreaming false here).
      await act(async () => {
        await p1;
      });
      expect(result.current.isStreaming).toBe(true);

      await act(async () => {
        secondXhr.simulateChunks(['data: {"done":true}\n']);
        await p2;
      });

      expect(result.current.isStreaming).toBe(false);
    });
  });

  // P3-2026-09-24: xhrRef/isStreamingRef are single-slot state on this hook
  // instance. Before the fix, a second overlapping sendMessage call
  // overwrote xhrRef with the newer XHR, orphaning the first — abortStream
  // could then only ever reach the LAST call, and the first request's own
  // `finally` unconditionally nulled xhrRef out from under the second.
  it("refuses an overlapping sendMessage while one is already in flight, so abortStream still reaches the original request", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("token");

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    let firstXhr!: MockXHR;
    let p1!: Promise<void>;
    let p2!: Promise<void>;

    await act(async () => {
      p1 = result.current.sendMessage("first");
      // Flush the tokenStorage.get() microtask so the first XHR is created.
      await Promise.resolve();
      await Promise.resolve();
      firstXhr = xhrInstance;
      const callsAfterFirst = xhrConstructorCalls;

      // Second call while the first is still streaming — must be refused:
      // no second XHR, no state reset for the in-flight request.
      p2 = result.current.sendMessage("second");
      await Promise.resolve();
      await Promise.resolve();

      expect(xhrConstructorCalls).toBe(callsAfterFirst);
      expect(xhrInstance).toBe(firstXhr);

      // abortStream reaches the ONLY (original) in-flight request.
      result.current.abortStream();
      expect(firstXhr.abort).toHaveBeenCalledOnce();

      await p1;
      await p2;
    });

    expect(result.current.isStreaming).toBe(false);
  });

  it("silently ignores incomplete JSON chunks", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("token");

    // Simulate a JSON payload split across two onprogress deliveries.
    // The SSE buffer reassembles lines before passing them to JSON.parse.
    const chunks = [
      'data: {"content":"ok"}\ndata: {"conten',
      't":"split"}\ndata: {"done":true}\n',
    ];

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    await act(async () => {
      const p = result.current.sendMessage("test");
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.simulateChunks(chunks);
      await p;
    });

    expect(result.current.isStreaming).toBe(false);
  });

  it("clears requestError at the start of the next sendMessage call", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("token");

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    // First send — produces an error
    await act(async () => {
      const p = result.current.sendMessage("first");
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.simulateErrorResponse(429, { error: "Rate limit exceeded" });
      await p;
    });

    expect(result.current.requestError).toBe("Rate limit exceeded");

    // Second send — requestError is cleared at the top of sendMessage before any
    // network activity. After a successful second send it must remain null.
    await act(async () => {
      const p = result.current.sendMessage("retry");
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.simulateChunks(['data: {"done":true}\n']);
      await p;
    });

    expect(result.current.requestError).toBeNull();
  });

  describe("recipe finder events", () => {
    const block = {
      type: "recipe_results",
      source: "community",
      items: [],
      actions: ["generate"],
      notice: "no_matches",
      flow: {
        flowId: "00000000-0000-4000-8000-000000000000",
        stage: "results",
        request: "x",
        query: { q: "x" },
        round: 0,
        shownIds: [],
      },
    };

    it("sends finderAction in the body", async () => {
      const { wrapper } = createQueryWrapper();
      mockTokenStorage.get.mockResolvedValue("t");
      const { result } = renderHook(() => useSendMessage(42), { wrapper });
      const finderAction = {
        type: "generate" as const,
        flowId: "00000000-0000-4000-8000-000000000000",
      };
      await act(async () => {
        const p = result.current.sendMessage("Generate", undefined, undefined, {
          finderAction,
        });
        await Promise.resolve();
        await Promise.resolve();
        xhrInstance.simulateChunks(['data: {"done":true}\n']);
        await p;
      });
      expect(xhrInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ content: "Generate", finderAction }),
      );
    });

    it("exposes progress text and the finder block while streaming, then clears them", async () => {
      const { wrapper } = createQueryWrapper();
      mockTokenStorage.get.mockResolvedValue("t");
      const { result } = renderHook(() => useSendMessage(42), { wrapper });
      let p!: Promise<void>;
      await act(async () => {
        p = result.current.sendMessage("Mediterranean");
        await Promise.resolve();
        await Promise.resolve();
        xhrInstance.responseText =
          'data: {"status":"Searching community recipes…"}\n';
        xhrInstance.onprogress?.(new ProgressEvent("progress"));
      });
      expect(result.current.streamingStatus).toBe(
        "Searching community recipes…",
      );
      await act(async () => {
        xhrInstance.responseText += `data: ${JSON.stringify({ finder: block })}\n`;
        xhrInstance.onprogress?.(new ProgressEvent("progress"));
      });
      expect(result.current.streamingFinder).toEqual(block);
      await act(async () => {
        xhrInstance.responseText += 'data: {"done":true}\n';
        xhrInstance.onload?.(new ProgressEvent("load"));
        await p;
      });
      expect(result.current.streamingFinder).toBeNull();
      expect(result.current.streamingStatus).toBeNull();
    });

    it("ignores a malformed finder event", async () => {
      const { wrapper } = createQueryWrapper();
      mockTokenStorage.get.mockResolvedValue("t");
      const { result } = renderHook(() => useSendMessage(42), { wrapper });
      let p!: Promise<void>;
      await act(async () => {
        p = result.current.sendMessage("x");
        await Promise.resolve();
        await Promise.resolve();
        xhrInstance.responseText =
          'data: {"finder":{"type":"recipe_results"}}\n';
        xhrInstance.onprogress?.(new ProgressEvent("progress"));
      });
      expect(result.current.streamingFinder).toBeNull();
      await act(async () => {
        xhrInstance.onload?.(new ProgressEvent("load"));
        await p;
      });
    });
  });
});

// P3-2026-09-26: the recipe/remix finish-and-save policy keeps generating
// after an intentional abort, so a fixed settle margin (useRefreshOnFocus)
// isn't enough — these consumers poll (bounded by a cap) until the pending
// turn resolves. See the "Recipe/remix post-abort poll" block in useChat.ts.
describe("recipe/remix post-abort poll", () => {
  const PENDING_KEY = ["__pendingRecipeTurns"];
  // Advancing fake timers by EXACTLY the scheduled interval fires the timer
  // but leaves the resulting fetch's promise chain (queryFn -> React Query's
  // internal state update -> React's commit) one tick behind under fake
  // timers; a small buffer past the boundary lets it fully settle before the
  // next assertion reads `result.current`.
  const FLUSH_MS = 50;

  afterEach(() => {
    vi.useRealTimers();
  });

  const conversation = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 7,
    userId: "u1",
    title: "Recipe chat",
    type: "recipe",
    isPinned: false,
    pinnedAt: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  });

  it("useMarkPendingRecipeTurn writes the conversation id into the query cache with a fresh timestamp", () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => useMarkPendingRecipeTurn(), {
      wrapper,
    });

    const before = Date.now();
    act(() => {
      result.current(7);
    });
    const after = Date.now();

    const pending =
      queryClient.getQueryData<Record<number, number>>(PENDING_KEY);
    expect(pending?.[7]).toBeGreaterThanOrEqual(before);
    expect(pending?.[7]).toBeLessThanOrEqual(after);
  });

  // The pending-turns query entry never gets a `useQuery` observer (pollers
  // only read/write it directly), so its gcTime timer is scheduled once, at
  // first write, and never rescheduled — the default 5-minute gcTime would
  // otherwise wipe the whole map on a timer shorter than RECIPE_TURN_POLL_CAP_MS
  // can legitimately need, with nothing polling in between to keep it alive.
  it("survives past the default query gcTime (5 min) with nothing polling in between", () => {
    vi.useFakeTimers();
    const { wrapper, queryClient } = createQueryWrapper();

    const { result: markResult } = renderHook(
      () => useMarkPendingRecipeTurn(),
      {
        wrapper,
      },
    );
    act(() => {
      markResult.current(7);
    });

    // No useChatConversations/useChatMessages observer mounted here — the
    // default gcTime (5 min) would garbage-collect the query cache entry on
    // its own if useMarkPendingRecipeTurn hadn't pinned gcTime: Infinity.
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    });

    expect(
      queryClient.getQueryData<Record<number, number>>(PENDING_KEY),
    ).toEqual({ 7: expect.any(Number) });
  });

  // Opting a caller into the poll must not fragment a query key another
  // caller already shares — pollPendingRecipeTurns configures polling
  // BEHAVIOR only, not which server data is being fetched.
  it("keeps the same query key with and without pollPendingRecipeTurns, so callers share one cache entry", () => {
    const { wrapper, queryClient } = createQueryWrapper();
    mockApiRequest.mockResolvedValue({ json: async () => [conversation()] });

    renderHook(() => useChatConversations("coach"), { wrapper });
    renderHook(
      () => useChatConversations("coach", { pollPendingRecipeTurns: true }),
      { wrapper },
    );

    // Both hook instances resolve to the SAME cache entry — one fetch, not
    // two — which is only true if their query keys are identical.
    const matching = queryClient
      .getQueryCache()
      .findAll({ queryKey: ["/api/chat/conversations", { type: "coach" }] });
    expect(matching).toHaveLength(1);
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
  });

  it("polls the recipe conversation list while a turn is pending, and stops once the conversation's updatedAt moves past the abort mark", async () => {
    vi.useFakeTimers();
    const { wrapper, queryClient } = createQueryWrapper();

    const { result: markResult } = renderHook(
      () => useMarkPendingRecipeTurn(),
      {
        wrapper,
      },
    );
    act(() => {
      markResult.current(7);
    });
    const abortedAt =
      queryClient.getQueryData<Record<number, number>>(PENDING_KEY)![7];

    const preSettle = [conversation()];
    // Past the abort mark, so `isResolved` (updatedAt > abortedAt) fires —
    // mirrors the server bumping `chatConversations.updatedAt` on save.
    const settled = [
      conversation({ updatedAt: new Date(abortedAt + 1000).toISOString() }),
    ];
    mockApiRequest
      .mockResolvedValueOnce({ json: async () => preSettle })
      .mockResolvedValueOnce({ json: async () => preSettle })
      .mockResolvedValueOnce({ json: async () => settled });

    const { result } = renderHook(
      () => useChatConversations("recipe", { pollPendingRecipeTurns: true }),
      { wrapper },
    );

    // Initial fetch (mount).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toEqual(preSettle);

    // First poll tick — still pre-settle, keeps polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        RECIPE_TURN_POLL_INTERVAL_MS + FLUSH_MS,
      );
    });
    expect(result.current.data).toEqual(preSettle);
    expect(queryClient.getQueryData(PENDING_KEY)).toEqual({
      7: expect.any(Number),
    });

    // Second poll tick — the server's save landed; resolves and stops.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        RECIPE_TURN_POLL_INTERVAL_MS + FLUSH_MS,
      );
    });
    expect(result.current.data).toEqual(settled);
    expect(queryClient.getQueryData(PENDING_KEY)).toEqual({});

    const callsAtResolution = mockApiRequest.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECIPE_TURN_POLL_INTERVAL_MS * 3);
    });
    expect(mockApiRequest.mock.calls.length).toBe(callsAtResolution);
  });

  it("stops polling and purges the mark once the cap elapses without resolving", async () => {
    vi.useFakeTimers();
    const { wrapper, queryClient } = createQueryWrapper();

    const neverSettles = [conversation()];
    mockApiRequest.mockResolvedValue({ json: async () => neverSettles });

    const { result: markResult } = renderHook(
      () => useMarkPendingRecipeTurn(),
      {
        wrapper,
      },
    );
    act(() => {
      markResult.current(7);
    });

    renderHook(
      () => useChatConversations("recipe", { pollPendingRecipeTurns: true }),
      { wrapper },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        RECIPE_TURN_POLL_CAP_MS + RECIPE_TURN_POLL_INTERVAL_MS * 2 + FLUSH_MS,
      );
    });

    expect(queryClient.getQueryData(PENDING_KEY)).toEqual({});
    const callsAtCap = mockApiRequest.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECIPE_TURN_POLL_INTERVAL_MS * 3);
    });
    expect(mockApiRequest.mock.calls.length).toBe(callsAtCap);
  });

  it("cancels the poll on unmount — no further fetches after the observer is gone", async () => {
    vi.useFakeTimers();
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockResolvedValue({ json: async () => [conversation()] });

    const { result: markResult } = renderHook(
      () => useMarkPendingRecipeTurn(),
      {
        wrapper,
      },
    );
    act(() => {
      markResult.current(7);
    });

    const { unmount } = renderHook(
      () => useChatConversations("recipe", { pollPendingRecipeTurns: true }),
      { wrapper },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsBeforeUnmount = mockApiRequest.mock.calls.length;

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECIPE_TURN_POLL_CAP_MS);
    });
    expect(mockApiRequest.mock.calls.length).toBe(callsBeforeUnmount);
  });

  it("polls a conversation's messages while its turn is pending, and stops once a new assistant message appears", async () => {
    vi.useFakeTimers();
    const { wrapper, queryClient } = createQueryWrapper();
    // useChatMessages has no explicit queryFn (production relies on the
    // shared queryClient's default queryFn) — give this local client one
    // wired to the same mocked apiRequest, mirroring that default.
    queryClient.setQueryDefaults(["/api/chat/conversations/7/messages"], {
      queryFn: async () => {
        const res = await mockApiRequest(
          "GET",
          "/api/chat/conversations/7/messages",
        );
        return res.json();
      },
    });

    const userMsg = {
      id: 1,
      conversationId: 7,
      role: "user",
      content: "hi",
      metadata: null,
      createdAt: "2020-01-01T00:00:00.000Z",
    };

    const { result: markResult } = renderHook(
      () => useMarkPendingRecipeTurn(),
      {
        wrapper,
      },
    );
    act(() => {
      markResult.current(7);
    });
    const abortedAt =
      queryClient.getQueryData<Record<number, number>>(PENDING_KEY)![7];
    // Past the abort mark, so `isResolved` (an assistant message newer than
    // the abort) fires — mirrors the server's finish-and-save reply landing.
    const assistantMsg = {
      id: 2,
      conversationId: 7,
      role: "assistant",
      content: "the finished reply",
      metadata: null,
      createdAt: new Date(abortedAt + 1000).toISOString(),
    };
    mockApiRequest
      .mockResolvedValueOnce({ json: async () => [userMsg] })
      .mockResolvedValueOnce({ json: async () => [userMsg] })
      .mockResolvedValueOnce({ json: async () => [userMsg, assistantMsg] });

    const { result } = renderHook(
      () => useChatMessages(7, undefined, { pollPendingRecipeTurn: true }),
      { wrapper },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toEqual([userMsg]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        RECIPE_TURN_POLL_INTERVAL_MS + FLUSH_MS,
      );
    });
    expect(result.current.data).toEqual([userMsg]);
    expect(queryClient.getQueryData(PENDING_KEY)).toEqual({
      7: expect.any(Number),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        RECIPE_TURN_POLL_INTERVAL_MS + FLUSH_MS,
      );
    });
    expect(result.current.data).toEqual([userMsg, assistantMsg]);
    expect(queryClient.getQueryData(PENDING_KEY)).toEqual({});
  });
});

// The server anchors notebook follow-up dates (and the coach's "today") in
// the zone X-Timezone names; without it `parseTimezone` falls back to UTC.
// Each writer of a follow-up date must send it, or two writers anchor the
// same calendar day at different instants.
describe("X-Timezone header", () => {
  it("useSendMessage sends X-Timezone on the stream request", async () => {
    const { wrapper } = createQueryWrapper();
    mockTokenStorage.get.mockResolvedValue("test-token");

    const { result } = renderHook(() => useSendMessage(7), { wrapper });

    await act(async () => {
      const p = result.current.sendMessage("hello");
      await Promise.resolve();
      await Promise.resolve();
      xhrInstance.simulateChunks(['data: {"done":true}\n']);
      await p;
    });

    expect(xhrInstance.setRequestHeader).toHaveBeenCalledWith(
      "X-Timezone",
      "Asia/Tokyo",
    );
  });

  it("useCreateNotebookEntry sends X-Timezone", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockResolvedValue({ json: async () => ({ id: 1 }) });

    const { result } = renderHook(() => useCreateNotebookEntry(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        type: "commitment",
        content: "Check in",
        followUpDate: "2026-09-05",
      });
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/coach/notebook",
      expect.objectContaining({ followUpDate: "2026-09-05" }),
      { headers: { "X-Timezone": "Asia/Tokyo" } },
    );
  });

  it("useUpdateNotebookEntry sends X-Timezone", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockResolvedValue({ json: async () => ({ id: 3 }) });

    const { result } = renderHook(() => useUpdateNotebookEntry(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 3, followUpDate: "2026-09-05" });
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/coach/notebook/3",
      { followUpDate: "2026-09-05" },
      { headers: { "X-Timezone": "Asia/Tokyo" } },
    );
  });
});

describe("useSaveRecipeFromChat", () => {
  it("refreshes Saved Items, where the saved recipe now appears", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    mockApiRequest.mockResolvedValue({
      json: () =>
        Promise.resolve({ id: 100, title: "Soup", savedItemStatus: "linked" }),
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveRecipeFromChat(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: 5, messageId: 10 });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/saved-items"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/saved-items/count"],
    });
  });
});
