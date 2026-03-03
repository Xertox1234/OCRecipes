import { describe, it, expect } from "vitest";
import { getToastColors, getToastAccessibilityRole } from "../toast-utils";
import { Colors } from "@/constants/theme";

describe("getToastColors", () => {
  const lightTheme = Colors.light;
  const darkTheme = Colors.dark;

  it("returns success colors with check-circle icon", () => {
    const result = getToastColors("success", lightTheme);
    expect(result.background).toBe(lightTheme.success);
    expect(result.icon).toBe("check-circle");
    expect(result.text).toBe("#FFFFFF");
  });

  it("returns error colors with alert-circle icon", () => {
    const result = getToastColors("error", lightTheme);
    expect(result.background).toBe(lightTheme.error);
    expect(result.icon).toBe("alert-circle");
  });

  it("returns info colors with info icon", () => {
    const result = getToastColors("info", darkTheme);
    expect(result.background).toBe(darkTheme.info);
    expect(result.icon).toBe("info");
  });
});

describe("getToastAccessibilityRole", () => {
  it("returns alert for error variant", () => {
    expect(getToastAccessibilityRole("error")).toBe("alert");
  });

  it("returns none for success variant", () => {
    expect(getToastAccessibilityRole("success")).toBe("none");
  });

  it("returns none for info variant", () => {
    expect(getToastAccessibilityRole("info")).toBe("none");
  });
});
