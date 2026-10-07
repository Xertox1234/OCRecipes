// server/services/recipe-finder/offer.ts
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { sanitizeContextField } from "../../lib/ai-safety";
import {
  COOKING_TIME_IDS,
  type CookingTimeId,
} from "@shared/constants/cooking-times";
import {
  cookingTimeSchema,
  recipeDetailsSchema,
  spiceLevelSchema,
  type FinderBlock,
  type FinderFlow,
  type RecipeAdjustBlock,
  type RecipeDetails,
  type RecipeOfferBlock,
  type SpiceLevel,
} from "@shared/schemas/recipe-finder";

/**
 * The terminal `offer_recipe` tool Coach Pro calls instead of a regex deciding
 * "this is a recipe ask". Shared by the production coach and the probe so the
 * measured description is the shipped one.
 */
export const OFFER_RECIPE_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "offer_recipe",
    description:
      "Offer to make a recipe for a specific dish. Call this when the user wants a recipe or cooking instructions for a dish — including asking you to turn a dish you suggested into a recipe ('turn that into a recipe', 'how do I make that?'). Call it without any other text. If you cannot name a concrete dish, ask the user which dish in plain text instead of calling this. Do NOT call it for meal ideas or suggestions (answer those yourself), or for questions about an existing recipe (its calories, logging it, adding it to a plan, opinions about it).",
    parameters: {
      type: "object",
      properties: {
        dish: { type: "string", description: "The dish to make a recipe for." },
        from_conversation: {
          type: "boolean",
          description:
            "True when the dish came from earlier in the chat rather than this message.",
        },
        servings: { type: "integer", minimum: 1, maximum: 20 },
        spice: { type: "string", enum: [...spiceLevelSchema.options] },
        time: { type: "string", enum: [...COOKING_TIME_IDS] },
        ingredients: {
          type: "array",
          items: { type: "string" },
          maxItems: 15,
        },
      },
      required: ["dish", "from_conversation"],
    },
  },
};

const DISH_MAX = 80;
const INGREDIENT_MAX = 60;
const INGREDIENTS_MAX = 15;

export interface OfferRecipeArgs {
  dish: string;
  from_conversation: boolean;
  servings?: number;
  spice?: SpiceLevel;
  time?: CookingTimeId;
  ingredients?: string[];
}

/**
 * Sanitises first, then validates. A bad optional field (servings 99, spice
 * "extreme") is dropped rather than rejecting the whole call; only a missing,
 * empty or over-long dish fails the parse.
 */
export const offerRecipeArgsSchema: z.ZodType<
  OfferRecipeArgs,
  z.ZodTypeDef,
  unknown
> = z.unknown().transform((raw, ctx) => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    ctx.addIssue({ code: "custom", message: "args must be an object" });
    return z.NEVER;
  }
  const r = raw as Record<string, unknown>;
  // Sanitise one char over the cap so an over-long "dish" fails max(80)
  // rather than being silently truncated into a plausible-looking one.
  const dish = z
    .string()
    .trim()
    .min(1)
    .max(DISH_MAX)
    .safeParse(
      typeof r.dish === "string"
        ? sanitizeContextField(r.dish, DISH_MAX + 1)
        : r.dish,
    );
  if (!dish.success) {
    ctx.addIssue({ code: "custom", message: "invalid dish" });
    return z.NEVER;
  }
  const out: OfferRecipeArgs = {
    dish: dish.data,
    from_conversation: r.from_conversation === true,
  };
  const servings = recipeDetailsSchema.shape.servings.safeParse(r.servings);
  if (servings.success && servings.data !== undefined) {
    out.servings = servings.data;
  }
  const spice = spiceLevelSchema.safeParse(r.spice);
  if (spice.success) out.spice = spice.data;
  const time = cookingTimeSchema.safeParse(r.time);
  if (time.success) out.time = time.data;
  if (Array.isArray(r.ingredients)) {
    out.ingredients = r.ingredients
      .filter((i): i is string => typeof i === "string")
      .slice(0, INGREDIENTS_MAX)
      .map((i) => sanitizeContextField(i, INGREDIENT_MAX))
      .filter((i) => i.length > 0);
  }
  return out;
});

/** For COMPARISON only, never display. */
export function normalizeDish(dish: string): string {
  return dish
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(a|an|the) /, "")
    .trim();
}

export function buildOfferBlock(
  dish: string,
  details: RecipeDetails,
  flowId: string,
): RecipeOfferBlock {
  const request = [
    dish,
    details.servings && `for ${details.servings}`,
    details.ingredients.length && `with ${details.ingredients.join(", ")}`,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    type: "recipe_offer",
    flow: {
      flowId,
      stage: "offer",
      request,
      query: { q: dish.slice(0, 200) },
      round: 0,
      shownIds: [],
      dish,
      details,
    },
  };
}

export type OfferToolDecision =
  | { kind: "invalid" }
  | { kind: "offer"; dish: string; details: RecipeDetails }
  | { kind: "adjust"; flow: FinderFlow }
  | { kind: "repost_adjust"; block: RecipeAdjustBlock };

export function decideOfferToolCall(
  rawArgs: string,
  latest: FinderBlock | null,
): OfferToolDecision {
  let json: unknown;
  try {
    json = JSON.parse(rawArgs);
  } catch {
    return { kind: "invalid" };
  }
  const parsed = offerRecipeArgsSchema.safeParse(json);
  if (!parsed.success) return { kind: "invalid" };
  const args = parsed.data;

  const wanted = normalizeDish(args.dish);
  if (wanted && latest) {
    const same = normalizeDish(latest.flow.dish ?? "") === wanted;
    if (same && latest.type === "recipe_offer") {
      return { kind: "adjust", flow: latest.flow };
    }
    if (same && latest.type === "recipe_adjust") {
      return { kind: "repost_adjust", block: latest };
    }
  }

  return {
    kind: "offer",
    dish: args.dish,
    details: {
      ...(args.servings !== undefined && { servings: args.servings }),
      ...(args.spice && { spice: args.spice }),
      ...(args.time && { time: args.time }),
      ingredients: args.ingredients ?? [],
      fromConversation: args.from_conversation,
    },
  };
}
