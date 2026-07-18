import { withOpacity } from "@/constants/theme";
import {
  shouldFloatLabel,
  getRestBorderColor,
  resolvePlaceholder,
  resolveInputAccessibilityLabel,
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
