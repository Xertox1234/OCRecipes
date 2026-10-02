/** Target scroll offset so the row's current on-screen top lands just below the
 *  collapsed summary bar. `rowPageY` comes from a Reanimated measure() (already
 *  reflects the collapsing-header delta); `collapsedBarHeight` = insets.top +
 *  HOME_HEADER_COLLAPSED. Clamped to >= 0.
 *
 *  MUST stay a worklet: HomeScreen.glideRowToTop calls this inside a scheduleOnUI
 *  worklet (alongside measure()/scrollTo()). The Reanimated Babel plugin does
 *  not workletize across imports, so without this directive the call is fatal on
 *  the UI thread ("Tried to synchronously call a non-worklet function"). The
 *  directive is a no-op when the unit tests call it on the JS thread. */
export function glideToTopOffset(
  currentScrollY: number,
  rowPageY: number,
  collapsedBarHeight: number,
): number {
  "worklet";
  return Math.max(0, currentScrollY + (rowPageY - collapsedBarHeight));
}

/** Bottom padding for the Home scroll content. `basePadding` is the always-on
 *  tab-bar + FAB clearance. While an inline drawer is open and a keyboard height
 *  is known, the content needs at least that much room under it: iOS lays the
 *  keyboard over the page without shrinking the scroll view, so on a short page
 *  there is otherwise no scroll range left to lift the drawer's input above it.
 *  The keyboard covers the tab bar and FAB, so their clearance is not stacked on
 *  top of it - the larger of the two wins.
 *
 *  Keyed on drawer state, deliberately NOT on the keyboard being up: dropping the
 *  padding when the keyboard hides shrinks the content beneath a lifted scroll
 *  offset and the scroll view snaps the page back in a single frame.
 *
 *  Runs on the JS thread only (render), so it carries no "worklet" directive. */
export function scrollBottomPadding(
  basePadding: number,
  keyboardHeight: number,
  hasOpenDrawer: boolean,
  gap: number,
): number {
  if (!hasOpenDrawer || keyboardHeight <= 0) return basePadding;
  return Math.max(basePadding, keyboardHeight + gap);
}

/** Single-open accordion transition. Tapping the open drawer closes it; tapping
 *  a different one switches (isSwitch=true so the caller can sequence the
 *  collapse before the new open). */
export function nextOpenDrawer(
  current: string | null,
  tapped: string,
): { next: string | null; isSwitch: boolean } {
  if (current === tapped) return { next: null, isSwitch: false };
  return { next: tapped, isSwitch: current !== null };
}

/** Safety clamp for the 75%-of-screen drawer cap. */
export function clampDrawerHeight(
  measured: number,
  maxHeight?: number,
): number {
  if (maxHeight != null && measured > maxHeight) return maxHeight;
  return measured;
}

/** "high-protein" -> "High Protein" for carousel display. */
export function formatTermLabel(term: string): string {
  return term
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export type TrendingState = {
  isLoading: boolean;
  isError: boolean;
  terms: string[] | undefined;
};

export type TrendingResolved =
  | { kind: "loading" }
  | { kind: "terms"; terms: string[] }
  | { kind: "fallback"; terms: string[] };

/** Collapses the four query states into render branches: skeleton while the
 *  first load is in flight, else live terms when present, else curated
 *  fallback (covers both empty and error). */
export function resolveTrendingSource(
  state: TrendingState,
  fallback: string[],
): TrendingResolved {
  if (state.isLoading && (!state.terms || state.terms.length === 0)) {
    return { kind: "loading" };
  }
  if (!state.isError && state.terms && state.terms.length > 0) {
    return { kind: "terms", terms: state.terms };
  }
  return { kind: "fallback", terms: fallback };
}
