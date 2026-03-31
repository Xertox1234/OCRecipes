import { z } from "zod";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { UserProfile } from "@shared/schema";
import type { RecipeContent } from "@shared/types/cook-session";
import {
  openai,
  dalleClient,
  OPENAI_TIMEOUT_HEAVY_MS,
  OPENAI_TIMEOUT_IMAGE_MS,
} from "../lib/openai";
import {
  generateImage as runwareGenerateImage,
  isRunwareConfigured,
} from "../lib/runware";
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import { createServiceLogger, toError } from "../lib/logger";

const log = createServiceLogger("recipe-generation");

const RECIPE_IMAGES_DIR = path.resolve(process.cwd(), "uploads/recipe-images");
fs.mkdirSync(RECIPE_IMAGES_DIR, { recursive: true });

// Zod schemas for recipe generation
const instructionItemSchema = z.union([
  z.string(),
  z
    .object({
      text: z.string().optional(),
      instruction: z.string().optional(),
      description: z.string().optional(),
    })
    .passthrough(),
]);

const recipeContentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  timeEstimate: z.string().min(1).max(50),
  instructions: z
    .union([z.string(), z.array(instructionItemSchema)])
    .transform((v) => {
      if (!Array.isArray(v)) return v;
      // Handle both string[] and object[] (e.g. [{step: 1, text: "..."}])
      return v
        .map((item) =>
          typeof item === "string"
            ? item
            : (item.text ??
              item.instruction ??
              item.description ??
              JSON.stringify(item)),
        )
        .join("\n");
    })
    .pipe(z.string().min(1)),
  dietTags: z.array(z.string()).default([]),
});

// RecipeContent type is defined in @shared/types/cook-session and re-exported here
export type { RecipeContent };

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
        (a) => sanitizeUserInput(a.name),
      );
      parts.push(`MUST AVOID these allergens: ${allergyNames.join(", ")}`);
    }
    if (userProfile.dietType) {
      parts.push(`Diet type: ${sanitizeUserInput(userProfile.dietType)}`);
    }
    if (userProfile.cookingSkillLevel) {
      parts.push(
        `Cooking skill: ${sanitizeUserInput(userProfile.cookingSkillLevel)}`,
      );
    }
    if (userProfile.cookingTimeAvailable) {
      parts.push(
        `Preferred cooking time: ${sanitizeUserInput(userProfile.cookingTimeAvailable)}`,
      );
    }
  }

  if (additionalDietPrefs && additionalDietPrefs.length > 0) {
    parts.push(
      `Additional preferences: ${additionalDietPrefs.map(sanitizeUserInput).join(", ")}`,
    );
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

  const sanitizedProductName = sanitizeUserInput(input.productName);

  const prompt = `Create a delicious recipe using "${sanitizedProductName}" as the main ingredient ${servingsText}.

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

  let response;
  try {
    response = await openai.chat.completions.create(
      {
        model: "gpt-4o",
        max_completion_tokens: 2000,
        messages: [
          {
            role: "system",
            content: `You are a professional chef and recipe developer. Create delicious, practical recipes that are easy to follow. Always respond with valid JSON only. ${SYSTEM_PROMPT_BOUNDARY}`,
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      },
      { timeout: OPENAI_TIMEOUT_HEAVY_MS },
    );
  } catch (error) {
    log.error({ err: toError(error) }, "recipe generation API error");
    throw new Error("Failed to generate recipe. Please try again.");
  }

  const content = response.choices[0]?.message?.content || "{}";

  let parsedJson;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new Error("AI returned invalid JSON for recipe");
  }

  const parsed = recipeContentSchema.safeParse(parsedJson);

  if (!parsed.success) {
    log.warn(
      { zodErrors: parsed.error.flatten() },
      "recipe generation validation failed",
    );
    throw new Error("Failed to generate valid recipe content");
  }

  return parsed.data;
}

/**
 * Generate a food image using Runware (primary) or DALL-E 3 (fallback).
 * Saves to uploads/recipe-images/ and returns the URL path, or null on failure.
 */
export async function generateRecipeImage(
  recipeTitle: string,
  productName: string,
): Promise<string | null> {
  const safeTitle = sanitizeUserInput(recipeTitle);
  const safeProduct = sanitizeUserInput(productName);
  const prompt = `Appetizing food photography of "${safeTitle}" featuring ${safeProduct}. Professional lighting, top-down view, styled on rustic wooden table. No text or labels. Photorealistic style.`;

  // Try Runware first (66x cheaper than DALL-E)
  if (isRunwareConfigured) {
    try {
      const buffer = await runwareGenerateImage(prompt);
      if (buffer) {
        return await saveImageBuffer(buffer);
      }
      log.warn("Runware returned no image, falling back to DALL-E");
    } catch (error) {
      log.warn(
        { err: toError(error) },
        "Runware failed, falling back to DALL-E",
      );
    }
  }

  // Fallback to DALL-E
  try {
    const response = await dalleClient.images.generate(
      {
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
        response_format: "b64_json",
      },
      { timeout: OPENAI_TIMEOUT_IMAGE_MS },
    );

    const imageData = response.data?.[0]?.b64_json;
    if (!imageData) {
      log.error("DALL-E returned no image data");
      return null;
    }

    return await saveImageBuffer(Buffer.from(imageData, "base64"));
  } catch (error) {
    log.error({ err: toError(error) }, "DALL-E image generation error");
    return null;
  }
}

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

async function saveImageBuffer(buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(
      `Image too large: ${buffer.length} bytes (max ${MAX_IMAGE_SIZE_BYTES})`,
    );
  }
  const filename = `recipe-${crypto.randomUUID()}.png`;
  const filepath = path.join(RECIPE_IMAGES_DIR, filename);
  await fs.promises.writeFile(filepath, buffer);
  return `/api/recipe-images/${filename}`;
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
    log.error(
      { err: toError(error) },
      "image generation failed, continuing without image",
    );
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
