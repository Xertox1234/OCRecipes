// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";

import { useSheetHostProps } from "../useSheetHostProps";

// Only `style` is a real ViewProps field on BottomSheetBackdropProps;
// animatedIndex/animatedPosition are reanimated SharedValues this hook never
// reads (it only spreads `props` onto BottomSheetBackdrop), so a minimal
// double is enough — cast once here instead of `as never`-ing each field.
function fakeBackdropProps(): BottomSheetBackdropProps {
  return {
    animatedIndex: { value: 0 },
    animatedPosition: { value: 0 },
    style: {},
  } as unknown as BottomSheetBackdropProps;
}

describe("useSheetHostProps", () => {
  it("returns accessible={false} — the iOS a11y-leaf fix every sheet needs", () => {
    const { result } = renderHook(() =>
      useSheetHostProps({ backgroundColor: "#111111" }),
    );
    expect(result.current.accessible).toBe(false);
  });

  it("themes the background style from the given color", () => {
    const { result } = renderHook(() =>
      useSheetHostProps({ backgroundColor: "#abcdef" }),
    );
    expect(result.current.backgroundStyle).toEqual({
      backgroundColor: "#abcdef",
    });
  });

  it("hides the handle indicator by default", () => {
    const { result } = renderHook(() =>
      useSheetHostProps({ backgroundColor: "#111111" }),
    );
    expect(result.current.handleIndicatorStyle).toEqual({
      display: "none",
    });
  });

  it("renders a themed handle indicator when handleIndicatorColor is given", () => {
    const { result } = renderHook(() =>
      useSheetHostProps({
        backgroundColor: "#111111",
        handleIndicatorColor: "#ff0000",
      }),
    );
    expect(result.current.handleIndicatorStyle).toEqual({
      backgroundColor: "#ff0000",
    });
  });

  it("forwards backdropOpacity/backdropPressBehavior only when provided, and always sets appearsOnIndex/disappearsOnIndex", () => {
    const { result: withOverrides } = renderHook(() =>
      useSheetHostProps({
        backgroundColor: "#111111",
        backdropOpacity: 0.35,
        backdropPressBehavior: "close",
      }),
    );
    const withProps =
      withOverrides.current.backdropComponent(fakeBackdropProps());
    expect(withProps.props).toMatchObject({
      appearsOnIndex: 0,
      disappearsOnIndex: -1,
      opacity: 0.35,
      pressBehavior: "close",
    });

    const { result: withoutOverrides } = renderHook(() =>
      useSheetHostProps({ backgroundColor: "#111111" }),
    );
    const withoutProps =
      withoutOverrides.current.backdropComponent(fakeBackdropProps());
    expect(withoutProps.props).not.toHaveProperty("opacity");
    expect(withoutProps.props).not.toHaveProperty("pressBehavior");
  });

  it("keeps a stable backdropComponent reference across re-renders with unchanged options", () => {
    const { result, rerender } = renderHook(
      (opts: { backdropOpacity?: number }) =>
        useSheetHostProps({
          backgroundColor: "#111111",
          backdropOpacity: opts.backdropOpacity,
        }),
      { initialProps: { backdropOpacity: 0.5 } },
    );
    const first = result.current.backdropComponent;
    rerender({ backdropOpacity: 0.5 });
    expect(result.current.backdropComponent).toBe(first);

    rerender({ backdropOpacity: 0.8 });
    expect(result.current.backdropComponent).not.toBe(first);
  });
});
