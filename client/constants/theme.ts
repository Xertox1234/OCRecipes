import { Platform } from "react-native";

export const Colors = {
  light: {
    // Text - from Figma light mode
    text: "#212832",
    textSecondary: "#878787",
    buttonText: "#FFFFFF",
    // Navigation
    tabIconDefault: "#6B6B6B",
    tabIconSelected: "#9372F1",
    // Links - purple accent
    link: "#9372F1",
    linkPressed: "#6B42DE",
    // Backgrounds - from Figma light mode
    backgroundRoot: "#FFFFFF",
    backgroundDefault: "#FFFFFF",
    backgroundSecondary: "#F2F2F2",
    backgroundTertiary: "#E8E8E8",
    // Border
    border: "#E0E0E0",
    // Status colors (unchanged)
    error: "#D32F2F",
    warning: "#F57C00",
    success: "#00C853",
    info: "#2196F3",
    // Nutrition accents (unchanged)
    calorieAccent: "#FF6B35",
    proteinAccent: "#00C853",
    carbsAccent: "#FF6B35",
    fatAccent: "#FFC107",
  },
  dark: {
    // Text - from Figma dark mode
    text: "#FFFFFF",
    textSecondary: "#C4C4C4",
    buttonText: "#FFFFFF",
    // Navigation
    tabIconDefault: "#C4C4C4",
    tabIconSelected: "#9372F1",
    // Links - purple accent
    link: "#9372F1",
    linkPressed: "#6B42DE",
    // Backgrounds - from Figma dark mode (warm navy)
    backgroundRoot: "#212832",
    backgroundDefault: "#212832",
    backgroundSecondary: "#393948",
    backgroundTertiary: "#4A4A5A",
    // Border
    border: "#4A4A5A",
    // Status colors (unchanged)
    error: "#EF5350",
    warning: "#FFB74D",
    success: "#00E676",
    info: "#64B5F6",
    // Nutrition accents (unchanged)
    calorieAccent: "#FF8A65",
    proteinAccent: "#00E676",
    carbsAccent: "#FF8A65",
    fatAccent: "#FFD54F",
  },
};

/** Height of the bottom tab bar (must match MainTabNavigator screenOptions) */
export const TAB_BAR_HEIGHT = Platform.select({ ios: 88, android: 72 }) ?? 88;

/** Size of the floating action button */
export const FAB_SIZE = 56;

/** Extra bottom padding for screens with the FAB (FAB height + margin) */
export const FAB_CLEARANCE = FAB_SIZE + 16; // FAB size + gap

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
  inputHeight: 48,
  buttonHeight: 52,
  shutterButtonSize: 72,
};

export const BorderRadius = {
  // Scale (keep existing for backward compatibility)
  xs: 8,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 30,
  "2xl": 40,
  "3xl": 50,
  full: 9999,
  // Semantic names (from Figma design - use these for new components)
  input: 8,
  button: 8,
  card: 15,
  chip: 28,
  chipFilled: 19,
  tag: 28,
  thumbnail: 10,
  avatar: 9999,
};

// Poppins font family names (loaded in App.tsx)
export const FontFamily = {
  regular: "Poppins_400Regular",
  medium: "Poppins_500Medium",
  semiBold: "Poppins_600SemiBold",
  bold: "Poppins_700Bold",
};

export const Typography = {
  h1: {
    fontFamily: FontFamily.bold,
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700" as const,
  },
  h2: {
    fontFamily: FontFamily.bold,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "700" as const,
  },
  h3: {
    fontFamily: FontFamily.semiBold,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600" as const,
  },
  h4: {
    fontFamily: FontFamily.semiBold,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600" as const,
  },
  body: {
    fontFamily: FontFamily.regular,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400" as const,
  },
  small: {
    fontFamily: FontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400" as const,
  },
  caption: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "400" as const,
  },
  link: {
    fontFamily: FontFamily.regular,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400" as const,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
});

/**
 * Creates a hex color with alpha/opacity value.
 * @param hexColor - A hex color string (e.g., "#FF6B35")
 * @param opacity - Opacity value from 0 to 1
 * @returns Hex color with alpha suffix (e.g., "#FF6B3533")
 */
export function withOpacity(hexColor: string, opacity: number): string {
  const alpha = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hexColor}${alpha}`;
}

export const Shadows = {
  small: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  medium: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  large: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
};
