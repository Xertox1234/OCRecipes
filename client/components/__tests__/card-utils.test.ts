import { describe, it, expect } from "vitest";

import { getBackgroundColorForElevation, getBadgeColors } from "../card-utils";

// Minimal theme stubs matching the ThemeColors interface
const lightTheme = {
  backgroundRoot: "#FAF6F0",
  backgroundDefault: "#FAF6F0",
  backgroundSecondary: "#EEE6DA",
  backgroundTertiary: "#E2D7CA",
  success: "#007A30",
  warning: "#F57C00",
  error: "#D32F2F",
  info: "#2196F3",
  link: "#B5451C",
};

describe("card-utils", () => {
  describe("getBackgroundColorForElevation", () => {
    it("returns backgroundDefault for elevation 1", () => {
      expect(getBackgroundColorForElevation(1, lightTheme)).toBe("#FAF6F0");
    });

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
