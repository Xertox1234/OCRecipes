// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { useQuickLogSession, MAX_LOG_ITEMS } from "../useQuickLogSession";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";

const GENERIC_PARSE_MESSAGE = "Failed to parse food text. Please try again.";
const QUICK_LOG_PREMIUM_MESSAGE =
  "Quick Log is a premium feature. Upgrade to log food by text or voice.";

const { mockApiRequest, mockTokenStorage, mockEnqueue, mockKeyboardDismiss } =
  vi.hoisted(() => ({
    mockApiRequest: vi.fn(),
    mockTokenStorage: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
      invalidateCache: vi.fn(),
    },
    mockEnqueue: vi.fn().mockResolvedValue(undefined),
    mockKeyboardDismiss: vi.fn(),
  }));

// The shared react-native mock has no Keyboard (see QuickLogDrawer.test.tsx's
// identical override) — reset() dismisses it on every close path.
vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Keyboard: { dismiss: mockKeyboardDismiss },
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  getApiUrl: () => "http://localhost:3000",
}));

vi.mock("@/lib/token-storage", () => ({ tokenStorage: mockTokenStorage }));

vi.mock("@/lib/offline-queue", () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
}));

const mockSpeechToText = {
  isListening: false,
  transcript: "",
  isFinal: false,
  volume: -2,
  error: null,
  startListening: vi.fn(),
  stopListening: vi.fn(),
};

vi.mock("@/hooks/useSpeechToText", () => ({
  useSpeechToText: vi.fn(() => mockSpeechToText),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ impact: vi.fn(), notification: vi.fn() }),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  // Reset useSpeechToText factory to default values between tests
  const { useSpeechToText } = await import("@/hooks/useSpeechToText");
  (useSpeechToText as ReturnType<typeof vi.fn>).mockReturnValue(
    mockSpeechToText,
  );
  mockTokenStorage.get.mockResolvedValue("test-token");
  // frequentItems query is deferred (enabled: isOpen). No pre-queued mock needed.
});

