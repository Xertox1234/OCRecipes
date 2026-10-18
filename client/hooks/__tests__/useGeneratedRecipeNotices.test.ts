// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  HELD_RECIPE_DRAFT_KEY,
  PENDING_RECIPE_GENERATION_KEY,
  UNREAD_GENERATED_RECIPES_KEY,
  clearAllGeneratedRecipesUnread,
  clearGeneratedRecipeUnread,
  getHeldRecipeDraft,
  getUnreadGeneratedRecipeIds,
  isPendingGeneration,
  markGeneratedRecipeUnread,
  noteGeneratedRecipeReady,
  noteRecipeDraftReady,
  setHeldRecipeDraft,
  setPendingGeneration,
  subscribeToGeneratedRecipeReady,
  subscribeToRecipeDraftReady,
  useHasUnreadGeneratedRecipe,
  useHeldRecipeDraft,
  usePendingGeneration,
  type HeldRecipeDraft,
} from "../useGeneratedRecipeNotices";
import type { ImportedRecipeData } from "@shared/types/recipe-import";
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

// ---- Meal-plan draft (spec §5b): the generated draft is held on the device
// until the user reviews it; nothing is saved server-side.
const draftOf = (title: string): HeldRecipeDraft => ({
  prefill: { title } as unknown as ImportedRecipeData,
  returnToMealPlan: { mealType: "dinner", plannedDate: "2026-10-20" },
});

describe("held recipe draft", () => {
  it("holds one draft, replacing any earlier one", () => {
    const { queryClient } = createQueryWrapper();
    expect(getHeldRecipeDraft(queryClient)).toBeNull();

    setHeldRecipeDraft(queryClient, draftOf("Soup"));
    setHeldRecipeDraft(queryClient, draftOf("Salad"));

    expect(getHeldRecipeDraft(queryClient)).toEqual(draftOf("Salad"));
  });

  it("noteRecipeDraftReady holds the draft and notifies subscribers", () => {
    const { queryClient } = createQueryWrapper();
    const listener = vi.fn();
    const unsubscribe = subscribeToRecipeDraftReady(listener);

    noteRecipeDraftReady(queryClient, draftOf("Soup"));

    expect(getHeldRecipeDraft(queryClient)).toEqual(draftOf("Soup"));
    expect(listener).toHaveBeenCalledExactlyOnceWith(draftOf("Soup"));
    unsubscribe();
    noteRecipeDraftReady(queryClient, draftOf("Salad"));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("useHeldRecipeDraft returns null after setHeldRecipeDraft(null)", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => useHeldRecipeDraft(), { wrapper });
    expect(result.current).toBeNull();

    act(() => {
      setHeldRecipeDraft(queryClient, draftOf("Soup"));
    });
    await waitFor(() => expect(result.current).toEqual(draftOf("Soup")));

    act(() => {
      setHeldRecipeDraft(queryClient, null);
    });
    await waitFor(() => expect(result.current).toBeNull());
    // Written as null, never undefined (setQueryData(key, undefined) is a no-op).
    expect(queryClient.getQueryData(HELD_RECIPE_DRAFT_KEY)).toBeNull();
  });

  it("survives past the default gcTime with no observer mounted", () => {
    vi.useFakeTimers();
    try {
      const { queryClient } = createQueryWrapper();
      setHeldRecipeDraft(queryClient, draftOf("Soup"));
      act(() => {
        vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      });
      expect(getHeldRecipeDraft(queryClient)).toEqual(draftOf("Soup"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("queryClient.clear() drops the held draft", () => {
    const { wrapper, queryClient } = createQueryWrapper();
    setHeldRecipeDraft(queryClient, draftOf("Soup"));

    queryClient.clear();

    expect(getHeldRecipeDraft(queryClient)).toBeNull();
    const { result } = renderHook(() => useHeldRecipeDraft(), { wrapper });
    expect(result.current).toBeNull();
  });
});
