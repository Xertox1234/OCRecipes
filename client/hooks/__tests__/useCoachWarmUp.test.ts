// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import { useCoachWarmUp } from "../useCoachWarmUp";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useCoachWarmUp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // CoachChat's handleSend depends on this object; a fresh literal per render
  // gave handleSend (and every row's renderItem) a new identity whenever the
  // parent screen re-rendered.
  it("returns the same object across re-renders with the same conversation", () => {
    const { result, rerender } = renderHook(() => useCoachWarmUp(42));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  describe("sendWarmUp", () => {
    it("does not fire for transcript shorter than 20 chars", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useCoachWarmUp(42));
      act(() => {
        void result.current.sendWarmUp("short");
      });
      await act(() => vi.advanceTimersByTimeAsync(600));
      expect(mockApiRequest).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("fires warm-up after 20+ chars and 500ms debounce", async () => {
      vi.useFakeTimers();
      mockApiRequest.mockResolvedValue(
        new Response(JSON.stringify({ warmUpId: "test-id" })),
      );
      const { result } = renderHook(() => useCoachWarmUp(42));
      act(() => {
        void result.current.sendWarmUp(
          "this is a longer transcript that exceeds twenty characters",
        );
      });
      await act(() => vi.advanceTimersByTimeAsync(600));
      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/coach/warm-up",
        {
          conversationId: 42,
          interimTranscript:
            "this is a longer transcript that exceeds twenty characters",
        },
      );
      vi.useRealTimers();
    });
  });

  describe("sendTextWarmUp", () => {
    it("does not fire for text shorter than 3 chars", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useCoachWarmUp(42));
      act(() => {
        void result.current.sendTextWarmUp("hi");
      });
      await act(() => vi.advanceTimersByTimeAsync(600));
      expect(mockApiRequest).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("fires warm-up after 3+ chars and 500ms debounce", async () => {
      vi.useFakeTimers();
      mockApiRequest.mockResolvedValue(
        new Response(JSON.stringify({ warmUpId: "test-id" })),
      );
      const { result } = renderHook(() => useCoachWarmUp(42));
      act(() => {
        void result.current.sendTextWarmUp("hel");
      });
      await act(() => vi.advanceTimersByTimeAsync(600));
      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/coach/warm-up",
        {
          conversationId: 42,
          interimTranscript: "hel",
        },
      );
      vi.useRealTimers();
    });
  });

  describe("getWarmUpId", () => {
    it("returns and clears the warmUpId", async () => {
      vi.useFakeTimers();
      mockApiRequest.mockResolvedValue(
        new Response(JSON.stringify({ warmUpId: "test-123" })),
      );
      const { result } = renderHook(() => useCoachWarmUp(42));

      act(() => {
        void result.current.sendWarmUp(
          "this is a longer transcript that exceeds twenty characters",
        );
      });
      await act(() => vi.advanceTimersByTimeAsync(600));

      let id: string | null = null;
      act(() => {
        id = result.current.getWarmUpId();
      });
      expect(id).toBe("test-123");

      // Second call should return null (cleared)
      act(() => {
        id = result.current.getWarmUpId();
      });
      expect(id).toBeNull();
      vi.useRealTimers();
    });
  });

  describe("reset", () => {
    it("clears all state", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useCoachWarmUp(42));

      // Start a warm-up
      act(() => {
        void result.current.sendWarmUp(
          "this is a longer transcript that exceeds twenty characters",
        );
      });

      // Reset before the timer fires
      act(() => {
        result.current.reset();
      });

      // Advance past the debounce
      await act(() => vi.advanceTimersByTimeAsync(600));

      // Should not have called the API
      expect(mockApiRequest).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  // R48: warm-up is a best-effort prefetch, so offline / 4xx misses stay
  // quiet, but a server error (systematic 5xx, contract break) is reported.
  describe("failure reporting (R48)", () => {
    it.each([
      [
        "sendWarmUp",
        "this is a longer transcript that exceeds twenty characters",
      ],
      ["sendTextWarmUp", "hello coach"],
    ] as const)("%s reports a 5xx", async (method, text) => {
      vi.useFakeTimers();
      const { logger } = await import("@/lib/logger");
      const { ApiError } = await import("@/lib/api-error");
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      try {
        const boom = new ApiError("503: down", undefined, 503);
        mockApiRequest.mockRejectedValue(boom);
        const { result } = renderHook(() => useCoachWarmUp(42));
        act(() => {
          void result.current[method](text);
        });
        await act(() => vi.advanceTimersByTimeAsync(600));
        expect(errorSpy).toHaveBeenCalledWith("Coach warm-up failed", boom);
      } finally {
        errorSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it("stays quiet on a network error (offline is expected for a prefetch)", async () => {
      vi.useFakeTimers();
      const { logger } = await import("@/lib/logger");
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      try {
        mockApiRequest.mockRejectedValue(
          new TypeError("Network request failed"),
        );
        const { result } = renderHook(() => useCoachWarmUp(42));
        act(() => {
          void result.current.sendTextWarmUp("hello coach");
        });
        await act(() => vi.advanceTimersByTimeAsync(600));
        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });
});
