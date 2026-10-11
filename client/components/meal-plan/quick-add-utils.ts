/**
 * Pure routing logic for Quick Add rows.
 *
 * Personal rows carry a `meal_plan_recipes.id` and can be added to the plan
 * directly. Community rows carry a `community_recipes.id` — a DIFFERENT id
 * space — so they must never be sent to POST /api/meal-plan/items as a
 * `recipeId` (it 404s, or silently adds the user's own unrelated recipe that
 * happens to share the number). They open the recipe detail instead, like
 * RecipeBrowserScreen.handleRecipePress.
 */

export type QuickAddRowSource = "personal" | "community";

export type QuickAddAction =
  | { kind: "add"; recipeId: number }
  | { kind: "view-community"; communityRecipeId: number };

export function resolveQuickAddAction(row: {
  id: number;
  source: QuickAddRowSource;
}): QuickAddAction {
  if (row.source === "community") {
    return { kind: "view-community", communityRecipeId: row.id };
  }
  return { kind: "add", recipeId: row.id };
}

export function quickAddRowAccessibilityLabel(
  row: { title: string; source: QuickAddRowSource },
  cal: string | null,
  mealType: string | null,
): string {
  const calSuffix = cal ? `, ${cal}` : "";
  if (row.source === "community") {
    return `View ${row.title}${calSuffix}`;
  }
  return `Add ${row.title}${calSuffix} to ${mealType}`;
}
