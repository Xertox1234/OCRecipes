// Pure logic for FocusField — the shared focus look of every text field
// (2px ring + warm fill on the visible field). Extracted so Vitest can cover it
// (see the client/components/*-utils.ts pattern).
import type { TextStyle, ViewStyle } from "react-native";

/** Width of the focus ring drawn over the visible field's edge. */
export const FOCUS_RING_WIDTH = 2;

/**
 * Corner radius of the visible field, so the overlays follow its shape.
 * Takes an already-flattened style (`StyleSheet.flatten(style)`); a missing or
 * non-numeric radius (a percentage) draws square overlays.
 */
export function resolveFieldRadius(style: object): number {
  const radius = (style as { borderRadius?: unknown } | null)?.borderRadius;
  return typeof radius === "number" ? radius : 0;
}

/** Ring colour: an error keeps precedence over the focus colour. */
export function resolveFieldColors(opts: {
  hasError: boolean;
  errorColor: string;
  ringColor: string;
}): { ring: string } {
  return { ring: opts.hasError ? opts.errorColor : opts.ringColor };
}

const BOX_KEYS = new Set([
  "backgroundColor",
  "width",
  "height",
  "minHeight",
  "maxHeight",
  "alignSelf",
  "position",
  "top",
  "left",
  "right",
  "bottom",
]);
const BOX_PREFIXES = ["border", "margin", "flex"];

/**
 * Split one input style into the part that draws the visible box (fill, edge,
 * size, placement — goes on the FocusField container) and the part that styles
 * the text (font, colour, padding — stays on the input).
 */
export function splitFieldStyle(style: object): {
  box: ViewStyle;
  text: TextStyle;
} {
  const box: Record<string, unknown> = {};
  const text: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style ?? {})) {
    const isBox =
      BOX_KEYS.has(key) || BOX_PREFIXES.some((p) => key.startsWith(p));
    (isBox ? box : text)[key] = value;
  }
  return { box: box as ViewStyle, text: text as TextStyle };
}

/**
 * Added to an input's text style once `splitFieldStyle` has moved its box keys
 * to the FocusField: the input grows into a box with a set height and shrinks
 * under a `maxHeight` cap (so a multiline composer still scrolls inside it).
 * The basis stays auto, so an auto-height box still sizes to the text.
 */
export const FIELD_INPUT_FILL: TextStyle = { flexGrow: 1, flexShrink: 1 };
