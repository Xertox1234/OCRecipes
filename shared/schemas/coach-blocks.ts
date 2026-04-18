// shared/schemas/coach-blocks.ts
import { z } from "zod";
import { mealPlanDaySchema, type MealPlanDay } from "./meal-plan";

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

/** Whitelist of screens the AI coach is allowed to navigate to. */
const NAVIGABLE_SCREENS = [
  "NutritionDetail",
  "FeaturedRecipeDetail",
  "QuickLog",
  "DailyNutritionDetail",
  "Scan",
  "WeightTracking",
  "RecipeChat",
  "RecipeBrowserModal",
  "GroceryListsModal",
  "PantryModal",
  "CookbookListModal",
] as const;

const navigateActionSchema = z.object({
  type: z.literal("navigate"),
  screen: z.enum(NAVIGABLE_SCREENS),
  params: z.record(z.unknown()).optional(),
});

/** Per-screen param schemas for navigate actions requiring specific params. */
const screenParamSchemas: Record<string, z.ZodType<Record<string, unknown>>> = {
  NutritionDetail: z.object({ barcode: z.string() }),
  FeaturedRecipeDetail: z.object({ recipeId: z.number() }),
  RecipeChat: z.object({ conversationId: z.number() }),
};

const GOAL_TYPES = ["calories", "protein", "carbs", "fat", "weight"] as const;

const setGoalActionSchema = z.object({
  type: z.literal("set_goal"),
  goalType: z.enum(GOAL_TYPES),
  value: z.number().optional(),
});

const blockActionSchema = z
  .discriminatedUnion("type", [
    logFoodActionSchema,
    navigateActionSchema,
    setGoalActionSchema,
  ])
  .superRefine((val, ctx) => {
    if (val.type === "navigate") {
      validateNavigateParams(val, ctx);
    }
  });

// ── Block schemas ───────────────────────────────────────────────────

export const actionCardSchema = z.object({
  type: z.literal("action_card"),
  title: z.string(),
  subtitle: z.string(),
  action: blockActionSchema,
  actionLabel: z.string(),
});

/** Validate navigate action screen params (shared between action card and suggestion list). */
function validateNavigateParams(
  val: { screen: string; params?: Record<string, unknown> },
  ctx: z.RefinementCtx,
): void {
  const schema = screenParamSchemas[val.screen];
  if (schema) {
    if (!val.params) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Screen "${val.screen}" requires params`,
        path: ["params"],
      });
      return;
    }
    const result = schema.safeParse(val.params);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["params", ...issue.path],
        });
      }
    }
  }
}

const navigateActionWithParamValidation = navigateActionSchema.superRefine(
  validateNavigateParams,
);

export const suggestionListSchema = z.object({
  type: z.literal("suggestion_list"),
  items: z.array(
    z.object({
      title: z.string(),
      subtitle: z.string(),
      action: z.union([navigateActionWithParamValidation, z.null()]).nullable(),
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
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, "Must be ISO date format (YYYY-MM-DD)"),
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
  days: z.array(mealPlanDaySchema),
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
/**
 * Re-exported from `@shared/schemas/meal-plan` for backward compatibility.
 * New code should import `MealPlanDay` directly from `@shared/types/meal-plan`
 * (or `@shared/schemas/meal-plan`) rather than from coach-blocks.
 */
export type { MealPlanDay };
export type BlockAction = z.infer<typeof blockActionSchema>;
export type LogFoodAction = z.infer<typeof logFoodActionSchema>;
export type NavigateAction = z.infer<typeof navigateActionSchema>;
