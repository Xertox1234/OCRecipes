import { useCallback } from "react";
import { Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { usePlanFamily, type PlanFamily } from "@/hooks/useFamily";
import { dietaryProfileQueryOptions } from "@/hooks/useDietaryProfile";
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
const UNCHECKED: PlanPickResult = {
  proceed: true,
  note: ALLERGENS_NOT_CHECKED,
};
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
 * "Add anyway?"; a meal that cannot be checked goes ahead with a note. With
 * family planning off it checks the user's own allergies.
 */
export function useConfirmPlanPick(): (
  req: PlanPickRequest,
) => Promise<PlanPickResult> {
  const family = usePlanFamily();
  // Without family planning the user's own allergies still count. Undefined
  // while loading or failed: unknown, never "no allergies"; null is no profile.
  const { data: dietaryProfile } = useQuery(dietaryProfileQueryOptions);
  const queryClient = useQueryClient();
  const { notification } = useHaptics();

  return useCallback(
    async (req) => {
      let eaters: PlanFamily;
      let choice: PlanAudienceChoice;
      if (family) {
        eaters = family;
        choice = req.audience ?? peekPendingAudience(req.slot) ?? SELF;
      } else {
        // No family: the meal is the user's own, whatever a stale choice says.
        if (dietaryProfile === undefined) return UNCHECKED;
        eaters = {
          profiles: [],
          userAllergies: dietaryProfile?.allergies ?? [],
        };
        choice = SELF;
      }
      if (!pickNeedsCheck(choice, eaters)) return GO;

      let meal: PickedMeal;
      if ("recipeId" in req.meal) {
        try {
          meal = pickedFromRecipe(
            await queryClient.fetchQuery({
              ...mealPlanRecipeDetailQueryOptions(req.meal.recipeId),
              staleTime: 60_000,
              // Offline, fail at once (and say "not checked") instead of
              // pausing until the network returns with the add stuck.
              networkMode: "always",
            }),
          );
        } catch {
          // Unread is unknown, never safe.
          meal = UNCHECKED_MEAL;
        }
      } else {
        meal = req.meal;
      }

      const warning = getPickWarning(meal, choice, eaters);
      if (!warning) return GO;
      if (warning.kind === "unchecked") return UNCHECKED;
      notification(Haptics.NotificationFeedbackType.Warning);
      return { proceed: await confirmClash(warning.lines), note: null };
    },
    [family, dietaryProfile, queryClient, notification],
  );
}
