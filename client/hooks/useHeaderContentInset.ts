import { useHeaderHeight } from "@react-navigation/elements";

/**
 * Canonical source of the header inset for scrollable content rendered under
 * a transparent header (`useScreenOptions()` defaults `headerTransparent`
 * to `true` for every stack screen). Wraps `useHeaderHeight()` so every
 * screen reads the inset from one shared place instead of hand-rolling
 * `paddingTop: headerHeight + Spacing.*` — and never falls back to an
 * iOS-only ScrollView prop (`contentInsetAdjustmentBehavior` no-ops on
 * Android). See `docs/rules/react-native.md`.
 *
 * @param extra Additional spacing (e.g. `Spacing.lg`) added on top of the
 *   raw header height for visual breathing room. Defaults to 0.
 */
export function useHeaderContentInset(extra: number = 0): number {
  const headerHeight = useHeaderHeight();
  return headerHeight + extra;
}
