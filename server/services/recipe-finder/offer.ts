// server/services/recipe-finder/offer.ts
import type { ChatCompletionTool } from "openai/resources/chat/completions";

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
        spice: { type: "string", enum: ["mild", "medium", "hot"] },
        time: { type: "string", enum: ["quick", "moderate", "leisurely"] },
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
