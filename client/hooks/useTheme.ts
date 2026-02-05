import { useContext, createContext } from "react";
import { useColorScheme } from "react-native";
import { Colors } from "@/constants/theme";

type ThemePreference = "light" | "dark" | "system";

interface ThemeContextType {
  preference: ThemePreference;
  colorScheme: "light" | "dark";
  isDark: boolean;
  setPreference: (pref: ThemePreference) => Promise<void>;
}

// Default context with undefined value - always exists so hooks can be called unconditionally
const DefaultThemeContext = createContext<ThemeContextType | undefined>(
  undefined,
);

// Reference to actual ThemeContext - set by ThemeProvider
let _themeContext: React.Context<ThemeContextType | undefined> =
  DefaultThemeContext;

export function registerThemeContext(
  ctx: React.Context<ThemeContextType | undefined>,
) {
  _themeContext = ctx;
}

export function useTheme() {
  const systemColorScheme = useColorScheme();

  // Always call useContext unconditionally (rules of hooks)
  const themeCtx = useContext(_themeContext);

  // Use context value if available, otherwise fall back to system
  const resolvedColorScheme: "light" | "dark" =
    themeCtx?.colorScheme ?? systemColorScheme ?? "light";

  const isDark = resolvedColorScheme === "dark";
  const theme = Colors[resolvedColorScheme];

  return {
    theme,
    isDark,
    colorScheme: resolvedColorScheme,
  };
}
