/**
 * WCAG 2.x relative-luminance contrast helpers.
 *
 * Deterministic, pure, no rendering — used to assert real contrast ratios for
 * color pairs (e.g. a badge's text color over its actual composited fill)
 * instead of relying on eyeballing hex values or an external checker.
 *
 * See docs/solutions/conventions/wcag-color-contrast-2026-05-13.md and
 * docs/solutions/best-practices/recheck-wcag-after-background-color-change-2026-05-12.md
 * for the project convention this formalizes.
 */

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    // Fail loudly rather than silently returning NaN channels (which would
    // propagate a NaN ratio into an opaque `expected NaN to be >= 4.5`).
    throw new Error(
      `hexToRgb expects a 6-digit hex color (e.g. "#1a2b3c"), got "${hex}"`,
    );
  }
  return [0, 2, 4].map((i) => parseInt(h.substring(i, i + 2), 16)) as RGB;
}

function rgbToHex([r, g, b]: RGB): string {
  return (
    "#" +
    [r, g, b]
      .map((c) =>
        Math.max(0, Math.min(255, Math.round(c)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function srgbChannelToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(srgbChannelToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors (1:1 to 21:1). */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Alpha-composites `fillHex` at `opacity` (0-1) over `bgHex` (source-over,
 * both fully opaque inputs) — models what a `withOpacity(color, opacity)`
 * backgroundColor actually renders as once composited over the page/surface
 * behind it.
 */
export function compositeOver(
  fillHex: string,
  opacity: number,
  bgHex: string,
): string {
  const fill = hexToRgb(fillHex);
  const bg = hexToRgb(bgHex);
  const blended = fill.map(
    (c, i) => opacity * c + (1 - opacity) * bg[i],
  ) as RGB;
  return rgbToHex(blended);
}
