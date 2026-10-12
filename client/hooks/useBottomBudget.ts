import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getBottomBudget } from "@/components/bottom-budget-utils";
import { useSafeTabBarHeight } from "@/hooks/useSafeTabBarHeight";

/**
 * Bottom space a screen must reserve: the full floating tab bar height inside
 * a tab stack, the safe-area inset anywhere else (root modals). Use this
 * instead of `insets.bottom` for any screen that can sit in a tab stack.
 */
export function useBottomBudget(): number {
  const insets = useSafeAreaInsets();
  return getBottomBudget(useSafeTabBarHeight(), insets.bottom);
}
