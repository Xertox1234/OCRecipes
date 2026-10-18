// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import { tokenStorage } from "@/lib/token-storage";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  getUnreadGeneratedRecipeIds,
  isPendingGeneration,
  setPendingGeneration,
  subscribeToGeneratedRecipeReady,
} from "../useGeneratedRecipeNotices";
import {
  RECIPE_GENERATION_DEADLINE_MS,
  generationErrorCopy,
  useGenerateRecipeInBackground,
  type GenerateRecipeInput,
} from "../useGenerateRecipeInBackground";
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

const input: GenerateRecipeInput = {
  productName: "Oats",
  barcode: null,
  servings: 2,
  dietPreferences: [],
  timeConstraint: undefined,
  shareToPublic: false,
};

function okResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

function renderStart() {
  const { wrapper, queryClient } = createQueryWrapper();
  const { result } = renderHook(() => useGenerateRecipeInBackground(), {
    wrapper,
  });
  return { queryClient, start: result.current.start };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tokenStorage.get).mockResolvedValue("tok-A");
});

describe("useGenerateRecipeInBackground", () => {
  it("sets photo pending on start and clears it on success", async () => {
    vi.mocked(apiRequest).mockResolvedValue(okResponse({ id: 42 }));
    const { queryClient, start } = renderStart();

    act(() => {
      start(input);
    });

    expect(isPendingGeneration(queryClient, "photo")).toBe(true);
    await waitFor(() =>
      expect(isPendingGeneration(queryClient, "photo")).toBe(false),
    );
  });

  it("posts the input to /api/recipes/generate under the submit-time token", async () => {
    vi.mocked(apiRequest).mockResolvedValue(okResponse({ id: 42 }));
    const { start } = renderStart();

    act(() => {
      start(input);
    });

    await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());
    expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/recipes/generate",
      input,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      "tok-A",
    );
  });

  it("on success invalidates /api/saved-items and /api/saved-items/count, marks the recipe unread and notifies subscribers", async () => {
    vi.mocked(apiRequest).mockResolvedValue(okResponse({ id: 42 }));
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const listener = vi.fn();
    const unsubscribe = subscribeToGeneratedRecipeReady(listener);
    const { queryClient, start } = renderStart();

    act(() => {
      start(input);
    });

    await waitFor(() => expect(listener).toHaveBeenCalledWith(42));
    expect(getUnreadGeneratedRecipeIds(queryClient)).toEqual([42]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/saved-items"] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["/api/saved-items/count"],
    });
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
      .mockResolvedValueOnce("tok-B");
    vi.mocked(apiRequest).mockResolvedValue(okResponse({ id: 42 }));
    const listener = vi.fn();
    const unsubscribe = subscribeToGeneratedRecipeReady(listener);
    const { queryClient, start } = renderStart();

    act(() => {
      start(input);
    });

    // Submit-time read, then the post-settle re-read.
    await waitFor(() => expect(tokenStorage.get).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(getUnreadGeneratedRecipeIds(queryClient)).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(mockNotification).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
    // The flag is left to the session that owns it now (teardown's
    // queryClient.clear() already dropped the old one).
    expect(isPendingGeneration(queryClient, "photo")).toBe(true);
    unsubscribe();
  });

  it("stays silent on a failure too when the auth token changed since submit", async () => {
    vi.mocked(tokenStorage.get)
      .mockResolvedValueOnce("tok-A")
      .mockResolvedValueOnce(null);
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError("502: Bad Gateway", undefined, 502),
    );
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const { queryClient, start } = renderStart();

    act(() => {
      start(input);
    });

    await waitFor(() => expect(tokenStorage.get).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(isPendingGeneration(queryClient, "photo")).toBe(true);
    invalidate.mockRestore();
  });

  it("on a 4xx shows the server message and clears pending without touching saved items", async () => {
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError(
        '429: {"error":"Daily recipe generation limit reached","code":"DAILY_LIMIT_REACHED"}',
        ErrorCode.DAILY_LIMIT_REACHED,
        429,
      ),
    );
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const listener = vi.fn();
    const unsubscribe = subscribeToGeneratedRecipeReady(listener);
    const { queryClient, start } = renderStart();

    act(() => {
      start(input);
    });

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith(
        "Daily recipe generation limit reached",
      ),
    );
    expect(isPendingGeneration(queryClient, "photo")).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(getUnreadGeneratedRecipeIds(queryClient)).toEqual([]);
    unsubscribe();
    invalidate.mockRestore();
  });

  it("on a non-4xx failure still invalidates saved items and shows the soft toast", async () => {
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError("502: Bad Gateway", undefined, 502),
    );
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const listener = vi.fn();
    const unsubscribe = subscribeToGeneratedRecipeReady(listener);
    const { queryClient, start } = renderStart();

    act(() => {
      start(input);
    });

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith(
        "Couldn't confirm the recipe — check Saved items",
      ),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/saved-items"] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["/api/saved-items/count"],
    });
    expect(isPendingGeneration(queryClient, "photo")).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    invalidate.mockRestore();
  });

  it("aborts after the deadline and treats it as a soft failure", async () => {
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
      const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
      const { queryClient, start } = renderStart();

      await act(async () => {
        start(input);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(seenSignal?.aborted).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECIPE_GENERATION_DEADLINE_MS);
      });

      expect(seenSignal?.aborted).toBe(true);
      expect(mockToast.error).toHaveBeenCalledWith(
        "Couldn't confirm the recipe — check Saved items",
      );
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["/api/saved-items"],
      });
      expect(isPendingGeneration(queryClient, "photo")).toBe(false);
      invalidate.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores start() while photo is already pending", async () => {
    vi.mocked(apiRequest).mockResolvedValue(okResponse({ id: 42 }));
    const { queryClient, start } = renderStart();

    act(() => {
      start(input);
      start(input);
    });

    await waitFor(() =>
      expect(isPendingGeneration(queryClient, "photo")).toBe(false),
    );
    expect(apiRequest).toHaveBeenCalledOnce();
  });
});

