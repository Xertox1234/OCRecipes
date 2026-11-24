import { GOALS_QUERY_KEY } from "@/hooks/useCalorieGoal";
import { QUERY_KEYS } from "@/lib/query-keys";
import type { WriteCardKind } from "@shared/schemas/coach-write-cards";

const GROCERY_LISTS = ["/api/meal-plan/grocery-lists"] as const;

/**
 * The queries the rest of the app reads a Coach write card's data from, per
 * card kind: a save or an undo in the chat invalidates them so the Plan tab,
 * grocery lists, pantry and the day's totals show the change without a manual
 * refresh. Each key is a prefix: `["/api/meal-plan"]` matches every dated plan
 * query, and not `["/api/meal-plan/recipes"]`, whose first element differs.
 */
export function writeCardRefreshKeys(
  kind: WriteCardKind | undefined,
): readonly (readonly string[])[] {
  switch (kind) {
    case "food":
      return [
        QUERY_KEYS.scannedItems,
        QUERY_KEYS.dailySummary,
        QUERY_KEYS.dailyBudget,
      ];
    case "grocery":
      return [GROCERY_LISTS];
    case "plan":
      // A plan card can also add its meals' shopping to a list.
      return [["/api/meal-plan"], GROCERY_LISTS];
    case "pantry":
      return [["/api/pantry"], ["/api/pantry/expiring"]];
    case "goals":
      // The same three GoalSetupScreen refreshes after its own save.
      return [GOALS_QUERY_KEY, QUERY_KEYS.dailySummary, QUERY_KEYS.dailyBudget];
    case "allergy":
      return [QUERY_KEYS.dietaryProfile];
    default:
      return [];
  }
}
