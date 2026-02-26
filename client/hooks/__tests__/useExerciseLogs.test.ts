// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useLogExercise, useDeleteExerciseLog } from "../useExerciseLogs";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useExerciseLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useLogExercise", () => {
    it("calls POST endpoint with exercise data", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ id: 1, exerciseName: "Running" }),
      });

      const { result } = renderHook(() => useLogExercise(), { wrapper });

      const exercise = {
        exerciseName: "Running",
        exerciseType: "cardio",
        durationMinutes: 30,
        caloriesBurned: 300,
      };

      await act(async () => {
        result.current.mutate(exercise);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/exercises",
        exercise,
      );
    });

    it("invalidates exercises, summary, and daily-budget on success", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ id: 1 }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useLogExercise(), { wrapper });

      await act(async () => {
        result.current.mutate({
          exerciseName: "Running",
          exerciseType: "cardio",
          durationMinutes: 30,
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/exercises"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/exercises/summary"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/daily-budget"],
      });
    });

    it("sets error state on API failure", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useLogExercise(), { wrapper });

      await act(async () => {
        result.current.mutate({
          exerciseName: "Running",
          exerciseType: "cardio",
          durationMinutes: 30,
        });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("useDeleteExerciseLog", () => {
    it("calls DELETE endpoint and invalidates same queries", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({}),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useDeleteExerciseLog(), { wrapper });

      await act(async () => {
        result.current.mutate(42);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "DELETE",
        "/api/exercises/42",
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/exercises"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/exercises/summary"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/daily-budget"],
      });
    });
  });
});
