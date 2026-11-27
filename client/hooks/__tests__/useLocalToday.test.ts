// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { AppState } from "react-native";
import { msUntilNextLocalMidnight, useLocalToday } from "../useLocalToday";

describe("msUntilNextLocalMidnight", () => {
  it("counts to the next local midnight", () => {
    const now = new Date(2026, 10, 26, 23, 50, 0);
    expect(msUntilNextLocalMidnight(now)).toBe(10 * 60 * 1000);
  });

  it("is a full day just after midnight", () => {
    const now = new Date(2026, 10, 27, 0, 0, 0);
    expect(msUntilNextLocalMidnight(now)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("useLocalToday", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 26, 23, 50, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves to the new day at local midnight without a remount", () => {
    const { result } = renderHook(() => useLocalToday());
    expect(result.current).toBe("2026-11-26");

    act(() => {
      vi.advanceTimersByTime(11 * 60 * 1000);
    });
    expect(result.current).toBe("2026-11-27");

    // and again the night after, so the timer re-arms
    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(result.current).toBe("2026-11-28");
  });

  it("catches up when the app comes back to the front", () => {
    const { result } = renderHook(() => useLocalToday());
    const handler = vi.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1];
    expect(handler).toBeTypeOf("function");

    // The phone slept through midnight: the clock moved, no timer fired.
    vi.setSystemTime(new Date(2026, 10, 27, 7, 0, 0));
    act(() => {
      (handler as (s: string) => void)("active");
    });
    expect(result.current).toBe("2026-11-27");
  });

  it("stops listening when unmounted", () => {
    const remove = vi.fn();
    vi.mocked(AppState.addEventListener).mockReturnValueOnce({
      remove,
    } as unknown as ReturnType<typeof AppState.addEventListener>);
    const { unmount } = renderHook(() => useLocalToday());
    unmount();
    expect(remove).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
