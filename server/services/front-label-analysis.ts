import { z } from "zod";
import { openai } from "../lib/openai";
import { SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import type { FrontLabelExtractionResult } from "@shared/types/front-label";

const MAX_FIELD_LENGTH = 200;
const MAX_CLAIMS = 20;

const FRONT_LABEL_PROMPT = `You are a product packaging analysis assistant. Extract the following from the front of this product package photo:

- brand: The brand or manufacturer name
- productName: The specific product name or variant
- netWeight: Net weight or volume with units (e.g., "40g", "1.4 oz", "500ml")
- claims: List of dietary, health, or marketing claims explicitly printed on the package
  (e.g., "No Added Sugar", "Keto Friendly", "Gluten Free", "Organic", "Non-GMO", "High Protein", "Vegan")

Rules:
- Only include claims that are explicitly printed on the package
- Do not infer or guess claims from the product type
- If a field is not visible or readable, return null
- Return claims as an array of strings, exactly as printed

${SYSTEM_PROMPT_BOUNDARY}

Respond with JSON only:
{
  "brand": "string or null",
  "productName": "string or null",
  "netWeight": "string or null",
  "claims": ["claim1", "claim2"],
  "confidence": 0.85
}`;

const frontLabelExtractionSchema = z.object({
  brand: z.string().nullable(),
  productName: z.string().nullable(),
  netWeight: z.string().nullable(),
  claims: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

/** Sanitize extracted strings — truncate to max length */
function sanitizeField(value: string | null): string | null {
  if (!value) return null;
  return value.slice(0, MAX_FIELD_LENGTH).trim() || null;
}

/**
 * Analyze a front-of-package photo to extract brand, product name,
 * net weight, and dietary/marketing claims.
 */
export async function analyzeFrontLabel(
  imageBase64: string,
): Promise<FrontLabelExtractionResult> {
  const startTime = Date.now();

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 300,
      messages: [
        {
          role: "system",
          content: FRONT_LABEL_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract product details from this package front:",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "low",
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = frontLabelExtractionSchema.safeParse(JSON.parse(content));

    if (!parsed.success) {
      console.error("Front label extraction validation failed:", parsed.error);
      return {
        brand: null,
        productName: null,
        netWeight: null,
        claims: [],
        confidence: 0,
      };
    }

    // Sanitize: truncate fields and cap claims count
    const result: FrontLabelExtractionResult = {
      brand: sanitizeField(parsed.data.brand),
      productName: sanitizeField(parsed.data.productName),
      netWeight: sanitizeField(parsed.data.netWeight),
      claims: parsed.data.claims
        .slice(0, MAX_CLAIMS)
        .map((c) => c.slice(0, MAX_FIELD_LENGTH).trim())
        .filter((c) => c.length > 0),
      confidence: parsed.data.confidence,
    };

    console.warn(
      `Front label extraction completed in ${Date.now() - startTime}ms`,
    );
    return result;
  } catch (error) {
    console.error("Front label analysis error:", error);
    return {
      brand: null,
      productName: null,
      netWeight: null,
      claims: [],
      confidence: 0,
    };
  }
}
