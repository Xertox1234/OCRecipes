import { createElement, useCallback, useMemo } from "react";
import { BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";

const HIDDEN_HANDLE_STYLE = { display: "none" as const };

// @gorhom/bottom-sheet only exports the narrow `BottomSheetBackdropProps`
// (the backdropComponent render-prop's own parameter type) from its package
// root — `pressBehavior` lives on the wider `BottomSheetDefaultBackdropProps`
// (the concrete `BottomSheetBackdrop` component's own props), which is not a
// public export. Inlined here to match its declared type
// (components/bottomSheetBackdrop/types.d.ts `BackdropPressBehavior`).
type BackdropPressBehavior = "none" | "close" | "collapse" | number;

export interface UseSheetHostPropsOptions {
  /** Themed background color for the sheet's own `backgroundStyle`. */
  backgroundColor: string;
  /** Forwarded to `BottomSheetBackdrop`; omit to use gorhom's own default. */
  backdropOpacity?: number;
  /** Forwarded to `BottomSheetBackdrop`; omit to use gorhom's own default. */
  backdropPressBehavior?: BackdropPressBehavior;
  /**
   * Renders a themed handle indicator in this color instead of hiding it.
   * Omit when the sheet's own content draws its own drag indicator (the
   * common case — most sheets hide the library's default so both don't
   * render at once).
   */
  handleIndicatorColor?: string;
}

export interface SheetHostProps {
  backdropComponent: (props: BottomSheetBackdropProps) => React.ReactElement;
  backgroundStyle: { backgroundColor: string };
  handleIndicatorStyle:
    | { backgroundColor: string }
    | typeof HIDDEN_HANDLE_STYLE;
  accessible: false;
}

/**
 * Shared `BottomSheetModal` host prop bundle: backdrop renderer, themed
 * background, handle-indicator style, and the `accessible={false}` iOS a11y
 * fix, in one place instead of copy-pasted per sheet.
 *
 * `@gorhom/bottom-sheet` defaults `accessible=true` on the `DraggableView`
 * that wraps a sheet's children. On new-arch iOS that makes the wrapper an
 * accessibility LEAF (`isAccessibilityElement=YES`), so VoiceOver — and
 * Maestro's iOS driver — see one opaque "Bottom Sheet" element and the
 * sheet's content (including testIDs) becomes unreachable; Android is
 * unaffected. `accessible={false}` keeps the children individually exposed.
 * MUST be `false`, not `null`: gorhom resolves it as
 * `_providedAccessible ?? undefined`, so `null` re-defaults to `true`. See
 * docs/solutions/logic-errors/gorhom-bottomsheetmodal-collapses-a11y-subtree-on-ios-2026-09-05.md.
 *
 * Backdrop/background/handle styling is caller-supplied (via options) rather
 * than hardcoded — sheets across the app are NOT visually identical (e.g.
 * MealPlanHomeScreen hides its handle and dims the backdrop to 0.35 with
 * `pressBehavior="close"`; RecipeBrowserScreen shows a themed handle and
 * uses gorhom's own backdrop defaults) — only the `accessible={false}` fix
 * and its rationale are truly shared across every site.
 */
export function useSheetHostProps({
  backgroundColor,
  backdropOpacity,
  backdropPressBehavior,
  handleIndicatorColor,
}: UseSheetHostPropsOptions): SheetHostProps {
  const backdropComponent = useCallback(
    (props: BottomSheetBackdropProps) =>
      createElement(BottomSheetBackdrop, {
        ...props,
        appearsOnIndex: 0,
        disappearsOnIndex: -1,
        ...(backdropOpacity !== undefined ? { opacity: backdropOpacity } : {}),
        ...(backdropPressBehavior !== undefined
          ? { pressBehavior: backdropPressBehavior }
          : {}),
      }),
    [backdropOpacity, backdropPressBehavior],
  );

  const backgroundStyle = useMemo(
    () => ({ backgroundColor }),
    [backgroundColor],
  );

  const handleIndicatorStyle = useMemo(
    () =>
      handleIndicatorColor !== undefined
        ? { backgroundColor: handleIndicatorColor }
        : HIDDEN_HANDLE_STYLE,
    [handleIndicatorColor],
  );

  return {
    backdropComponent,
    backgroundStyle,
    handleIndicatorStyle,
    accessible: false,
  };
}
