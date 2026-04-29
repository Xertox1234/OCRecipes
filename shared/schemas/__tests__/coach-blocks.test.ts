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
