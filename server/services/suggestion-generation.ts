import { z } from "zod";
import type { UserProfile } from "@shared/schema";
import { openai, MODEL_FAST, OPENAI_TIMEOUT_FAST_MS } from "../lib/openai";
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import { buildDietaryContext } from "../lib/dietary-context";

// Zod schema for AI suggestion response
const suggestionItemSchema = z.object({
  type: z.enum(["recipe", "craft", "pairing"]),
  title: z.string(),
  description: z.string().default(""),
  difficulty: z.string().optional(),
  timeEstimate: z.string().optional(),
});

const suggestionsResponseSchema = z.object({
  suggestions: z.array(suggestionItemSchema).min(1),
});

export type SuggestionItem = z.infer<typeof suggestionItemSchema>;

export interface GenerateSuggestionsInput {
  productName: string;
  brandName?: string | null;
  userProfile: UserProfile | null | undefined;
}

export interface GenerateInstructionsInput {
  productName: string;
  brandName?: string | null;
  suggestionTitle: string;
  suggestionType: "recipe" | "craft" | "pairing";
  userProfile: UserProfile | null | undefined;
}

/**
 * Generate creative suggestions (recipes, crafts, pairings) for a food item using OpenAI.
 */
export async function generateSuggestions(
  input: GenerateSuggestionsInput,
): Promise<SuggestionItem[]> {
  const dietaryContext = buildDietaryContext(input.userProfile, {
    allergenDetail: "basic",
  });

  const safeName = sanitizeUserInput(input.productName || "");
  const safeBrand = input.brandName ? sanitizeUserInput(input.brandName) : "";

  const prompt = `Given this food item: "${safeName}"${safeBrand ? ` by ${safeBrand}` : ""}, generate creative suggestions.

${dietaryContext ? `User preferences: ${dietaryContext}` : ""}

Generate exactly 4 suggestions in this JSON format:
{
  "suggestions": [
    {
      "type": "recipe",
      "title": "Recipe name",
      "description": "Brief 1-2 sentence description of how to use this ingredient",
      "difficulty": "Easy/Medium/Hard",
      "timeEstimate": "15 min"
    },
    {
      "type": "recipe",
      "title": "Another recipe",
      "description": "Description",
      "difficulty": "Easy",
      "timeEstimate": "30 min"
    },
    {
      "type": "craft",
      "title": "Fun kid activity with food packaging or theme",
      "description": "Brief description of a creative activity for kids",
      "timeEstimate": "20 min"
    },
    {
      "type": "pairing",
      "title": "What goes well with this",
      "description": "Complementary foods or drinks that pair nicely"
    }
  ]
}

Keep descriptions concise. Make recipes practical and kid activities fun and safe. Return only valid JSON.`;

  const completion = await openai.chat.completions.create(
    {
      model: MODEL_FAST,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: `You are a helpful culinary and crafts assistant for a family-friendly nutrition app. Be practical and creative. If the user has allergies listed, never suggest recipes containing those allergens. Always respond with valid JSON only, no markdown formatting. ${SYSTEM_PROMPT_BOUNDARY}`,
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1024,
    },
    { timeout: OPENAI_TIMEOUT_FAST_MS },
  );

  const responseText = completion.choices[0]?.message?.content || "{}";
  const parsed = suggestionsResponseSchema.safeParse(JSON.parse(responseText));
  if (!parsed.success) {
    throw new SuggestionParseError("AI returned an unexpected response format");
  }

  return parsed.data.suggestions;
}

/**
 * Generate detailed instructions for a specific suggestion using OpenAI.
 */
export async function generateInstructions(
  input: GenerateInstructionsInput,
): Promise<string> {
  const dietaryContext = buildDietaryContext(input.userProfile, {
    allergenDetail: "basic",
  });

  const safeItemName = sanitizeUserInput(input.productName || "");
  const safeItemBrand = input.brandName
    ? sanitizeUserInput(input.brandName)
    : "";
  const safeTitle = sanitizeUserInput(input.suggestionTitle);

  let prompt: string;
  if (input.suggestionType === "recipe") {
    prompt = `Write detailed cooking instructions for: "${safeTitle}"

This recipe uses "${safeItemName}"${safeItemBrand ? ` by ${safeItemBrand}` : ""} as a main ingredient.

${dietaryContext ? `User preferences: ${dietaryContext}` : ""}

Provide clear, numbered step-by-step instructions. Include:
1. A brief ingredients list (with approximate amounts)
2. Preparation steps
3. Cooking steps
4. Any helpful tips

Keep instructions practical and easy to follow. Format as plain text with clear sections.`;
  } else if (input.suggestionType === "craft") {
    prompt = `Write detailed instructions for the kid-friendly activity: "${safeTitle}"

This activity is inspired by "${safeItemName}".

Provide clear, numbered step-by-step instructions. Include:
1. Materials needed
2. Setup instructions
3. Activity steps
4. Safety notes (if applicable)
5. Fun variations or extensions

Keep instructions simple and safe for children. Format as plain text with clear sections.`;
  } else {
    // pairing
    prompt = `Explain in detail why these foods pair well: "${safeTitle}"

Based on "${safeItemName}"${safeItemBrand ? ` by ${safeItemBrand}` : ""}.

${dietaryContext ? `User preferences: ${dietaryContext}` : ""}

Include:
1. Why these flavors complement each other
2. Serving suggestions
3. Preparation tips
4. Alternative pairings to try

Format as plain text with clear sections.`;
  }

  const completion = await openai.chat.completions.create(
    {
      model: MODEL_FAST,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `You are a helpful culinary and crafts assistant for a family-friendly nutrition app. Provide clear, practical instructions in plain text with numbered steps and clear section headings. Do not use markdown formatting. If the user has allergies listed, never suggest ingredients containing those allergens. ${SYSTEM_PROMPT_BOUNDARY}`,
        },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 1500,
    },
    { timeout: OPENAI_TIMEOUT_FAST_MS },
  );

  return (
    completion.choices[0]?.message?.content ||
    "Unable to generate instructions."
  );
}

/**
 * Error thrown when AI response cannot be parsed into expected suggestion format.
 */
export class SuggestionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuggestionParseError";
  }
}
