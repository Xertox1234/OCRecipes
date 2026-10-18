import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { apiRequest } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { useToast } from "@/context/ToastContext";
import { useHaptics } from "@/hooks/useHaptics";
import type { ImportedRecipeData } from "@shared/types/recipe-import";
import {
  generationErrorCopy,
  isClientRejection,
  sessionMatch,
  withDeadline,
  type SessionMatch,
} from "./useGenerateRecipeInBackground";
import {
  isPendingGeneration,
  noteRecipeDraftReady,
  setPendingGeneration,
  type HeldRecipeDraft,
} from "./useGeneratedRecipeNotices";

type ReturnToMealPlan = NonNullable<HeldRecipeDraft["returnToMealPlan"]>;

interface DraftDeps {
  queryClient: QueryClient;
  toast: Pick<ReturnType<typeof useToast>, "error">;
  haptics: Pick<ReturnType<typeof useHaptics>, "notification">;
}

/**
 * The request itself, as a plain module function (React Compiler cannot lower
 * the try/catch/finally; see useGenerateRecipeInBackground). The caller has
 * already flagged "mealPlan" as pending.
 *
 * Unlike the photo sheet, this route returns an UNSAVED draft (spec §5b): on
 * success the draft is held on the device and the toast offers "Review"; on
 * ANY failure nothing exists server-side, so the copy is a plain error — never
 * "check Saved items".
 */
export async function runDraftGeneration(
  { queryClient, toast, haptics }: DraftDeps,
  prompt: string,
  returnToMealPlan: ReturnToMealPlan | undefined,
): Promise<void> {
  let token: string | null = null;
  let session: SessionMatch = "unknown";
  try {
    token = await tokenStorage.get();
    const res = await withDeadline((signal) =>
      apiRequest(
        "POST",
        "/api/meal-plan/recipes/generate",
        { prompt },
        { signal },
        token,
      ),
    );
    const prefill = (await res.json()) as ImportedRecipeData;
    session = await sessionMatch(token);
    if (session !== "same") return;
    noteRecipeDraftReady(queryClient, { prefill, returnToMealPlan });
    haptics.notification(Haptics.NotificationFeedbackType.Success);
  } catch (err) {
    session = await sessionMatch(token);
    if (session !== "same") return;
    toast.error(
      isClientRejection(err)
        ? generationErrorCopy(err)
        : "Couldn't generate the recipe",
    );
  } finally {
    if (session !== "different") {
      setPendingGeneration(queryClient, "mealPlan", false);
    }
  }
}

/**
 * Generate a meal-plan recipe draft WITHOUT holding the screen: `start`
 * returns at once and the screen goes back to the plan; the draft arrives as
 * a toast ("Recipe draft ready — tap to review") and, if the toast is missed,
 * as a banner on the generate screen. One at a time for this entry point
 * (owner ruling 2026-10-17); independent of the photo sheet's flag.
 */
export function useRecipeGenerate(): {
  start: (prompt: string, returnToMealPlan?: ReturnToMealPlan) => void;
} {
  const queryClient = useQueryClient();
  const toast = useToast();
  const haptics = useHaptics();

  const start = useCallback(
    (prompt: string, returnToMealPlan?: ReturnToMealPlan) => {
      if (isPendingGeneration(queryClient, "mealPlan")) return;
      setPendingGeneration(queryClient, "mealPlan", true);
      void runDraftGeneration(
        { queryClient, toast, haptics },
        prompt,
        returnToMealPlan,
      );
    },
    [queryClient, toast, haptics],
  );

  return { start };
}
