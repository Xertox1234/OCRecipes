import { describe, it, expect } from "vitest";
import {
  AbsoluteFill,
  TAB_BAR_HEIGHT,
  tabBarHeight,
  withOpacity,
  Colors,
} from "../theme";
import { contrastRatio as contrast } from "../../../test/utils/wcag-contrast";

describe("withOpacity", () => {
  it("appends correct alpha for full opacity", () => {
    expect(withOpacity("#FF6B35", 1)).toBe("#FF6B35ff");
  });

  it("appends correct alpha for zero opacity", () => {
    expect(withOpacity("#FF6B35", 0)).toBe("#FF6B3500");
  });

  it("appends correct alpha for 50% opacity", () => {
    // 0.5 * 255 = 127.5, rounded to 128 = 0x80
    expect(withOpacity("#FF6B35", 0.5)).toBe("#FF6B3580");
  });

  it("appends correct alpha for ~12% opacity", () => {
    // 0.12 * 255 = 30.6, rounded to 31 = 0x1f
    expect(withOpacity("#FFFFFF", 0.12)).toBe("#FFFFFF1f");
  });

  it("pads single-digit hex values with zero", () => {
    // 0.02 * 255 = 5.1, rounded to 5 = 0x05
    expect(withOpacity("#000000", 0.02)).toBe("#00000005");
  });

  it("works with short hex colors", () => {
    expect(withOpacity("#FFF", 1)).toBe("#FFFff");
  });
});

describe("AbsoluteFill", () => {
  it("AbsoluteFill pins the element to all four edges", () => {
    expect(AbsoluteFill).toEqual({
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});

// Android is edge-to-edge, and React Navigation puts the bottom inset INSIDE
// the bar's fixed height as padding — the bar must grow by it or the labels
// sit under the 3-button navigation bar. iOS's 88 already includes it.
describe("tabBarHeight", () => {
  it("adds the bottom inset on Android", () => {
    expect(tabBarHeight(48, "android")).toBe(TAB_BAR_HEIGHT + 48);
  });

  it("keeps the fixed height on iOS", () => {
    expect(tabBarHeight(34, "ios")).toBe(TAB_BAR_HEIGHT);
  });
});

// Accessibility audit 2026-11-21 H1: dark-mode `success` (#4CAF7D) and
// `error` (#F16360) are TEXT colours (light enough to read on dark); as fills
// under white content they measure 2.71:1 and 3.14:1. Fills use *Solid.
describe("solid fill tokens under white content", () => {
  it.each(["light", "dark"] as const)(
    "%s successSolid and errorSolid reach 4.5:1 under buttonText",
    (mode) => {
      const t = Colors[mode];
      expect(contrast(t.successSolid, t.buttonText)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(t.errorSolid, t.buttonText)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

// Accessibility audit 2026-11-21 M11: secondary text sits on
// backgroundSecondary cards (weekly-report settings, notebook, opening brief);
// #6B6B6B measured 4.31:1 there.
describe("secondary text on secondary surfaces", () => {
  it.each(["light", "dark"] as const)(
    "%s textSecondary reaches 4.5:1 on backgroundSecondary",
    (mode) => {
      const t = Colors[mode];
      expect(
        contrast(t.textSecondary, t.backgroundSecondary),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});
