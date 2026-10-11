// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";

import {
  recipeStatsKey,
  useRecipeCommunityStats,
  useSetRecipeTried,
  useRecipeVariants,
} from "../useRecipeCommunity";
import { ApiError } from "@/lib/api-error";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const ok = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) });
const stats = {
  triedCount: 2,
  triedByMe: false,
  favouritedCount: 1,
  variantCount: 0,
};

describe("useRecipeCommunity", () => {
  afterEach(() => {
    mockApiRequest.mockReset();
  });

  it("useRecipeCommunityStats fetches /stats", async () => {
    mockApiRequest.mockResolvedValue(ok(stats));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRecipeCommunityStats(7, true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stats);
    expect(mockApiRequest).toHaveBeenCalledWith("GET", "/api/recipes/7/stats");
  });

  it("does not fetch when disabled", () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useRecipeCommunityStats(7, false), { wrapper });
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("isSuccess turns false when a refetch 404s (recipe went private)", async () => {
    mockApiRequest.mockResolvedValueOnce(ok(stats));
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => useRecipeCommunityStats(7, true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    mockApiRequest.mockRejectedValueOnce(
      new ApiError("Recipe not found", "NOT_FOUND", 404),
    );
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: recipeStatsKey(7) });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(false));
  });

  it("useSetRecipeTried updates the cache optimistically and PUTs", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(recipeStatsKey(7), stats);
    let resolvePut: (v: unknown) => void = () => {};
    mockApiRequest.mockImplementation((method: string) =>
      method === "PUT"
        ? new Promise((r) => {
            resolvePut = r;
          })
        : Promise.resolve(ok({ ...stats, triedCount: 3, triedByMe: true })),
    );

    const { result } = renderHook(() => useSetRecipeTried(7), { wrapper });
    act(() => {
      result.current.mutate(true);
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(recipeStatsKey(7))).toEqual({
        ...stats,
        triedCount: 3,
        triedByMe: true,
      }),
    );
    expect(mockApiRequest).toHaveBeenCalledWith("PUT", "/api/recipes/7/tried");
    resolvePut(ok({ tried: true, triedCount: 3 }));
  });

  it("rolls back on error", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(recipeStatsKey(7), stats);
    mockApiRequest.mockImplementation((method: string) =>
      method === "PUT"
        ? Promise.reject(new Error("network"))
        : Promise.resolve(ok(stats)),
    );
    const { result } = renderHook(() => useSetRecipeTried(7), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(true).catch(() => {});
    });
    expect(queryClient.getQueryData(recipeStatsKey(7))).toEqual(stats);
  });

  it("tap then untap ends untried (last tap wins)", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(recipeStatsKey(7), stats);
    mockApiRequest.mockImplementation((method: string) =>
      method === "GET"
        ? Promise.resolve(ok(stats))
        : Promise.resolve(ok({ tried: method === "PUT", triedCount: 2 })),
    );
    const { result } = renderHook(() => useSetRecipeTried(7), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(true);
      await result.current.mutateAsync(false);
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData<typeof stats>(recipeStatsKey(7))?.triedByMe,
      ).toBe(false),
    );
    expect(mockApiRequest).toHaveBeenCalledWith(
      "DELETE",
      "/api/recipes/7/tried",
    );
  });

  it("useRecipeVariants fetches /variants", async () => {
    mockApiRequest.mockResolvedValue(ok({ variants: [] }));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRecipeVariants(7), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/recipes/7/variants",
    );
  });
});
