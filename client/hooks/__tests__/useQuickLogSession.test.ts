// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { useQuickLogSession, MAX_LOG_ITEMS } from "../useQuickLogSession";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest, mockTokenStorage } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockTokenStorage: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    invalidateCache: vi.fn(),
  },
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  getApiUrl: () => "http://localhost:3000",
}));

vi.mock("@/lib/token-storage", () => ({ tokenStorage: mockTokenStorage }));

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

  it("sets parseError when parse fails", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("some food"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parseError).not.toBeNull());
    expect(result.current.parsedItems).toHaveLength(0);
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
    const { wrapper } = createQueryWrapper();

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
