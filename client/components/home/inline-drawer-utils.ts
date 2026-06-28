/** Target scroll offset so the row's current on-screen top lands just below the
 *  collapsed summary bar. `rowPageY` comes from a Reanimated measure() (already
 *  reflects the collapsing-header delta); `collapsedBarHeight` = insets.top +
 *  HOME_HEADER_COLLAPSED. Clamped to >= 0.
 *
 *  MUST stay a worklet: HomeScreen.glideRowToTop calls this inside a runOnUI
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
