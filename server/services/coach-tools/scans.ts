import { z } from "zod";
import { sanitizeUserInput } from "../../lib/ai-safety";
import { storage } from "../../storage";
import { scanAmount as amount } from "../label-compare";
import { defineTool, type CoachToolEntry } from "./types";

const getRecentScansSchema = z.object({
  limit: z.number().int().min(1).max(10).optional(),
});

/** Text from a label or a barcode database, on its way back to the model. */
function text(value: string | null): string | null {
  return value === null ? null : sanitizeUserInput(value);
}

/**
 * The user's latest scans (Coach roadmap T4), newest first: what the compare
 * card names by id, and enough to answer "what did I scan". Product and brand
 * names come from labels and an external barcode database, so they are
 * sanitized like every other stored text a tool hands back; the row's account
 * id and photo links are left out.
 */
const getRecentScansTool = defineTool({
  name: "get_recent_scans",
  available: (opts) => !!opts.writeCards,
  definition: () => ({
    type: "function",
    function: {
      name: "get_recent_scans",
      description:
        "List the products the user scanned most recently (barcodes and nutrition labels), newest first: each one's id, name, serving size and nutrition per serving (calories; protein, carbs, fat, fiber and sugar in g; sodium in mg). A blank value means the label did not list it. Only the latest scans (at most 10), so an older one may not be in the list; leave the limit out when looking for a named product.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "How many scans, 1 to 10 (default 10).",
          },
        },
        required: [],
      },
    },
  }),
  argsSchema: getRecentScansSchema,
  run: async (args, { userId }) => {
    const { items } = await storage.getScannedItems(
      userId,
      args.limit ?? 10,
      0,
    );
    return {
      scans: items.map((s) => ({
        id: s.id,
        name: sanitizeUserInput(s.productName),
        brand: text(s.brandName),
        servingSize: text(s.servingSize),
        calories: amount(s.calories),
        protein: amount(s.protein),
        carbs: amount(s.carbs),
        fat: amount(s.fat),
        fiber: amount(s.fiber),
        sugar: amount(s.sugar),
        sodium: amount(s.sodium),
        scannedAt: s.scannedAt,
      })),
    };
  },
});

export const SCAN_TOOLS: CoachToolEntry[] = [getRecentScansTool];
