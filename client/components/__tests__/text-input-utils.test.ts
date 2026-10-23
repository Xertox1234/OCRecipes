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
  resolveFocusBorder,
  compensateSyntheticBorder,
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

describe("resolveFocusBorder", () => {
  it("keeps an existing border width and rests on its own colour", () => {
    expect(
      resolveFocusBorder({ borderWidth: 2, borderColor: "#112233" }, "#AA0000"),
    ).toEqual({
      borderWidth: 2,
      restColor: "#112233",
      focusColor: "#AA0000",
    });
  });

  it("falls back to the supplied rest colour when a bordered style names none", () => {
    expect(
      resolveFocusBorder({ borderWidth: 1 }, "#AA0000", "#CCCCCC"),
    ).toEqual({ borderWidth: 1, restColor: "#CCCCCC", focusColor: "#AA0000" });
  });

  it("adds a 1px border that rests fully transparent when the style has none", () => {
    expect(resolveFocusBorder({}, "#AA0000")).toEqual({
      borderWidth: 1,
      restColor: withOpacity("#AA0000", 0),
      focusColor: "#AA0000",
    });
  });

  it("treats a zero border width as borderless", () => {
    expect(resolveFocusBorder({ borderWidth: 0 }, "#AA0000").borderWidth).toBe(
      1,
    );
  });

  it("ignores a non-string border colour", () => {
    expect(
      resolveFocusBorder(
        { borderWidth: 1, borderColor: 5 as unknown as string },
        "#AA0000",
        "#CCCCCC",
      ).restColor,
    ).toBe("#CCCCCC");
  });
});

describe("compensateSyntheticBorder", () => {
  it("returns nothing when the style already draws a border", () => {
    expect(
      compensateSyntheticBorder({ borderWidth: 1, paddingVertical: 8 }),
    ).toEqual({});
  });

  it("takes 1px back from every side's padding so the box keeps its size", () => {
    expect(compensateSyntheticBorder({ padding: 8 })).toEqual({
      paddingTop: 7,
      paddingBottom: 7,
      paddingLeft: 7,
      paddingRight: 7,
    });
  });

  it("lets a specific side beat the axis shorthand beat the all-sides shorthand", () => {
    expect(
      compensateSyntheticBorder({
        padding: 10,
        paddingVertical: 8,
        paddingTop: 4,
        paddingHorizontal: 12,
      }),
    ).toEqual({
      paddingTop: 3,
      paddingBottom: 7,
      paddingLeft: 11,
      paddingRight: 11,
    });
  });

  it("uses a -1 margin on a side that has no padding to give back", () => {
    expect(compensateSyntheticBorder({ padding: 0, minWidth: 24 })).toEqual({
      marginTop: -1,
      marginBottom: -1,
      marginLeft: -1,
      marginRight: -1,
    });
  });

  it("adds the -1 to the caller's own margin on that side", () => {
    expect(
      compensateSyntheticBorder({ paddingHorizontal: 4, marginVertical: 6 }),
    ).toEqual({
      marginTop: 5,
      marginBottom: 5,
      paddingLeft: 3,
      paddingRight: 3,
    });
  });

  it("leaves a side alone when its padding or margin is not a plain number", () => {
    const out = compensateSyntheticBorder({
      paddingTop: "5%" as unknown as number,
      paddingBottom: 6,
      paddingHorizontal: 6,
    });
    expect(out.paddingTop).toBeUndefined();
    expect(out.marginTop).toBeUndefined();
    expect(out.paddingBottom).toBe(5);
  });
});
