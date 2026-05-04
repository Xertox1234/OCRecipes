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
import { z } from "zod";
import { createHash } from "crypto";
import { storage } from "../storage";
import { lookupNutrition } from "./nutrition-lookup";
import { searchCatalogRecipes } from "./recipe-catalog";
import { logger } from "../lib/logger";
import { isValidCalendarDate } from "../utils/date-validation";

// ---------------------------------------------------------------------------
// Structured error type returned by all tool call paths.
// The `code` field lets the model distinguish arg errors from service failures.
// ---------------------------------------------------------------------------

export type ToolErrorResult = {
  error: true;
  code: "INVALID_ARGS" | "NOT_FOUND" | "SERVICE_UNAVAILABLE";
  message: string;
};

function invalidArgs(toolName: string, message: string): ToolErrorResult {
  return {
    error: true,
    code: "INVALID_ARGS",
    message: `${toolName}: ${message}`,
  };
}

function notFound(message: string): ToolErrorResult {
  return { error: true, code: "NOT_FOUND", message };
}

export function serviceUnavailable(toolName: string): ToolErrorResult {
  return {
    error: true,
    code: "SERVICE_UNAVAILABLE",
    message: `${toolName} is temporarily unavailable`,
  };
}

// ---------------------------------------------------------------------------
// Per-tool Zod schemas (M11 — 2026-04-18)
// Validate tool args before dispatch so phantom params never reach handlers.
// ---------------------------------------------------------------------------

const lookupNutritionSchema = z.object({
  query: z.string().min(1),
});

const searchRecipesSchema = z.object({
  query: z.string().min(1),
  diet: z.string().optional(),
  cuisine: z.string().optional(),
  maxReadyTime: z.number().optional(),
});

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
  .refine(isValidCalendarDate, "Must be a real calendar date");

const getDailyLogDetailsSchema = z.object({
  date: isoDateSchema.optional(),
});

const logFoodItemSchema = z.object({
  name: z.string().min(1),
  calories: z.number().nonnegative(),
  protein: z.number().nonnegative().optional(),
  carbs: z.number().nonnegative().optional(),
  fat: z.number().nonnegative().optional(),
  servingSize: z.string().optional(),
});

const getPantryItemsSchema = z.object({
  expiringWithinDays: z.number().optional(),
});

const getMealPlanSchema = z.object({
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
});

// NOTE: plannedDate and mealType are marked required in the OpenAI JSON tool definition.
// Keep this Zod schema aligned — if you change required/optional here, update getToolDefinitions() too.
const addToMealPlanSchema = z.object({
  plannedDate: z.string().default(() => new Date().toISOString().split("T")[0]),
  mealType: z.string().default("lunch"),
  notes: z.string().optional(),
});

const addToGroceryListSchema = z.object({
  listName: z.string().optional(),
  items: z
    .array(
      z.object({
        name: z.string(),
        quantity: z.string().optional(),
        unit: z.string().optional(),
      }),
    )
    .optional(),
});

