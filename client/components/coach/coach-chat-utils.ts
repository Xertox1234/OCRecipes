import {
  coachBlockSchema,
  mealPlanCardSchema,
  type CoachBlock,
  type MealPlanDay,
} from "@shared/schemas/coach-blocks";

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
