// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  PENDING_RECIPE_GENERATION_KEY,
  UNREAD_GENERATED_RECIPES_KEY,
  clearAllGeneratedRecipesUnread,
  clearGeneratedRecipeUnread,
  getUnreadGeneratedRecipeIds,
  isPendingGeneration,
  markGeneratedRecipeUnread,
  noteGeneratedRecipeReady,
  setPendingGeneration,
  subscribeToGeneratedRecipeReady,
  useHasUnreadGeneratedRecipe,
  usePendingGeneration,
} from "../useGeneratedRecipeNotices";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

// TanStack batches observer notifications onto a macrotask, so a cache write
// reaches React one task later (see useCoachUnreadReplies.test.ts).
const flushNotifications = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("unread generated recipes", () => {
  it("records a recipe once, however many times it is noted", () => {
    const { queryClient } = createQueryWrapper();

    markGeneratedRecipeUnread(queryClient, 7);
    markGeneratedRecipeUnread(queryClient, 7);

    expect(getUnreadGeneratedRecipeIds(queryClient)).toEqual([7]);
  });

  it("clears one id and keeps the others", () => {
    const { queryClient } = createQueryWrapper();
    markGeneratedRecipeUnread(queryClient, 7);
    markGeneratedRecipeUnread(queryClient, 8);

    clearGeneratedRecipeUnread(queryClient, 7);

    expect(getUnreadGeneratedRecipeIds(queryClient)).toEqual([8]);
  });

  // setQueryData(key, undefined) is a no-op, so the emptied list must be a
  // defined [] or the Profile dot would never go away.
  it("writes [] (not undefined) when the last id clears", () => {
    const { queryClient } = createQueryWrapper();
    markGeneratedRecipeUnread(queryClient, 7);

    clearGeneratedRecipeUnread(queryClient, 7);

    expect(queryClient.getQueryData(UNREAD_GENERATED_RECIPES_KEY)).toEqual([]);
  });

  it("clears all ids at once", () => {
    const { queryClient } = createQueryWrapper();
    markGeneratedRecipeUnread(queryClient, 7);
    markGeneratedRecipeUnread(queryClient, 8);

    clearAllGeneratedRecipesUnread(queryClient);

    expect(getUnreadGeneratedRecipeIds(queryClient)).toEqual([]);
    expect(queryClient.getQueryData(UNREAD_GENERATED_RECIPES_KEY)).toEqual([]);
  });

  it("useHasUnreadGeneratedRecipe flips true on mark and false on clear", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => useHasUnreadGeneratedRecipe(), {
      wrapper,
    });
    expect(result.current).toBe(false);

    act(() => {
      markGeneratedRecipeUnread(queryClient, 7);
    });
    await waitFor(() => expect(result.current).toBe(true));

    act(() => {
      clearGeneratedRecipeUnread(queryClient, 7);
    });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("keeps its answer through an unfiltered invalidate, without fetching", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => useHasUnreadGeneratedRecipe(), {
      wrapper,
    });
    act(() => {
      markGeneratedRecipeUnread(queryClient, 7);
    });
    await waitFor(() => expect(result.current).toBe(true));

    await act(async () => {
      await queryClient.invalidateQueries();
      await queryClient.refetchQueries();
    });
    await flushNotifications();

    expect(result.current).toBe(true);
    expect(queryClient.isFetching()).toBe(0);
  });
});

describe("pending generation", () => {
  it("tracks photo and mealPlan independently", () => {
    const { queryClient } = createQueryWrapper();
    expect(isPendingGeneration(queryClient, "photo")).toBe(false);

    setPendingGeneration(queryClient, "photo", true);

    expect(isPendingGeneration(queryClient, "photo")).toBe(true);
    expect(isPendingGeneration(queryClient, "mealPlan")).toBe(false);

    setPendingGeneration(queryClient, "mealPlan", true);
    setPendingGeneration(queryClient, "photo", false);

    expect(isPendingGeneration(queryClient, "photo")).toBe(false);
    expect(isPendingGeneration(queryClient, "mealPlan")).toBe(true);
  });

  it("usePendingGeneration re-renders when the flag changes", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => usePendingGeneration("photo"), {
      wrapper,
    });
    expect(result.current).toBe(false);

    act(() => {
      setPendingGeneration(queryClient, "photo", true);
    });
    await waitFor(() => expect(result.current).toBe(true));

    act(() => {
      setPendingGeneration(queryClient, "photo", false);
    });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("usePendingGeneration for one entry ignores the other entry's flag", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => usePendingGeneration("mealPlan"), {
      wrapper,
    });

    act(() => {
      setPendingGeneration(queryClient, "photo", true);
    });
    await flushNotifications();

    expect(result.current).toBe(false);
  });
});

describe("ready emitter", () => {
  it("noteGeneratedRecipeReady marks unread and calls every subscriber with the id", () => {
    const { queryClient } = createQueryWrapper();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeToGeneratedRecipeReady(first);
    const unsubscribeSecond = subscribeToGeneratedRecipeReady(second);

    noteGeneratedRecipeReady(queryClient, 42);

    expect(getUnreadGeneratedRecipeIds(queryClient)).toEqual([42]);
    expect(first).toHaveBeenCalledWith(42);
    expect(second).toHaveBeenCalledWith(42);
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("an unsubscribed listener is not called", () => {
    const { queryClient } = createQueryWrapper();
    const listener = vi.fn();
    subscribeToGeneratedRecipeReady(listener)();

    noteGeneratedRecipeReady(queryClient, 42);

    expect(listener).not.toHaveBeenCalled();
    // The mark is recorded whether or not anyone is listening for the toast.
    expect(getUnreadGeneratedRecipeIds(queryClient)).toEqual([42]);
  });
});

describe("cache lifetime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("unread and pending entries survive past the default gcTime with no observer mounted", () => {
    vi.useFakeTimers();
    const { queryClient } = createQueryWrapper();

    markGeneratedRecipeUnread(queryClient, 7);
    setPendingGeneration(queryClient, "photo", true);
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    });

    expect(getUnreadGeneratedRecipeIds(queryClient)).toEqual([7]);
    expect(isPendingGeneration(queryClient, "photo")).toBe(true);
  });
});

describe("logout", () => {
  it("queryClient.clear() empties unread, pending and leaves hooks reporting false", () => {
    const { wrapper, queryClient } = createQueryWrapper();
    markGeneratedRecipeUnread(queryClient, 7);
    setPendingGeneration(queryClient, "photo", true);

    queryClient.clear();

    expect(getUnreadGeneratedRecipeIds(queryClient)).toEqual([]);
    expect(isPendingGeneration(queryClient, "photo")).toBe(false);
    expect(
      queryClient.getQueryData(PENDING_RECIPE_GENERATION_KEY),
    ).toBeUndefined();

    const unread = renderHook(() => useHasUnreadGeneratedRecipe(), { wrapper });
    const pending = renderHook(() => usePendingGeneration("photo"), {
      wrapper,
    });
    expect(unread.result.current).toBe(false);
    expect(pending.result.current).toBe(false);
  });
});
