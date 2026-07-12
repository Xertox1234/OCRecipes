import { useCallback, useEffect, useRef } from "react";
import { BackHandler, Platform } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";

export interface UseSheetBackHandlerResult {
  /**
   * Wire this onto the BottomSheetModal's own `onChange` prop. Required for
   * BOTH usage modes: for imperatively-presented hosts (no `isOpen` state) it
   * is the only way presented state is tracked; for state-driven hosts
   * (passing `isOpen`) it is what confirms the sheet has fully closed —
   * `isOpen` flipping to `false` no longer closes the ref by itself (see the
   * hook's own JSDoc below), so skipping this wiring for a state-driven host
   * leaves the ref permanently "open" after the first close.
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
 * `isOpen` ref AND the host screen's focus state, returning `false` (event
 * falls through) whenever the sheet isn't presented or the screen isn't
 * focused — so it never fights React Navigation's own back handling or
 * swallows a legitimate back press meant for a different, currently-focused
 * screen. Register/unregister-around-visibility is unnecessary: the ref gate
 * achieves the same safety without the timing risk of re-registering
 * listeners on every open/close.
 *
 * The focus gate matters because the listener lives for the host's full
 * lifetime, not just while a sheet is presented: a deep-link or
 * push-notification navigation (`navigationRef.navigate(...)` — see
 * `client/App.tsx`'s notification-response handler) can push a sibling
 * screen that BLURS (not unmounts) a tab screen without clearing its sheet
 * state, leaving a stale listener from the blurred screen that would
 * otherwise consume a back press meant for the newly-focused screen.
 *
 * Two usage modes — **both now require wiring `onSheetChange`**:
 * - **State-driven (effect-presented) hosts**: pass the boolean that already
 *   drives `.present()`/`.dismiss()` as `isOpen`, AND wire the returned
 *   `onSheetChange` onto the BottomSheetModal's `onChange` prop. `isOpen`
 *   flipping `true` opens the ref immediately (no animation lag to cover on
 *   the way in, since the boolean flip already precedes `.present()`).
 *   `isOpen` flipping `false` no longer closes the ref by itself — closing
 *   is confirmed only by `onSheetChange(-1)`, so the ref stays "open" for
 *   the sheet's entire close animation instead of racing ahead of what the
 *   user still sees on screen. This mirrors the imperative-host bias below,
 *   and it means a state-driven host that forgets to wire `onSheetChange`
 *   leaves the ref stuck "open" after the first close.
 * - **Imperatively-presented hosts** (no `isOpen` state): omit `isOpen` and
 *   pass the returned `onSheetChange` (required) and `onSheetAnimate`
 *   (closes the opening-animation gap) to the BottomSheetModal's
 *   `onChange`/`onAnimate` props — presented state derives entirely from
 *   gorhom's snap-point index (`-1` = closed, `>= 0` = presented/animating
 *   open).
 *
 * Each call to this hook independently subscribes to `useIsFocused()` — a
 * host with several sheets (e.g. `MealPlanHomeScreen`'s 4 hosts) gets one
 * subscription per hook instance rather than one shared subscription per
 * screen. This is a deliberate, examined trade-off (see
 * `todos/archive/P3-2026-07-09-usesheetbackhandler-duplicate-isfocused-listeners.md`),
 * not an oversight: `useIsFocused()` is a cheap context read with no
 * re-render storm, and de-duplicating it would require either making
 * `isFocused` a *required* hook parameter — which would force every
 * single-sheet host (`HomeScreen`, `RecipeBrowserScreen`,
 * `RecipeEntryHubScreen`, `BeveragePickerSheet`, `ConfirmationModal`) to
 * also compute and pass it, for zero benefit to those call sites — or an
 * *optional* override parameter, which reproduces the exact
 * silently-dropped-safety-param footgun documented in `docs/LEARNINGS.md`
 * (2026-04-28, "Optional Hook Safety Param Silently Dropped at Call Site"):
 * a call site can omit the param with no TypeScript error, silently
 * re-enabling a per-instance subscription no one intended. Sharing was not
 * worth either cost for a cosmetic/perf-only P3 item.
 */
export function useSheetBackHandler(
  sheetRef: React.RefObject<BottomSheetModal | null>,
  isOpen?: boolean,
): UseSheetBackHandlerResult {
  const isOpenRef = useRef(isOpen ?? false);
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);

  // Mirrors focus into a ref for the same reason isOpen is mirrored below —
  // the hardware-back-press callback is invoked asynchronously by the OS,
  // not synchronously during render, so this is the "ref read later, in an
  // async callback" case hooks.md carves out for the useEffect-mirror
  // pattern.
  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  // Only ever opens the ref from the state-driven `isOpen` prop — never
  // closes it. Closing is confirmed exclusively by `onSheetChange(-1)`
  // below, so a state-driven host gets the same close-animation grace
  // period as an imperative host (see the JSDoc above and the "stays open
  // across the close animation" test).
  useEffect(() => {
    if (isOpen) {
      isOpenRef.current = true;
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
        if (!isOpenRef.current || !isFocusedRef.current) return false;
        sheetRef.current?.dismiss();
        return true;
      },
    );

    return () => subscription.remove();
  }, [sheetRef]);

  return { onSheetChange, onSheetAnimate };
}
