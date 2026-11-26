import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { civilDateString, civilDateToInstant } from "../../lib/civil-date";
import { sanitizeUserInput } from "../../lib/ai-safety";
import { storage } from "../../storage";
import { lookupNutrition } from "../nutrition-lookup";
import { getSubstitutions } from "../ingredient-substitution";
import { logFoodCardArgsSchema } from "../write-cards/tool-args";
import { foodCardResult } from "../write-cards/results";
import {
  defineTool,
  isoDateSchema,
  MEAL_TYPE_PARAM,
  notFound,
  type CoachToolEntry,
} from "./types";

const lookupNutritionSchema = z.object({
  query: z.string().min(1).max(200),
});

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

const getSubstitutionsSchema = z.object({
  ingredients: z
    // Bounded: this list becomes a second, paid model prompt.
    .array(
      z.object({
        name: z.string().max(200),
        unit: z.string().max(50).optional(),
      }),
    )
    .max(30)
    .optional(),
});

const lookupNutritionTool = defineTool({
  name: "lookup_nutrition",
  definition: () => ({
    type: "function",
    function: {
      name: "lookup_nutrition",
      description:
        "Look up nutritional information (calories, and grams of protein, carbs, fat and fiber, and mg of sodium) for any food item or ingredient. Use this when the user asks about the nutrition of a specific food.",
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
  }),
  argsSchema: lookupNutritionSchema,
  run: async (args) => {
    const result = await lookupNutrition(args.query);
    if (!result) {
      return notFound(`No nutrition data found for "${args.query}"`);
    }
    // Trim to fields the model needs — full result has micronutrients and source
    // metadata that inflate the token budget unnecessarily.
    // The name and serving size come from an outside nutrition source.
    const { name, calories, protein, carbs, fat, fiber, sodium, servingSize } =
      result;
    return {
      name: sanitizeUserInput(name),
      calories,
      protein,
      carbs,
      fat,
      // Promised by the description; sodium is in mg, the rest in g.
      fiber,
      sodium,
      servingSize: sanitizeUserInput(servingSize),
    };
  },
});

const getDailyLogDetailsTool = defineTool({
  name: "get_daily_log_details",
  definition: () => ({
    type: "function",
    function: {
      name: "get_daily_log_details",
      description:
        "List the foods the user logged on a day (name, meal, servings, calories and macros, local time) with that day's totals. Use it to see WHAT they ate, or for a day other than today. Today's totals are already in USER CONTEXT, so do not call it only to read them.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              "ISO date string (YYYY-MM-DD). Omit it for today — the server resolves that in the user's timezone. For any other day, resolve it against the current date given in USER CONTEXT rather than guessing.",
          },
        },
        required: [],
      },
    },
  }),
  argsSchema: getDailyLogDetailsSchema,
  run: async (args, { userId, tz }) => {
    // Keep the requested day as a STRING and convert once, explicitly.
    // `parseIsoDate` anchors to UTC midnight, which is right for the pure
    // calendar arithmetic in `addDaysIso`/`getInclusiveDayCount` but wrong as
    // an input to a tz-bucketed read: its civil day in a negative-offset zone
    // is the previous one. That mattered more here than elsewhere, because
    // the echoed `date` below is handed to the model, which would then assert
    // the previous day's logs to the user under the requested date's label.
    const dateStr = args.date ?? civilDateString(new Date(), tz);
    const date = civilDateToInstant(dateStr, tz);

    const [logs, totals] = await Promise.all([
      storage.getDailyLogItems(userId, date, tz),
      storage.getDailySummary(userId, date, tz),
    ]);
    const localTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const rounded = (value: number | string | null) =>
      value === null ? null : Math.round(Number(value));

    return {
      date: dateStr,
      // What was eaten, not the stored rows: those carry ids and no names.
      // A product name comes from a barcode database or a label scan.
      items: logs.map((log) => ({
        name: log.name ? sanitizeUserInput(log.name) : "Unnamed item",
        mealType: log.mealType,
        servings: log.servings === null ? 1 : Number(log.servings),
        calories: rounded(log.calories),
        protein: rounded(log.protein),
        carbs: rounded(log.carbs),
        fat: rounded(log.fat),
        time: localTime.format(log.loggedAt),
      })),
      totals,
    };
  },
});

