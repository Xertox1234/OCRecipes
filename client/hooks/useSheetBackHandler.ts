import { useCallback, useEffect, useRef } from "react";
import { BackHandler, Platform } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

export interface UseSheetBackHandlerResult {
  /**
   * Wire this onto the BottomSheetModal's own `onChange` prop for
   * imperatively-presented hosts (no `isOpen` state) — it tracks presented
   * state via a ref instead of adding React state. Safe to ignore for
   * state-driven hosts that already pass `isOpen`.
   */
  onSheetChange: (index: number) => void;
  /**
   * Wire this onto the BottomSheetModal's own `onAnimate` prop alongside
   * `onSheetChange`, for imperatively-presented hosts. `onChange` only fires
   * once an animation *completes* — during the opening animation (a few
   * hundred ms of spring/timing motion) `onSheetChange` hasn't run yet, so a
   * back press in that window would fall through and reproduce the exact bug
   * this hook exists to fix. `onAnimate` fires (via `runOnJS`, one frame —
   * not truly synchronous) when the animation *starts*, well before
   * `onChange` fires on completion, so this flips the ref open immediately.
   * Closing is still left to `onSheetChange` (never flips the ref closed here) — biasing
   * toward "still open" during a close animation means a back press just
   * re-dismisses an already-dismissing sheet (harmless) rather than ever
   * risking a false negative while the sheet is still visible.
   */
  onSheetAnimate: (fromIndex: number, toIndex: number) => void;
}

/**
 * Wires Android hardware back to dismiss an open BottomSheetModal and
 * consume the event, so back doesn't simultaneously pop/navigate the screen
 * underneath. `@gorhom/bottom-sheet` has no built-in BackHandler wiring
 * (verified in library source) — every sheet host needs this explicitly.
 * No-op on iOS (BackHandler is Android-only).
 *
 * The listener is registered once for the host's lifetime and gates on an
 * `isOpen` ref, returning `false` (event falls through) whenever the sheet
 * isn't presented — so it never fights React Navigation's own back handling
 * or swallows a legitimate back press. Register/unregister-around-visibility
 * is unnecessary: the ref gate achieves the same safety without the timing
 * risk of re-registering listeners on every open/close.
 *
 * Two usage modes:
 * - **State-driven (effect-presented) hosts**: pass the boolean that already
 *   drives `.present()`/`.dismiss()` as `isOpen`.
 * - **Imperatively-presented hosts** (no `isOpen` state): omit `isOpen` and
 *   pass the returned `onSheetChange` to the BottomSheetModal's `onChange`
 *   prop — it derives presented state from gorhom's snap-point index
 *   (`-1` = closed, `>= 0` = presented).
 */
export function useSheetBackHandler(
  sheetRef: React.RefObject<BottomSheetModal | null>,
  isOpen?: boolean,
): UseSheetBackHandlerResult {
  const isOpenRef = useRef(isOpen ?? false);

  // Mirrors the state-driven `isOpen` prop into the ref so the (async,
  // externally-invoked) hardware-back-press callback below always reads the
  // latest value — this is the "ref read later, in an async callback" case
  // hooks.md carves out for the useEffect-mirror pattern.
  useEffect(() => {
    if (isOpen !== undefined) {
      isOpenRef.current = isOpen;
    }
  }, [isOpen]);

  const onSheetChange = useCallback((index: number) => {
    isOpenRef.current = index >= 0;
  }, []);

  const onSheetAnimate = useCallback((_fromIndex: number, toIndex: number) => {
    if (toIndex >= 0) {
      isOpenRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!isOpenRef.current) return false;
        sheetRef.current?.dismiss();
        return true;
      },
    );

    return () => subscription.remove();
  }, [sheetRef]);

  return { onSheetChange, onSheetAnimate };
}
