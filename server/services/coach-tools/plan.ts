import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { civilDateString } from "../../lib/civil-date";
import { sanitizeUserInput } from "../../lib/ai-safety";
import { storage } from "../../storage";
import { addMealPlanCardArgsSchema } from "../write-cards/tool-args";
import { CARD_SHOWN_MESSAGE } from "../write-cards/results";
import {
  defineTool,
  invalidArgs,
  MEAL_TYPES,
  MEAL_TYPE_PARAM,
  isoDateSchema,
  type CoachToolEntry,
} from "./types";

const getMealPlanSchema = z.object({
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
});

// NOTE: plannedDate and mealType are marked required in the OpenAI JSON tool definition.
// Keep this Zod schema aligned — if you change required/optional here, update getToolDefinitions() too.
//
// `plannedDate` staying REQUIRED **in the OpenAI JSON tool definition** (the
// `required: [...]` array in `getToolDefinitions`) — as distinct from the Zod
// field below, which is `.optional()` — is only defensible because the prompt
// now states the user's calendar date (`nutrition-coach.ts`, the "Current time
// for this user" line, rendered as yyyy-mm-dd in their timezone). Before that
// the model was required to emit a date it had never been told, so it guessed —
// and this proposal writes a real row. **If that date is ever removed from the
// prompt, this field must stop being required**, or the guessing returns.
// That is not merely asserted: removing the date from the prompt turns the
// `current time rendering` block in `nutrition-coach.test.ts` red.
//
// `plannedDate` is `.optional()` rather than carrying a `.default()` on purpose.
// A default here cannot see the request's timezone, so the previous
// `.default(() => new Date().toISOString().split("T")[0])` filed a UTC day —
// the user's TOMORROW for a negative offset in the evening. Worse, because the
// default always populated the field, the `?? toIsoDate(new Date())` fallbacks
// at the call site could never run: they looked like the default and were dead,
// so fixing only those changes nothing. The default now lives at the call site,
// where `tz` is in scope.

const addToMealPlanSchema = z.object({
  // `isoDateSchema`, not a bare string: this is the one date the model is
  // forced to produce, and it is the one that WRITES. A bare `z.string()` let
  // "next Friday", "07/10/2026" and "2026-02-30" through safeParse, past the
  // client's `isBrowseOnly` check, and on to the route's own validation —
  // surfacing to the user as "Couldn't add the recipe to your plan. Please try
  // again.", a permanent failure worded as a transient one. Rejecting here
  // routes it back to the model through `invalidArgs`, which can correct it.
  plannedDate: isoDateSchema.optional(),
  mealType: z.enum(MEAL_TYPES).default("lunch"),
  notes: z.string().optional(),
});

const MAX_MEAL_PLAN_RANGE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  items: Awaited<ReturnType<typeof storage.getMealPlanItemSummaries>>,
) {
  return items.map((item) => ({
    id: item.id,
    plannedDate: item.plannedDate,
    mealType: item.mealType,
    servings: item.servings,
    recipe: item.recipe
      ? {
          id: item.recipe.id,
          title: sanitizeUserInput(item.recipe.title),
          caloriesPerServing: item.recipe.caloriesPerServing,
          proteinPerServing: item.recipe.proteinPerServing,
          carbsPerServing: item.recipe.carbsPerServing,
          fatPerServing: item.recipe.fatPerServing,
        }
      : null,
    scannedItem: item.scannedItem
      ? {
          id: item.scannedItem.id,
          productName: sanitizeUserInput(item.scannedItem.productName),
          calories: item.scannedItem.calories,
          protein: item.scannedItem.protein,
          carbs: item.scannedItem.carbs,
          fat: item.scannedItem.fat,
        }
      : null,
  }));
}

