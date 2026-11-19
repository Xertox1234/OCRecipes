import { z } from "zod";
import { sanitizeUserInput } from "../../lib/ai-safety";
import { storage } from "../../storage";
import { findCommunity } from "../recipe-finder/find-community";
import { defineTool, type CoachToolEntry } from "./types";

const searchRecipesSchema = z.object({
  query: z.string().min(1),
  diet: z.string().optional(),
  cuisine: z.string().optional(),
});

const getMyRecipesSchema = z.object({
  query: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

const searchRecipesTool = defineTool({
  name: "search_recipes",
  definition: () => ({
    type: "function",
    function: {
      name: "search_recipes",
      description:
        "Search OCRecipes community recipes for healthy meal ideas. Use this when the user asks for recipe suggestions, meal ideas, or specific dish types. Results are already filtered server-side to exclude the user's allergens — do not re-check or veto results for allergy reasons.",
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
        },
        required: ["query"],
      },
    },
  }),
  argsSchema: searchRecipesSchema,
  run: async (args, { userId }) => {
    // Community recipes only — Spoonacular content is never shown
    // (inspired-recipes spec 2026-10-12). findCommunity searches with
    // safeForMe, so the user's allergens/diet are filtered server-side.
    const items = await findCommunity(
      {
        q: args.query,
        diet: args.diet,
        cuisine: args.cuisine,
      },
      userId,
      [],
    );
    return {
      // Other users' public recipe titles go back to the model as tool
      // output — sanitize them like any other third-party text.
      results: items.map(({ id, title, imageUrl, readyInMinutes }) => ({
        id,
        title: sanitizeUserInput(title),
        imageUrl,
        readyInMinutes,
      })),
    };
  },
});

// The two recipe-id tools a plan card needs exist only in write-card mode.
const getMyRecipesTool = defineTool({
  name: "get_my_recipes",
  available: (opts) => !!opts.writeCards,
  definition: () => ({
    type: "function",
    function: {
      name: "get_my_recipes",
      description:
        "List recipes saved in the user's own library (source 'mine' for add_to_meal_plan).",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional words to match in the title.",
          },
          limit: { type: "integer", description: "At most 10. Default 10." },
        },
      },
    },
  }),
  argsSchema: getMyRecipesSchema,
  run: async (args, { userId }) => {
    const { items } = await storage.getUserMealPlanRecipes(userId, 50);
    const q = args.query?.toLowerCase();
    return {
      recipes: items
        .filter((r) => !q || r.title.toLowerCase().includes(q))
        .slice(0, args.limit ?? 10)
        .map((r) => ({
          id: r.id,
          // The user's own text, but still tool output read by the model.
          title: sanitizeUserInput(r.title),
          calories: Math.round(Number(r.caloriesPerServing ?? 0)),
          protein: Math.round(Number(r.proteinPerServing ?? 0)),
        })),
    };
  },
});

const findPlanRecipesTool = defineTool({
  name: "find_plan_recipes",
  available: (opts) => !!opts.writeCards,
  definition: () => ({
    type: "function",
    function: {
      name: "find_plan_recipes",
      description:
        "Find community recipes to put on a meal plan card (source 'community' for add_to_meal_plan). Only for building a plan; results are already safe for the user's allergies.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "e.g. 'high protein dinner', 'vegetarian lunch'.",
          },
          diet: { type: "string" },
          cuisine: { type: "string" },
        },
        required: ["query"],
      },
    },
  }),
  argsSchema: searchRecipesSchema,
  run: async (args, { userId, opts }) => {
    // Same safe-for-me community search as search_recipes.
    const items = await findCommunity(
      {
        q: args.query,
        diet: args.diet,
        cuisine: args.cuisine,
      },
      userId,
      [],
    );
    const shown = items.slice(0, 10);
    opts.planRecipePool?.push(...shown.map((r) => r.id));
    return {
      recipes: shown.map(({ id, title, calories }) => ({
        id,
        title: sanitizeUserInput(title),
        calories,
      })),
    };
  },
});

export const RECIPE_TOOLS: CoachToolEntry[] = [
  searchRecipesTool,
  getMyRecipesTool,
  findPlanRecipesTool,
];
