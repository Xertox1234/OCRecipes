// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { useQuickLogSession } from "../useQuickLogSession";
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

vi.mock("@/hooks/useSpeechToText", () => ({
  useSpeechToText: () => ({
    isListening: false,
    transcript: "",
    isFinal: false,
    volume: -2,
    error: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ impact: vi.fn(), notification: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockTokenStorage.get.mockResolvedValue("test-token");
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
});
