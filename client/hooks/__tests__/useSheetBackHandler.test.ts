// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import * as RN from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

import { useSheetBackHandler } from "../useSheetBackHandler";

const { useIsFocusedMock } = vi.hoisted(() => ({
  useIsFocusedMock: vi.fn(() => true),
}));

vi.mock("@react-navigation/native", () => ({
  useIsFocused: useIsFocusedMock,
}));

describe("useSheetBackHandler", () => {
  const originalPlatformOS = RN.Platform.OS;

  beforeEach(() => {
    useIsFocusedMock.mockReturnValue(true);
  });

  afterEach(() => {
    // Platform.OS is a plain string property, not a function — vi.spyOn can't
    // intercept it. Mutate-and-restore is the simplest path (matches
    // useFavouriteRecipes.test.ts convention).
    RN.Platform.OS = originalPlatformOS;
    vi.restoreAllMocks();
    useIsFocusedMock.mockReset();
    useIsFocusedMock.mockReturnValue(true);
  });

  function makeSheetRef() {
    const ref = createRef<BottomSheetModal | null>();
    // @ts-expect-error -- test double; only `.dismiss` is exercised
    ref.current = { dismiss: vi.fn(), present: vi.fn() };
    return ref;
  }

  it("registers a hardwareBackPress listener on Android", () => {
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    renderHook(() => useSheetBackHandler(sheetRef, false));

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "hardwareBackPress",
      expect.any(Function),
    );
  });

  it("does not register a listener on iOS", () => {
    RN.Platform.OS = "ios";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    renderHook(() => useSheetBackHandler(sheetRef, false));

    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });

  it("dismisses the sheet and consumes the event when open", () => {
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    renderHook(() => useSheetBackHandler(sheetRef, true));

    const handler = addEventListenerSpy.mock.calls[0]?.[1] as () => boolean;
    const consumed = handler();

    expect(consumed).toBe(true);
    expect(sheetRef.current?.dismiss).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss and lets the event fall through when closed", () => {
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    renderHook(() => useSheetBackHandler(sheetRef, false));

    const handler = addEventListenerSpy.mock.calls[0]?.[1] as () => boolean;
    const consumed = handler();

    expect(consumed).toBe(false);
    expect(sheetRef.current?.dismiss).not.toHaveBeenCalled();
  });

  it("re-reads isOpen on every render for state-driven hosts", () => {
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    const { rerender } = renderHook(
      ({ isOpen }: { isOpen: boolean }) =>
        useSheetBackHandler(sheetRef, isOpen),
      { initialProps: { isOpen: false } },
    );

    rerender({ isOpen: true });

    const handler = addEventListenerSpy.mock.calls[0]?.[1] as () => boolean;
    expect(handler()).toBe(true);
    // Listener is registered once for the host's lifetime, not re-registered
    // around visibility — the ref gate (not re-subscription) is what tracks
    // open/closed state.
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
  });

  it("stays open across the close animation for state-driven hosts too, until onSheetChange confirms closed", () => {
    // Mirrors the imperative-host asymmetric bias: isOpen flipping to false
    // (e.g. a synchronous state clear inside an in-sheet action handler)
    // must not immediately let a back press fall through while the sheet is
    // still visibly closing — only onSheetChange(-1) confirms the close
    // animation actually landed.
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    const { result, rerender } = renderHook(
      ({ isOpen }: { isOpen: boolean }) =>
        useSheetBackHandler(sheetRef, isOpen),
      { initialProps: { isOpen: true } },
    );

    const handler = addEventListenerSpy.mock.calls[0]?.[1] as () => boolean;
    expect(handler()).toBe(true);

    // The host's boolean flips closed synchronously, but the sheet's close
    // animation hasn't visually finished — onSheetChange(-1) hasn't fired.
    rerender({ isOpen: false });
    expect(handler()).toBe(true);

    result.current.onSheetChange(-1);
    expect(handler()).toBe(false);
  });

  it("lets the event fall through when the sheet is open but the host screen isn't focused", () => {
    useIsFocusedMock.mockReturnValue(false);
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    renderHook(() => useSheetBackHandler(sheetRef, true));

    const handler = addEventListenerSpy.mock.calls[0]?.[1] as () => boolean;
    const consumed = handler();

    expect(consumed).toBe(false);
    expect(sheetRef.current?.dismiss).not.toHaveBeenCalled();
  });

  it("stops consuming back presses once the host screen blurs, without re-registering the listener", () => {
    // A deep-link/notification navigation can blur (not unmount) a tab
    // screen while its sheet state is still non-null — a stale listener
    // must not swallow a back press meant for the newly-focused screen.
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    const { rerender } = renderHook(() => useSheetBackHandler(sheetRef, true));

    const handler = addEventListenerSpy.mock.calls[0]?.[1] as () => boolean;
    expect(handler()).toBe(true);

    useIsFocusedMock.mockReturnValue(false);
    rerender();

    expect(handler()).toBe(false);
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
  });

  it("resumes consuming back presses once the host screen refocuses (tab-switch-away-then-back)", () => {
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    const { rerender } = renderHook(() => useSheetBackHandler(sheetRef, true));

    const handler = addEventListenerSpy.mock.calls[0]?.[1] as () => boolean;

    useIsFocusedMock.mockReturnValue(false);
    rerender();
    expect(handler()).toBe(false);

    useIsFocusedMock.mockReturnValue(true);
    rerender();
    expect(handler()).toBe(true);
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
  });

  it("recovers from a spurious onSheetChange(-1) fired during a blur/refocus round-trip, when isOpen stays true throughout (state-driven host)", () => {
    // Repro for
    // todos/archive/P3-2026-07-12-sheetbackhandler-stale-listener-after-blur-refocus.md:
    // a deep-link push blurs the host screen while a state-driven sheet is
    // open (isOpen never changes — the host's own menu state is untouched by
    // the round-trip), and a stray onSheetChange(-1) fires mid-round-trip
    // (observed on-device; gorhom can emit this during a screen
    // detach/reattach even though the sheet never visually closed). Without
    // a live isOpen fallback, isOpenRef gets stuck false forever, since
    // isOpen itself never transitions again to re-open it — only
    // onSheetChange(-1) ever clears the ref, and only the isOpen prop
    // transitioning to true ever sets it, so a spurious clear while isOpen
    // stays true is unrecoverable without a live fallback.
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    const { result, rerender } = renderHook(
      ({ isOpen }: { isOpen: boolean }) =>
        useSheetBackHandler(sheetRef, isOpen),
      { initialProps: { isOpen: true } },
    );

    const handler = addEventListenerSpy.mock.calls[0]?.[1] as () => boolean;

    // Blur (deep link pushes a sibling screen on top).
    useIsFocusedMock.mockReturnValue(false);
    rerender({ isOpen: true });
    expect(handler()).toBe(false);

    // A stray onSheetChange(-1) fires during the round-trip, even though
    // the sheet never actually closed and isOpen never changed.
    result.current.onSheetChange(-1);

    // Refocus (hardware back pops the sibling screen).
    useIsFocusedMock.mockReturnValue(true);
    rerender({ isOpen: true });

    // A further back press should still dismiss the still-open sheet.
    expect(handler()).toBe(true);
    expect(sheetRef.current?.dismiss).toHaveBeenCalledTimes(1);
  });

  it("still lets a back press fall through after a blur/refocus round-trip when the sheet genuinely closed (isOpen flips false for real)", () => {
    // Symmetric counterpart to the spurious-event recovery test above: the
    // live isOpen fallback must never make a genuinely-closed, state-driven
    // sheet "sticky" after refocus — it should only rescue the case where
    // isOpen stays true but isOpenRef desynced, not override a real close.
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    const { result, rerender } = renderHook(
      ({ isOpen }: { isOpen: boolean }) =>
        useSheetBackHandler(sheetRef, isOpen),
      { initialProps: { isOpen: true } },
    );

    const handler = addEventListenerSpy.mock.calls[0]?.[1] as () => boolean;

    // Blur (deep link pushes a sibling screen on top).
    useIsFocusedMock.mockReturnValue(false);
    rerender({ isOpen: true });

    // The sheet genuinely closes during the round-trip — isOpen flips
    // false and onSheetChange(-1) confirms it, exactly as a real dismiss
    // does.
    rerender({ isOpen: false });
    result.current.onSheetChange(-1);

    // Refocus (hardware back pops the sibling screen).
    useIsFocusedMock.mockReturnValue(true);
    rerender({ isOpen: false });

    // A further back press must fall through — the sheet is really closed.
    expect(handler()).toBe(false);
    expect(sheetRef.current?.dismiss).not.toHaveBeenCalled();
  });

  it("tracks presented state via onSheetChange for imperative hosts (no isOpen param)", () => {
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    const { result } = renderHook(() => useSheetBackHandler(sheetRef));

    const handler = addEventListenerSpy.mock.calls[0]?.[1] as () => boolean;

    // Not presented yet — back press falls through.
    expect(handler()).toBe(false);

    // BottomSheetModal reports index 0 (snap point reached) via onChange.
    result.current.onSheetChange(0);
    expect(handler()).toBe(true);
    expect(sheetRef.current?.dismiss).toHaveBeenCalledTimes(1);

    // Index -1 means fully closed.
    result.current.onSheetChange(-1);
    expect(handler()).toBe(false);
  });

  it("marks the sheet open as soon as the open animation starts, via onSheetAnimate", () => {
    // onChange only fires when an animation COMPLETES (gorhom's
    // animateToPositionCompleted), not when it starts — so for imperative
    // hosts, onSheetChange alone leaves a dead window during the opening
    // animation where a back press falls through and pops the screen
    // underneath a sheet that is still visibly animating open. onSheetAnimate
    // (wired to gorhom's onAnimate, which fires synchronously before the
    // animation starts) closes that window.
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    const { result } = renderHook(() => useSheetBackHandler(sheetRef));

    const handler = addEventListenerSpy.mock.calls[0]?.[1] as () => boolean;

    // Sheet is about to animate open (present() called) — onChange hasn't
    // fired yet (animation not complete), but onAnimate has.
    result.current.onSheetAnimate(-1, 0);
    expect(handler()).toBe(true);
    expect(sheetRef.current?.dismiss).toHaveBeenCalledTimes(1);
  });

  it("does not mark the sheet open via onSheetAnimate when animating toward closed", () => {
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    const { result } = renderHook(() => useSheetBackHandler(sheetRef));

    const handler = addEventListenerSpy.mock.calls[0]?.[1] as () => boolean;

    result.current.onSheetAnimate(0, -1);
    expect(handler()).toBe(false);
  });

  it("stays open across the close animation until onSheetChange confirms fully closed", () => {
    // onSheetAnimate never flips the ref closed (only onSheetChange does) —
    // biasing toward "still open" during a close animation means a back
    // press just re-dismisses an already-dismissing sheet (harmless) rather
    // than ever falling through while the sheet is still visible.
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    const sheetRef = makeSheetRef();

    const { result } = renderHook(() => useSheetBackHandler(sheetRef));

    const handler = addEventListenerSpy.mock.calls[0]?.[1] as () => boolean;

    result.current.onSheetAnimate(-1, 0);
    expect(handler()).toBe(true);

    // Close animation starts (toIndex -1) — still open until onChange(-1)
    // confirms it landed.
    result.current.onSheetAnimate(0, -1);
    expect(handler()).toBe(true);

    result.current.onSheetChange(-1);
    expect(handler()).toBe(false);
  });

  it("removes the subscription on unmount", () => {
    RN.Platform.OS = "android";
    const remove = vi.fn();
    vi.spyOn(RN.BackHandler, "addEventListener").mockReturnValue({
      remove,
    } as ReturnType<typeof RN.BackHandler.addEventListener>);
    const sheetRef = makeSheetRef();

    const { unmount } = renderHook(() => useSheetBackHandler(sheetRef, true));
    unmount();

    expect(remove).toHaveBeenCalledTimes(1);
  });
});
