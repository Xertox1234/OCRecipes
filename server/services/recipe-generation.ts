import OpenAI from "openai";
import { z } from "zod";
import type { UserProfile } from "@shared/schema";

// Initialize OpenAI client for text generation (may use custom endpoint)
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// DALL-E client uses direct OpenAI API (custom endpoints may not support image generation)
const dalleClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

// Zod schemas for recipe generation
const recipeContentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  timeEstimate: z.string().min(1).max(50),
  instructions: z.string().min(1),
  dietTags: z.array(z.string()).default([]),
});

export type RecipeContent = z.infer<typeof recipeContentSchema>;

export interface RecipeGenerationInput {
  productName: string;
  barcode?: string | null;
  servings?: number;
  dietPreferences?: string[];
  timeConstraint?: string;
  userProfile?: UserProfile | null;
}

export interface GeneratedRecipe {
  title: string;
  description: string;
  difficulty: string;
  timeEstimate: string;
  instructions: string;
  dietTags: string[];
  imageUrl: string | null;
}

/**
 * Build dietary context string from user profile
 */
function buildDietaryContext(
  userProfile: UserProfile | null | undefined,
  additionalDietPrefs?: string[],
): string {
  const parts: string[] = [];

  if (userProfile) {
    if (
      userProfile.allergies &&
      Array.isArray(userProfile.allergies) &&
      userProfile.allergies.length > 0
    ) {
      const allergyNames = (userProfile.allergies as { name: string }[]).map(
        (a) => a.name,
      );
      parts.push(`MUST AVOID these allergens: ${allergyNames.join(", ")}`);
    }
    if (userProfile.dietType) {
      parts.push(`Diet type: ${userProfile.dietType}`);
    }
    if (userProfile.cookingSkillLevel) {
      parts.push(`Cooking skill: ${userProfile.cookingSkillLevel}`);
    }
    if (userProfile.cookingTimeAvailable) {
      parts.push(`Preferred cooking time: ${userProfile.cookingTimeAvailable}`);
    }
  }

  if (additionalDietPrefs && additionalDietPrefs.length > 0) {
    parts.push(`Additional preferences: ${additionalDietPrefs.join(", ")}`);
  }

  return parts.length > 0 ? parts.join(". ") + "." : "";
}

/**
 * Generate recipe content using GPT-4
 */
export async function generateRecipeContent(
  input: RecipeGenerationInput,
): Promise<RecipeContent> {
  const dietaryContext = buildDietaryContext(
    input.userProfile,
    input.dietPreferences,
  );

  const servingsText = input.servings ? `for ${input.servings} servings` : "";
  const timeText = input.timeConstraint
    ? `The recipe should take ${input.timeConstraint} or less.`
    : "";

  const prompt = `Create a delicious recipe using "${input.productName}" as the main ingredient ${servingsText}.

${dietaryContext ? `User dietary requirements: ${dietaryContext}` : ""}
${timeText}

Generate a complete recipe with:
1. A creative, appetizing title
2. A brief description (1-2 sentences)
3. Clear step-by-step instructions including ingredients list
4. Difficulty level (Easy, Medium, or Hard)
5. Total time estimate (prep + cook)
6. Relevant diet tags (e.g., "vegetarian", "gluten-free", "low-carb", "quick", "kid-friendly")

Respond with JSON only:
{
  "title": "Recipe Title",
  "description": "Brief appetizing description",
  "difficulty": "Easy|Medium|Hard",
  "timeEstimate": "30 min",
  "instructions": "Full instructions with ingredients list and steps",
  "dietTags": ["tag1", "tag2"]
}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2000,
    messages: [
      {
        role: "system",
        content:
          "You are a professional chef and recipe developer. Create delicious, practical recipes that are easy to follow. Always respond with valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content || "{}";
  const parsed = recipeContentSchema.safeParse(JSON.parse(content));

  if (!parsed.success) {
    console.error("Recipe generation validation failed:", parsed.error);
    throw new Error("Failed to generate valid recipe content");
  }

  return parsed.data;
}

/**
 * Generate a food image using DALL-E 3
 * Returns base64 data URL or null if generation fails
 */
export async function generateRecipeImage(
  recipeTitle: string,
  productName: string,
): Promise<string | null> {
  try {
    const prompt = `Appetizing food photography of "${recipeTitle}" featuring ${productName}. Professional lighting, top-down view, styled on rustic wooden table. No text or labels. Photorealistic style.`;

    const response = await dalleClient.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "b64_json",
    });

    const imageData = response.data?.[0]?.b64_json;
    if (!imageData) {
      console.error("DALL-E returned no image data");
      return null;
    }

    // Return as base64 data URL (stored directly in DB like avatars)
    return `data:image/png;base64,${imageData}`;
  } catch (error) {
    console.error("DALL-E image generation error:", error);
    return null;
  }
}

/**
 * Generate a complete recipe with content and image
 */
export async function generateFullRecipe(
  input: RecipeGenerationInput,
): Promise<GeneratedRecipe> {
  // Generate recipe content first
  const content = await generateRecipeContent(input);

  // Generate image (non-blocking, recipe still usable without image)
  let imageUrl: string | null = null;
  try {
    imageUrl = await generateRecipeImage(content.title, input.productName);
  } catch (error) {
    console.error("Image generation failed, continuing without image:", error);
  }

  return {
    ...content,
    imageUrl,
  };
}

/**
 * Normalize product name for fuzzy matching
 * Lowercases, trims whitespace, removes special characters
 */
export function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}
