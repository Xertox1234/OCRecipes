// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useUpdateHealthKitSettings, useSyncHealthKit } from "../useHealthKit";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

vi.mock("@/lib/healthkit", () => ({
  healthKitAvailable: true,
}));

describe("useHealthKit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useUpdateHealthKitSettings", () => {
    it("calls PUT endpoint with settings array", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve([{ dataType: "weight", enabled: true }]),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useUpdateHealthKitSettings(), {
        wrapper,
      });

      const settings = [
        { dataType: "weight", enabled: true },
        { dataType: "steps", enabled: false },
      ];

      await act(async () => {
        result.current.mutate(settings);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "PUT",
        "/api/healthkit/settings",
        { settings },
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/healthkit/settings"],
      });
    });

    it("sets error state on API failure", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useUpdateHealthKitSettings(), {
        wrapper,
      });

      await act(async () => {
        result.current.mutate([{ dataType: "weight", enabled: true }]);
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("useSyncHealthKit", () => {
    it("calls sync endpoint and invalidates weight + exercises", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ synced: true }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useSyncHealthKit(), { wrapper });

      await act(async () => {
        result.current.mutate({
          weights: [{ weight: 75, date: "2024-01-01" }],
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/healthkit/sync",
        {
          weights: [{ weight: 75, date: "2024-01-01" }],
        },
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/weight"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/exercises"],
      });
    });
  });
});
