// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useSendMessage } from "../useChat";

const { mockApiRequest, mockGetApiUrl, mockTokenStorage, mockFetch } =
  vi.hoisted(() => ({
    mockApiRequest: vi.fn(),
    mockGetApiUrl: vi.fn(() => "http://localhost:3000"),
    mockTokenStorage: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
      invalidateCache: vi.fn(),
    },
    mockFetch: vi.fn(),
  }));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  getApiUrl: () => mockGetApiUrl(),
}));

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: mockTokenStorage,
}));

globalThis.fetch = mockFetch;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      ),
  };
}

function createReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

describe("useSendMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when conversationId is null", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSendMessage(null), { wrapper });

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("streams SSE content and accumulates messages", async () => {
    const { wrapper } = createWrapper();
    mockTokenStorage.get.mockResolvedValue("test-token");

    const chunks = [
      'data: {"content":"Hello"}\n',
      'data: {"content":" world"}\n',
      'data: {"done":true}\n',
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      body: createReadableStream(chunks),
    });

    const { result } = renderHook(() => useSendMessage(42), { wrapper });

    expect(result.current.isStreaming).toBe(false);

    await act(async () => {
      await result.current.sendMessage("test message");
    });

    // After streaming completes, isStreaming should be false and content cleared
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toBe("");

    // Verify fetch was called correctly
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining("/api/chat/conversations/42/messages"),
      }),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        }),
        body: JSON.stringify({ content: "test message" }),
      }),
    );
  });

  it("sends request without auth header when no token", async () => {
    const { wrapper } = createWrapper();
    mockTokenStorage.get.mockResolvedValue(null);

    mockFetch.mockResolvedValue({
      ok: true,
      body: createReadableStream(['data: {"done":true}\n']),
    });

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers).toEqual({ "Content-Type": "application/json" });
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it("throws on non-ok response", async () => {
    const { wrapper } = createWrapper();
    mockTokenStorage.get.mockResolvedValue("token");

    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    await expect(
      act(async () => {
        await result.current.sendMessage("test");
      }),
    ).rejects.toThrow("500: Internal Server Error");

    expect(result.current.isStreaming).toBe(false);
  });

  it("throws when response body is missing", async () => {
    const { wrapper } = createWrapper();
    mockTokenStorage.get.mockResolvedValue("token");

    mockFetch.mockResolvedValue({
      ok: true,
      body: null,
    });

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    await expect(
      act(async () => {
        await result.current.sendMessage("test");
      }),
    ).rejects.toThrow("No response body");

    expect(result.current.isStreaming).toBe(false);
  });

  it("throws on application-level error from SSE stream", async () => {
    const { wrapper } = createWrapper();
    mockTokenStorage.get.mockResolvedValue("token");

    const chunks = [
      'data: {"content":"partial"}\n',
      'data: {"error":"Rate limit exceeded"}\n',
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      body: createReadableStream(chunks),
    });

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    await expect(
      act(async () => {
        await result.current.sendMessage("test");
      }),
    ).rejects.toThrow("Rate limit exceeded");

    expect(result.current.isStreaming).toBe(false);
  });

  it("invalidates query cache when done signal received", async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    mockTokenStorage.get.mockResolvedValue("token");

    const chunks = ['data: {"content":"response"}\n', 'data: {"done":true}\n'];

    mockFetch.mockResolvedValue({
      ok: true,
      body: createReadableStream(chunks),
    });

    const { result } = renderHook(() => useSendMessage(5), { wrapper });

    await act(async () => {
      await result.current.sendMessage("test");
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/chat/conversations/5/messages"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/chat/conversations"],
    });
  });

  it("silently ignores incomplete JSON chunks", async () => {
    const { wrapper } = createWrapper();
    mockTokenStorage.get.mockResolvedValue("token");

    // Simulate a chunk that splits a JSON payload
    const chunks = [
      'data: {"content":"ok"}\ndata: {"conten',
      't":"split"}\ndata: {"done":true}\n',
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      body: createReadableStream(chunks),
    });

    const { result } = renderHook(() => useSendMessage(1), { wrapper });

    // Should not throw despite malformed JSON in middle chunk
    await act(async () => {
      await result.current.sendMessage("test");
    });

    expect(result.current.isStreaming).toBe(false);
  });
});
