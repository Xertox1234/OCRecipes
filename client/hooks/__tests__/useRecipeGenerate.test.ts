// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import { tokenStorage } from "@/lib/token-storage";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  getHeldRecipeDraft,
  isPendingGeneration,
  setPendingGeneration,
  subscribeToRecipeDraftReady,
} from "../useGeneratedRecipeNotices";
import { RECIPE_GENERATION_DEADLINE_MS } from "../useGenerateRecipeInBackground";
import { useRecipeGenerate } from "../useRecipeGenerate";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

vi.mock("@/lib/query-client", () => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/token-storage", () => ({
  tokenStorage: { get: vi.fn() },
}));
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("@/context/ToastContext", () => ({ useToast: () => mockToast }));
const mockNotification = vi.fn();
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ notification: mockNotification }),
}));

const returnToMealPlan = { mealType: "dinner", plannedDate: "2026-10-20" };
const draftJson = { title: "Lemon Soup", ingredients: [] };

function okResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

function renderStart() {
  const { wrapper, queryClient } = createQueryWrapper();
  const { result } = renderHook(() => useRecipeGenerate(), { wrapper });
  return { queryClient, start: result.current.start };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tokenStorage.get).mockResolvedValue("tok-A");
});

// The meal-plan "generate with AI" screen: the request returns an UNSAVED
// draft (spec §5b), so success holds it on the device and tells the toast
// bridge; nothing in Saved items changes.
describe("useRecipeGenerate (background draft)", () => {
  it("sets mealPlan pending on start and clears it on success", async () => {
    vi.mocked(apiRequest).mockResolvedValue(okResponse(draftJson));
    const { queryClient, start } = renderStart();

    act(() => {
      start("lemon soup", returnToMealPlan);
    });

    expect(isPendingGeneration(queryClient, "mealPlan")).toBe(true);
    expect(isPendingGeneration(queryClient, "photo")).toBe(false);
    await waitFor(() =>
      expect(isPendingGeneration(queryClient, "mealPlan")).toBe(false),
    );
  });

  it("posts the prompt to /api/meal-plan/recipes/generate under the submit-time token", async () => {
    vi.mocked(apiRequest).mockResolvedValue(okResponse(draftJson));
    const { start } = renderStart();

    act(() => {
      start("lemon soup");
    });

    await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
    expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/meal-plan/recipes/generate",
      { prompt: "lemon soup" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      "tok-A",
    );
  });

  it("on success holds the draft with returnToMealPlan, notifies subscribers, and leaves Saved items alone", async () => {
    vi.mocked(apiRequest).mockResolvedValue(okResponse(draftJson));
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const listener = vi.fn();
    const unsubscribe = subscribeToRecipeDraftReady(listener);
    const { queryClient, start } = renderStart();

    act(() => {
      start("lemon soup", returnToMealPlan);
    });

    await waitFor(() =>
      expect(listener).toHaveBeenCalledWith({
        prefill: draftJson,
        returnToMealPlan,
      }),
    );
    expect(getHeldRecipeDraft(queryClient)).toEqual({
      prefill: draftJson,
      returnToMealPlan,
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(mockNotification).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
    expect(mockToast.error).not.toHaveBeenCalled();
    unsubscribe();
    invalidate.mockRestore();
  });

  it("stays silent when the auth token changed since submit", async () => {
    vi.mocked(tokenStorage.get)
      .mockResolvedValueOnce("tok-A")
      .mockResolvedValue("tok-B");
    vi.mocked(apiRequest).mockResolvedValue(okResponse(draftJson));
    const listener = vi.fn();
    const unsubscribe = subscribeToRecipeDraftReady(listener);
    const { queryClient, start } = renderStart();

    act(() => {
      start("lemon soup");
    });

    await waitFor(() => expect(tokenStorage.get).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(getHeldRecipeDraft(queryClient)).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    expect(mockNotification).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
    // The flag now belongs to the next session (teardown cleared the old one).
    expect(isPendingGeneration(queryClient, "mealPlan")).toBe(true);
    unsubscribe();
  });

  it("on a 4xx shows static code-keyed copy and clears pending", async () => {
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError(
        '429: {"error":"Daily recipe generation limit reached","code":"DAILY_LIMIT_REACHED"}',
        ErrorCode.DAILY_LIMIT_REACHED,
        429,
      ),
    );
    const { queryClient, start } = renderStart();

    act(() => {
      start("lemon soup");
    });

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith(
        "Daily recipe generation limit reached",
      ),
    );
    expect(isPendingGeneration(queryClient, "mealPlan")).toBe(false);
    expect(getHeldRecipeDraft(queryClient)).toBeNull();
  });

  it("on a non-4xx failure shows the plain error — nothing was saved, so no 'check Saved items'", async () => {
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError("502: Bad Gateway", undefined, 502),
    );
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const { queryClient, start } = renderStart();

    act(() => {
      start("lemon soup");
    });

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith(
        "Couldn't generate the recipe",
      ),
    );
    expect(invalidate).not.toHaveBeenCalled();
    expect(isPendingGeneration(queryClient, "mealPlan")).toBe(false);
    invalidate.mockRestore();
  });

  it("aborts after the deadline and treats it as a plain failure", async () => {
    vi.useFakeTimers();
    try {
      let seenSignal: AbortSignal | undefined;
      vi.mocked(apiRequest).mockImplementation(
        (_method, _route, _data, init) =>
          new Promise<Response>((_resolve, reject) => {
            seenSignal = init?.signal ?? undefined;
            seenSignal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      );
      const { queryClient, start } = renderStart();

      await act(async () => {
        start("lemon soup");
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(seenSignal?.aborted).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECIPE_GENERATION_DEADLINE_MS);
      });

      expect(seenSignal?.aborted).toBe(true);
      expect(mockToast.error).toHaveBeenCalledWith(
        "Couldn't generate the recipe",
      );
      expect(isPendingGeneration(queryClient, "mealPlan")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores start() while mealPlan is already pending", async () => {
    vi.mocked(apiRequest).mockResolvedValue(okResponse(draftJson));
    const { queryClient, start } = renderStart();

    act(() => {
      start("lemon soup");
      start("lemon soup again");
    });

    await waitFor(() =>
      expect(isPendingGeneration(queryClient, "mealPlan")).toBe(false),
    );
    expect(apiRequest).toHaveBeenCalledOnce();
  });

  it("does not block on a pending PHOTO generation — the entry points are independent", async () => {
    vi.mocked(apiRequest).mockResolvedValue(okResponse(draftJson));
    const { queryClient, start } = renderStart();
    setPendingGeneration(queryClient, "photo", true);

    act(() => {
      start("lemon soup");
    });

    await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
  });
});
