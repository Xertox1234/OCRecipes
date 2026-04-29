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

  describe("sendWarmUp", () => {
    it("does not fire for transcript shorter than 20 chars", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useCoachWarmUp(42));
      act(() => {
        result.current.sendWarmUp("short");
      });
      await act(() => vi.advanceTimersByTimeAsync(600));
      expect(mockApiRequest).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("fires warm-up after 20+ chars and 500ms debounce", async () => {
      vi.useFakeTimers();
      mockApiRequest.mockResolvedValue({
        json: async () => ({ warmUpId: "test-id" }),
      } as unknown as Response);
      const { result } = renderHook(() => useCoachWarmUp(42));
      act(() => {
        result.current.sendWarmUp(
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
        result.current.sendTextWarmUp("hi");
      });
      await act(() => vi.advanceTimersByTimeAsync(600));
      expect(mockApiRequest).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("fires warm-up after 3+ chars and 500ms debounce", async () => {
      vi.useFakeTimers();
      mockApiRequest.mockResolvedValue({
        json: async () => ({ warmUpId: "test-id" }),
      } as unknown as Response);
      const { result } = renderHook(() => useCoachWarmUp(42));
      act(() => {
        result.current.sendTextWarmUp("hel");
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
      mockApiRequest.mockResolvedValue({
        json: async () => ({ warmUpId: "test-123" }),
      } as unknown as Response);
      const { result } = renderHook(() => useCoachWarmUp(42));

      act(() => {
        result.current.sendWarmUp(
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
        result.current.sendWarmUp(
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
});
