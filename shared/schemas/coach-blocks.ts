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
  "GoalSetup",
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
// `satisfies` pins the keys to real NAVIGABLE_SCREENS members, so a misspelled
// screen name is a compile error; the Record<string, …> annotation is kept so
// the `screenParamSchemas[val.screen]` lookup still accepts any screen union.
// This file (shared/) cannot import client/navigation's RootStackParamList
// (shared/ never imports from client/), so the per-screen field lists below
// are kept in sync with RootStackParamList BY HAND — no compiler check ties
// them together. Since validateNavigateParams now reassigns val.params to
// the stripped result, a field present on RootStackParamList but missing
// here is silently dropped from every Coach navigate action, with no
// failing test to catch the drift. Keep this file's screens in sync with
// client/navigation/RootStackNavigator.tsx by hand when either changes.
// NutritionDetail's barcode arm (RootStackParamList) also carries three
// optional label-capture companions — `ocrText`, `nutritionImageUri`,
// `frontImageUri`. They are deliberately NOT included below: the Coach
// system prompt (server/services/coach-blocks.ts's BLOCKS_SYSTEM_PROMPT)
// never describes per-screen param shapes to the LLM, and no server tool
// constructs a NutritionDetail navigate action at all — so the LLM has no
// basis to emit them. If it ever did, validateNavigateParams below would
// now silently strip them — an accepted low-risk gap, unlike
// FeaturedRecipeDetail/RecipeChat below, where the equivalent fields are
// instead widened in (kept, not stripped) because real callers rely on them.
const screenParamSchemas: Record<string, z.ZodType<Record<string, unknown>>> = {
  NutritionDetail: z.object({ barcode: z.string() }),
  // recipeType/type: real, tolerated fields on
  // RootStackParamList["FeaturedRecipeDetail"] — widened here so the
  // stripping fix in validateNavigateParams doesn't delete them.
  // `.catch(undefined)`: an out-of-vocabulary value (e.g. an LLM reusing
  // "spoonacular" from recipeCardSchema.source below) must degrade to
  // "field absent", not fail the whole action/block — a typed field is
  // stricter than an unlisted one, which safeParse always tolerated.
  FeaturedRecipeDetail: z.object({
    recipeId: z.number(),
    recipeType: z.enum(["community", "mealPlan"]).optional().catch(undefined),
    type: z.enum(["community", "mealPlan"]).optional().catch(undefined),
  }),
  // initialMessage/remixSourceRecipeId/remixSourceRecipeTitle: real,
  // tolerated fields on RootStackParamList["RecipeChat"] — widened here so
  // the stripping fix in validateNavigateParams doesn't delete them.
  // conversationId is optional (not required) to match
  // RootStackParamList["RecipeChat"] exactly — a remix/prefill chat
  // (the scenario initialMessage/remixSourceRecipeId exist for) starts
  // with no conversationId yet; requiring it would fail that case wholesale.
  RecipeChat: z.object({
    conversationId: z.number().optional().catch(undefined),
    initialMessage: z.string().optional().catch(undefined),
    remixSourceRecipeId: z.number().optional().catch(undefined),
    remixSourceRecipeTitle: z.string().optional().catch(undefined),
  }),
} satisfies Partial<Record<(typeof NAVIGABLE_SCREENS)[number], z.ZodType>>;

const GOAL_TYPES = ["calories", "protein", "carbs", "fat", "weight"] as const;

const setGoalActionSchema = z.object({
  type: z.literal("set_goal"),
  goalType: z.enum(GOAL_TYPES),
  value: z.number().optional(),
});

const addMealPlanActionSchema = z.object({
  type: z.literal("add_meal_plan"),
  plan: z.array(mealPlanDaySchema),
});

const addGroceryListActionSchema = z.object({
  type: z.literal("add_grocery_list"),
  listName: z.string().optional(),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.string().nullable().optional(),
      unit: z.string().nullable().optional(),
    }),
  ),
});

const blockActionSchema = z
  .discriminatedUnion("type", [
    logFoodActionSchema,
    navigateActionSchema,
    setGoalActionSchema,
    addMealPlanActionSchema,
    addGroceryListActionSchema,
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
      return;
    }
    // Reassign to the parsed/stripped result — schema.safeParse() alone only
    // reports success, it does not mutate val.params. Without this, a key
    // not present in the per-screen schema (e.g. an illegal `itemId`
    // alongside `barcode` for NutritionDetail) survives validation and
    // reaches navigation.navigate unstripped.
    val.params = result.data;
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
  notebookEntryId: z.number().optional(),
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
export type SetGoalAction = z.infer<typeof setGoalActionSchema>;
export type AddMealPlanAction = z.infer<typeof addMealPlanActionSchema>;
export type AddGroceryListAction = z.infer<typeof addGroceryListActionSchema>;
