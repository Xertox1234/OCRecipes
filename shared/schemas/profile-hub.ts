import { z } from "zod";

// ---------------------------------------------------------------------------
// Widget data (calorie budget)
// ---------------------------------------------------------------------------

const dailyBudgetSchema = z.object({
  calorieGoal: z.number(),
  foodCalories: z.number(),
  remaining: z.number(),
});

export const profileWidgetsSchema = z.object({
  dailyBudget: dailyBudgetSchema,
});

export type ProfileWidgetsResponse = z.infer<typeof profileWidgetsSchema>;

// ---------------------------------------------------------------------------
// Library counts (cookbook, saved items, scan history, etc.)
// ---------------------------------------------------------------------------

export const libraryCountsSchema = z.object({
  cookbooks: z.number(),
  savedItems: z.number(),
  scanHistory: z.number(),
  groceryLists: z.number(),
  pantryItems: z.number(),
  featuredRecipes: z.number(),
  favouriteRecipes: z.number(),
});

export type LibraryCountsResponse = z.infer<typeof libraryCountsSchema>;