describe("useQuickLogSession", () => {
  it("parses food text and populates parsedItems on success", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              name: "eggs",
              quantity: 2,
              unit: "large",
              calories: 143,
              protein: 12,
              carbs: 1,
              fat: 10,
              servingSize: null,
            },
          ],
        }),
    });

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("2 eggs"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));
    expect(result.current.parsedItems[0].name).toBe("eggs");
    expect(result.current.parseError).toBeNull();
  });

  it("enqueues each parsed item to the durable offline queue when offline (per-item, not paused)", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              name: "eggs",
              quantity: 2,
              unit: "large",
              calories: 143,
              protein: 12,
              carbs: 1,
              fat: 10,
              servingSize: null,
            },
            {
              name: "toast",
              quantity: 1,
              unit: "slice",
              calories: 80,
              protein: 3,
              carbs: 14,
              fat: 1,
              servingSize: null,
            },
          ],
        }),
    });

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });
    act(() => result.current.setInputText("2 eggs and toast"));
    act(() => result.current.handleTextSubmit());
    await waitFor(() => expect(result.current.parsedItems).toHaveLength(2));

    mockApiRequest.mockClear(); // drop the parse call; assert no LOG call fires

    // Device offline: the batch mutation must RUN and enqueue each item durably,
    // not pause in-memory (a paused mutation is lost on force-quit, the failure
    // the durable queue prevents). Requires networkMode: "always"; the default
    // "online" pauses mutationFn offline so the enqueue branch never executes.
    const isOnlineSpy = vi
      .spyOn(onlineManager, "isOnline")
      .mockReturnValue(false);
    try {
      act(() => {
        void result.current.submitLog();
      });

      await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(2));
      // Enqueued per item, in order, so they replay in savedAt order on reconnect.
      expect(mockEnqueue).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          endpoint: "/api/scanned-items",
          method: "POST",
          body: expect.objectContaining({ productName: "2 large eggs" }),
        }),
      );
      expect(mockEnqueue).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          body: expect.objectContaining({ productName: "1 slice toast" }),
        }),
      );
      // No direct server POST while offline.
      expect(mockApiRequest).not.toHaveBeenCalled();
    } finally {
      isOnlineSpy.mockRestore();
    }
  });

  it("sets parseError when parse fails", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("some food"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parseError).not.toBeNull());
    expect(result.current.parsedItems).toHaveLength(0);
  });

  it("shows the premium message (not a parse failure) when text parse returns PREMIUM_REQUIRED", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockRejectedValueOnce(
      new ApiError("403: Premium required", ErrorCode.PREMIUM_REQUIRED, 403),
    );

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("some food"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parseError).not.toBeNull());
    expect(result.current.parseError).toBe(QUICK_LOG_PREMIUM_MESSAGE);
  });

  it("keeps the generic parse message for a non-premium ApiError", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockRejectedValueOnce(
      new ApiError("500: boom", ErrorCode.INTERNAL_ERROR, 500),
    );

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("some food"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parseError).not.toBeNull());
    expect(result.current.parseError).toBe(GENERIC_PARSE_MESSAGE);
  });

  // An empty parse is a successful request that found no food. It needs its
  // own flag: a parseError would say "try again" about a request that worked,
  // and no flag at all leaves the drawer looking unchanged (the device report).
  it("sets parseEmpty (not parseError) when a text parse returns no items", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("hello there"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parseEmpty).toBe(true));
    expect(result.current.parseError).toBeNull();
    expect(result.current.parsedItems).toHaveLength(0);
  });

  it("sets parseEmpty when a voice auto-parse returns no items", async () => {
    const { useSpeechToText } = await import("@/hooks/useSpeechToText");
    (useSpeechToText as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mockSpeechToText,
      isFinal: true,
      transcript: "um",
    });
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    await waitFor(() => expect(result.current.parseEmpty).toBe(true));
    expect(result.current.parseError).toBeNull();
  });

  it("clears parseEmpty when the next parse finds food", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "toast",
                quantity: 1,
                unit: "slice",
                calories: 80,
                protein: 3,
                carbs: 14,
                fat: 1,
                servingSize: null,
              },
            ],
          }),
      });

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("hello"));
    act(() => result.current.handleTextSubmit());
    await waitFor(() => expect(result.current.parseEmpty).toBe(true));

    act(() => result.current.setInputText("1 slice toast"));
    act(() => result.current.handleTextSubmit());
    await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));
    expect(result.current.parseEmpty).toBe(false);
  });

  it("clears parseEmpty on a new submit, before its result arrives", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      })
      .mockReturnValueOnce(new Promise(() => {})); // second parse never settles

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("hello"));
    act(() => result.current.handleTextSubmit());
    await waitFor(() => expect(result.current.parseEmpty).toBe(true));

    act(() => result.current.handleTextSubmit());
    expect(result.current.parseEmpty).toBe(false);
  });

  // A chip is a known-good suggestion; leaving "couldn't find any food" beside
  // it implies the chip's item failed too.
  it("tapping a chip clears a stale empty-parse message", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("asdf"));
    act(() => result.current.handleTextSubmit());
    await waitFor(() => expect(result.current.parseEmpty).toBe(true));

    act(() => result.current.handleChipPress("Coffee"));
    expect(result.current.parseEmpty).toBe(false);
    expect(result.current.inputText).toBe("Coffee");
  });

  it("reset clears parseEmpty", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("hello"));
    act(() => result.current.handleTextSubmit());
    await waitFor(() => expect(result.current.parseEmpty).toBe(true));

    act(() => result.current.reset());
    expect(result.current.parseEmpty).toBe(false);
  });

  it("shows the premium message when voice auto-parse returns PREMIUM_REQUIRED", async () => {
    const { useSpeechToText } = await import("@/hooks/useSpeechToText");
    (useSpeechToText as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mockSpeechToText,
      isFinal: true,
      transcript: "3 eggs",
    });
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockRejectedValueOnce(
      new ApiError("403: Premium required", ErrorCode.PREMIUM_REQUIRED, 403),
    );

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    await waitFor(() => expect(result.current.parseError).not.toBeNull());
    expect(result.current.parseError).toBe(QUICK_LOG_PREMIUM_MESSAGE);
  });

  it("removes item by index", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              name: "eggs",
              quantity: 2,
              unit: "large",
              calories: 143,
              protein: 12,
              carbs: 1,
              fat: 10,
              servingSize: null,
            },
            {
              name: "coffee",
              quantity: 1,
              unit: "cup",
              calories: 5,
              protein: 0,
              carbs: 1,
              fat: 0,
              servingSize: null,
            },
          ],
        }),
    });

    act(() => result.current.setInputText("2 eggs and coffee"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parsedItems).toHaveLength(2));

    act(() => result.current.removeItem(0));

    expect(result.current.parsedItems).toHaveLength(1);
    expect(result.current.parsedItems[0].name).toBe("coffee");
  });

  it("removeItem is a no-op while a log submit is in flight", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              name: "eggs",
              quantity: 2,
              unit: "large",
              calories: 143,
              protein: 12,
              carbs: 1,
              fat: 10,
              servingSize: null,
            },
            {
              name: "coffee",
              quantity: 1,
              unit: "cup",
              calories: 5,
              protein: 0,
              carbs: 1,
              fat: 0,
              servingSize: null,
            },
          ],
        }),
    });
    // logAll POSTs hang so the submit stays in flight
    mockApiRequest.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("2 eggs and coffee"));
    act(() => result.current.handleTextSubmit());
    await waitFor(() => expect(result.current.parsedItems).toHaveLength(2));

    act(() => result.current.submitLog());
    await waitFor(() => expect(result.current.isSubmitting).toBe(true));

    // Removing mid-submit must be ignored — the list is frozen so onError's
    // failedIndices stay aligned with the submitted array.
    act(() => result.current.removeItem(0));
    expect(result.current.parsedItems).toHaveLength(2);
  });

  it("calls onLogSuccess with summary after submitLog succeeds", async () => {
    const { wrapper } = createQueryWrapper();
    const onLogSuccess = vi.fn();

    mockApiRequest
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "chicken",
                quantity: 1,
                unit: "breast",
                calories: 320,
                protein: 58,
                carbs: 0,
                fat: 7,
                servingSize: null,
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });

    const { result } = renderHook(() => useQuickLogSession({ onLogSuccess }), {
      wrapper,
    });

    act(() => result.current.setInputText("chicken breast"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));

    act(() => result.current.submitLog());

    await waitFor(() => expect(onLogSuccess).toHaveBeenCalledOnce());
    expect(onLogSuccess).toHaveBeenCalledWith({
      itemCount: 1,
      totalCalories: 320,
      firstName: "chicken",
    });
    expect(result.current.parsedItems).toHaveLength(0);
    expect(result.current.inputText).toBe("");
  });

  // P1-2026-09-23: this online-success path used to invalidate dailySummary,
  // scannedItems, and frequentItems, but never daily-budget — leaving Home's
  // calorie header stale after a QuickLog submit.
  it("invalidates /api/daily-budget after submitLog succeeds online", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    mockApiRequest
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "chicken",
                quantity: 1,
                unit: "breast",
                calories: 320,
                protein: 58,
                carbs: 0,
                fat: 7,
                servingSize: null,
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });

    const { result } = renderHook(() => useQuickLogSession({}), { wrapper });

    act(() => result.current.setInputText("chicken breast"));
    act(() => result.current.handleTextSubmit());
    await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));

    act(() => result.current.submitLog());

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/daily-budget"],
      }),
    );
  });

  it("sets submitError when log fails", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "eggs",
                quantity: 1,
                unit: "large",
                calories: 72,
                protein: 6,
                carbs: 0,
                fat: 5,
                servingSize: null,
              },
            ],
          }),
      })
      .mockRejectedValueOnce(new Error("server error"));

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("egg"));
    act(() => result.current.handleTextSubmit());
    await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));

    act(() => result.current.submitLog());

    await waitFor(() => expect(result.current.submitError).not.toBeNull());
  });

  it("partial failure: removes successfully logged items so retry is idempotent", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    // Parse returns 2 items: eggs (index 0) and coffee (index 1)
    mockApiRequest
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "eggs",
                quantity: 2,
                unit: "large",
                calories: 143,
                protein: 12,
                carbs: 1,
                fat: 10,
                servingSize: null,
              },
              {
                name: "coffee",
                quantity: 1,
                unit: "cup",
                calories: 5,
                protein: 0,
                carbs: 1,
                fat: 0,
                servingSize: null,
              },
            ],
          }),
      })
      // eggs POST succeeds (index 0)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      })
      // coffee POST fails (index 1)
      .mockRejectedValueOnce(new Error("server error"));

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("2 eggs and coffee"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parsedItems).toHaveLength(2));

    act(() => result.current.submitLog());

    // After partial failure only the failed item (coffee, index 1) remains
    await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));
    expect(result.current.parsedItems[0].name).toBe("coffee");
    expect(result.current.submitError).toBe(
      "Some items failed to log. Please try again.",
    );
    // P1-2026-09-23 (code-reviewer finding): the partial-success onError
    // branch invalidates daily-budget too — real server writes happened for
    // the item(s) that DID persist (eggs), so Home's calorie header is stale
    // otherwise, same as the full-success path.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/daily-budget"],
    });
  });

  it("total failure: preserves all parsedItems and shows generic error message", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "eggs",
                quantity: 2,
                unit: "large",
                calories: 143,
                protein: 12,
                carbs: 1,
                fat: 10,
                servingSize: null,
              },
              {
                name: "coffee",
                quantity: 1,
                unit: "cup",
                calories: 5,
                protein: 0,
                carbs: 1,
                fat: 0,
                servingSize: null,
              },
            ],
          }),
      })
      // Both POSTs fail
      .mockRejectedValueOnce(new Error("server error"))
      .mockRejectedValueOnce(new Error("server error"));

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("2 eggs and coffee"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parsedItems).toHaveLength(2));

    act(() => result.current.submitLog());

    await waitFor(() => expect(result.current.submitError).not.toBeNull());
    // All items remain — nothing was successfully logged
    expect(result.current.parsedItems).toHaveLength(2);
    expect(result.current.submitError).toBe(
      "Failed to log items. Please try again.",
    );
  });

  it("reset clears inputText, parsedItems, and errors", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("some food"));

    act(() => result.current.reset());

    expect(result.current.inputText).toBe("");
    expect(result.current.parsedItems).toHaveLength(0);
    expect(result.current.parseError).toBeNull();
    expect(result.current.submitError).toBeNull();
  });

  // Closing the drawer never dismissed the keyboard before this — it could
  // stay up over the collapsed/locked row (P3-2026-09-29). Every close path
  // (switching drawers, leaving the tab, a successful log) funnels through
  // this one reset(), so dismissing here covers all of them.
  it("calls Keyboard.dismiss() on reset", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.reset());

    expect(mockKeyboardDismiss).toHaveBeenCalledTimes(1);
  });

  // A per-parse generation counter lets consumers announce every successful
  // parse, not just the first — see the "second manifestation" in
  // docs/solutions/logic-errors/imperative-announce-must-be-content-keyed-not-variant-keyed-2026-06-24.md.
  describe("parseGeneration", () => {
    it("starts at 0 and is silent until the first parse", () => {
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useQuickLogSession(), { wrapper });

      expect(result.current.parseGeneration).toBe(0);
    });

    it("bumps on a successful text-submit parse", async () => {
      const { wrapper } = createQueryWrapper();
      mockApiRequest.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "eggs",
                quantity: 2,
                unit: "large",
                calories: 143,
                protein: 12,
                carbs: 1,
                fat: 10,
                servingSize: null,
              },
            ],
          }),
      });

      const { result } = renderHook(() => useQuickLogSession(), { wrapper });

      act(() => result.current.setInputText("2 eggs"));
      act(() => result.current.handleTextSubmit());

      await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));
      expect(result.current.parseGeneration).toBe(1);
    });

    it("bumps again on a second successful parse that replaces the results, with no empty state in between", async () => {
      const { wrapper } = createQueryWrapper();
      mockApiRequest
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                {
                  name: "eggs",
                  quantity: 2,
                  unit: "large",
                  calories: 143,
                  protein: 12,
                  carbs: 1,
                  fat: 10,
                  servingSize: null,
                },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                {
                  name: "toast",
                  quantity: 1,
                  unit: "slice",
                  calories: 80,
                  protein: 3,
                  carbs: 14,
                  fat: 1,
                  servingSize: null,
                },
              ],
            }),
        });

      const { result } = renderHook(() => useQuickLogSession(), { wrapper });

      act(() => result.current.setInputText("2 eggs"));
      act(() => result.current.handleTextSubmit());
      await waitFor(() => expect(result.current.parseGeneration).toBe(1));

      // The prior result was never cleared (no empty state, no reset) —
      // exactly the case the discriminator (`parsedItems.length > 0`) alone
      // can't distinguish from "unchanged".
      act(() => result.current.setInputText("1 slice toast"));
      act(() => result.current.handleTextSubmit());
      await waitFor(() =>
        expect(result.current.parsedItems[0]?.name).toBe("toast"),
      );
      expect(result.current.parseGeneration).toBe(2);
    });

    it("bumps on a successful voice auto-parse", async () => {
      const { useSpeechToText } = await import("@/hooks/useSpeechToText");
      (useSpeechToText as ReturnType<typeof vi.fn>).mockReturnValue({
        ...mockSpeechToText,
        isFinal: true,
        transcript: "3 eggs",
      });

      const { wrapper } = createQueryWrapper();
      mockApiRequest.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "eggs",
                quantity: 3,
                unit: "large",
                calories: 216,
                protein: 18,
                carbs: 1,
                fat: 15,
                servingSize: null,
              },
            ],
          }),
      });

      const { result } = renderHook(() => useQuickLogSession(), { wrapper });

      await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));
      expect(result.current.parseGeneration).toBe(1);
    });

    // The counter must key off an actual new parse, not any change to
    // parsedItems — removeItem changes the array the same way a re-parse
    // does, and over-announcing every removal is worse than the gap this
    // counter fixes (see the solution doc's "why this one was left unfixed"
    // note).
    it("does not bump when removeItem changes the list", async () => {
      const { wrapper } = createQueryWrapper();
      mockApiRequest.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "eggs",
                quantity: 2,
                unit: "large",
                calories: 143,
                protein: 12,
                carbs: 1,
                fat: 10,
                servingSize: null,
              },
              {
                name: "coffee",
                quantity: 1,
                unit: "cup",
                calories: 5,
                protein: 0,
                carbs: 1,
                fat: 0,
                servingSize: null,
              },
            ],
          }),
      });

      const { result } = renderHook(() => useQuickLogSession(), { wrapper });

      act(() => result.current.setInputText("2 eggs and coffee"));
      act(() => result.current.handleTextSubmit());
      await waitFor(() => expect(result.current.parsedItems).toHaveLength(2));
      expect(result.current.parseGeneration).toBe(1);

      act(() => result.current.removeItem(0));

      expect(result.current.parsedItems).toHaveLength(1);
      expect(result.current.parseGeneration).toBe(1);
    });
  });

  it("does not repopulate items when a parse resolves after reset()", async () => {
    const { wrapper } = createQueryWrapper();

    // Parse hangs until we resolve it manually
    let resolveParse!: (v: unknown) => void;
    mockApiRequest.mockReturnValueOnce(
      new Promise((res) => {
        resolveParse = res;
      }),
    );

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("2 eggs"));
    act(() => result.current.handleTextSubmit());

    // User abandons the session while the parse is still in flight
    act(() => result.current.reset());

    // The parse resolves — but its result belongs to a cleared session
    await act(async () => {
      resolveParse({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "eggs",
                quantity: 2,
                unit: "large",
                calories: 143,
                protein: 12,
                carbs: 1,
                fat: 10,
                servingSize: null,
              },
            ],
          }),
      });
    });

    // Dismissed session must not be repopulated by the stale parse
    expect(result.current.parsedItems).toHaveLength(0);
    expect(result.current.parseError).toBeNull();
  });

  it("reset during an in-flight submit, then a late error, does not repopulate the submitError banner", async () => {
    const { wrapper } = createQueryWrapper();

    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              name: "eggs",
              quantity: 1,
              unit: "large",
              calories: 72,
              protein: 6,
              carbs: 0,
              fat: 5,
              servingSize: null,
            },
          ],
        }),
    });

    // logAll POST hangs until we reject it manually, simulating a late error
    // that resolves after the session has already been reset (drawer closed
    // mid-submit).
    let rejectLog!: (reason: unknown) => void;
    mockApiRequest.mockReturnValueOnce(
      new Promise((_, rej) => {
        rejectLog = rej;
      }),
    );

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("egg"));
    act(() => result.current.handleTextSubmit());
    await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));

    act(() => result.current.submitLog());
    await waitFor(() => expect(result.current.isSubmitting).toBe(true));

    // User closes the drawer mid-submit — session resets while the POST is
    // still in flight.
    act(() => result.current.reset());
    expect(result.current.submitError).toBeNull();

    // The submit's error arrives after the reset — it belongs to a dismissed
    // session and must not repopulate the banner.
    await act(async () => {
      rejectLog(new Error("server error"));
    });
    await waitFor(() => expect(result.current.isSubmitting).toBe(false));

    expect(result.current.submitError).toBeNull();
    expect(result.current.parsedItems).toHaveLength(0);
  });

  it("auto-parses when isFinal becomes true with a transcript", async () => {
    const { useSpeechToText } = await import("@/hooks/useSpeechToText");
    (useSpeechToText as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mockSpeechToText,
      isFinal: true,
      transcript: "3 eggs",
    });

    const { wrapper } = createQueryWrapper();
    // frequentItems is deferred (enabled: isOpen=false by default); parse mock is first
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              name: "eggs",
              quantity: 3,
              unit: "large",
              calories: 216,
              protein: 18,
              carbs: 1,
              fat: 15,
              servingSize: null,
            },
          ],
        }),
    });

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));
    expect(result.current.parsedItems[0].name).toBe("eggs");
  });

  it("auto-parses a final transcript only once, not on every mutation settle", async () => {
    const { useSpeechToText } = await import("@/hooks/useSpeechToText");
    // isFinal/transcript stay constant (they only reset on the next startListening)
    (useSpeechToText as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mockSpeechToText,
      isFinal: true,
      transcript: "3 eggs",
    });

    const { wrapper } = createQueryWrapper();
    // First parse succeeds; any erroneous re-fire gets a never-resolving promise so
    // isParsing stays true — this bounds the buggy loop at one extra call to assert on
    // (a resolving mock would re-fire forever and OOM the test).
    mockApiRequest
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "eggs",
                quantity: 3,
                unit: "large",
                calories: 216,
                protein: 18,
                carbs: 1,
                fat: 15,
                servingSize: null,
              },
            ],
          }),
      })
      .mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));

    // Let any erroneous re-fire (effect re-runs once isParsing settles) flush through
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const parseCalls = mockApiRequest.mock.calls.filter((args) =>
      String(args[1]).includes("/api/food/parse"),
    );
    expect(parseCalls).toHaveLength(1);
  });

  it("handleVoicePress calls startListening when not listening", () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.handleVoicePress());

    expect(mockSpeechToText.startListening).toHaveBeenCalledOnce();
  });

  it("handleTextSubmit does not fire a second parse when isParsing is true", async () => {
    const { wrapper } = createQueryWrapper();

    // First parse call: hangs so isParsing stays true
    let resolveFirst!: (v: unknown) => void;
    mockApiRequest.mockReturnValueOnce(
      new Promise((res) => {
        resolveFirst = res;
      }),
    );

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("2 eggs"));

    // Kick off first parse — isParsing becomes true
    act(() => result.current.handleTextSubmit());

    // Immediately attempt a second parse while first is in-flight
    act(() => result.current.handleTextSubmit());

    // Settle the first request
    await act(async () => {
      resolveFirst({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "eggs",
                quantity: 2,
                unit: "large",
                calories: 143,
                protein: 12,
                carbs: 1,
                fat: 10,
                servingSize: null,
              },
            ],
          }),
      });
    });

    // mockApiRequest should only have been called once for the parse endpoint
    // (the other call was the frequentItems query from beforeEach)
    const parseCalls = mockApiRequest.mock.calls.filter((args) =>
      String(args[1]).includes("/api/food/parse"),
    );
    expect(parseCalls).toHaveLength(1);
  });

  it("handleVoicePress calls stopListening when already listening", async () => {
    const { useSpeechToText } = await import("@/hooks/useSpeechToText");
    (useSpeechToText as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mockSpeechToText,
      isListening: true,
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.handleVoicePress());

    expect(mockSpeechToText.stopListening).toHaveBeenCalledOnce();
    expect(mockSpeechToText.startListening).not.toHaveBeenCalled();
  });

  it("caps items at MAX_LOG_ITEMS and sets capWarning when items exceed the limit", async () => {
    const { wrapper } = createQueryWrapper();

    // Parse returns MAX_LOG_ITEMS + 2 items
    const extraItems = Array.from({ length: MAX_LOG_ITEMS + 2 }, (_, i) => ({
      name: `item${i}`,
      quantity: 1,
      unit: "piece",
      calories: 10,
      protein: null,
      carbs: null,
      fat: null,
      servingSize: null,
    }));

    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items: extraItems }),
    });
    // Mock log responses for only the capped items
    for (let i = 0; i < MAX_LOG_ITEMS; i++) {
      mockApiRequest.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: i + 1 }),
      });
    }

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("lots of food"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() =>
      expect(result.current.parsedItems).toHaveLength(MAX_LOG_ITEMS + 2),
    );

    // Track POST calls
    const callsBefore = mockApiRequest.mock.calls.length;
    act(() => result.current.submitLog());

    await waitFor(() => expect(result.current.capWarning).not.toBeNull());
    expect(result.current.capWarning).toContain(`${MAX_LOG_ITEMS}`);

    // Only MAX_LOG_ITEMS POST requests were made (not MAX_LOG_ITEMS + 2)
    const logCalls = mockApiRequest.mock.calls.slice(callsBefore);
    expect(logCalls).toHaveLength(MAX_LOG_ITEMS);
  });

  it("does not set capWarning when items are within the limit", async () => {
    const { wrapper } = createQueryWrapper();

    const items = Array.from({ length: MAX_LOG_ITEMS }, (_, i) => ({
      name: `item${i}`,
      quantity: 1,
      unit: "piece",
      calories: 10,
      protein: null,
      carbs: null,
      fat: null,
      servingSize: null,
    }));

    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items }),
    });
    for (let i = 0; i < MAX_LOG_ITEMS; i++) {
      mockApiRequest.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: i + 1 }),
      });
    }

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("lots of food"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() =>
      expect(result.current.parsedItems).toHaveLength(MAX_LOG_ITEMS),
    );

    act(() => result.current.submitLog());

    await waitFor(() => expect(result.current.parsedItems).toHaveLength(0));
    expect(result.current.capWarning).toBeNull();
  });

  it("reset clears capWarning", async () => {
    const { wrapper } = createQueryWrapper();

    const items = Array.from({ length: MAX_LOG_ITEMS + 1 }, (_, i) => ({
      name: `item${i}`,
      quantity: 1,
      unit: "piece",
      calories: 10,
      protein: null,
      carbs: null,
      fat: null,
      servingSize: null,
    }));

    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ items }),
    });
    for (let i = 0; i < MAX_LOG_ITEMS; i++) {
      mockApiRequest.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: i + 1 }),
      });
    }

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("lots of food"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() =>
      expect(result.current.parsedItems).toHaveLength(MAX_LOG_ITEMS + 1),
    );

    act(() => result.current.submitLog());
    await waitFor(() => expect(result.current.capWarning).not.toBeNull());

    act(() => result.current.reset());
    expect(result.current.capWarning).toBeNull();
  });
});
