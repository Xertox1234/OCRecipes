// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useLogWeight,
  useDeleteWeightLog,
  useSetGoalWeight,
} from "../useWeightLogs";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useWeightLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useLogWeight", () => {
    it("calls POST endpoint with weight data", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ id: 1, weight: 75.5 }),
      });

      const { result } = renderHook(() => useLogWeight(), { wrapper });

      await act(async () => {
        result.current.mutate({
          weight: 75.5,
          source: "manual",
          note: "Morning",
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/weight", {
        weight: 75.5,
        source: "manual",
        note: "Morning",
      });
    });

    it("invalidates weight and trend queries", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ id: 1 }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useLogWeight(), { wrapper });

      await act(async () => {
        result.current.mutate({ weight: 80 });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/weight"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/weight/trend"],
      });
    });

    it("sets error state on API failure", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useLogWeight(), { wrapper });

      await act(async () => {
        result.current.mutate({ weight: 75 });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("useDeleteWeightLog", () => {
    it("calls DELETE endpoint and invalidates queries", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({}),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useDeleteWeightLog(), { wrapper });

      await act(async () => {
        result.current.mutate(10);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith("DELETE", "/api/weight/10");
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/weight"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/weight/trend"],
      });
    });
  });

  describe("useSetGoalWeight", () => {
    it("calls PUT endpoint with goal weight", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ goalWeight: 70 }),
      });

      const { result } = renderHook(() => useSetGoalWeight(), { wrapper });

      await act(async () => {
        result.current.mutate(70);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith("PUT", "/api/goals/weight", {
        goalWeight: 70,
      });
    });

    it("supports null to clear goal weight", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ goalWeight: null }),
      });

      const { result } = renderHook(() => useSetGoalWeight(), { wrapper });

      await act(async () => {
        result.current.mutate(null);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith("PUT", "/api/goals/weight", {
        goalWeight: null,
      });
    });

    it("invalidates trend and auth queries", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({}),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useSetGoalWeight(), { wrapper });

      await act(async () => {
        result.current.mutate(70);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/weight/trend"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/auth/me"],
      });
    });
  });
});
