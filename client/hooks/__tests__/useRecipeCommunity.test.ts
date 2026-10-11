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

  describe("overlapping taps", () => {
    function deferred() {
      let resolve: (v: unknown) => void = () => {};
      let reject: (e: unknown) => void = () => {};
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it("sends the untap only after the tap settles, and the tap's refetch never overwrites the untap", async () => {
      const { wrapper, queryClient } = createQueryWrapper();
      let serverTried = false;
      let gets = 0;
      const put = deferred();
      const del = deferred();
      mockApiRequest.mockImplementation((method: string) => {
        if (method === "PUT") return put.promise;
        if (method === "DELETE") return del.promise;
        gets += 1;
        return Promise.resolve(ok({ ...stats, triedByMe: serverTried }));
      });
      // Observed stats query, as in the bar: invalidation refetches it.
      const { result } = renderHook(
        () => ({
          stats: useRecipeCommunityStats(7, true),
          setTried: useSetRecipeTried(7),
        }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.stats.isSuccess).toBe(true));
      const getsAfterMount = gets;
      const triedByMe = () =>
        queryClient.getQueryData<typeof stats>(recipeStatsKey(7))?.triedByMe;

      act(() => {
        result.current.setTried.mutate(true);
        result.current.setTried.mutate(false);
      });
      await waitFor(() =>
        expect(mockApiRequest).toHaveBeenCalledWith(
          "PUT",
          "/api/recipes/7/tried",
        ),
      );
      expect(mockApiRequest).not.toHaveBeenCalledWith(
        "DELETE",
        "/api/recipes/7/tried",
      );

      serverTried = true;
      await act(async () => {
        put.resolve(ok({ tried: true, triedCount: 3 }));
      });
      await waitFor(() =>
        expect(mockApiRequest).toHaveBeenCalledWith(
          "DELETE",
          "/api/recipes/7/tried",
        ),
      );
      // The last tap (untried) still shows while the untap is in flight, and
      // the settled tap did not refetch the intermediate server state.
      expect(triedByMe()).toBe(false);
      expect(gets).toBe(getsAfterMount);

      serverTried = false;
      await act(async () => {
        del.resolve(ok({ tried: false, triedCount: 2 }));
      });
      await waitFor(() => expect(gets).toBe(getsAfterMount + 1));
      await waitFor(() => expect(result.current.stats.isFetching).toBe(false));
      expect(triedByMe()).toBe(false);
    });

    it("an earlier tap's failure does not roll back over a later tap", async () => {
      const { wrapper, queryClient } = createQueryWrapper();
      queryClient.setQueryData(recipeStatsKey(7), stats);
      const firstPut = deferred();
      const del = deferred();
      let puts = 0;
      mockApiRequest.mockImplementation((method: string) => {
        if (method === "PUT") {
          puts += 1;
          return puts === 1 ? firstPut.promise : new Promise(() => {});
        }
        if (method === "DELETE") return del.promise;
        return Promise.resolve(ok(stats));
      });
      const { result } = renderHook(() => useSetRecipeTried(7), { wrapper });

      act(() => {
        result.current.mutate(true);
        result.current.mutate(false);
        result.current.mutate(true);
      });
      await act(async () => {
        firstPut.reject(new Error("network"));
      });
      await waitFor(() =>
        expect(mockApiRequest).toHaveBeenCalledWith(
          "DELETE",
          "/api/recipes/7/tried",
        ),
      );
      // Rolling back to the first tap's snapshot would show untried here.
      expect(
        queryClient.getQueryData<typeof stats>(recipeStatsKey(7))?.triedByMe,
      ).toBe(true);
    });
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
