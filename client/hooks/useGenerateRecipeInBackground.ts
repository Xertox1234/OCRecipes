import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import { tokenStorage } from "@/lib/token-storage";
import { useToast } from "@/context/ToastContext";
import { useHaptics } from "@/hooks/useHaptics";
import { ErrorCode } from "@shared/constants/error-codes";
import type { CommunityRecipe } from "@shared/schema";
import {
  isPendingGeneration,
  noteGeneratedRecipeReady,
  setPendingGeneration,
} from "./useGeneratedRecipeNotices";

export interface GenerateRecipeInput {
  productName: string;
  barcode?: string | null;
  servings: number;
  dietPreferences: string[];
  timeConstraint?: string;
  shareToPublic: boolean;
}

/** The server's own heavy-model timeout is 60 s; past it nothing is coming. */
export const RECIPE_GENERATION_DEADLINE_MS = 60_000;

export const SOFT_FAILURE_COPY =
  "Couldn't confirm the recipe — check Saved items";

/**
 * Run `run` with an AbortSignal that fires after `ms`. `AbortController` +
 * `setTimeout` rather than `AbortSignal.timeout`, which Hermes lacks.
 */
export async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number = RECIPE_GENERATION_DEADLINE_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Static, user-safe copy for a rejected generation. Never the raw
 * `ApiError.message` — that is the server body with a status prefix (see
 * docs/rules/client-state.md); branch on `.code` like `importErrorCopy`.
 */
export function generationErrorCopy(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case ErrorCode.DAILY_LIMIT_REACHED:
        return "Daily recipe generation limit reached";
      case ErrorCode.PREMIUM_REQUIRED:
        return "Recipe generation is a premium feature.";
      case ErrorCode.RATE_LIMITED:
        return "Too many requests. Please wait a moment and try again.";
    }
  }
  return "Couldn't generate the recipe";
}

/** A 4xx is the server declining; anything else leaves the outcome unknown. */
export function isClientRejection(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    typeof err.status === "number" &&
    err.status >= 400 &&
    err.status < 500
  );
}

function invalidateSavedItems(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["/api/saved-items"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/saved-items/count"] });
}

/**
 * True when the session that submitted (`token`) is still the one signed in.
 * An unreadable token counts as "not the same": stay quiet rather than risk
 * a mark, a toast or a haptic for someone else (same guard as useChat.ts).
 */
export async function isSameSession(token: string | null): Promise<boolean> {
  try {
    return (await tokenStorage.get()) === token;
  } catch {
    return false;
  }
}

/**
 * Generate a recipe from the photo-analysis sheet WITHOUT holding the sheet
 * open. `start` returns at once; the request runs to completion on its own
 * (the closure outlives the sheet's unmount), then:
 *
 *  - success → Saved items refetch, unread mark + "recipe ready" event (toast
 *    and Profile dot via the bridge in MainTabNavigator), success haptic;
 *  - 4xx (limit, premium, validation) → error toast with static copy, nothing
 *    saved, nothing to refetch;
 *  - anything else (5xx, network, 60 s deadline) → the server may well have
 *    saved the recipe before the reply was lost, so Saved items refetch and
 *    the toast says to look there.
 *
 * One generation at a time for this entry point (owner ruling 2026-10-17):
 * `start` is a no-op while "photo" is pending. Spec:
 * docs/superpowers/specs/2026-10-17-recipe-generate-argon-background-completion-design.md
 */
export function useGenerateRecipeInBackground(): {
  start: (input: GenerateRecipeInput) => void;
} {
  const queryClient = useQueryClient();
  const toast = useToast();
  const haptics = useHaptics();

  const start = useCallback(
    (input: GenerateRecipeInput) => {
      if (isPendingGeneration(queryClient, "photo")) return;
      setPendingGeneration(queryClient, "photo", true);

      void (async () => {
        let token: string | null = null;
        try {
          token = await tokenStorage.get();
          const res = await withDeadline((signal) =>
            apiRequest(
              "POST",
              "/api/recipes/generate",
              input,
              { signal },
              token,
            ),
          );
          const recipe = (await res.json()) as CommunityRecipe;
          if (!(await isSameSession(token))) return;
          invalidateSavedItems(queryClient);
          noteGeneratedRecipeReady(queryClient, recipe.id);
          haptics.notification(Haptics.NotificationFeedbackType.Success);
        } catch (err) {
          if (!(await isSameSession(token))) return;
          if (isClientRejection(err)) {
            toast.error(generationErrorCopy(err));
            return;
          }
          invalidateSavedItems(queryClient);
          toast.error(SOFT_FAILURE_COPY);
        } finally {
          setPendingGeneration(queryClient, "photo", false);
        }
      })();
    },
    [queryClient, toast, haptics],
  );

  return { start };
}
