// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { ApiError } from "@/lib/api-error";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

import {
  useCreateSuggestionListing,
  useMakeSuggestion,
} from "../useInspiredSuggestions";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/query-client", async (orig) => ({
  ...(await orig<object>()),
  apiRequest,
}));

const card = {
  id: 1,
  title: "Bean Tacos",
  description: "Quick bright tacos tonight.",
  totalMinutes: 25,
  tags: [],
  imageUrl: null,
  madeRecipeId: null,
};
const json = (body: unknown) => ({ json: async () => body }) as Response;

beforeEach(() => apiRequest.mockReset());

describe("useCreateSuggestionListing", () => {
  it("POSTs the query and returns parsed suggestions", async () => {
    apiRequest.mockResolvedValue(json({ suggestions: [card] }));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCreateSuggestionListing(), {
      wrapper,
    });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ query: "tacos" });
    });
    expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/inspired/suggestions",
      { query: "tacos" },
    );
    expect(out).toEqual([card]);
  });
});

describe("useMakeSuggestion", () => {
  it("POSTs make and returns the recipe id", async () => {
    apiRequest.mockResolvedValue(json({ recipeId: 88 }));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMakeSuggestion(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(1);
    });
    expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/inspired/suggestions/1/make",
    );
    await waitFor(() => expect(result.current.data).toEqual({ recipeId: 88 }));
  });
});

describe("useMakeSuggestion refreshes Saved items", () => {
  it("invalidates the saved-items list and count on success", async () => {
    apiRequest.mockResolvedValue(json({ recipeId: 88 }));
    const { wrapper, queryClient } = createQueryWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useMakeSuggestion(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(1);
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["/api/saved-items"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["/api/saved-items/count"] });
  });
});

describe("useMakeSuggestion 409 wait", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const conflict = () => new ApiError("busy", "MAKING_IN_PROGRESS", 409);

  it("polls after a 409 and resolves once madeRecipeId appears", async () => {
    apiRequest
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce(json({ suggestions: [card] }))
      .mockResolvedValueOnce(
        json({ suggestions: [{ ...card, madeRecipeId: 55 }] }),
      );
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMakeSuggestion(), { wrapper });
    let out: unknown;
    await act(async () => {
      const p = result.current.mutateAsync(1).then((v) => (out = v));
      await vi.advanceTimersByTimeAsync(4000);
      await p;
    });
    expect(out).toEqual({ recipeId: 55 });
    expect(apiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/inspired/suggestions?ids=1",
    );
  });

  it("rejects with the original 409 after the bounded attempts", async () => {
    const err = conflict();
    apiRequest.mockImplementation(async (method: string) => {
      if (method === "POST") throw err;
      return json({ suggestions: [card] });
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMakeSuggestion(), { wrapper });
    let caught: unknown;
    await act(async () => {
      const p = result.current.mutateAsync(1).catch((e) => (caught = e));
      await vi.advanceTimersByTimeAsync(31 * 2000);
      await p;
    });
    expect(caught).toBe(err);
    const gets = apiRequest.mock.calls.filter((c) => c[0] === "GET");
    expect(gets).toHaveLength(30);
  });

  it("rethrows a non-409 error immediately without polling", async () => {
    const err = new ApiError("limit", "DAILY_LIMIT_REACHED", 429);
    apiRequest.mockImplementation(async (method: string) => {
      if (method === "POST") throw err;
      return json({ suggestions: [card] });
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMakeSuggestion(), { wrapper });
    let caught: unknown;
    await act(async () => {
      const p = result.current.mutateAsync(1).catch((e) => (caught = e));
      await vi.advanceTimersByTimeAsync(5000);
      await p;
    });
    expect(caught).toBe(err);
    expect(apiRequest.mock.calls.filter((c) => c[0] === "GET")).toHaveLength(0);
  });
});
