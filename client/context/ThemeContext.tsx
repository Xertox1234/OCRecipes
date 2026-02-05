import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useColorScheme as useSystemColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { registerThemeContext } from "@/hooks/useTheme";

export type ThemePreference = "light" | "dark" | "system";

interface ThemeContextType {
  /** User's theme preference */
  preference: ThemePreference;
  /** Resolved color scheme (light or dark) */
  colorScheme: "light" | "dark";
  /** Whether the resolved theme is dark */
  isDark: boolean;
  /** Set the theme preference */
  setPreference: (pref: ThemePreference) => Promise<void>;
}

const THEME_STORAGE_KEY = "@nutriscan/theme-preference";

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Register context with useTheme hook for backward compatibility
registerThemeContext(ThemeContext);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useSystemColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preference from storage on mount
  useEffect(() => {
    async function loadPreference() {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored === "light" || stored === "dark" || stored === "system") {
          setPreferenceState(stored);
        }
      } catch {
        // Ignore storage errors, use default
      } finally {
        setIsLoaded(true);
      }
    }
    loadPreference();
  }, []);

  const setPreference = useCallback(async (pref: ThemePreference) => {
    setPreferenceState(pref);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Resolve the actual color scheme
  const colorScheme = useMemo(() => {
    if (preference === "system") {
      return systemColorScheme ?? "light";
    }
    return preference;
  }, [preference, systemColorScheme]);

  const isDark = colorScheme === "dark";

  const value = useMemo(
    () => ({
      preference,
      colorScheme,
      isDark,
      setPreference,
    }),
    [preference, colorScheme, isDark, setPreference],
  );

  // Don't render until preference is loaded to avoid flash
  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useThemePreference() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useThemePreference must be used within a ThemeProvider");
  }
  return context;
}