describe("generationErrorCopy", () => {
  it("maps known 4xx codes to static copy and never echoes the body", () => {
    expect(
      generationErrorCopy(
        new ApiError('429: {"error":"x"}', ErrorCode.DAILY_LIMIT_REACHED, 429),
      ),
    ).toBe("Daily recipe generation limit reached");
    expect(
      generationErrorCopy(
        new ApiError('403: {"error":"x"}', ErrorCode.PREMIUM_REQUIRED, 403),
      ),
    ).toBe("Recipe generation is a premium feature.");
    expect(
      generationErrorCopy(
        new ApiError('429: {"error":"x"}', ErrorCode.RATE_LIMITED, 429),
      ),
    ).toBe("Too many requests. Please wait a moment and try again.");
    expect(generationErrorCopy(new ApiError("400: nope", undefined, 400))).toBe(
      "Couldn't generate the recipe",
    );
    expect(generationErrorCopy(new Error("boom"))).toBe(
      "Couldn't generate the recipe",
    );
  });
});

// The pending flag is per entry point, not per session: a request that
// outlives its session must not release a flag the NEXT session now owns
// (same shape as docs/solutions/logic-errors/conditional-update-lock-release-
// must-compare-its-own-token-2026-10-13.md).
describe("useGenerateRecipeInBackground — stale request and the pending flag", () => {
  it("leaves the next session's pending flag alone when a stale request settles", async () => {
    vi.mocked(tokenStorage.get)
      .mockResolvedValueOnce("tok-A")
      .mockResolvedValue("tok-B");
    let resolveRequest: (res: Response) => void = () => {};
    vi.mocked(apiRequest).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const { queryClient, start } = renderStart();
    act(() => {
      start(input);
    });
    await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());

    // A signs out (teardown clears the cache), B signs in and starts their own.
    queryClient.clear();
    setPendingGeneration(queryClient, "photo", true);
    await act(async () => {
      resolveRequest(okResponse({ id: 42 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(isPendingGeneration(queryClient, "photo")).toBe(true);
    expect(getUnreadGeneratedRecipeIds(queryClient)).toEqual([]);
  });

  it("releases the pending flag when the token cannot be read after settle, so the current user is not stuck", async () => {
    vi.mocked(tokenStorage.get)
      .mockResolvedValueOnce("tok-A")
      .mockRejectedValue(new Error("secure store unavailable"));
    vi.mocked(apiRequest).mockResolvedValue(okResponse({ id: 42 }));
    const listener = vi.fn();
    const unsubscribe = subscribeToGeneratedRecipeReady(listener);
    const { queryClient, start } = renderStart();

    act(() => {
      start(input);
    });

    await waitFor(() =>
      expect(isPendingGeneration(queryClient, "photo")).toBe(false),
    );
    expect(listener).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
    unsubscribe();
  });
});
