import { describe, it, expect } from "vitest";

import { Colors } from "@/constants/theme";
import { getBackgroundColorForElevation, getBadgeColors } from "../card-utils";

/** WCAG relative luminance contrast ratio of two #RRGGBB colors. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Minimal theme stubs matching the ThemeColors interface
const lightTheme = {
  backgroundRoot: "#FAF6F0",
  backgroundDefault: "#FAF6F0",
  backgroundSecondary: "#EEE6DA",
  backgroundTertiary: "#E2D7CA",
  surface: "#FFFFFF",
  success: "#007A30",
  warning: "#F57C00",
  error: "#D32F2F",
  info: "#2196F3",
  link: "#B5451C",
};

describe("card-utils", () => {
  describe("getBackgroundColorForElevation", () => {
    it("returns the surface token for elevation 1", () => {
      expect(getBackgroundColorForElevation(1, lightTheme)).toBe("#FFFFFF");
    });

    it.each(["light", "dark"] as const)(
      "elevation-1 card is visibly distinct from backgroundRoot in the %s theme",
      (mode) => {
        const theme = Colors[mode];
        expect(getBackgroundColorForElevation(1, theme)).not.toBe(
          theme.backgroundRoot,
        );
      },
    );

    it.each(["light", "dark"] as const)(
      "text and textSecondary clear 4.5:1 on the elevation-1 surface in the %s theme",
      (mode) => {
        const theme = Colors[mode];
        const bg = getBackgroundColorForElevation(1, theme);
        expect(contrast(theme.text, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
      },
    );

    it("returns backgroundSecondary for elevation 2", () => {
      expect(getBackgroundColorForElevation(2, lightTheme)).toBe("#EEE6DA");
    });

    it("returns backgroundTertiary for elevation 3", () => {
      expect(getBackgroundColorForElevation(3, lightTheme)).toBe("#E2D7CA");
    });

    it("falls back to backgroundRoot for unknown elevation", () => {
      expect(getBackgroundColorForElevation(0, lightTheme)).toBe("#FAF6F0");
      expect(getBackgroundColorForElevation(99, lightTheme)).toBe("#FAF6F0");
    });
  });

  describe("getBadgeColors", () => {
    it("returns success colors for success variant", () => {
      const result = getBadgeColors("success", lightTheme);
      expect(result.text).toBe("#007A30");
      expect(result.bg).toContain("007A30"); // withOpacity wraps the color
    });

    it("returns warning colors for warning variant", () => {
      const result = getBadgeColors("warning", lightTheme);
      expect(result.text).toBe("#F57C00");
    });

    it("returns error colors for error variant", () => {
      const result = getBadgeColors("error", lightTheme);
      expect(result.text).toBe("#D32F2F");
    });

    it("returns info colors for info variant", () => {
      const result = getBadgeColors("info", lightTheme);
      expect(result.text).toBe("#2196F3");
    });

    it("returns link colors for default variant", () => {
      const result = getBadgeColors("default", lightTheme);
      expect(result.text).toBe("#B5451C");
    });
  });
});
