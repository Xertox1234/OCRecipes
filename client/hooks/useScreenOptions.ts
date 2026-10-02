import { Platform } from "react-native";
import { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { isLiquidGlassAvailable } from "expo-glass-effect";

import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";

interface UseScreenOptionsParams {
  transparent?: boolean;
}

export function useScreenOptions({
  transparent = true,
}: UseScreenOptionsParams = {}): NativeStackNavigationOptions {
  const { theme, isDark } = useTheme();
  const { reducedMotion } = useAccessibility();

  return {
    headerTitleAlign: "center",
    // A function `headerTitle` (most Plan, Coach and Profile screens) or none
    // (header-hidden screens) leaves native-stack using the route NAME as the
    // screen's `title`, and iOS copies that into the back button of the screen
    // pushed on top (visible label, VoiceOver label, history menu). A fixed
    // title overrides all three. Not `minimal` display mode: it leaves the
    // VoiceOver label raw (measured on the iOS 26 simulator).
    headerBackTitle: "Back",
    headerTransparent: transparent,
    headerBlurEffect: isDark ? "dark" : "light",
    headerTintColor: theme.text,
    headerStyle: {
      backgroundColor: Platform.select({
        ios: undefined,
        android: theme.backgroundRoot,
        web: theme.backgroundRoot,
      }),
    },
    gestureEnabled: true,
    gestureDirection: "horizontal",
    fullScreenGestureEnabled: isLiquidGlassAvailable() ? false : true,
    contentStyle: {
      backgroundColor: theme.backgroundRoot,
    },
    // Fall back to no animation when reduced motion is preferred
    ...(reducedMotion ? { animation: "none" } : {}),
  };
}
