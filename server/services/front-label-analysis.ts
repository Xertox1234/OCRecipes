import { z } from "zod";
import { aiChat } from "../lib/ai-client";
import { OPENAI_TIMEOUT_HEAVY_MS } from "../lib/openai";
import { SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import type { FrontLabelExtractionResult } from "@shared/types/front-label";
import { createServiceLogger, toError } from "../lib/logger";
import { parseAiJson } from "../lib/ai-json";

const log = createServiceLogger("front-label-analysis");

const MAX_FIELD_LENGTH = 200;
const MAX_CLAIMS = 20;
const MAX_ALLERGEN_STATEMENTS = 20;
// Longer than a name: an EU or multilingual "Contains: …" line runs long,
// and an allergen cut off its end would go unwarned.
const MAX_STATEMENT_LENGTH = 500;

// The Coach's front-of-pack step also reads the printed allergen lines, for
// the allergy check on a product the barcode did not find. Only ever read as
// printed: a missing line is "none printed here", never "allergen-free".
const ALLERGEN_FIELD = `- allergenStatements: Every allergen statement printed on the package, exactly as printed
  (e.g., "Contains: milk, soy", "May contain peanuts", "Made in a facility that also processes tree nuts", "Allergy advice: for allergens see ingredients in bold")
`;
const ALLERGEN_RULES = `- For allergenStatements, copy each statement exactly as printed; do not infer allergens from the product type, the picture or the ingredients, and return an empty array when none is printed
`;

function frontLabelPrompt(allergens: boolean): string {
  return `You are a product packaging analysis assistant. Extract the following from the front of this product package photo:

- brand: The brand or manufacturer name
- productName: The specific product name or variant
- netWeight: Net weight or volume with units (e.g., "40g", "1.4 oz", "500ml")
- claims: List of dietary, health, or marketing claims explicitly printed on the package
  (e.g., "No Added Sugar", "Keto Friendly", "Gluten Free", "Organic", "Non-GMO", "High Protein", "Vegan")
${allergens ? ALLERGEN_FIELD : ""}
Rules:
- Only include claims that are explicitly printed on the package
- Do not infer or guess claims from the product type
- If a field is not visible or readable, return null
- Return claims as an array of strings, exactly as printed
${allergens ? ALLERGEN_RULES : ""}
${SYSTEM_PROMPT_BOUNDARY}

Respond with JSON only:
{
  "brand": "string or null",
  "productName": "string or null",
  "netWeight": "string or null",
  "claims": ["claim1", "claim2"],${allergens ? '\n  "allergenStatements": ["statement1"],' : ""}
  "confidence": 0.85
}`;
}

const frontLabelExtractionSchema = z.object({
  brand: z.string().nullable(),
  productName: z.string().nullable(),
  netWeight: z.string().nullable(),
  claims: z.array(z.string()),
  allergenStatements: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
});

/** Truncate, trim and cap a list of printed strings. */
function sanitizeList(
  values: string[],
  max: number,
  maxLength: number,
): string[] {
  return values
    .map((c) => c.slice(0, maxLength).trim())
    .filter((c) => c.length > 0)
    .slice(0, max);
}

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
  /** Also read the printed allergen statements (the Coach's front step). */
  options: { allergens?: boolean } = {},
): Promise<FrontLabelExtractionResult> {
  const allergens = options.allergens === true;
  const startTime = Date.now();

  let response;
  try {
    response = await aiChat(
      "front-label-scan",
      {
        // Gemini counts reasoning tokens inside this cap; 300 cut replies off
        // (todo P2-2026-10-18-camera-vision-features-to-gemini, 2026-11-05).
        max_completion_tokens: 1300,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: frontLabelPrompt(allergens),
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
                  // Allergen lines are small print; the plain read needs
                  // only the large brand and name. High detail costs more
                  // tokens: one call per optional front step, behind the
                  // photo cap.
                  detail: allergens ? "high" : "low",
                },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      },
      // Vision call — same tier as the other label/receipt scans; without
      // it the SDK default is 600 s.
      { timeout: OPENAI_TIMEOUT_HEAVY_MS },
    );
  } catch (error) {
    log.error({ err: toError(error) }, "front label analysis error");
    throw new Error("Failed to analyze product front label. Please try again.");
  }

  const parsed = parseAiJson(
    response.choices[0]?.message?.content,
    frontLabelExtractionSchema,
    {
      noResponse: "No response from front label analysis",
      invalid: "Front label extraction returned invalid data",
      validationFailed: "front label extraction validation failed",
    },
    log,
  );

  // Sanitize: truncate fields and cap claims count
  const result: FrontLabelExtractionResult = {
    brand: sanitizeField(parsed.brand),
    productName: sanitizeField(parsed.productName),
    netWeight: sanitizeField(parsed.netWeight),
    claims: parsed.claims
      .slice(0, MAX_CLAIMS)
      .map((c) => c.slice(0, MAX_FIELD_LENGTH).trim())
      .filter((c) => c.length > 0),
    ...(allergens && {
      allergenStatements: sanitizeList(
        parsed.allergenStatements ?? [],
        MAX_ALLERGEN_STATEMENTS,
        MAX_STATEMENT_LENGTH,
      ),
    }),
    confidence: parsed.confidence,
  };

  log.debug(
    { durationMs: Date.now() - startTime },
    "front label extraction completed",
  );
  return result;
}
