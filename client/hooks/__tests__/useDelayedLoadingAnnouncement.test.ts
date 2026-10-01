// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import * as RN from "react-native";

import {
  LOADING_ANNOUNCEMENT_DELAY_MS,
  useDelayedLoadingAnnouncement,
} from "../useDelayedLoadingAnnouncement";

// One hook for every skeleton screen's "Loading" announcement. HistoryScreen
// can't be rendered in this harness (see its P2 harness todo), so its
// isLoading && !isError gate is covered here through `active`.
describe("useDelayedLoadingAnnouncement", () => {
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    announceSpy.mockRestore();
    vi.useRealTimers();
  });

  it("uses a 500ms delay (modal-present safe)", () => {
    expect(LOADING_ANNOUNCEMENT_DELAY_MS).toBe(500);
  });

  it("announces Loading once after the delay, not synchronously", () => {
    renderHook(() => useDelayedLoadingAnnouncement(true));
    expect(announceSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(LOADING_ANNOUNCEMENT_DELAY_MS);
    expect(announceSpy).toHaveBeenCalledExactlyOnceWith("Loading");
  });

  it("never announces while inactive", () => {
    renderHook(() => useDelayedLoadingAnnouncement(false));
    vi.advanceTimersByTime(LOADING_ANNOUNCEMENT_DELAY_MS * 2);
    expect(announceSpy).not.toHaveBeenCalled();
  });

  it("does not announce when it goes inactive before the delay (content loaded, or an error arrived)", () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useDelayedLoadingAnnouncement(active),
      { initialProps: { active: true } },
    );
    vi.advanceTimersByTime(200);
    rerender({ active: false });
    vi.advanceTimersByTime(LOADING_ANNOUNCEMENT_DELAY_MS);
    expect(announceSpy).not.toHaveBeenCalled();
  });

  it("does not announce after unmounting before the delay", () => {
    const { unmount } = renderHook(() => useDelayedLoadingAnnouncement(true));
    unmount();
    vi.advanceTimersByTime(LOADING_ANNOUNCEMENT_DELAY_MS);
    expect(announceSpy).not.toHaveBeenCalled();
  });

  it("announces again when loading starts again (a retry that shows the skeleton)", () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useDelayedLoadingAnnouncement(active),
      { initialProps: { active: true } },
    );
    vi.advanceTimersByTime(LOADING_ANNOUNCEMENT_DELAY_MS);
    rerender({ active: false });
    rerender({ active: true });
    vi.advanceTimersByTime(LOADING_ANNOUNCEMENT_DELAY_MS);
    expect(announceSpy).toHaveBeenCalledTimes(2);
  });
});
