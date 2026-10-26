// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";

import { ApiError } from "@/lib/api-error";
import { useMakeSuggestionFlow } from "../useMakeSuggestionFlow";

const { mockMake, mockNavigate, mockToastError } = vi.hoisted(() => ({
  mockMake: vi.fn(),
  mockNavigate: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("@/hooks/useInspiredSuggestions", () => ({
  useMakeSuggestion: () => ({ mutateAsync: mockMake }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: mockToastError }),
}));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useMakeSuggestionFlow", () => {
  beforeEach(() => {
    mockMake.mockReset();
    mockNavigate.mockReset();
    mockToastError.mockReset();
  });

  it("opens the made recipe and clears makingId", async () => {
    mockMake.mockResolvedValue({ recipeId: 42 });
    const { result } = renderHook(() => useMakeSuggestionFlow());

    await act(async () => {
      result.current.make(7);
    });

    expect(mockMake).toHaveBeenCalledWith(7);
    expect(mockNavigate).toHaveBeenCalledWith("FeaturedRecipeDetail", {
      recipeId: 42,
      recipeType: "community",
    });
    expect(result.current.makingId).toBeNull();
  });

  it("ignores a second make while one runs, even in the same frame", async () => {
    const pending = deferred<{ recipeId: number }>();
    mockMake.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useMakeSuggestionFlow());

    act(() => {
      result.current.make(1);
      result.current.make(2);
    });
    expect(mockMake).toHaveBeenCalledTimes(1);
    expect(result.current.makingId).toBe(1);

    await act(async () => {
      pending.resolve({ recipeId: 9 });
    });
    expect(result.current.makingId).toBeNull();
  });

  it.each([
    [429, "You've reached today's recipe limit."],
    [500, "Couldn't make this recipe. Try again."],
  ])("shows the %i toast without calling onExpired", async (status, copy) => {
    mockMake.mockRejectedValue(new ApiError("x", undefined, status));
    const onExpired = vi.fn();
    const { result } = renderHook(() => useMakeSuggestionFlow());

    await act(async () => {
      result.current.make(3, onExpired);
    });

    expect(mockToastError).toHaveBeenCalledWith(copy);
    expect(onExpired).not.toHaveBeenCalled();
    expect(result.current.makingId).toBeNull();
  });

  it("on 410 shows the expired toast and calls onExpired", async () => {
    mockMake.mockRejectedValue(new ApiError("x", undefined, 410));
    const onExpired = vi.fn();
    const { result } = renderHook(() => useMakeSuggestionFlow());

    await act(async () => {
      result.current.make(3, onExpired);
    });

    expect(mockToastError).toHaveBeenCalledWith(
      "These ideas expired — search again.",
    );
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
