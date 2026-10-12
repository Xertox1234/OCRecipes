import { describe, it, expect } from "vitest";

import {
  getBottomBudget,
  getInputBarBottomPadding,
} from "../bottom-budget-utils";

describe("getBottomBudget", () => {
  it("reserves the floating tab bar height inside a tab stack, not just the home-indicator inset", () => {
    // iPhone: tab bar 88pt, home-indicator inset 34pt. The bar floats over
    // content, so the screen must clear all 88pt.
    expect(getBottomBudget(88, 34)).toBe(88);
  });

  it("falls back to the safe-area inset outside a tab navigator (tab bar height 0)", () => {
    expect(getBottomBudget(0, 34)).toBe(34);
  });

  it("is 0 when neither is present", () => {
    expect(getBottomBudget(0, 0)).toBe(0);
  });
});

describe("getInputBarBottomPadding", () => {
  it("sits on the tab bar when the keyboard is down", () => {
    expect(
      getInputBarBottomPadding({
        keyboardVisible: false,
        tabBarHeight: 88,
        insetBottom: 34,
        restingGap: 8,
      }),
    ).toBe(88);
  });

  it("sits directly on the keyboard (resting gap only) when the keyboard is up", () => {
    expect(
      getInputBarBottomPadding({
        keyboardVisible: true,
        tabBarHeight: 88,
        insetBottom: 34,
        restingGap: 8,
      }),
    ).toBe(8);
  });

  it("uses the inset outside a tab stack when the keyboard is down", () => {
    expect(
      getInputBarBottomPadding({
        keyboardVisible: false,
        tabBarHeight: 0,
        insetBottom: 34,
        restingGap: 8,
      }),
    ).toBe(34);
  });
});
