import { describe, it, expect } from "vitest";
import {
  glideToTopOffset,
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
