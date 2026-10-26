import { describe, it, expect } from "vitest";

import { Colors, withOpacity } from "@/constants/theme";
import {
  contrastRatio,
  compositeOver,
} from "../../../test/utils/wcag-contrast";
import {
  FOCUS_RING_WIDTH,
  labelFieldText,
  resolveFieldColors,
  resolveFieldRadius,
  splitFieldStyle,
} from "../field-focus-utils";

describe("FOCUS_RING_WIDTH", () => {
  it("is a 2px ring", () => {
    expect(FOCUS_RING_WIDTH).toBe(2);
  });
});

describe("resolveFieldRadius", () => {
  it("returns the flattened style's borderRadius", () => {
    expect(resolveFieldRadius({ borderRadius: 8 })).toBe(8);
  });

  it("returns 0 when the style has no borderRadius", () => {
    expect(resolveFieldRadius({})).toBe(0);
  });

  it("returns 0 for a non-numeric borderRadius", () => {
    expect(resolveFieldRadius({ borderRadius: "50%" })).toBe(0);
  });
});

describe("resolveFieldColors", () => {
  it("uses the error colour for the ring when the field has an error", () => {
    expect(
      resolveFieldColors({ hasError: true, errorColor: "E", ringColor: "R" })
        .ring,
    ).toBe("E");
  });

  it("uses the ring colour when there is no error", () => {
    expect(
      resolveFieldColors({ hasError: false, errorColor: "E", ringColor: "R" })
        .ring,
    ).toBe("R");
  });
});

describe("splitFieldStyle", () => {
  it("puts the visible box's keys on the box and the rest on the text", () => {
    const { box, text } = splitFieldStyle({
      backgroundColor: "x",
      borderRadius: 8,
      color: "y",
      fontSize: 14,
      paddingHorizontal: 12,
      flex: 1,
    });
    expect(box).toEqual({ backgroundColor: "x", borderRadius: 8, flex: 1 });
    expect(text).toEqual({ color: "y", fontSize: 14, paddingHorizontal: 12 });
  });

  it("sends border*, margin*, flex*, size and position keys to the box", () => {
    const { box, text } = splitFieldStyle({
      borderWidth: 1,
      borderColor: "c",
      borderTopLeftRadius: 4,
      marginTop: 2,
      marginHorizontal: 3,
      width: 100,
      height: 40,
      minHeight: 40,
      maxHeight: 120,
      flexGrow: 1,
      flexBasis: 0,
      alignSelf: "stretch",
      position: "absolute",
      top: 1,
      left: 2,
      right: 3,
      bottom: 4,
      lineHeight: 18,
    });
    expect(Object.keys(box).sort()).toEqual(
      [
        "borderWidth",
        "borderColor",
        "borderTopLeftRadius",
        "marginTop",
        "marginHorizontal",
        "width",
        "height",
        "minHeight",
        "maxHeight",
        "flexGrow",
        "flexBasis",
        "alignSelf",
        "position",
        "top",
        "left",
        "right",
        "bottom",
      ].sort(),
    );
    expect(text).toEqual({ lineHeight: 18 });
  });
});

describe("focus tokens", () => {
  it.each(["light", "dark"] as const)(
    "%s focusRing is the link colour",
    (mode) => {
      expect(Colors[mode].focusRing).toBe(Colors[mode].link);
    },
  );

  it.each(["light", "dark"] as const)(
    "%s focusFill is the link colour at 12%% opacity",
    (mode) => {
      expect(Colors[mode].focusFill).toBe(withOpacity(Colors[mode].link, 0.12));
    },
  );

  // The warm fill sits over the field's own rest fill. Text must stay
  // readable on the result for every base the fill is laid on.
  it.each([
    ["light", "backgroundSecondary"],
    ["light", "backgroundDefault"],
    ["dark", "backgroundSecondary"],
    ["dark", "backgroundDefault"],
  ] as const)(
    "%s text over focusFill on %s is at least 4.5:1",
    (mode, base) => {
      const palette = Colors[mode];
      const fill = palette.focusFill;
      const opacity = parseInt(fill.slice(7, 9), 16) / 255;
      const composited = compositeOver(
        fill.slice(0, 7),
        opacity,
        palette[base],
      );
      expect(contrastRatio(palette.text, composited)).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );
});

describe("labelFieldText", () => {
  it("drops the value under the floated label, over the caller's own padding", () => {
    const { text } = labelFieldText({
      fontSize: 15,
      padding: 12,
      paddingVertical: 8,
      lineHeight: 20,
    });
    expect(text).toMatchObject({
      fontSize: 15,
      padding: 12,
      paddingTop: 26,
      paddingBottom: 10,
      lineHeight: 18,
    });
  });

  it("lines the label up with the text's left padding", () => {
    expect(labelFieldText({ paddingLeft: 10 }).labelLeft).toBe(10);
    expect(labelFieldText({ paddingHorizontal: 12 }).labelLeft).toBe(12);
    expect(labelFieldText({ padding: 14 }).labelLeft).toBe(14);
    expect(
      labelFieldText({ paddingLeft: 4, paddingHorizontal: 12 }).labelLeft,
    ).toBe(4);
  });

  it("puts the label at the field's edge when the text has no numeric left padding", () => {
    expect(labelFieldText({}).labelLeft).toBe(0);
    expect(labelFieldText({ paddingLeft: "5%" }).labelLeft).toBe(0);
  });
});
