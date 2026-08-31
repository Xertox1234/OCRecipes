// shared/schemas/__tests__/coach-blocks.test.ts
import { describe, it, expect } from "vitest";
import {
  actionCardSchema,
  suggestionListSchema,
  inlineChartSchema,
  commitmentCardSchema,
  quickRepliesSchema,
  recipeCardSchema,
  mealPlanCardSchema,
  coachBlockSchema,
} from "../coach-blocks";

describe("Coach Block Schemas", () => {
  it("validates an action card", () => {
    const card = {
      type: "action_card",
      title: "Grilled chicken salad",
      subtitle: "~450 cal - 38g protein",
      action: {
        type: "log_food",
        description: "Grilled chicken salad",
        calories: 450,
        protein: 38,
        fat: 12,
        carbs: 25,
      },
      actionLabel: "Log it",
    };
    expect(actionCardSchema.parse(card)).toEqual(card);
  });

  it("validates meal-plan and grocery action cards", () => {
    const mealPlanActionCard = {
      type: "action_card",
      title: "Add the day plan",
      subtitle: "Save this plan to your week",
      action: {
        type: "add_meal_plan",
        plan: [
          {
            label: "Today",
            meals: [
              {
                type: "lunch",
                title: "Turkey wrap",
                calories: 430,
                protein: 32,
              },
            ],
            totals: { calories: 430, protein: 32 },
          },
        ],
      },
      actionLabel: "Add plan",
    };

    const groceryActionCard = {
      type: "action_card",
      title: "Add grocery items",
      subtitle: "Save these ingredients",
      action: {
        type: "add_grocery_list",
        listName: "Coach Grocery List",
        items: [{ name: "Greek yogurt", quantity: "2", unit: "cups" }],
      },
      actionLabel: "Add groceries",
    };

    expect(actionCardSchema.parse(mealPlanActionCard)).toEqual(
      mealPlanActionCard,
    );
    expect(actionCardSchema.parse(groceryActionCard)).toEqual(
      groceryActionCard,
    );
  });

  it("validates set_goal navigation to GoalSetup", () => {
    const list = {
      type: "suggestion_list",
      items: [
        {
          title: "Adjust my goals",
          subtitle: "Open goal settings",
          action: { type: "navigate", screen: "GoalSetup" },
        },
      ],
    };
    expect(suggestionListSchema.parse(list)).toEqual(list);
  });

  it("validates a suggestion list", () => {
    const list = {
      type: "suggestion_list",
      items: [
        {
          title: "Greek Chicken Bowl",
          subtitle: "480 cal - 42g P",
          action: {
            type: "navigate",
            screen: "FeaturedRecipeDetail",
            params: { recipeId: 123 },
          },
        },
        { title: "Tuna Wrap", subtitle: "420 cal", action: null },
      ],
    };
    expect(suggestionListSchema.parse(list)).toEqual(list);
  });

  it("validates an inline chart", () => {
    const chart = {
      type: "inline_chart",
      chartType: "bar",
      title: "Protein This Week",
      data: [
        { label: "Mon", value: 142, target: 140, hit: true },
        { label: "Tue", value: 155, target: 140, hit: true },
      ],
      summary: "5/7 days on target",
    };
    expect(inlineChartSchema.parse(chart)).toEqual(chart);
  });

  it("validates a commitment card", () => {
    const card = {
      type: "commitment_card",
      title: "Meal prep on Sunday",
      followUpText: "I'll check in on Monday",
      followUpDate: "2026-04-13",
    };
    expect(commitmentCardSchema.parse(card)).toEqual(card);
  });

  it("validates quick replies", () => {
    const replies = {
      type: "quick_replies",
      options: [
        { label: "Yes", message: "Yes, show me options" },
        { label: "No", message: "No thanks" },
      ],
    };
    expect(quickRepliesSchema.parse(replies)).toEqual(replies);
  });

  it("validates a recipe card", () => {
    const card = {
      type: "recipe_card",
      recipe: {
        title: "Mediterranean Quinoa Bowl",
        calories: 420,
        protein: 28,
        prepTime: "15 min",
        imageUrl: null,
        recipeId: 456,
        source: "community",
      },
    };
    expect(recipeCardSchema.parse(card)).toEqual(card);
  });

  it("validates a meal plan card", () => {
    const card = {
      type: "meal_plan_card",
      title: "High-Protein Day Plan",
      days: [
        {
          label: "Today",
          meals: [
            {
              type: "breakfast",
              title: "Greek Yogurt",
              calories: 320,
              protein: 28,
            },
          ],
          totals: { calories: 320, protein: 28 },
        },
      ],
    };
    expect(mealPlanCardSchema.parse(card)).toEqual(card);
  });

  it("parses discriminated union via coachBlockSchema", () => {
    const block = {
      type: "quick_replies",
      options: [{ label: "Yes", message: "Yes" }],
    };
    const parsed = coachBlockSchema.parse(block);
    expect(parsed.type).toBe("quick_replies");
  });

  it("rejects unknown block type", () => {
    expect(() =>
      coachBlockSchema.parse({ type: "unknown", data: 123 }),
    ).toThrow();
  });
});

