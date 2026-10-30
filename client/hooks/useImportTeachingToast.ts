import { useCallback } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useToast } from "@/context/ToastContext";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { claimTipSlot, releaseTipSlot } from "@/hooks/useFeatureTip";
import {
  hasSeenTip,
  hasUsedFeature,
  markTipSeen,
} from "@/lib/feature-tips-storage";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

/**
 * Returns a callback for after someone saves a recipe they built by hand:
 * suggests importing next time, once — only when their plan includes import,
 * they haven't imported yet, and no other tip is on screen.
 */
export function useImportTeachingToast(): () => void {
  const toast = useToast();
  const navigation =
    useNavigation<NativeStackNavigationProp<MealPlanStackParamList>>();
  const canImport = usePremiumFeature("urlImport");

  return useCallback(() => {
    if (!canImport) return;
    if (hasUsedFeature("import") || hasSeenTip("toast-import")) return;
    if (!claimTipSlot("toast-import")) return;
    void markTipSeen("toast-import");
    toast.info("Next time, import it from a link or photo", {
      action: {
        label: "Import",
        onPress: () => navigation.navigate("RecipeImport"),
      },
    });
    releaseTipSlot("toast-import");
  }, [canImport, navigation, toast]);
}
