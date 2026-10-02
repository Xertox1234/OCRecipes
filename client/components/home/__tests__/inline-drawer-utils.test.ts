import { describe, it, expect } from "vitest";
import {
  glideToTopOffset,
  scrollBottomPadding,
  nextOpenDrawer,
  clampDrawerHeight,
  formatTermLabel,
  resolveTrendingSource,
} from "../inline-drawer-utils";

describe("glideToTopOffset", () => {
  it("scrolls the row's on-screen top to just below the collapsed bar", () => {
    // row currently 400px down the screen, page already scrolled 100, bar is 90 tall
    expect(glideToTopOffset(100, 400, 90)).toBe(410);
  });
  it("never returns a negative offset", () => {
    expect(glideToTopOffset(0, 10, 90)).toBe(0);
  });
});

describe("scrollBottomPadding", () => {
  // base = tab bar + FAB clearance; 336 is a typical iPhone keyboard; gap 16.
  const BASE = 200;
  const KEYBOARD = 336;
  const GAP = 16;

  it("keeps the base padding when no drawer is open, whatever the keyboard height", () => {
    expect(scrollBottomPadding(BASE, KEYBOARD, false, GAP)).toBe(BASE);
  });
  it("keeps the base padding while no keyboard height is known yet", () => {
    expect(scrollBottomPadding(BASE, 0, true, GAP)).toBe(BASE);
  });
  it("reserves the keyboard height plus the gap when a drawer is open and that is taller than the base", () => {
    expect(scrollBottomPadding(BASE, KEYBOARD, true, GAP)).toBe(352);
  });
  it("takes the larger of the two rather than stacking the base on the keyboard (the keyboard covers the tab bar and FAB)", () => {
    expect(scrollBottomPadding(BASE, KEYBOARD, true, GAP)).not.toBe(
      BASE + KEYBOARD + GAP,
    );
  });
  it("never goes below the base for a short keyboard (e.g. a hardware keyboard's suggestion bar)", () => {
    expect(scrollBottomPadding(BASE, 120, true, GAP)).toBe(BASE);
    // exactly at the boundary: keyboard + gap == base
    expect(scrollBottomPadding(BASE, BASE - GAP, true, GAP)).toBe(BASE);
  });
  it("ignores a nonsensical negative keyboard height", () => {
    expect(scrollBottomPadding(BASE, -5, true, GAP)).toBe(BASE);
  });
});

describe("nextOpenDrawer", () => {
  it("opens when nothing is open", () => {
    expect(nextOpenDrawer(null, "search-recipes")).toEqual({
      next: "search-recipes",
      isSwitch: false,
    });
  });
  it("toggles closed when tapping the open one", () => {
    expect(nextOpenDrawer("search-recipes", "search-recipes")).toEqual({
      next: null,
      isSwitch: false,
    });
  });
  it("flags a switch when another is open", () => {
    expect(nextOpenDrawer("search-recipes", "generate-recipe")).toEqual({
      next: "generate-recipe",
      isSwitch: true,
    });
  });
});

describe("clampDrawerHeight", () => {
  it("returns measured when under the cap", () => {
    expect(clampDrawerHeight(300, 600)).toBe(300);
  });
  it("clamps to the cap when over", () => {
    expect(clampDrawerHeight(900, 600)).toBe(600);
  });
  it("returns measured when no cap is given", () => {
    expect(clampDrawerHeight(900, undefined)).toBe(900);
  });
});

describe("formatTermLabel", () => {
  it("title-cases and de-dashes", () => {
    expect(formatTermLabel("high-protein")).toBe("High Protein");
    expect(formatTermLabel("italian")).toBe("Italian");
  });
  it("normalizes mixed case and collapses extra separators", () => {
    expect(formatTermLabel("HIGH-PROTEIN")).toBe("High Protein");
    expect(formatTermLabel("  air   fryer  ")).toBe("Air Fryer");
  });
});

describe("resolveTrendingSource", () => {
  const fallback = ["High Protein", "Air Fryer"];
  it("shows loading only when loading and no terms yet", () => {
    expect(
      resolveTrendingSource(
        { isLoading: true, isError: false, terms: undefined },
        fallback,
      ),
    ).toEqual({ kind: "loading" });
  });
  it("shows live terms when present", () => {
    expect(
      resolveTrendingSource(
        { isLoading: false, isError: false, terms: ["Vegan"] },
        fallback,
      ),
    ).toEqual({ kind: "terms", terms: ["Vegan"] });
  });
  it("falls back when empty", () => {
    expect(
      resolveTrendingSource(
        { isLoading: false, isError: false, terms: [] },
        fallback,
      ),
    ).toEqual({ kind: "fallback", terms: fallback });
  });
  it("falls back on error", () => {
    expect(
      resolveTrendingSource(
        { isLoading: false, isError: true, terms: undefined },
        fallback,
      ),
    ).toEqual({ kind: "fallback", terms: fallback });
  });
  it("shows live terms while re-fetching (stale-while-revalidate)", () => {
    expect(
      resolveTrendingSource(
        { isLoading: true, isError: false, terms: ["Vegan"] },
        fallback,
      ),
    ).toEqual({ kind: "terms", terms: ["Vegan"] });
  });
  it("shows loading on a retry after error when no terms are cached yet", () => {
    expect(
      resolveTrendingSource(
        { isLoading: true, isError: true, terms: undefined },
        fallback,
      ),
    ).toEqual({ kind: "loading" });
  });
});
