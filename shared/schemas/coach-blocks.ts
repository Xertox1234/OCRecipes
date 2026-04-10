// shared/schemas/coach-blocks.ts
import { z } from "zod";

// ── Action types for cards ──────────────────────────────────────────

const logFoodActionSchema = z.object({
  type: z.literal("log_food"),
  description: z.string(),
  calories: z.number(),
  protein: z.number(),
  fat: z.number(),
  carbs: z.number(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  servings: z.number().optional(),
});

const navigateActionSchema = z.object({
  type: z.literal("navigate"),
  screen: z.string(),
  params: z.record(z.unknown()).optional(),
});

const setGoalActionSchema = z.object({
  type: z.literal("set_goal"),
  goalType: z.string(),
  value: z.number().optional(),
});

const blockActionSchema = z.discriminatedUnion("type", [
  logFoodActionSchema,
  navigateActionSchema,
  setGoalActionSchema,
]);

// ── Block schemas ───────────────────────────────────────────────────

export const actionCardSchema = z.object({
  type: z.literal("action_card"),
  title: z.string(),
  subtitle: z.string(),
  action: blockActionSchema,
  actionLabel: z.string(),
});

export const suggestionListSchema = z.object({
  type: z.literal("suggestion_list"),
  items: z.array(
    z.object({
      title: z.string(),
      subtitle: z.string(),
      action: z.union([navigateActionSchema, z.null()]).nullable(),
    }),
  ),
});

export const inlineChartSchema = z.object({
  type: z.literal("inline_chart"),
  chartType: z.enum(["bar", "progress", "stat_row"]),
  title: z.string(),
  data: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
      target: z.number().optional(),
      hit: z.boolean().optional(),
    }),
  ),
  summary: z.string().optional(),
});

export const commitmentCardSchema = z.object({
  type: z.literal("commitment_card"),
  title: z.string(),
  followUpText: z.string(),
  followUpDate: z.string(),
});

export const quickRepliesSchema = z.object({
  type: z.literal("quick_replies"),
  options: z.array(
    z.object({
      label: z.string(),
      message: z.string(),
    }),
  ),
});

export const recipeCardSchema = z.object({
  type: z.literal("recipe_card"),
  recipe: z.object({
    title: z.string(),
    calories: z.number(),
    protein: z.number(),
    prepTime: z.string(),
    imageUrl: z.string().nullable(),
    recipeId: z.number(),
    source: z.enum(["community", "spoonacular", "generated"]),
  }),
});

export const mealPlanCardSchema = z.object({
  type: z.literal("meal_plan_card"),
  title: z.string(),
  days: z.array(
    z.object({
      label: z.string(),
      meals: z.array(
        z.object({
          type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
          title: z.string(),
          calories: z.number(),
          protein: z.number(),
        }),
      ),
      totals: z.object({
        calories: z.number(),
        protein: z.number(),
      }),
    }),
  ),
});

// ── Discriminated union of all blocks ───────────────────────────────

export const coachBlockSchema = z.discriminatedUnion("type", [
  actionCardSchema,
  suggestionListSchema,
  inlineChartSchema,
  commitmentCardSchema,
  quickRepliesSchema,
  recipeCardSchema,
  mealPlanCardSchema,
]);

export type CoachBlock = z.infer<typeof coachBlockSchema>;
export type ActionCard = z.infer<typeof actionCardSchema>;
export type SuggestionList = z.infer<typeof suggestionListSchema>;
export type InlineChart = z.infer<typeof inlineChartSchema>;
export type CommitmentCard = z.infer<typeof commitmentCardSchema>;
export type QuickReplies = z.infer<typeof quickRepliesSchema>;
export type RecipeCard = z.infer<typeof recipeCardSchema>;
export type MealPlanCard = z.infer<typeof mealPlanCardSchema>;
export type BlockAction = z.infer<typeof blockActionSchema>;
export type LogFoodAction = z.infer<typeof logFoodActionSchema>;
export type NavigateAction = z.infer<typeof navigateActionSchema>;
