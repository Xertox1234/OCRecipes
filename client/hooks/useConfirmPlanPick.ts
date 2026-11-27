import { useCallback } from "react";
import { Alert } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { ALLERGENS_NOT_CHECKED } from "@/components/meal-plan/family-utils";
import {
  UNCHECKED_MEAL,
  getPickWarning,
  pickClashPrompt,
  pickNeedsCheck,
  pickedFromRecipe,
  type PickedMeal,
} from "@/components/meal-plan/pick-allergen-utils";
import { usePlanFamily } from "@/hooks/useFamily";
import { useHaptics } from "@/hooks/useHaptics";
import { mealPlanRecipeDetailQueryOptions } from "@/hooks/useMealPlanRecipes";
import {
  peekPendingAudience,
  type PlanAudienceChoice,
  type PlanSlot,
} from "@/lib/plan-audience";

export interface PlanPickRequest {
  slot: PlanSlot;
  /** A saved recipe to read, or what is already known about the meal. */
  meal: { recipeId: number } | PickedMeal;
  /** Who it is for; left out, the add menu's choice for the slot, else the user. */
  audience?: PlanAudienceChoice;
}

export interface PlanPickResult {
  /** False when the user cancelled at the clash warning: do not add. */
  proceed: boolean;
  /** "Allergens not checked" for the success toast, or null. */
  note: string | null;
}

const GO: PlanPickResult = { proceed: true, note: null };
const SELF: PlanAudienceChoice = { audience: "self", familyProfileId: null };

/** A native alert: VoiceOver and TalkBack announce it and move focus to it. */
function confirmClash(lines: string[]): Promise<boolean> {
  const p = pickClashPrompt(lines);
  return new Promise((resolve) => {
    Alert.alert(
      p.title,
      p.message,
      [
        { text: p.cancel, style: "cancel", onPress: () => resolve(false) },
        { text: p.confirm, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * The allergen check every path that adds a meal to the plan runs first
 * (owner decision 2026-11-20): a clash with whoever the meal is for asks
 * "Add anyway?"; a meal that cannot be checked goes ahead with a note. Off
 * while family planning is off, like every other family control.
 */
export function useConfirmPlanPick(): (
  req: PlanPickRequest,
) => Promise<PlanPickResult> {
  const family = usePlanFamily();
  const queryClient = useQueryClient();
  const { notification } = useHaptics();

  return useCallback(
    async (req) => {
      if (!family) return GO;
      const choice = req.audience ?? peekPendingAudience(req.slot) ?? SELF;
      if (!pickNeedsCheck(choice, family)) return GO;

      let meal: PickedMeal;
      if ("recipeId" in req.meal) {
        try {
          meal = pickedFromRecipe(
            await queryClient.fetchQuery({
              ...mealPlanRecipeDetailQueryOptions(req.meal.recipeId),
              staleTime: 60_000,
            }),
          );
        } catch {
          // Unread is unknown, never safe.
          meal = UNCHECKED_MEAL;
        }
      } else {
        meal = req.meal;
      }

      const warning = getPickWarning(meal, choice, family);
      if (!warning) return GO;
      if (warning.kind === "unchecked") {
        return { proceed: true, note: ALLERGENS_NOT_CHECKED };
      }
      notification(Haptics.NotificationFeedbackType.Warning);
      return { proceed: await confirmClash(warning.lines), note: null };
    },
    [family, queryClient, notification],
  );
}
