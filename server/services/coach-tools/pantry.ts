import { z } from "zod";
import { sanitizeUserInput } from "../../lib/ai-safety";
import { storage } from "../../storage";
import { updatePantryCardArgsSchema } from "../write-cards/tool-args";
import { pantryCardResult } from "../write-cards/results";
import { defineTool, type CoachToolEntry } from "./types";

const getPantryItemsSchema = z.object({
  // Bounded: a huge count made an Invalid Date that threw in the query.
  expiringWithinDays: z.number().min(0).max(365).optional(),
});

// Titles and product names can come from other users' public recipes or an
// external barcode database, and this goes back to the model as tool output.
/**
 * Pantry rows as tool output. The model reads the text fields, so they get
 * the same sanitizing as every other stored text a tool hands back.
 */
function sanitizePantryItems(
  items: Awaited<ReturnType<typeof storage.getPantryItems>>,
) {
  return items.map((item) => ({
    ...item,
    name: sanitizeUserInput(item.name),
    unit: item.unit === null ? null : sanitizeUserInput(item.unit),
    category: item.category === null ? null : sanitizeUserInput(item.category),
  }));
}

const getPantryItemsTool = defineTool({
  name: "get_pantry_items",
  definition: () => ({
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
  }),
  argsSchema: getPantryItemsSchema,
  run: async (args, { userId }) => {
    const { expiringWithinDays } = args;
    if (expiringWithinDays !== undefined) {
      const items = await storage.getExpiringPantryItems(
        userId,
        expiringWithinDays,
      );
      return { items: sanitizePantryItems(items), expiringWithinDays };
    }

    const items = await storage.getPantryItems(userId);
    return { items: sanitizePantryItems(items) };
  },
});

// update_pantry is offered, and run, only for an app that can draw the pantry
// card (it lists the kind) and a plan that includes the pantry.
const updatePantryTool = defineTool({
  name: "update_pantry",
  available: (opts) => !!opts.writeCards && !!opts.pantryCard,
  definition: () => ({
    type: "function",
    function: {
      name: "update_pantry",
      description:
        "Show the user a card of changes to their pantry: items to add, amounts they used, and items to remove. Nothing changes until the user taps the card. Call this when the user says they bought, used up, finished or threw out food, or asks you to update their pantry. For a use or remove, call get_pantry_items first and pass that item's id.",
      parameters: {
        type: "object",
        properties: {
          changes: {
            type: "array",
            description: "The changes (1 to 20), one per pantry item.",
            items: {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  enum: ["add", "use", "remove"],
                  description:
                    "add: put an item in the pantry. use: take an amount out of an item. remove: take the whole item out.",
                },
                name: {
                  type: "string",
                  description: "For add: the item, e.g. 'eggs'.",
                },
                quantity: {
                  type: "string",
                  description:
                    "For add: how much, e.g. '12'. For use: how much was used, in the unit the pantry item already has.",
                },
                unit: {
                  type: "string",
                  description: "For add only, e.g. 'g', 'cans'.",
                },
                expiresInDays: {
                  type: "number",
                  description:
                    "For add only: days until it expires, if the user said.",
                },
                itemId: {
                  type: "number",
                  description:
                    "For use and remove: the pantry item's id from get_pantry_items.",
                },
                all: {
                  type: "boolean",
                  description: "For use: true when the item is used up.",
                },
              },
              required: ["action"],
            },
          },
        },
        required: ["changes"],
      },
    },
  }),
  argsSchema: updatePantryCardArgsSchema,
  run: async (args, { opts }) =>
    pantryCardResult(
      await opts.onWriteCardProposal?.({ kind: "pantry", args }),
    ),
});

export const PANTRY_TOOLS: CoachToolEntry[] = [
  getPantryItemsTool,
  updatePantryTool,
];
