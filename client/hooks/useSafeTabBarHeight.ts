import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

/**
 * Safe wrapper around useBottomTabBarHeight that returns 0 when the screen
 * is rendered outside of a Bottom Tab Navigator (e.g., as a root modal).
 */
export function useSafeTabBarHeight(): number {
  try {
    return useBottomTabBarHeight();
  } catch {
    return 0;
  }
}
