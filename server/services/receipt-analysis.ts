import { z } from "zod";
import { openai, MODEL_HEAVY } from "../lib/openai";
import { SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import { createServiceLogger, toError } from "../lib/logger";

const log = createServiceLogger("receipt-analysis");

const receiptItemSchema = z.object({
  name: z.string(),
  originalName: z.string(),
  quantity: z.number().min(0).default(1),
  unit: z.string().optional(),
  category: z.enum([
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
  isFood: z.boolean(),
  estimatedShelfLifeDays: z.number().int().min(1).max(730),
  confidence: z.number().min(0).max(1),
});

const receiptAnalysisSchema = z.object({
  items: z.array(receiptItemSchema),
  storeName: z.string().optional(),
  purchaseDate: z.string().optional(),
  totalAmount: z.string().optional(),
  isPartialExtraction: z.boolean().default(false),
  overallConfidence: z.number().min(0).max(1),
});

export type ReceiptItem = z.infer<typeof receiptItemSchema>;
export type ReceiptAnalysisResult = z.infer<typeof receiptAnalysisSchema>;

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
    response = await openai.chat.completions.create({
      model: MODEL_HEAVY,
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
    });
  } catch (error) {
    log.error({ err: toError(error) }, "receipt analysis API error");
    throw new Error("Failed to analyze receipt photo. Please try again.");
  }

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from receipt analysis");

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      "Receipt analysis returned invalid data. Please try again.",
    );
  }

  const result = receiptAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    log.warn(
      { zodErrors: result.error.flatten() },
      "receipt validation failed",
    );
    throw new Error(
      "Receipt analysis returned unexpected data. Please try again.",
    );
  }

  const validated = result.data;
  // Filter to food items only
  validated.items = validated.items.filter((item) => item.isFood);

  return validated;
}

// Export schemas for testing
export const _testInternals = {
  receiptItemSchema,
  receiptAnalysisSchema,
  RECEIPT_ANALYSIS_PROMPT,
};
