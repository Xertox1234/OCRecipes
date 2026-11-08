// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  TASTE_PICKS_PAGE_LIMIT,
  useSaveTastePicks,
  useSavedTastePicks,
  useTastePickCandidates,
} from "../useTastePicks";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

const candidate = (id: number) => ({
  id,
  title: `Recipe ${id}`,
  imageUrl: "",
  cuisineOrigin: null,
});

function page(n: number, count: number) {
  return {
    candidates: Array.from({ length: count }, (_, i) =>
      candidate((n - 1) * 100 + i + 1),
    ),
    total: 999,
    page: n,
  };
}

function candidateUrls() {
  return mockApiRequest.mock.calls
    .filter(([, url]) => String(url).startsWith("/api/taste-picks/candidates"))
    .map(([, url]) => String(url));
}

beforeEach(() => {
  mockApiRequest.mockReset();
});

describe("useTastePickCandidates", () => {
  it("loads page 1 with the diet filter and flattens the pages", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => page(1, 2),
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useTastePickCandidates("vegan"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.candidates).toHaveLength(2));
    expect(candidateUrls()).toEqual([
      `/api/taste-picks/candidates?page=1&limit=${TASTE_PICKS_PAGE_LIMIT}&dietType=vegan`,
    ]);
  });

  it("requests the next page once even when the list asks twice in a row", async () => {
    mockApiRequest.mockImplementation(async (_m: string, url: string) => ({
      json: async () =>
        url.includes("page=1&") ? page(1, TASTE_PICKS_PAGE_LIMIT) : page(2, 3),
    }));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useTastePickCandidates(), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.candidates).toHaveLength(TASTE_PICKS_PAGE_LIMIT),
    );

    // FlatList can fire onEndReached repeatedly before the next render.
    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });

    await waitFor(() =>
      expect(result.current.candidates).toHaveLength(
        TASTE_PICKS_PAGE_LIMIT + 3,
      ),
    );
    expect(candidateUrls().filter((u) => u.includes("page=2&"))).toHaveLength(
      1,
    );
  });

  it("stops paging after a short page", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => page(1, 3) });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useTastePickCandidates(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.candidates).toHaveLength(3));

    act(() => result.current.loadMore());

    expect(candidateUrls()).toHaveLength(1);
  });

  it("reports a malformed response as an error, not as an empty list", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ nope: true }) });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useTastePickCandidates(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useSavedTastePicks", () => {
  it("returns the saved recipe ids", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({
        picks: [4, 9].map((recipeId) => ({
          recipeId,
          title: `Recipe ${recipeId}`,
          imageUrl: "",
        })),
      }),
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useSavedTastePicks(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([4, 9]);
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/taste-picks",
      undefined,
      { signal: expect.any(AbortSignal) },
    );
  });
});

describe("useSaveTastePicks", () => {
  it("PUTs the picks, then refreshes the carousel and the saved picks", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({}) });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSaveTastePicks(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync([1, 2]);
    });

    expect(mockApiRequest).toHaveBeenCalledWith("PUT", "/api/taste-picks", {
      recipeIds: [1, 2],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/carousel"] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["/api/taste-picks"],
      exact: true,
    });
  });
});
