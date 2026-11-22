import { describe, it, expect } from "vitest";
import { buttonBoxStyle } from "../button-utils";
import { Spacing, Typography } from "@/constants/theme";

// A fixed 52pt height clipped the label at the iOS accessibility text sizes
// ("Update pantry" showed only the middle of its letters, sim check
// 2026-11-22). The box now grows with its label and 52 is the minimum.
describe("buttonBoxStyle", () => {
  it("has no fixed height, so the box can grow with its label", () => {
    expect("height" in buttonBoxStyle).toBe(false);
  });

  it("keeps 52pt as the minimum", () => {
    expect(buttonBoxStyle.minHeight).toBe(Spacing.buttonHeight);
  });

  it("has vertical padding, so a grown label does not touch the edges", () => {
    expect(buttonBoxStyle.paddingVertical).toBeGreaterThan(0);
  });

  // No layout change at the default text size: a one-line label and a label
  // that wraps to two lines both still fit inside the 52pt minimum.
  it.each([1, 2])(
    "a %i-line label at the default size still makes a 52pt button",
    (lines) => {
      const content =
        lines * Typography.body.lineHeight + 2 * buttonBoxStyle.paddingVertical;
      expect(Math.max(buttonBoxStyle.minHeight, content)).toBe(
        Spacing.buttonHeight,
      );
    },
  );

  it("a label at the largest accessibility size makes a taller button", () => {
    const largest = 3.1; // iOS accessibility-extra-extra-extra-large
    const content =
      Typography.body.lineHeight * largest + 2 * buttonBoxStyle.paddingVertical;
    expect(content).toBeGreaterThan(Spacing.buttonHeight);
  });
});
