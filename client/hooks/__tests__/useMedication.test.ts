// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import { useLogMedication } from "../useMedication";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useMedication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useLogMedication", () => {
    it("calls POST endpoint with medication data", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ id: 1, medicationName: "Ozempic" }),
      });

      const { result } = renderHook(() => useLogMedication(), { wrapper });

      const data = {
        medicationName: "Ozempic",
        dosage: "0.5mg",
        sideEffects: ["nausea"],
        appetiteLevel: 3,
      };

      await act(async () => {
        result.current.mutate(data);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/medication/log",
        data,
      );
    });

    it("sets error state on API failure", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useLogMedication(), { wrapper });

      await act(async () => {
        result.current.mutate({ medicationName: "Test", dosage: "1mg" });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it("invalidates logs and insights queries on success", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        json: () => Promise.resolve({ id: 1 }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useLogMedication(), { wrapper });

      await act(async () => {
        result.current.mutate({ medicationName: "Test", dosage: "1mg" });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/medication/logs"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/medication/insights"],
      });
    });
  });
});