// Write-card mode (spec 2026-11-09) swaps this tool's definition AND its args
// schema; the legacy form proposes nothing the app can save.
const logFoodItemCardDefinition = (): ChatCompletionTool => ({
  type: "function",
  function: {
    name: "log_food_item",
    description:
      "Show the user a card to log food they ate. Nothing is saved until the user taps the card. Put every item from the message in one call. Food can be logged for today or yesterday only.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Each food the user ate (1 to 8).",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The food, e.g. 'large egg', 'whole-wheat toast'.",
              },
              count: {
                type: "integer",
                description: "How many units they had (1 to 20).",
              },
              unitLabel: {
                type: "string",
                description: "The unit counted, e.g. 'egg', 'slice', 'cup'.",
              },
              estimate: {
                type: "object",
                description:
                  "Your estimate for ONE unit; the server prefers a nutrition lookup when it finds one.",
                properties: {
                  calories: { type: "number" },
                  protein: { type: "number" },
                  carbs: { type: "number" },
                  fat: { type: "number" },
                },
                required: ["calories", "protein", "carbs", "fat"],
              },
            },
            required: ["name", "count", "unitLabel", "estimate"],
          },
        },
        mealType: {
          ...MEAL_TYPE_PARAM,
          description:
            "The meal, only if the user said it (otherwise it is set from the time of day).",
        },
        day: {
          type: "string",
          enum: ["today", "yesterday"],
          description: "When they ate it. Defaults to today.",
        },
      },
      required: ["items"],
    },
  },
});

const logFoodItemTool = defineTool({
  name: "log_food_item",
  definition: (opts) =>
    opts.writeCards
      ? logFoodItemCardDefinition()
      : {
          type: "function",
          function: {
            name: "log_food_item",
            description:
              "Propose adding a food item to the daily nutrition log. Nothing is saved — the user logs it themselves. Use when the user says they ate something and wants it tracked.",
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
  argsSchema: (opts) =>
    opts.writeCards ? logFoodCardArgsSchema : logFoodItemSchema,
  run: async (args, { opts }) => {
    if (opts.writeCards) {
      const card = args as z.infer<typeof logFoodCardArgsSchema>;
      return foodCardResult(
        await opts.onWriteCardProposal?.({ kind: "food", args: card }),
      );
    }
    const data = args as z.infer<typeof logFoodItemSchema>;
    // Nothing in the client reads this proposal, so the message must not
    // send the user to a button; it tells the model where they can log it.
    return {
      proposal: true,
      action: {
        type: "log_food",
        description: data.name,
        calories: data.calories,
        protein: data.protein ?? 0,
        carbs: data.carbs ?? 0,
        fat: data.fat ?? 0,
      },
      description: data.name,
      calories: data.calories,
      protein: data.protein ?? 0,
      carbs: data.carbs ?? 0,
      fat: data.fat ?? 0,
      servingSize: data.servingSize,
      message:
        "This item has not been logged. Tell the user they can log it with Quick Log on the Home screen.",
    };
  },
});

const getSubstitutionsTool = defineTool({
  name: "get_substitutions",
  definition: () => ({
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
                unit: {
                  type: "string",
                  description:
                    "Unit of measure for the ingredient, e.g. 'cup', 'tbsp', 'g'.",
                },
              },
              required: ["name"],
            },
          },
        },
        required: ["ingredients"],
      },
    },
  }),
  argsSchema: getSubstitutionsSchema,
  run: async (args, { userId }) => {
    const rawIngredients = args.ingredients ?? [];

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

    // The user's own allergies and diet filter the suggestions, as on the
    // cooking route: without the profile nothing removes almond milk for a
    // tree-nut allergy. The suggestion text is written by a second model
    // from the names above.
    const profile = await storage.getUserProfile(userId);
    const result = await getSubstitutions(ingredients, profile);
    return {
      suggestions: result.suggestions.map((suggestion) => ({
        ...suggestion,
        substitute: sanitizeUserInput(suggestion.substitute),
        reason: sanitizeUserInput(suggestion.reason),
        ratio: sanitizeUserInput(suggestion.ratio),
      })),
      dietaryProfileSummary: sanitizeUserInput(result.dietaryProfileSummary),
    };
  },
});

export const NUTRITION_TOOLS: CoachToolEntry[] = [
  lookupNutritionTool,
  getDailyLogDetailsTool,
  logFoodItemTool,
  getSubstitutionsTool,
];
