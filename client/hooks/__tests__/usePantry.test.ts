// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useCreatePantryItem,
  useUpdatePantryItem,
  useDeletePantryItem,
} from "../usePantry";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("usePantry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useCreatePantryItem", () => {
    it("calls POST endpoint and invalidates pantry queries", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: "Flour" }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useCreatePantryItem(), { wrapper });

      await act(async () => {
        result.current.mutate({ name: "Flour", quantity: "2", unit: "kg" });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/pantry", {
        name: "Flour",
        quantity: "2",
        unit: "kg",
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/pantry"] });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/pantry/expiring"],
      });
    });

    it("throws on non-ok response", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Validation error"),
      });

      const { result } = renderHook(() => useCreatePantryItem(), { wrapper });

      await act(async () => {
        result.current.mutate({ name: "" });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("400: Validation error");
    });
  });

  describe("useUpdatePantryItem", () => {
    it("calls PUT endpoint with id and updates", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 5, name: "Sugar", quantity: "3" }),
      });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useUpdatePantryItem(), { wrapper });

      await act(async () => {
        result.current.mutate({ id: 5, quantity: "3" });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith("PUT", "/api/pantry/5", {
        quantity: "3",
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/pantry"] });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/pantry/expiring"],
      });
    });
  });

  describe("useDeletePantryItem", () => {
    it("calls DELETE endpoint and accepts 204 status", async () => {
      const { wrapper, queryClient } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({ ok: true, status: 204 });

      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useDeletePantryItem(), { wrapper });

      await act(async () => {
        result.current.mutate(10);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockApiRequest).toHaveBeenCalledWith("DELETE", "/api/pantry/10");
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/pantry"] });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/pantry/expiring"],
      });
    });

    it("throws on non-ok non-204 response", async () => {
      const { wrapper } = createQueryWrapper();

      mockApiRequest.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server Error"),
      });

      const { result } = renderHook(() => useDeletePantryItem(), { wrapper });

      await act(async () => {
        result.current.mutate(10);
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.message).toBe("500: Server Error");
    });
  });
});
