import {
  coachBlockSchema,
  mealPlanCardSchema,
  type CoachBlock,
  type MealPlanDay,
} from "@shared/schemas/coach-blocks";
import { ApiError } from "@/lib/api-error";
import {
  MEAL_LABELS,
  type MealType,
} from "@/screens/meal-plan/meal-plan-utils";

/**
 * Validates and parses raw plan data from a block action into typed MealPlanDay[].
 * Returns undefined if the data is missing or fails Zod validation.
 */
export function parsePlanDays(raw: unknown): MealPlanDay[] | undefined {
  const parsed = mealPlanCardSchema.shape.days.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Builds an accessibility label for the AI meal plan banner.
 */
export function planBannerA11yLabel(days: MealPlanDay[]): string {
  const totalMeals = days.reduce((sum, d) => sum + d.meals.length, 0);
  const dayWord = days.length === 1 ? "day" : "days";
  const mealWord = totalMeals === 1 ? "meal" : "meals";
  return `AI meal plan with ${days.length} ${dayWord} and ${totalMeals} ${mealWord}`;
}

/**
 * Strips the coach_blocks fence from accumulated XHR streaming text.
 * When a response is mid-stream, the closing ``` may not have arrived yet,
 * so this handles that case by stripping from the open fence to end-of-string.
 */
export function stripCoachBlocksFence(accumulated: string): string {
  const openIdx = accumulated.indexOf("```coach_blocks\n");
  if (openIdx === -1) return accumulated.trim();
  const closeIdx = accumulated.indexOf("```", openIdx + 16);
  if (closeIdx === -1) return accumulated.slice(0, openIdx).trim();
  // Remove the fence block: take text before open fence and text after close fence.
  // If after-text starts with \n, skip it to avoid double newline.
  let after = accumulated.slice(closeIdx + 3);
  if (after.startsWith("\n")) after = after.slice(1);
  return (accumulated.slice(0, openIdx) + after).trim();
}

/**
 * Filters an unknown array through coachBlockSchema, returning only valid blocks.
 */
export function filterValidBlocks(raw: unknown[]): CoachBlock[] {
  const valid: CoachBlock[] = [];
  for (const b of raw) {
    const result = coachBlockSchema.safeParse(b);
    if (result.success) valid.push(result.data);
  }
  return valid;
}

export interface PlanSaveFailure {
  /** User-facing toast copy for this failure. */
  message: string;
  /**
   * Whether a retry of the SAME confirm could plausibly succeed. `false` for
   * a failure the server will reproduce identically on every retry — the
   * sheet should close instead of inviting a retry that can only fail again.
   */
  terminal: boolean;
}

const GENERIC_PLAN_SAVE_FAILURE: PlanSaveFailure = {
  message: "Couldn't add the recipe to your plan. Please try again.",
  terminal: false,
};

/**
 * Classifies a `saveCatalogRecipe`/`addMealPlanItem` rejection from
 * `handleConfirmPlanSlot`. `apiRequest`'s `throwIfResNotOk` (`client/lib/
 * query-client.ts`) throws an `ApiError` carrying the response's numeric
 * `status`, so the three terminal statuses `POST /api/meal-plan/catalog/:id/
 * save` can return (`server/routes/recipe-catalog.ts`) are read straight off
 * it — no new error-taxonomy layer needed:
 *  - 402 `CatalogQuotaError` — the day's Spoonacular quota is spent.
 *  - 422 — the catalog recipe has no instructions or ingredients.
 *  - 404 — the catalog id (possibly LLM-hallucinated) doesn't resolve.
 * All three reproduce identically on retry, so they're terminal. Anything
 * else (network blip, 5xx, `addMealPlanItem`'s own transient failures) falls
 * through to the existing generic retry copy.
 */
export function describePlanSaveFailure(error: unknown): PlanSaveFailure {
  if (error instanceof ApiError) {
    if (error.status === 402) {
      return {
        message:
          "You've reached today's online recipe search limit. Try saving this recipe again tomorrow.",
        terminal: true,
      };
    }
    if (error.status === 422) {
      return {
        message:
          "This recipe doesn't have enough detail to save. Try a different one.",
        terminal: true,
      };
    }
    if (error.status === 404) {
      return {
        message: "This recipe is no longer available. Try a different one.",
        terminal: true,
      };
    }
  }
  return GENERIC_PLAN_SAVE_FAILURE;
}

/**
 * Success toast copy for "Add to Plan", naming the chosen day and meal so a
 * mis-filed slot (e.g. the timezone bug `plan-slot-picker-utils.ts` guards
 * against) is visible in the confirmation itself, not just on the Plan tab.
 *
 * Takes `dayLabel` as a plain string (the tapped chip's own `weekday`, e.g.
 * "Wednesday") rather than the `plannedDate` ISO string — do NOT change this
 * to re-derive the day by parsing `plannedDate`. `plannedDate` is a
 * UTC-string conversion of a local-midnight instant (see `PlanSlotDay.iso`'s
 * doc-comment in `plan-slot-picker-utils.ts`); re-parsing it back into a
 * weekday lands on the wrong day for any UTC-positive offset, which would
 * make this toast contradict the very chip the user just tapped.
 */
export function formatPlanSaveSuccess(
  dayLabel: string,
  mealType: MealType,
): string {
  return `Added to ${dayLabel} ${MEAL_LABELS[mealType]}`;
}