describe("validateNavigateParams stripping", () => {
  // The next two tests are bug-reproduction tests: they fail without
  // `val.params = result.data` in validateNavigateParams (verified RED
  // against the pre-fix code) — they pin the reassignment itself.
  it("strips an illegal itemId from NutritionDetail params via the action_card call site", () => {
    const card = {
      type: "action_card",
      title: "View item",
      subtitle: "Nutrition facts",
      action: {
        type: "navigate",
        screen: "NutritionDetail",
        // itemId is not part of screenParamSchemas.NutritionDetail and must
        // not survive validation alongside barcode.
        params: { barcode: "012345678905", itemId: 42 },
      },
      actionLabel: "View",
    };
    const parsed = actionCardSchema.parse(card);
    if (parsed.action.type !== "navigate") {
      throw new Error("expected a navigate action");
    }
    expect(parsed.action.params).toEqual({ barcode: "012345678905" });
    expect(parsed.action.params).not.toHaveProperty("itemId");
  });

  it("strips an illegal itemId from NutritionDetail params via the suggestion_list call site", () => {
    const list = {
      type: "suggestion_list",
      items: [
        {
          title: "View item",
          subtitle: "Nutrition facts",
          action: {
            type: "navigate",
            screen: "NutritionDetail",
            params: { barcode: "012345678905", itemId: 42 },
          },
        },
      ],
    };
    const parsed = suggestionListSchema.parse(list);
    const action = parsed.items[0].action;
    if (!action || action.type !== "navigate") {
      throw new Error("expected a navigate action");
    }
    expect(action.params).toEqual({ barcode: "012345678905" });
    expect(action.params).not.toHaveProperty("itemId");
  });

  // The next two tests are regression guards, not bug-reproduction tests:
  // they pass identically before and after the reassignment fix (nothing
  // was being stripped either way pre-fix). They exist to catch a FUTURE
  // narrowing of screenParamSchemas that would newly start dropping these
  // real, tolerated fields.
  it("retains recipeType and type on FeaturedRecipeDetail params after stripping", () => {
    const list = {
      type: "suggestion_list",
      items: [
        {
          title: "Greek Chicken Bowl",
          subtitle: "480 cal - 42g P",
          action: {
            type: "navigate",
            screen: "FeaturedRecipeDetail",
            params: { recipeId: 123, recipeType: "mealPlan", type: "mealPlan" },
          },
        },
      ],
    };
    const parsed = suggestionListSchema.parse(list);
    const action = parsed.items[0].action;
    if (!action || action.type !== "navigate") {
      throw new Error("expected a navigate action");
    }
    expect(action.params).toEqual({
      recipeId: 123,
      recipeType: "mealPlan",
      type: "mealPlan",
    });
  });

  it("retains initialMessage, remixSourceRecipeId, and remixSourceRecipeTitle on RecipeChat params after stripping", () => {
    const card = {
      type: "action_card",
      title: "Remix this recipe",
      subtitle: "Chat with the coach",
      action: {
        type: "navigate",
        screen: "RecipeChat",
        params: {
          conversationId: 7,
          initialMessage: "Make this vegan",
          remixSourceRecipeId: 99,
          remixSourceRecipeTitle: "Grilled Chicken Salad",
        },
      },
      actionLabel: "Remix",
    };
    const parsed = actionCardSchema.parse(card);
    if (parsed.action.type !== "navigate") {
      throw new Error("expected a navigate action");
    }
    expect(parsed.action.params).toEqual({
      conversationId: 7,
      initialMessage: "Make this vegan",
      remixSourceRecipeId: 99,
      remixSourceRecipeTitle: "Grilled Chicken Salad",
    });
  });

  // Proves the mechanism both filterValidBlocks (client, every
  // useChatMessages read) and validateBlocks (server) rely on:
  // coachBlockSchema.safeParse(...).data is stripped, so a message
  // persisted before this fix is stripped too, on next read — not just
  // freshly-generated ones.
  it("strips itemId when re-validated through coachBlockSchema, the schema every read path re-parses persisted blocks with", () => {
    const rawBlock = {
      type: "action_card",
      title: "View item",
      subtitle: "Nutrition facts",
      action: {
        type: "navigate",
        screen: "NutritionDetail",
        params: { barcode: "012345678905", itemId: 42 },
      },
      actionLabel: "View",
    };
    const result = coachBlockSchema.safeParse(rawBlock);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const block = result.data;
    if (block.type !== "action_card" || block.action.type !== "navigate") {
      throw new Error("expected an action_card with a navigate action");
    }
    expect(block.action.params).toEqual({ barcode: "012345678905" });
  });

  it("drops an out-of-vocabulary recipeType to undefined instead of failing the whole action", () => {
    const card = {
      type: "action_card",
      title: "Greek Chicken Bowl",
      subtitle: "480 cal - 42g P",
      action: {
        type: "navigate",
        screen: "FeaturedRecipeDetail",
        // "spoonacular" is a real value elsewhere in this schema
        // (recipeCardSchema.source) but not a legal FeaturedRecipeDetail
        // recipeType — must degrade the one field, not reject the action.
        params: { recipeId: 123, recipeType: "spoonacular" },
      },
      actionLabel: "View recipe",
    };
    const parsed = actionCardSchema.parse(card);
    if (parsed.action.type !== "navigate") {
      throw new Error("expected a navigate action");
    }
    expect(parsed.action.params).toEqual({ recipeId: 123 });
  });

  it("accepts a RecipeChat navigate action with no conversationId (a fresh remix/prefill chat)", () => {
    const card = {
      type: "action_card",
      title: "Remix this recipe",
      subtitle: "Chat with the coach",
      action: {
        type: "navigate",
        screen: "RecipeChat",
        params: {
          remixSourceRecipeId: 99,
          remixSourceRecipeTitle: "Grilled Chicken Salad",
          initialMessage: "Make this vegan",
        },
      },
      actionLabel: "Remix",
    };
    const parsed = actionCardSchema.parse(card);
    if (parsed.action.type !== "navigate") {
      throw new Error("expected a navigate action");
    }
    expect(parsed.action.params).toEqual({
      remixSourceRecipeId: 99,
      remixSourceRecipeTitle: "Grilled Chicken Salad",
      initialMessage: "Make this vegan",
    });
  });
});