const getMealPlanTool = defineTool({
  name: "get_meal_plan",
  definition: () => ({
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
              "Start date in YYYY-MM-DD format. Omit it for today — the server resolves that in the user's timezone. For any other day, resolve it against the current date given in USER CONTEXT rather than guessing.",
          },
          endDate: {
            type: "string",
            description:
              "End date in YYYY-MM-DD format. Defaults to 7 days from start. Resolve any explicit day against the current date given in USER CONTEXT.",
          },
        },
        required: [],
      },
    },
  }),
  argsSchema: getMealPlanSchema,
  run: async (args, { userId, tz }) => {
    // The user's civil today, not the server's. `toIsoDate(new Date())` is a
    // UTC basis, which for an LA user in the evening is TOMORROW — so
    // "what's on my plan this week" silently omitted the day they were
    // standing in. Measured wrong-hour window per day: LA 7/24, Auckland
    // 12/24, New York 4/24, Berlin 2/24, UTC 0/24.
    const today = civilDateString(new Date(), tz);
    const startDate = args.startDate ?? today;
    const defaultEnd = addDaysIso(startDate, 6);
    const endDate = args.endDate ?? defaultEnd;
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

    const items = await storage.getMealPlanItemSummaries(
      userId,
      startDate,
      endDate,
    );
    return { startDate, endDate, items: compactMealPlanItems(items) };
  },
});

const addToMealPlanCardDefinition = (): ChatCompletionTool => ({
  type: "function",
  function: {
    name: "add_to_meal_plan",
    description:
      "Show the user a card of meals to add to their plan. Nothing is saved until the user taps the card. Every recipe must be an id returned by find_plan_recipes or get_my_recipes in this conversation — never invent one.",
    parameters: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          description: "One row per day and meal (1 to 7).",
          items: {
            type: "object",
            properties: {
              plannedDate: {
                type: "string",
                description:
                  'YYYY-MM-DD. Resolve relative days ("tomorrow", "Sunday") against the current date given in USER CONTEXT.',
              },
              mealType: MEAL_TYPE_PARAM,
              recipe: {
                type: "object",
                properties: {
                  source: { type: "string", enum: ["community", "mine"] },
                  id: { type: "integer" },
                },
                required: ["source", "id"],
              },
              alternatives: {
                type: "array",
                description:
                  "Up to 3 other recipes for this row, for the user's Swap.",
                items: {
                  type: "object",
                  properties: {
                    source: { type: "string", enum: ["community", "mine"] },
                    id: { type: "integer" },
                  },
                  required: ["source", "id"],
                },
              },
            },
            required: ["plannedDate", "mealType", "recipe"],
          },
        },
      },
      required: ["rows"],
    },
  },
});

const addToMealPlanTool = defineTool({
  name: "add_to_meal_plan",
  definition: (opts) =>
    opts.writeCards
      ? addToMealPlanCardDefinition()
      : {
          type: "function",
          function: {
            name: "add_to_meal_plan",
            description:
              "Propose scheduling a food item or recipe on the user's meal plan. Call this when the user agrees to a suggested meal or asks to schedule, plan, or save a meal for a specific day or week. Nothing is saved — the user adds it themselves.",
            parameters: {
              type: "object",
              properties: {
                plannedDate: {
                  type: "string",
                  description:
                    'Date in YYYY-MM-DD format. Resolve relative days ("today", "tomorrow", "Sunday") against the current date given in USER CONTEXT; never guess.',
                },
                mealType: {
                  type: "string",
                  enum: [...MEAL_TYPES],
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
  argsSchema: (opts) =>
    opts.writeCards ? addMealPlanCardArgsSchema : addToMealPlanSchema,
  run: async (args, { tz, opts }) => {
    if (opts.writeCards) {
      const card = args as z.infer<typeof addMealPlanCardArgsSchema>;
      await opts.onWriteCardProposal?.({
        kind: "plan",
        args: card,
        pool: [...(opts.planRecipePool ?? [])],
      });
      return { card_shown: true, message: CARD_SHOWN_MESSAGE };
    }
    const data = args as z.infer<typeof addToMealPlanSchema>;
    // Nothing in the client reads this proposal (see log_food_item).
    return {
      proposal: true,
      action: {
        type: "navigate",
        screen: "RecipeBrowserModal",
        params: {
          plannedDate: data.plannedDate ?? civilDateString(new Date(), tz),
          mealType: data.mealType ?? "lunch",
        },
      },
      // Same UTC-basis defect, and this one WRITES: since PR #885 this
      // proposal creates a real `meal_plan_items` row, so "add chicken for
      // today" at 6pm PDT filed it under tomorrow.
      plannedDate: data.plannedDate ?? civilDateString(new Date(), tz),
      mealType: data.mealType ?? "lunch",
      notes: data.notes,
      message:
        "This meal has not been added. Tell the user they can add it from the Plan tab.",
    };
  },
});

export const PLAN_TOOLS: CoachToolEntry[] = [
  getMealPlanTool,
  addToMealPlanTool,
];