const getSubstitutionsSchema = z.object({
  ingredients: z
    .array(z.object({ name: z.string(), unit: z.string().optional() }))
    .optional(),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of tool calls the coach may make in a single response turn. */
export const MAX_TOOL_CALLS_PER_RESPONSE = 5;
const MAX_MEAL_PLAN_RANGE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function hashUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

function toIsoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function parseIsoDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDaysIso(date: string, days: number): string {
  return toIsoDate(new Date(parseIsoDate(date).getTime() + days * DAY_MS));
}

function getInclusiveDayCount(startDate: string, endDate: string): number {
  return (
    Math.floor(
      (parseIsoDate(endDate).getTime() - parseIsoDate(startDate).getTime()) /
        DAY_MS,
    ) + 1
  );
}

function compactMealPlanItems(
  items: Awaited<ReturnType<typeof storage.getMealPlanItems>>,
) {
  return items.map((item) => ({
    id: item.id,
    plannedDate: item.plannedDate,
    mealType: item.mealType,
    servings: item.servings,
    recipe: item.recipe
      ? {
          id: item.recipe.id,
          title: item.recipe.title,
          caloriesPerServing: item.recipe.caloriesPerServing,
          proteinPerServing: item.recipe.proteinPerServing,
          carbsPerServing: item.recipe.carbsPerServing,
          fatPerServing: item.recipe.fatPerServing,
        }
      : null,
    scannedItem: item.scannedItem
      ? {
          id: item.scannedItem.id,
          productName: item.scannedItem.productName,
          calories: item.scannedItem.calories,
          protein: item.scannedItem.protein,
          carbs: item.scannedItem.carbs,
          fat: item.scannedItem.fat,
        }
      : null,
  }));
}

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
          "Propose adding a food item to the daily nutrition log. Returns a proposal — the user must confirm before the item is saved. Use when the user says they ate something and wants it tracked.",
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
              description:
                "Start date in YYYY-MM-DD format. Defaults to today.",
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
          "Propose scheduling a food item or recipe on the user's meal plan. Returns a proposal — the user must confirm before it is saved.",
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
          "Propose creating a grocery list with one or more items. Returns a proposal — the user must confirm before items are saved.",
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
): Promise<ToolErrorResult | object> {
  logger.debug(
    { toolName, userIdHash: hashUserId(userId) },
    "Executing coach tool call",
  );

  switch (toolName) {
    case "lookup_nutrition": {
      const parsed = lookupNutritionSchema.safeParse(args);
      if (!parsed.success) {
        return invalidArgs("lookup_nutrition", parsed.error.message);
      }
      const result = await lookupNutrition(parsed.data.query);
      if (!result) {
        return notFound(`No nutrition data found for "${parsed.data.query}"`);
      }
      // Trim to fields the model needs — full result has micronutrients and source
      // metadata that inflate the token budget unnecessarily.
      const { name, calories, protein, carbs, fat, servingSize } = result;
      return { name, calories, protein, carbs, fat, servingSize };
    }

    case "search_recipes": {
      const parsed = searchRecipesSchema.safeParse(args);
      if (!parsed.success) {
        return invalidArgs("search_recipes", parsed.error.message);
      }
      // M2: resolve user allergens and pass as intolerances so Spoonacular
      // filters them out — AI exclusion prompts are insufficient alone.
      const profile = await storage.getUserProfile(userId);
      const allergyNames = (
        (profile?.allergies as { name: string }[] | null) ?? []
      )
        .map((a) => a?.name)
        .filter(Boolean);
      const result = await searchCatalogRecipes({
        query: parsed.data.query,
        diet: parsed.data.diet,
        cuisine: parsed.data.cuisine,
        maxReadyTime: parsed.data.maxReadyTime,
        intolerances:
          allergyNames.length > 0 ? allergyNames.join(",") : undefined,
        number: 5,
      });
      return { results: result.results };
    }

    case "get_daily_log_details": {
      const parsed = getDailyLogDetailsSchema.safeParse(args);
      if (!parsed.success) {
        return invalidArgs("get_daily_log_details", parsed.error.message);
      }
      const date = parsed.data.date
        ? parseIsoDate(parsed.data.date)
        : new Date();

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
      const parsed = logFoodItemSchema.safeParse(args);
      if (!parsed.success) {
        return invalidArgs("log_food_item", parsed.error.message);
      }
      // Return proposal — client renders as action card for user confirmation
      return {
        proposal: true,
        action: {
          type: "log_food",
          description: parsed.data.name,
          calories: parsed.data.calories,
          protein: parsed.data.protein ?? 0,
          carbs: parsed.data.carbs ?? 0,
          fat: parsed.data.fat ?? 0,
        },
        description: parsed.data.name,
        calories: parsed.data.calories,
        protein: parsed.data.protein ?? 0,
        carbs: parsed.data.carbs ?? 0,
        fat: parsed.data.fat ?? 0,
        servingSize: parsed.data.servingSize,
        message:
          "I've prepared this to log. Please confirm by tapping 'Log it' below.",
      };
    }

    case "get_pantry_items": {
      const parsed = getPantryItemsSchema.safeParse(args);
      if (!parsed.success) {
        return invalidArgs("get_pantry_items", parsed.error.message);
      }
      const { expiringWithinDays } = parsed.data;
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
      const parsed = getMealPlanSchema.safeParse(args);
      if (!parsed.success) {
        return invalidArgs("get_meal_plan", parsed.error.message);
      }
      const today = toIsoDate(new Date());
      const startDate = parsed.data.startDate ?? today;
      const defaultEnd = addDaysIso(startDate, 6);
      const endDate = parsed.data.endDate ?? defaultEnd;
      const dayCount = getInclusiveDayCount(startDate, endDate);
      if (dayCount < 1) {
        return invalidArgs(
          "get_meal_plan",
          "endDate must be on or after startDate",
        );
      }
      if (dayCount > MAX_MEAL_PLAN_RANGE_DAYS) {
        return invalidArgs(
          "get_meal_plan",
          `date range is limited to ${MAX_MEAL_PLAN_RANGE_DAYS} days`,
        );
      }

      const items = await storage.getMealPlanItems(userId, startDate, endDate);
      return { startDate, endDate, items: compactMealPlanItems(items) };
    }

    case "add_to_meal_plan": {
      const parsed = addToMealPlanSchema.safeParse(args);
      if (!parsed.success) {
        return invalidArgs("add_to_meal_plan", parsed.error.message);
      }
      // Return proposal — client renders as meal plan card for user confirmation
      return {
        proposal: true,
        action: {
          type: "navigate",
          screen: "RecipeBrowserModal",
          params: {
            date: parsed.data.plannedDate ?? toIsoDate(new Date()),
            mealType: parsed.data.mealType ?? "lunch",
          },
        },
        plannedDate: parsed.data.plannedDate ?? toIsoDate(new Date()),
        mealType: parsed.data.mealType ?? "lunch",
        notes: parsed.data.notes,
        message: "I've prepared this meal plan addition. Please confirm below.",
      };
    }

    case "add_to_grocery_list": {
      const parsed = addToGroceryListSchema.safeParse(args);
      if (!parsed.success) {
        return invalidArgs("add_to_grocery_list", parsed.error.message);
      }
      // Return proposal — client renders for user confirmation
      return {
        proposal: true,
        action: {
          type: "navigate",
          screen: "GroceryListsModal",
        },
        listName: parsed.data.listName ?? "Coach Grocery List",
        items: (parsed.data.items ?? []).map((i) => ({
          name: i.name,
          quantity: i.quantity ?? null,
          unit: i.unit ?? null,
        })),
        message:
          "Here are the items I'd add to your grocery list. Please confirm below.",
      };
    }

    case "get_substitutions": {
      const parsed = getSubstitutionsSchema.safeParse(args);
      if (!parsed.success) {
        return invalidArgs("get_substitutions", parsed.error.message);
      }
      // Lazy import to avoid circular dependency with recipe-catalog
      const { getSubstitutions } = await import("./ingredient-substitution");
      const rawIngredients = parsed.data.ingredients ?? [];

      const ingredients = rawIngredients.map((item, index) => ({
        id: String(index + 1),
        name: item.name,
        quantity: 1,
        unit: item.unit ?? "",
        confidence: 1,
        category: "other" as const,
        photoId: "",
        userEdited: false,
      }));

      const result = await getSubstitutions(ingredients, null);
      return result;
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
