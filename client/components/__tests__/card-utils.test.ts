import { describe, it, expect } from "vitest";

import { getBackgroundColorForElevation, getBadgeColors } from "../card-utils";

// Minimal theme stubs matching the ThemeColors interface
const lightTheme = {
  backgroundRoot: "#FFFFFF",
  backgroundDefault: "#FFFFFF",
  backgroundSecondary: "#F2F2F2",
  backgroundTertiary: "#E8E8E8",
  success: "#00C853",
  warning: "#F57C00",
  error: "#D32F2F",
  info: "#2196F3",
  link: "#9372F1",
};

describe("card-utils", () => {
  describe("getBackgroundColorForElevation", () => {
    it("returns backgroundDefault for elevation 1", () => {
      expect(getBackgroundColorForElevation(1, lightTheme)).toBe("#FFFFFF");
    });

    it("returns backgroundSecondary for elevation 2", () => {
      expect(getBackgroundColorForElevation(2, lightTheme)).toBe("#F2F2F2");
    });

    it("returns backgroundTertiary for elevation 3", () => {
      expect(getBackgroundColorForElevation(3, lightTheme)).toBe("#E8E8E8");
    });

    it("falls back to backgroundRoot for unknown elevation", () => {
      expect(getBackgroundColorForElevation(0, lightTheme)).toBe("#FFFFFF");
      expect(getBackgroundColorForElevation(99, lightTheme)).toBe("#FFFFFF");
    });
  });

  describe("getBadgeColors", () => {
    it("returns success colors for success variant", () => {
      const result = getBadgeColors("success", lightTheme);
      expect(result.text).toBe("#00C853");
      expect(result.bg).toContain("00C853"); // withOpacity wraps the color
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
      expect(result.text).toBe("#9372F1");
    });
  });
});
