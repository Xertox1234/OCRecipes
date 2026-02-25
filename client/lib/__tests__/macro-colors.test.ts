import { getMacroColor, getMacroColors, type MacroType } from "../macro-colors";

// Define theme colors inline to avoid importing react-native via theme.ts
const lightThemeColors = {
  calorieAccent: "#FF6B35",
  proteinAccent: "#00C853",
  carbsAccent: "#FF6B35",
  fatAccent: "#FFC107",
} as any;

const darkThemeColors = {
  calorieAccent: "#FF8A65",
  proteinAccent: "#00E676",
  carbsAccent: "#FF8A65",
  fatAccent: "#FFD54F",
} as any;

describe("Macro Colors", () => {
  const lightTheme = lightThemeColors;
  const darkTheme = darkThemeColors;

  describe("getMacroColor", () => {
    it("returns calorie accent for light theme", () => {
      expect(getMacroColor(lightTheme, "calories")).toBe("#FF6B35");
    });

    it("returns protein accent for light theme", () => {
      expect(getMacroColor(lightTheme, "protein")).toBe("#00C853");
    });

    it("returns carbs accent for light theme", () => {
      expect(getMacroColor(lightTheme, "carbs")).toBe("#FF6B35");
    });

    it("returns fat accent for light theme", () => {
      expect(getMacroColor(lightTheme, "fat")).toBe("#FFC107");
    });

    it("returns calorie accent for dark theme", () => {
      expect(getMacroColor(darkTheme, "calories")).toBe("#FF8A65");
    });

    it("returns protein accent for dark theme", () => {
      expect(getMacroColor(darkTheme, "protein")).toBe("#00E676");
    });

    it("returns carbs accent for dark theme", () => {
      expect(getMacroColor(darkTheme, "carbs")).toBe("#FF8A65");
    });

    it("returns fat accent for dark theme", () => {
      expect(getMacroColor(darkTheme, "fat")).toBe("#FFD54F");
    });
  });

  describe("getMacroColors", () => {
    it("returns all macro colors for light theme", () => {
      const colors = getMacroColors(lightTheme);
      expect(colors.calories).toBe("#FF6B35");
      expect(colors.protein).toBe("#00C853");
      expect(colors.carbs).toBe("#FF6B35");
      expect(colors.fat).toBe("#FFC107");
    });

    it("returns all macro colors for dark theme", () => {
      const colors = getMacroColors(darkTheme);
      expect(colors.calories).toBe("#FF8A65");
      expect(colors.protein).toBe("#00E676");
      expect(colors.carbs).toBe("#FF8A65");
      expect(colors.fat).toBe("#FFD54F");
    });

    it("returns all four macro types", () => {
      const colors = getMacroColors(lightTheme);
      const macroTypes: MacroType[] = ["calories", "protein", "carbs", "fat"];
      for (const macro of macroTypes) {
        expect(colors[macro]).toBeDefined();
        expect(typeof colors[macro]).toBe("string");
      }
    });
  });
});
