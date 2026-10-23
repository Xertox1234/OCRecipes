// Pure logic for TextInput's animated focus border and floating label,
// extracted so Vitest can cover it (see client/components/*-utils.ts pattern).
import { withOpacity } from "@/constants/theme";

/** Label floats when the field has focus or content. */
export function shouldFloatLabel(
  isFocused: boolean,
  value: string | undefined,
): boolean {
  return isFocused || (value?.length ?? 0) > 0;
}

/**
 * Rest-state border color for the focus interpolation. Light mode keeps the
 * subtle theme border; dark mode rests on a fully transparent link tint so the
 * focus transition stays in-hue instead of fading through gray.
 */
export function getRestBorderColor(
  isDark: boolean,
  themeBorder: string,
  themeLink: string,
): string {
  return isDark ? withOpacity(themeLink, 0) : themeBorder;
}

/**
 * With a floating label the placeholder only appears once the label has
 * floated out of its way; without a label it passes through untouched.
 */
export function resolvePlaceholder(
  label: string | undefined,
  placeholder: string | undefined,
  floated: boolean,
): string | undefined {
  if (!label) return placeholder;
  return floated ? placeholder : undefined;
}

/**
 * Focus border for a drop-in input that keeps the caller's own look.
 *
 * A style that already draws a border animates THAT border's colour toward the
 * focus colour. A borderless style (a chat composer, an inline numeric field)
 * gets a 1px border resting fully transparent, so focus still answers back
 * without the caller restyling anything — the only cost is 1px of inset.
 */
export function resolveFocusBorder(
  flat: { borderWidth?: number; borderColor?: unknown },
  focusColor: string,
  fallbackRestColor?: string,
): { borderWidth: number; restColor: string; focusColor: string } {
  const bordered = (flat.borderWidth ?? 0) > 0;
  const own =
    typeof flat.borderColor === "string" ? flat.borderColor : undefined;
  return {
    borderWidth: bordered ? (flat.borderWidth as number) : 1,
    restColor: bordered
      ? (own ?? fallbackRestColor ?? withOpacity(focusColor, 0))
      : withOpacity(focusColor, 0),
    focusColor,
  };
}

type Side = "Top" | "Right" | "Bottom" | "Left";
const SIDES: Side[] = ["Top", "Right", "Bottom", "Left"];

/** A side's value: specific side, then axis shorthand, then all-sides shorthand. */
function sideValue(
  flat: Record<string, unknown>,
  prop: "padding" | "margin",
  side: Side,
): unknown {
  const axis = side === "Top" || side === "Bottom" ? "Vertical" : "Horizontal";
  return flat[`${prop}${side}`] ?? flat[`${prop}${axis}`] ?? flat[prop];
}

/**
 * Style overrides that cancel the 1px border `resolveFocusBorder` adds to a
 * borderless style, so focusing a field never changes its size.
 *
 * Per side: padding of 1 or more gives the pixel back (the border sits inside
 * the box, so padding - 1 + border = the old inset). A side with no padding
 * gets a -1 margin instead, which leaves the layout footprint unchanged and
 * lets the ring draw just outside it. A style that already draws a border
 * grows by nothing, and a non-numeric value (a percentage) is left alone.
 */
export function compensateSyntheticBorder(
  flat: object,
): Record<string, number> {
  const style = flat as Record<string, unknown>;
  if (((style.borderWidth as number | undefined) ?? 0) > 0) return {};
  const out: Record<string, number> = {};
  for (const side of SIDES) {
    const padding = sideValue(style, "padding", side) ?? 0;
    const margin = sideValue(style, "margin", side) ?? 0;
    if (typeof padding !== "number") continue;
    if (padding >= 1) {
      out[`padding${side}`] = padding - 1;
    } else if (typeof margin === "number") {
      out[`margin${side}`] = margin - 1;
    }
  }
  return out;
}

/** The visible label doubles as the input's accessible name unless overridden. */
export function resolveInputAccessibilityLabel(
  explicit: string | undefined,
  label: string | undefined,
): string | undefined {
  return explicit ?? label;
}

/**
 * Vertical geometry for a field carrying a floating label.
 *
 * A labelled field stacks two rows — the floated label and the value — so it
 * needs more height than the plain `Spacing.inputHeight` field and an explicit
 * `lineHeight` for the value text. Without the explicit line height the
 * arithmetic below depends on whatever the platform picks, which is what let
 * the label and the value overlap.
 *
 * All values are in container CONTENT coordinates (inside the border box).
 */
export interface LabelledInputGeometry {
  /** Minimum outer height of the bordered container, borders included. */
  containerMinHeight: number;
  /** Border width — inside the box, so it costs content height twice. */
  borderWidth: number;
  /** Space above the value text, reserved for the floated label. */
  inputPaddingTop: number;
  /** Space below the value text. */
  inputPaddingBottom: number;
  /** Explicit line height of the value text. */
  inputLineHeight: number;
  /** Line height of the label at rest (before it scales down). */
  labelLineHeight: number;
  /** Resting `top` of the absolutely-positioned label. */
  labelRestTop: number;
  /** `translateY` applied once the label floats. */
  labelFloatTranslateY: number;
  /** Scale applied once the label floats. */
  labelFloatScale: number;
}

export const LABELLED_INPUT_GEOMETRY: LabelledInputGeometry = {
  containerMinHeight: 56,
  borderWidth: 1,
  inputPaddingTop: 26,
  inputPaddingBottom: 10,
  inputLineHeight: 18,
  labelLineHeight: 18,
  labelRestTop: 26,
  labelFloatTranslateY: -19,
  labelFloatScale: 0.85,
};

/** Height inside the container's borders at its minimum size. */
export function getContainerContentHeight(g: LabelledInputGeometry): number {
  return g.containerMinHeight - g.borderWidth * 2;
}

/** Vertical bounds of the value text's first line. */
export function getInputFirstLineBounds(g: LabelledInputGeometry): {
  top: number;
  bottom: number;
} {
  return {
    top: g.inputPaddingTop,
    bottom: g.inputPaddingTop + g.inputLineHeight,
  };
}

/**
 * Visible bounds of the floated label.
 *
 * `transformOrigin: "left"` pins only the HORIZONTAL axis — the vertical origin
 * stays at the center, so a scaled label shrinks toward its own middle and its
 * visible top lands below the transformed box top. Ignoring that inset is what
 * makes a hand-computed travel distance land short.
 */
export function getFloatedLabelBounds(g: LabelledInputGeometry): {
  top: number;
  bottom: number;
} {
  const boxTop = g.labelRestTop + g.labelFloatTranslateY;
  const scaledHeight = g.labelLineHeight * g.labelFloatScale;
  const centerInset = (g.labelLineHeight - scaledHeight) / 2;
  return {
    top: boxTop + centerInset,
    bottom: boxTop + centerInset + scaledHeight,
  };
}
