// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useAcceptAdaptiveGoal,
  useDismissAdaptiveGoal,
} from "../useAdaptiveGoals";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useAdaptiveGoals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useAcceptAdaptiveGoal", () => {
    it("calls accept endpoint and invalidates goals + budget", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ accepted: true }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useAcceptAdaptiveGoal(), { wrapper });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/goals/adaptive/accept",
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/goals/adaptive"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/goals"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/daily-budget"],
      });
    });

    it("sets error state on API failure", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useAcceptAdaptiveGoal(), { wrapper });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("useDismissAdaptiveGoal", () => {
    it("calls dismiss endpoint and invalidates adaptive query only", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ dismissed: true }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useDismissAdaptiveGoal(), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/goals/adaptive/dismiss",
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/goals/adaptive"],
      });
      // Should NOT invalidate /api/goals or /api/daily-budget
      expect(invalidateSpy).not.toHaveBeenCalledWith({
        queryKey: ["/api/goals"],
      });
    });
  });
});