describe("RecipeBrowserModal navigate params", () => {
  const card = (params?: Record<string, unknown>) => ({
    type: "action_card",
    title: "Browse recipes",
    subtitle: "Find something to cook",
    actionLabel: "Browse",
    action: {
      type: "navigate",
      screen: "RecipeBrowserModal",
      ...(params ? { params } : {}),
    },
  });

  it("accepts a navigate action with no params at all", () => {
    expect(actionCardSchema.safeParse(card()).success).toBe(true);
  });

  it("accepts the four declared fields", () => {
    const result = actionCardSchema.safeParse(
      card({
        mealType: "dinner",
        plannedDate: "2026-09-01",
        searchQuery: "pasta",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("REJECTS the misspelled `date` field instead of silently dropping it", () => {
    const result = actionCardSchema.safeParse(card({ date: "2026-09-01" }));
    expect(result.success).toBe(false);
    if (result.success) return;
    // Pin the rejection MECHANISM, not just failure — otherwise this test
    // would stay green if it started failing for an unrelated reason.
    expect(
      result.error.issues.some((issue) => issue.code === "unrecognized_keys"),
    ).toBe(true);
  });

  it("still requires barcode for NutritionDetail when params are absent", () => {
    const result = actionCardSchema.safeParse({
      type: "action_card",
      title: "Details",
      subtitle: "See it",
      actionLabel: "Open",
      action: { type: "navigate", screen: "NutritionDetail" },
    });
    expect(result.success).toBe(false);
  });

  // suggestionListSchema's `items` is a z.array, which fails WHOLESALE if any
  // one element fails — so a single suggestion carrying a bad
  // RecipeBrowserModal param doesn't just lose that suggestion, it takes
  // every sibling suggestion in the same list down with it. This is
  // LLM-reachable: server/services/coach-blocks.ts describes suggestion_list
  // items as carrying navigate actions with params.
  it("REJECTS the whole suggestion list when one item navigates to RecipeBrowserModal with an unknown param", () => {
    const list = {
      type: "suggestion_list",
      items: [
        {
          title: "Greek Chicken Bowl",
          subtitle: "480 cal - 42g P",
          action: {
            type: "navigate",
            screen: "FeaturedRecipeDetail",
            params: { recipeId: 123 },
          },
        },
        {
          title: "Browse for dinner",
          subtitle: "Find something to cook",
          action: {
            type: "navigate",
            screen: "RecipeBrowserModal",
            params: { date: "2026-09-01" },
          },
        },
      ],
    };
    const result = suggestionListSchema.safeParse(list);
    expect(result.success).toBe(false);
  });

  it("accepts a suggestion list where every item has valid RecipeBrowserModal params (including none)", () => {
    const list = {
      type: "suggestion_list",
      items: [
        {
          title: "Add to today's plan",
          subtitle: "Confirm below",
          action: {
            type: "navigate",
            screen: "RecipeBrowserModal",
            params: { plannedDate: "2026-09-01", mealType: "dinner" },
          },
        },
        {
          title: "Browse recipes",
          subtitle: "Find something to cook",
          action: { type: "navigate", screen: "RecipeBrowserModal" },
        },
      ],
    };
    const result = suggestionListSchema.safeParse(list);
    expect(result.success).toBe(true);
  });
});
