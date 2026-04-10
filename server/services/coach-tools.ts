/**
 * Coach Tools Service
 *
 * Defines OpenAI function-calling tool definitions for the nutrition coach
 * and dispatches tool calls to the appropriate backend services.
 *
 * Tools available to the coach AI:
 *   1. lookup_nutrition      — look up macros for any food
 *   2. search_recipes        — search the recipe catalog
 *   3. get_daily_log_details — fetch today's food log + totals
 *   4. log_food_item         — add a food item to today's log
 *   5. get_pantry_items      — list pantry items (optionally expiring soon)
 *   6. get_meal_plan         — get meal plan for a date range
 *   7. add_to_meal_plan      — schedule a recipe/food on the meal plan
 *   8. add_to_grocery_list   — create a new grocery list with items
 *   9. get_substitutions     — suggest ingredient swaps
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { storage } from "../storage";
import { lookupNutrition } from "./nutrition-lookup";
import { searchCatalogRecipes } from "./recipe-catalog";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of tool calls the coach may make in a single response turn. */
export const MAX_TOOL_CALLS_PER_RESPONSE = 5;

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

/**
 * Returns the full array of OpenAI function-calling tool definitions.
 * Pass this array directly to OpenAI's `tools` parameter.
 */
export function getToolDefinitions(): ChatCompletionTool[] {
  return [
    {
      type: "function",
      function: {
        name: "lookup_nutrition",
        description:
          "Look up nutritional information (calories, protein, carbs, fat, fiber, sodium) for any food item or ingredient. Use this when the user asks about the nutrition of a specific food.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "The food item to look up, e.g. 'chicken breast', 'brown rice', 'avocado'.",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_recipes",
        description:
          "Search the recipe catalog for healthy meal ideas. Use this when the user asks for recipe suggestions, meal ideas, or specific dish types.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search keywords, e.g. 'high protein lunch', 'vegan dinner', 'quick breakfast'.",
            },
            diet: {
              type: "string",
              description:
                "Optional dietary filter, e.g. 'vegetarian', 'vegan', 'paleo', 'ketogenic'.",
            },
            cuisine: {
              type: "string",
              description:
                "Optional cuisine filter, e.g. 'italian', 'mexican', 'asian'.",
            },
            maxReadyTime: {
              type: "number",
              description: "Optional maximum preparation time in minutes.",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_daily_log_details",
        description:
          "Retrieve the user's food log and nutrition totals for today (or a specific date). Use this to check what the user has eaten and how their macros look.",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description:
                "ISO date string (YYYY-MM-DD). Defaults to today if omitted.",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "log_food_item",
        description:
          "Add a food item to the user's daily nutrition log. Use this when the user says they just ate something and wants it tracked.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the food item, e.g. 'Greek yogurt'.",
            },
            calories: {
              type: "number",
              description: "Calories per serving.",
            },
            protein: {
              type: "number",
              description: "Protein in grams per serving.",
            },
            carbs: {
              type: "number",
              description: "Carbohydrates in grams per serving.",
            },
            fat: {
              type: "number",
              description: "Fat in grams per serving.",
            },
            servingSize: {
              type: "string",
              description:
                "Human-readable serving size, e.g. '1 cup', '100g'. Defaults to '1 serving'.",
            },
          },
          required: ["name", "calories"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_pantry_items",
        description:
          "List the user's pantry items. Optionally filter to items expiring within a given number of days. Use this to suggest recipes from what the user already has.",
        parameters: {
          type: "object",
          properties: {
            expiringWithinDays: {
              type: "number",
              description:
                "If provided, only return items expiring within this many days.",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_meal_plan",
        description:
          "Retrieve the user's meal plan for a date range. Use this to see what meals are already planned and find gaps.",
        parameters: {
          type: "object",
          properties: {
            startDate: {
              type: "string",
              description: "Start date in YYYY-MM-DD format. Defaults to today.",
            },
            endDate: {
              type: "string",
              description:
                "End date in YYYY-MM-DD format. Defaults to 7 days from start.",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "add_to_meal_plan",
        description:
          "Schedule a food item or recipe on the user's meal plan for a specific date and meal type.",
        parameters: {
          type: "object",
          properties: {
            plannedDate: {
              type: "string",
              description: "Date in YYYY-MM-DD format.",
            },
            mealType: {
              type: "string",
              enum: ["breakfast", "lunch", "dinner", "snack"],
              description: "Which meal of the day.",
            },
            notes: {
              type: "string",
              description:
                "Optional notes about this meal plan entry, e.g. recipe name or food description.",
            },
          },
          required: ["plannedDate", "mealType"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "add_to_grocery_list",
        description:
          "Create a new grocery list with one or more items. Use this when the user wants to add ingredients to their shopping list.",
        parameters: {
          type: "object",
          properties: {
            listName: {
              type: "string",
              description:
                "Name for the grocery list, e.g. 'Weekly Shop', 'Meal Prep Ingredients'.",
            },
            items: {
              type: "array",
              description: "Items to add to the list.",
              items: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                    description: "Item name, e.g. 'chicken breast'.",
                  },
                  quantity: {
                    type: "string",
                    description: "Amount, e.g. '500g', '2 cans'.",
                  },
                  category: {
                    type: "string",
                    description:
                      "Grocery category, e.g. 'produce', 'dairy', 'meat'.",
                  },
                },
                required: ["name"],
              },
            },
          },
          required: ["items"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_substitutions",
        description:
          "Get ingredient substitution suggestions. Use this when the user needs to swap out an ingredient due to allergies, dietary restrictions, or missing items.",
        parameters: {
          type: "object",
          properties: {
            ingredients: {
              type: "array",
              description: "Ingredients to find substitutions for.",
              items: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                    description: "Ingredient name, e.g. 'butter'.",
                  },
                  reason: {
                    type: "string",
                    description:
                      "Why a substitution is needed, e.g. 'dairy-free', 'vegan', 'missing from pantry'.",
                  },
                },
                required: ["name"],
              },
            },
          },
          required: ["ingredients"],
        },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Tool Execution
// ---------------------------------------------------------------------------

/** Loose type for tool arguments — callers pass raw JSON-decoded objects. */
type ToolArgs = Record<string, unknown>;

/**
 * Dispatches a tool call to the appropriate backend service.
 *
 * @param toolName - The function name from the OpenAI tool call
 * @param args     - Parsed JSON arguments from the tool call
 * @param userId   - The authenticated user's ID
 * @returns A plain serialisable object representing the tool result
 * @throws Error if the tool name is not recognised
 */
export async function executeToolCall(
  toolName: string,
  args: ToolArgs,
  userId: string,
): Promise<unknown> {
  logger.debug({ toolName, userId }, "Executing coach tool call");

  switch (toolName) {
    case "lookup_nutrition": {
      const query = String(args.query ?? "");
      const result = await lookupNutrition(query);
      if (!result) {
        return { error: `No nutrition data found for "${query}"` };
      }
      return result;
    }

    case "search_recipes": {
      const result = await searchCatalogRecipes({
        query: String(args.query ?? ""),
        diet: args.diet ? String(args.diet) : undefined,
        cuisine: args.cuisine ? String(args.cuisine) : undefined,
        maxReadyTime: args.maxReadyTime
          ? Number(args.maxReadyTime)
          : undefined,
        number: 5,
      });
      return { results: result.results };
    }

    case "get_daily_log_details": {
      const dateStr = args.date ? String(args.date) : undefined;
      const date = dateStr ? new Date(dateStr) : new Date();

      const [logs, totals] = await Promise.all([
        storage.getDailyLogs(userId, date),
        storage.getDailySummary(userId, date),
      ]);

      return {
        date: date.toISOString().split("T")[0],
        items: logs,
        totals,
      };
    }

    case "log_food_item": {
      // Return proposal — client renders as action card for user confirmation
      return {
        proposal: true,
        action: "log_food",
        description: String(args.name ?? args.description ?? ""),
        calories: Number(args.calories ?? 0),
        protein: Number(args.protein ?? 0),
        carbs: Number(args.carbs ?? 0),
        fat: Number(args.fat ?? 0),
        mealType: args.mealType ? String(args.mealType) : undefined,
        message: "I've prepared this to log. Please confirm by tapping 'Log it' below.",
      };
    }

    case "get_pantry_items": {
      const expiringWithinDays = args.expiringWithinDays
        ? Number(args.expiringWithinDays)
        : undefined;

      if (expiringWithinDays !== undefined) {
        const items = await storage.getExpiringPantryItems(
          userId,
          expiringWithinDays,
        );
        return { items, expiringWithinDays };
      }

      const items = await storage.getPantryItems(userId);
      return { items };
    }

    case "get_meal_plan": {
      const today = new Date().toISOString().split("T")[0];
      const startDate = args.startDate ? String(args.startDate) : today;
      const defaultEnd = new Date(
        new Date(startDate).getTime() + 6 * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .split("T")[0];
      const endDate = args.endDate ? String(args.endDate) : defaultEnd;

      const items = await storage.getMealPlanItems(userId, startDate, endDate);
      return { startDate, endDate, items };
    }

    case "add_to_meal_plan": {
      // Return proposal — client renders as meal plan card for user confirmation
      return {
        proposal: true,
        action: "add_meal_plan",
        recipeId: Number(args.recipeId ?? 0),
        plannedDate: String(args.plannedDate ?? new Date().toISOString().split("T")[0]),
        mealType: String(args.mealType ?? "lunch"),
        message: "I've prepared this meal plan addition. Please confirm below.",
      };
    }

    case "add_to_grocery_list": {
      // Return proposal — client renders for user confirmation
      const rawItems = Array.isArray(args.items) ? args.items : [];
      return {
        proposal: true,
        action: "add_grocery_list",
        listName: args.listName ? String(args.listName) : "Coach Grocery List",
        items: rawItems.map((i: unknown) => {
          const item = i as Record<string, unknown>;
          return {
            name: String(item.name ?? ""),
            quantity: item.quantity ? String(item.quantity) : null,
            unit: item.unit ? String(item.unit) : null,
          };
        }),
        message: "Here are the items I'd add to your grocery list. Please confirm below.",
      };
    }

    case "get_substitutions": {
      // Lazy import to avoid circular dependency with recipe-catalog
      const { getSubstitutions } = await import("./ingredient-substitution");
      const rawIngredients = Array.isArray(args.ingredients)
        ? args.ingredients
        : [];

      const ingredients = rawIngredients.map(
        (i: unknown, index: number) => {
          const item = i as Record<string, unknown>;
          return {
            id: String(index + 1),
            name: String(item.name ?? ""),
            quantity: 1,
            unit: item.unit ? String(item.unit) : "",
            confidence: 1,
            category: "other" as const,
            photoId: "",
            userEdited: false,
          };
        },
      );

      const result = await getSubstitutions(ingredients, null);
      return result;
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
