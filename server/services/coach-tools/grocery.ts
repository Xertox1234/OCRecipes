import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { sanitizeUserInput } from "../../lib/ai-safety";
import { storage } from "../../storage";
import { addGroceryCardArgsSchema } from "../write-cards/tool-args";
import { groceryCardResult } from "../write-cards/results";
import { defineTool, type CoachToolEntry } from "./types";

const getGroceryListsSchema = z.object({
  listName: z.string().trim().max(100).optional(),
});

/** How much of the user's lists one call hands the model. */
const GROCERY_LISTS_RETURNED = 4;
const GROCERY_ITEMS_PER_LIST = 60;

const addToGroceryListSchema = z.object({
  listName: z.string().optional(),
  items: z
    .array(
      z.object({
        name: z.string(),
        quantity: z.string().optional(),
        category: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * A list as the model sees it: titles and item text are the user's own words,
 * so each passes the prompt sanitizer; row ids and flags are left out.
 */
function compactGroceryList(
  list: Awaited<
    ReturnType<typeof storage.getGroceryListsWithOpenItems>
  >[number],
) {
  const shown = list.items.slice(0, GROCERY_ITEMS_PER_LIST);
  const moreItems = list.openCount - shown.length;
  return {
    id: list.id,
    title: sanitizeUserInput(list.title),
    dateRangeStart: list.dateRangeStart,
    dateRangeEnd: list.dateRangeEnd,
    boughtCount: list.boughtCount,
    items: shown.map((item) => ({
      name: sanitizeUserInput(item.name),
      quantity: item.quantity,
      unit: item.unit === null ? null : sanitizeUserInput(item.unit),
      category:
        item.category === null ? null : sanitizeUserInput(item.category),
    })),
    ...(moreItems > 0 && { moreItems }),
  };
}

const getGroceryListsTool = defineTool({
  name: "get_grocery_lists",
  definition: () => ({
    type: "function",
    function: {
      name: "get_grocery_lists",
      description:
        "Read the user's most recent grocery lists: each list's title and the items still to buy, plus how many are already bought. Call this when the user asks what is on a list or what they still need to buy, and before add_to_grocery_list when they want to add to a list they already have, so you do not propose items it already holds.",
      parameters: {
        type: "object",
        properties: {
          listName: {
            type: "string",
            description:
              "Part of a list's title, to read only matching lists. Omit for the most recent lists.",
          },
        },
        required: [],
      },
    },
  }),
  argsSchema: getGroceryListsSchema,
  run: async (args, { userId }) => {
    const lists = await storage.getGroceryListsWithOpenItems(userId, {
      titleContains: args.listName || undefined,
      limit: GROCERY_LISTS_RETURNED,
      itemsPerList: GROCERY_ITEMS_PER_LIST,
    });
    return { lists: lists.map(compactGroceryList) };
  },
});

const addToGroceryListCardDefinition = (): ChatCompletionTool => ({
  type: "function",
  function: {
    name: "add_to_grocery_list",
    description:
      "Show the user a card of grocery items to add to one of their lists. Nothing is saved until the user taps the card. Items their pantry clearly covers are left off, and ones it may cover start unticked; the result says which.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Items to buy (1 to 40).",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "e.g. 'red lentils'." },
              quantity: { type: "string", description: "e.g. '500', '2'." },
              unit: { type: "string", description: "e.g. 'g', 'cans'." },
              maybeHave: {
                type: "boolean",
                description:
                  "True for staples the user may already have; the card starts it unticked.",
              },
            },
            required: ["name"],
          },
        },
        listName: {
          type: "string",
          description:
            "A name if the user makes a new list, e.g. 'Lentil stew'.",
        },
      },
      required: ["items"],
    },
  },
});

const addToGroceryListTool = defineTool({
  name: "add_to_grocery_list",
  definition: (opts) =>
    opts.writeCards
      ? addToGroceryListCardDefinition()
      : {
          type: "function",
          function: {
            name: "add_to_grocery_list",
            description:
              "Propose creating a grocery list with one or more items. Call this when the user wants to buy ingredients for a discussed meal or asks for a shopping list. Nothing is saved — the user adds the items themselves.",
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
  argsSchema: (opts) =>
    opts.writeCards ? addGroceryCardArgsSchema : addToGroceryListSchema,
  run: async (args, { opts }) => {
    if (opts.writeCards) {
      const card = args as z.infer<typeof addGroceryCardArgsSchema>;
      return groceryCardResult(
        await opts.onWriteCardProposal?.({ kind: "grocery", args: card }),
      );
    }
    const data = args as z.infer<typeof addToGroceryListSchema>;
    // Nothing in the client reads this proposal (see log_food_item).
    return {
      proposal: true,
      action: {
        type: "navigate",
        screen: "GroceryListsModal",
      },
      listName: data.listName ?? "Coach Grocery List",
      items: (data.items ?? []).map((i) => ({
        name: i.name,
        quantity: i.quantity ?? null,
        category: i.category ?? null,
      })),
      message:
        "These items have not been added. Tell the user they can add them to a grocery list from the Plan tab.",
    };
  },
});

export const GROCERY_TOOLS: CoachToolEntry[] = [
  getGroceryListsTool,
  addToGroceryListTool,
];
