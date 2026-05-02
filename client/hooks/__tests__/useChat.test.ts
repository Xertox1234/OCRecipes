// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import { useSendMessage } from "../useChat";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

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
});
