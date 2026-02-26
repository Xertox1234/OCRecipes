// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useUpdateSchedule, useStartFast, useEndFast } from "../useFasting";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useFasting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useUpdateSchedule", () => {
    it("calls PUT endpoint and invalidates schedule query", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      const schedule = {
        id: 1,
        protocol: "16:8",
        fastingHours: 16,
        eatingHours: 8,
      };

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve(schedule),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useUpdateSchedule(), { wrapper });

      await act(async () => {
        result.current.mutate({
          protocol: "16:8",
          fastingHours: 16,
          eatingHours: 8,
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "PUT",
        "/api/fasting/schedule",
        {
          protocol: "16:8",
          fastingHours: 16,
          eatingHours: 8,
        },
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/fasting/schedule"],
      });
    });
  });

  describe("useStartFast", () => {
    it("calls POST endpoint and invalidates current + history", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () =>
          Promise.resolve({ id: 1, startedAt: "2024-01-01T08:00:00Z" }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useStartFast(), { wrapper });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/fasting/start");
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/fasting/current"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/fasting/history"],
      });
    });
  });

  describe("useEndFast", () => {
    it("sends optional note and invalidates current + history", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () =>
          Promise.resolve({
            id: 1,
            startedAt: "2024-01-01T08:00:00Z",
            endedAt: "2024-01-02T00:00:00Z",
          }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useEndFast(), { wrapper });

      await act(async () => {
        result.current.mutate("Felt great!");
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/fasting/end", {
        note: "Felt great!",
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/fasting/current"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/fasting/history"],
      });
    });

    it("sets error state on API failure", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useEndFast(), { wrapper });

      await act(async () => {
        result.current.mutate(undefined);
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it("works without a note", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ id: 1 }),
      });

      const { result } = renderHook(() => useEndFast(), { wrapper });

      await act(async () => {
        result.current.mutate(undefined);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/fasting/end", {
        note: undefined,
      });
    });
  });
});
