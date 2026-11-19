import { useCallback, useState } from "react";
import * as Haptics from "expo-haptics";

import { useAddMealPlanItem } from "@/hooks/useMealPlan";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import {
  suggestionToPlanItem,
  type MealType,
} from "@/components/meal-plan/meal-plan-utils";
import { formatPlanAddSuccess } from "@/components/meal-plan/plan-add-copy";
import type { MealSuggestion } from "@shared/types/meal-suggestions";

interface UsePlanSuggestFlowOptions {
  /** The day a chosen suggestion is added to (YYYY-MM-DD, local). */
  dateStr: string;
  initialMealType: MealType;
  /** The plan includes AI meal suggestions; otherwise a tap upsells. */
  canSuggest: boolean;
}

/**
 * "Suggest a meal" on a meal-plan screen: a tap opens the suggestions modal
 * for that meal (or the upgrade modal when the plan lacks the feature), and a
 * chosen suggestion is added to `dateStr` in one server call. The upgrade
 * modal's setter is returned too, for a screen's other upsells.
 */
export function usePlanSuggestFlow({
  dateStr,
  initialMealType,
  canSuggest,
}: UsePlanSuggestFlowOptions) {
  const haptics = useHaptics();
  const toast = useToast();
  const { mutateAsync: addMealPlanItem } = useAddMealPlanItem();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [suggestModalVisible, setSuggestModalVisible] = useState(false);
  const [suggestMealType, setSuggestMealType] =
    useState<MealType>(initialMealType);

  const handleSuggest = useCallback(
    (mealType: MealType) => {
      if (!canSuggest) {
        haptics.notification(Haptics.NotificationFeedbackType.Warning);
        setShowUpgradeModal(true);
        return;
      }
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setSuggestMealType(mealType);
      setSuggestModalVisible(true);
    },
    [canSuggest, haptics],
  );

  const handleSelectSuggestion = useCallback(
    async (suggestion: MealSuggestion) => {
      try {
        // One server call: the recipe and its plan item are created in a
        // single transaction, so a failure leaves nothing behind.
        await addMealPlanItem(
          suggestionToPlanItem(suggestion, dateStr, suggestMealType),
        );
        // The modal closes, so confirm with a toast (fires its own Success).
        toast.success(formatPlanAddSuccess(dateStr, suggestMealType));
        setSuggestModalVisible(false);
      } catch {
        toast.error(
          "Couldn't add the suggestion to your plan. Please try again.",
        );
      }
    },
    [addMealPlanItem, dateStr, suggestMealType, toast],
  );

  const closeSuggest = useCallback(() => setSuggestModalVisible(false), []);

  return {
    suggestModalVisible,
    suggestMealType,
    handleSuggest,
    handleSelectSuggestion,
    closeSuggest,
    showUpgradeModal,
    setShowUpgradeModal,
  };
}
