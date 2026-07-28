import { withOpacity } from "@/constants/theme";
import {
  shouldFloatLabel,
  getRestBorderColor,
  resolvePlaceholder,
  resolveInputAccessibilityLabel,
  LABELLED_INPUT_GEOMETRY,
  getFloatedLabelBounds,
  getInputFirstLineBounds,
  getContainerContentHeight,
} from "../text-input-utils";

describe("shouldFloatLabel", () => {
  it("floats while focused even when empty", () => {
    expect(shouldFloatLabel(true, "")).toBe(true);
  });

  it("floats at rest when the input has a value", () => {
    expect(shouldFloatLabel(false, "Less salt")).toBe(true);
  });

  it("rests when unfocused and empty", () => {
    expect(shouldFloatLabel(false, "")).toBe(false);
  });

  it("rests when unfocused and value is undefined (uncontrolled, untouched)", () => {
    expect(shouldFloatLabel(false, undefined)).toBe(false);
  });
});

describe("getRestBorderColor", () => {
  it("keeps the subtle theme border in light mode", () => {
    expect(getRestBorderColor(false, "#E5E0D8", "#B5451C")).toBe("#E5E0D8");
  });

  it("rests on a fully transparent link tint in dark mode so the focus interpolation stays in-hue", () => {
    expect(getRestBorderColor(true, "#3A322C", "#E07050")).toBe(
      withOpacity("#E07050", 0),
    );
  });
});

describe("resolvePlaceholder", () => {
  it("passes the placeholder through when there is no floating label", () => {
    expect(resolvePlaceholder(undefined, "e.g. Less salt", false)).toBe(
      "e.g. Less salt",
    );
  });

  it("suppresses the placeholder while the label is resting in its place", () => {
    expect(resolvePlaceholder("Note title", "e.g. Less salt", false)).toBe(
      undefined,
    );
  });

  it("reveals the placeholder once the label has floated", () => {
    expect(resolvePlaceholder("Note title", "e.g. Less salt", true)).toBe(
      "e.g. Less salt",
    );
  });
});

describe("labelled input geometry", () => {
  const g = LABELLED_INPUT_GEOMETRY;

  it("fills the container's content box exactly, so the text line never drifts", () => {
    expect(g.inputPaddingTop + g.inputLineHeight + g.inputPaddingBottom).toBe(
      getContainerContentHeight(g),
    );
  });

  it("rests the label exactly on the first text line, so it reads as the placeholder", () => {
    const line = getInputFirstLineBounds(g);
    expect(g.labelRestTop).toBe(line.top);
    expect(g.labelRestTop + g.labelLineHeight).toBe(line.bottom);
  });

  it("floats the label clear of the first text line — the overlap this geometry exists to prevent", () => {
    const floated = getFloatedLabelBounds(g);
    const line = getInputFirstLineBounds(g);
    expect(floated.bottom).toBeLessThan(line.top);
    expect(line.top - floated.bottom).toBeGreaterThanOrEqual(2);
  });

  it("keeps the floated label inside the container's content box", () => {
    const floated = getFloatedLabelBounds(g);
    expect(floated.top).toBeGreaterThanOrEqual(0);
    expect(floated.bottom).toBeLessThanOrEqual(getContainerContentHeight(g));
  });

  it("travels upward and shrinks", () => {
    expect(g.labelFloatTranslateY).toBeLessThan(0);
    expect(g.labelFloatScale).toBeLessThan(1);
    expect(getFloatedLabelBounds(g).top).toBeLessThan(g.labelRestTop);
  });

  it("accounts for center-origin scaling — transformOrigin only pins the horizontal axis", () => {
    const floated = getFloatedLabelBounds(g);
    const boxTop = g.labelRestTop + g.labelFloatTranslateY;
    // The visible top sits BELOW the transformed box top, because the label
    // shrinks toward its own middle rather than its top edge.
    expect(floated.top).toBeGreaterThan(boxTop);
    expect(floated.bottom - floated.top).toBeCloseTo(
      g.labelLineHeight * g.labelFloatScale,
      5,
    );
  });
});

describe("resolveInputAccessibilityLabel", () => {
  it("prefers an explicit accessibilityLabel", () => {
    expect(resolveInputAccessibilityLabel("Custom", "Note title")).toBe(
      "Custom",
    );
  });

  it("falls back to the visible label", () => {
    expect(resolveInputAccessibilityLabel(undefined, "Note title")).toBe(
      "Note title",
    );
  });

  it("returns undefined when neither is provided", () => {
    expect(resolveInputAccessibilityLabel(undefined, undefined)).toBe(
      undefined,
    );
  });
});
