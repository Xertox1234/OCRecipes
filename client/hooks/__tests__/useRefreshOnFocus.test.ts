// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";

import {
  REFRESH_ON_FOCUS_SETTLE_MS,
  useRefreshOnFocus,
} from "../useRefreshOnFocus";

// Captures the latest callback the hook hands to useFocusEffect. Invoking it
// simulates a focus event; calling what it returns simulates the blur (the
// cleanup react-navigation runs when the screen loses focus).
const focus = vi.hoisted(() => ({
  cb: null as null | (() => void | (() => void)),
}));

vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    focus.cb = cb;
  },
}));

function fireFocus(): (() => void) | undefined {
  const cleanup = focus.cb?.();
  return typeof cleanup === "function" ? cleanup : undefined;
}

describe("useRefreshOnFocus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    focus.cb = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips the initial focus entirely — no immediate or follow-up refetch", () => {
    const refetch = vi.fn();
    renderHook(() =>
      useRefreshOnFocus(refetch, { settleMs: REFRESH_ON_FOCUS_SETTLE_MS }),
    );

    fireFocus(); // initial mount focus
    vi.advanceTimersByTime(REFRESH_ON_FOCUS_SETTLE_MS * 2);

    expect(refetch).not.toHaveBeenCalled();
  });

  it("refetches immediately on refocus, then once more after the settle margin", () => {
    const refetch = vi.fn();
    renderHook(() =>
      useRefreshOnFocus(refetch, { settleMs: REFRESH_ON_FOCUS_SETTLE_MS }),
    );

    fireFocus(); // initial — skipped
    fireFocus(); // returning focus
    expect(refetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(REFRESH_ON_FOCUS_SETTLE_MS - 1);
    expect(refetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(refetch).toHaveBeenCalledTimes(2);

    // Exactly one follow-up — not a polling interval.
    vi.advanceTimersByTime(REFRESH_ON_FOCUS_SETTLE_MS * 5);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("drops the follow-up when focus is lost before the margin elapses", () => {
    const refetch = vi.fn();
    renderHook(() =>
      useRefreshOnFocus(refetch, { settleMs: REFRESH_ON_FOCUS_SETTLE_MS }),
    );

    fireFocus(); // initial — skipped
    const blur = fireFocus(); // returning focus
    expect(refetch).toHaveBeenCalledTimes(1);

    expect(blur).toBeTypeOf("function");
    blur?.();
    vi.advanceTimersByTime(REFRESH_ON_FOCUS_SETTLE_MS * 2);

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("drops the follow-up when the screen unmounts before the margin elapses", () => {
    const refetch = vi.fn();
    const { unmount } = renderHook(() =>
      useRefreshOnFocus(refetch, { settleMs: REFRESH_ON_FOCUS_SETTLE_MS }),
    );

    fireFocus(); // initial — skipped
    fireFocus(); // returning focus (blur cleanup deliberately NOT called)
    expect(refetch).toHaveBeenCalledTimes(1);

    unmount();
    vi.advanceTimersByTime(REFRESH_ON_FOCUS_SETTLE_MS * 2);

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("without settleMs, refetches once per refocus and schedules no follow-up (Profile hub callers)", () => {
    const refetch = vi.fn();
    renderHook(() => useRefreshOnFocus(refetch));

    fireFocus(); // initial — skipped
    expect(fireFocus()).toBeUndefined(); // returning focus — no timer to clean up
    expect(refetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(REFRESH_ON_FOCUS_SETTLE_MS * 2);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("uses a settle margin comfortably above the server's post-disconnect settle", () => {
    // Pins the evidence-derived floor documented on the constant: a sub-second
    // margin would land inside TCP-close propagation + the coach path's
    // SELECT-then-write settle and re-latch pre-settle data.
    expect(REFRESH_ON_FOCUS_SETTLE_MS).toBeGreaterThanOrEqual(1000);
  });
});
