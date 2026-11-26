import { GOALS_QUERY_KEY } from "@/hooks/useCalorieGoal";
import { QUERY_KEYS } from "@/lib/query-keys";
import type { WriteCardKind } from "@shared/schemas/coach-write-cards";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

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
      // A plan card can also copy a community recipe into the user's own,
      // changes the day's planned calories, and can add its meals' shopping
      // to a list.
      return [
        ["/api/meal-plan"],
        ["/api/meal-plan/recipes"],
        ["/api/recipes/browse"],
        QUERY_KEYS.dailyBudget,
        GROCERY_LISTS,
      ];
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

/**
 * Coach roadmap T2: a reply's blocks can carry a food log the Coach already
 * applied (no Save tap ran its refresh). The queries to refresh when such a
 * reply arrives; none otherwise.
 */
export function arrivedSavedRefreshKeys(
  blocks: readonly CoachBlock[],
): readonly (readonly string[])[] {
  const logged = blocks.some(
    (b) => b.type === "write_card" && b.loggedAtOnce && b.status === "saved",
  );
  return logged ? writeCardRefreshKeys("food") : [];
}
