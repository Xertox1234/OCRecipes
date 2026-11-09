import { z } from "zod";
import { aiChat } from "../lib/ai-client";
import { OPENAI_TIMEOUT_HEAVY_MS } from "../lib/openai";
import { SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import { createServiceLogger, toError } from "../lib/logger";
import { parseAiJson } from "../lib/ai-json";

const log = createServiceLogger("receipt-analysis");

// Gemini (the Vertex backup) writes null for a field it has no value for,
// where GPT leaves the key out; both mean "not given".
// The trailing .optional() keeps the key optional in the inferred type (zod 4
// types a transformed field as a required key).
const absentAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .nullish()
    .transform((v) => v ?? undefined)
    .optional();

const receiptItemSchema = z.object({
  name: z.string(),
  originalName: z.string(),
  quantity: z.number().min(0).default(1),
  unit: absentAsUndefined(z.string()),
  // Gemini writes categories outside the list ("deli") or in another letter
  // case; one such line must not fail the whole receipt, so normalise the case
  // and file anything still unknown under "other".
  category: z
    .preprocess(
      (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
      z.enum([
        "produce",
        "meat",
        "seafood",
        "dairy",
        "bakery",
        "grains",
        "canned",
        "condiments",
        "spices",
        "frozen",
        "beverages",
        "snacks",
        "other",
      ]),
    )
    .catch("other"),
  isFood: z.boolean(),
  // Gemini writes null on non-food lines, where GPT writes a number.
  estimatedShelfLifeDays: absentAsUndefined(z.number().int().min(1).max(730)),
  confidence: z.number().min(0).max(1),
});

const receiptAnalysisSchema = z.object({
  items: z.array(receiptItemSchema),
  storeName: absentAsUndefined(z.string()),
  purchaseDate: absentAsUndefined(z.string()),
  totalAmount: absentAsUndefined(z.string()),
  isPartialExtraction: z.boolean().default(false),
  overallConfidence: z.number().min(0).max(1),
});

type ParsedReceipt = z.infer<typeof receiptAnalysisSchema>;

// What the service returns: only food lines, each with a shelf-life estimate.
export type ReceiptAnalysisResult = Omit<ParsedReceipt, "items"> & {
  items: (Omit<ParsedReceipt["items"][number], "estimatedShelfLifeDays"> & {
    estimatedShelfLifeDays: number;
  })[];
};

// Same default the review screen uses for a line it has no estimate for.
const DEFAULT_SHELF_LIFE_DAYS = 7;

const RECEIPT_ANALYSIS_PROMPT = `You are a grocery receipt analysis assistant. Analyze the receipt photo(s) and extract all purchased items.

For each line item on the receipt:
1. Decode abbreviated receipt names into full product names (e.g., "ORG BNS CKEN" → "Organic Boneless Chicken", "GV 2% MLK" → "Great Value 2% Milk")
2. Extract the quantity purchased (default to 1 if not shown)
3. Determine if the item is a food/grocery item (isFood: true) or non-food (isFood: false). Non-food examples: bags, cleaning supplies, household items, health/beauty products.
4. Categorize food items into one of: "produce", "meat", "seafood", "dairy", "bakery", "grains", "canned", "condiments", "spices", "frozen", "beverages", "snacks", "other"
5. Estimate shelf life in days based on the product type:
   - Fresh produce: 3-14 days
   - Fresh meat/poultry: 3-5 days
   - Fresh seafood: 2-3 days
   - Dairy (milk): 7-14 days, (cheese): 14-60 days, (yogurt): 14-21 days
   - Bread/bakery: 5-7 days
   - Canned goods: 365-730 days
   - Frozen items: 90-365 days
   - Condiments: 90-365 days
   - Dry goods/grains: 180-365 days
   - Snacks: 30-180 days
   - Beverages: 30-365 days
6. Set confidence (0-1) for how sure you are about the decoded name

Also extract if visible:
- Store name
- Purchase date
- Total amount

If any items are cut off or unreadable, set isPartialExtraction to true.

${SYSTEM_PROMPT_BOUNDARY}

Respond with JSON only matching this schema:
{
  "items": [
    {
      "name": "decoded full product name",
      "originalName": "receipt abbreviation as printed",
      "quantity": 1,
      "unit": "optional unit (lb, oz, gal, etc.)",
      "category": "produce",
      "isFood": true,
      "estimatedShelfLifeDays": 7,
      "confidence": 0.9
    }
  ],
  "storeName": "Store Name if visible",
  "purchaseDate": "YYYY-MM-DD if visible",
  "totalAmount": "$XX.XX if visible",
  "isPartialExtraction": false,
  "overallConfidence": 0.85
}`;

/**
 * Analyze 1-3 receipt photos and extract food items with estimated shelf life.
 * Sends all photos in a single GPT-4o call for cross-photo context.
 */
export async function analyzeReceiptPhotos(
  imagesBase64: string[],
): Promise<ReceiptAnalysisResult> {
  const imageContents = imagesBase64.map((base64) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:image/jpeg;base64,${base64}`,
      detail: "high" as const,
    },
  }));

  let response;
  try {
    response = await aiChat(
      "receipt-scan",
      {
        messages: [
          {
            role: "system",
            content: RECEIPT_ANALYSIS_PROMPT,
          },
          {
            role: "user",
            content: [
              ...imageContents,
              {
                type: "text" as const,
                text:
                  imagesBase64.length > 1
                    ? `Analyze these ${imagesBase64.length} receipt photos. They may be different sections of the same receipt.`
                    : "Analyze this receipt photo and extract all food items.",
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 4096,
        temperature: 0.2,
      },
      // Multi-image high-detail vision is a heavy call — same tier as
      // menu-analysis (the 45s client default can cut off large receipts).
      { timeout: OPENAI_TIMEOUT_HEAVY_MS },
    );
  } catch (error) {
    log.error({ err: toError(error) }, "receipt analysis API error");
    throw new Error("Failed to analyze receipt photo. Please try again.");
  }

  const result = parseAiJson(
    response.choices[0]?.message?.content,
    receiptAnalysisSchema,
    {
      noResponse: "No response from receipt analysis",
      invalid: "Receipt analysis returned invalid data. Please try again.",
      schemaMismatch:
        "Receipt analysis returned unexpected data. Please try again.",
      validationFailed: "receipt validation failed",
    },
    log,
  );

  // Filter to food items only; a food line without an estimate gets the default
  return {
    ...result,
    items: result.items
      .filter((item) => item.isFood)
      .map((item) => ({
        ...item,
        estimatedShelfLifeDays:
          item.estimatedShelfLifeDays ?? DEFAULT_SHELF_LIFE_DAYS,
      })),
  };
}

// Export schemas for testing
export const _testInternals = {
  receiptItemSchema,
  receiptAnalysisSchema,
  RECEIPT_ANALYSIS_PROMPT,
};
