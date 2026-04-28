import { z } from "zod";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { UserProfile } from "@shared/schema";
import type {
  RecipeContent,
  GeneratedIngredient,
} from "@shared/types/cook-session";
import {
  openai,
  dalleClient,
  OPENAI_TIMEOUT_HEAVY_MS,
  OPENAI_TIMEOUT_IMAGE_MS,
  MODEL_HEAVY,
} from "../lib/openai";
import {
  generateImage as runwareGenerateImage,
  isRunwareConfigured,
} from "../lib/runware";
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import { buildDietaryContext } from "../lib/dietary-context";
import { createServiceLogger, toError } from "../lib/logger";

const log = createServiceLogger("recipe-generation");

const RECIPE_IMAGES_DIR = path.resolve(process.cwd(), "uploads/recipe-images");
fs.mkdirSync(RECIPE_IMAGES_DIR, { recursive: true });

// Zod schemas for recipe generation
const ingredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.string().default(""),
  unit: z.string().default(""),
});

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
  ingredients: z.array(ingredientSchema).default([]),
  instructions: z
    .union([z.string(), z.array(instructionItemSchema)])
    .transform((v): string[] => {
      if (!Array.isArray(v)) {
        // Split single string on newlines into steps
        return v
          .split(/\n/)
          .map((s) => s.replace(/^\d+[\.\)\:\-]\s*/, "").trim())
          .filter((s) => s.length > 0);
      }
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
        .filter((s) => s.length > 0);
    })
    .pipe(z.array(z.string()).min(1)),
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
  ingredients: GeneratedIngredient[];
  instructions: string[];
  dietTags: string[];
  imageUrl: string | null;
}

/**
 * Parse a raw ingredient string like "200g rice noodles" or "3 tbsp fish sauce"
 * into a structured {name, quantity, unit} object.
 */
function parseIngredientString(raw: string): {
  name: string;
  quantity: string;
  unit: string;
} {
  // Try to match: quantity + unit + name
  const match = raw.match(
    /^(\d+(?:[\/\.]\d+)?)\s*(g|kg|ml|l|oz|lb|lbs|cup|cups|tbsp|tsp|tablespoons?|teaspoons?|ounces?|pounds?|bunch|head|clove|cloves|stalk|stalks|piece|pieces|slice|slices|can|cans|handful|pinch)?\s+(.+)$/i,
  );

  if (match) {
    return {
      quantity: match[1],
      unit: match[2] ?? "",
      name: match[3].trim(),
    };
  }

  // Try: "1 cucumber" (quantity + name, no unit)
  const simpleMatch = raw.match(/^(\d+(?:[\/\.]\d+)?)\s+(.+)$/);
  if (simpleMatch) {
    return {
      quantity: simpleMatch[1],
      unit: "",
      name: simpleMatch[2].trim(),
    };
  }

  // No quantity found — entire string is the name
  return { quantity: "", unit: "", name: raw };
}

/**
 * Generate recipe content using GPT-4
 */
export async function generateRecipeContent(
  input: RecipeGenerationInput,
): Promise<RecipeContent> {
  const dietaryContext = buildDietaryContext(input.userProfile, {
    allergenDetail: "basic",
    additionalPreferences: input.dietPreferences,
  });

  const servingsText = input.servings ? `for ${input.servings} servings` : "";
  const timeText = input.timeConstraint
    ? `Time constraint: ${sanitizeUserInput(input.timeConstraint)} or less.`
    : "";

  const sanitizedProductName = sanitizeUserInput(input.productName);

  const userParts: string[] = [
    `Create a recipe using "${sanitizedProductName}" as the main ingredient ${servingsText}.`.trim(),
  ];
  if (dietaryContext) userParts.push(`Dietary requirements: ${dietaryContext}`);
  if (timeText) userParts.push(timeText);

  const prompt = userParts.join("\n\n");

  let response;
  try {
    response = await openai.chat.completions.create(
      {
        model: MODEL_HEAVY,
        temperature: 0.7,
        max_completion_tokens: 2000,
        messages: [
          {
            role: "system",
            content: `You are a professional chef creating recipes for a nutrition tracking app. Recipes must be practical, nutritionally balanced, and easy to follow at home.

Guidelines:
- Use common, easy-to-find grocery-store ingredients.
- List each ingredient with a measured quantity and unit (e.g. "1 tbsp", "200 g"). Use "" for unit when the item is counted (e.g. "2" eggs).
- Write 5–12 concise instruction steps. Each step should describe one clear action.
- Adapt complexity to the user's cooking skill level when provided.
- Choose an accurate difficulty: Easy (≤ 5 ingredients, one-pot/no-cook), Medium (6–12 ingredients, standard techniques), Hard (12+ ingredients or advanced techniques).
- Include accurate prep + cook time in the timeEstimate.
- Tag with all applicable diet tags: "vegetarian", "vegan", "gluten-free", "dairy-free", "low-carb", "high-protein", "quick", "kid-friendly", etc.

ALLERGY SAFETY: If the user has listed allergens, NEVER include ingredients containing those allergens. Double-check every ingredient against the allergen list. Allergies are safety-critical — treat them as absolute exclusions.

Respond with a single JSON object matching this exact schema:
{
  "title": "string",
  "description": "string (1-2 sentences)",
  "difficulty": "Easy | Medium | Hard",
  "timeEstimate": "string (e.g. 30 min)",
  "ingredients": [{ "name": "string", "quantity": "string", "unit": "string" }],
  "instructions": ["string"],
  "dietTags": ["string"]
}

${SYSTEM_PROMPT_BOUNDARY}`,
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

  // Post-process: detect ingredients mixed into instructions
  const data = parsed.data;

  if (data.ingredients.length === 0 && data.instructions.length > 0) {
    // Handle edge case: "Instructions:" marker embedded at end of last ingredient line
    const normalizedInstructions = data.instructions.flatMap((s) => {
      const parts = s.split(/\n+/);
      return parts.map((p) => p.trim()).filter((p) => p.length > 0);
    });

    // Find the split point — look for "Instructions:" and "Ingredients:" markers
    const instructionsMarkerIdx = normalizedInstructions.findIndex((s) =>
      /^instructions:?\s*$/i.test(s.trim()),
    );
    const ingredientsMarkerIdx = normalizedInstructions.findIndex((s) =>
      /^ingredients:?\s*$/i.test(s.trim()),
    );

    if (ingredientsMarkerIdx !== -1 && instructionsMarkerIdx !== -1) {
      // Both markers found — extract ingredients between them
      const rawIngredients = normalizedInstructions.slice(
        ingredientsMarkerIdx + 1,
        instructionsMarkerIdx,
      );
      const actualInstructions = normalizedInstructions.slice(
        instructionsMarkerIdx + 1,
      );

      data.ingredients = rawIngredients
        .filter((s) => s.trim().length > 0)
        .map((s) => parseIngredientString(s.trim()));
      data.instructions = actualInstructions.filter((s) => s.trim().length > 0);
    } else if (ingredientsMarkerIdx !== -1) {
      // Only "Ingredients:" found — split: lines after marker until a cooking-verb line are ingredients
      const afterMarker = normalizedInstructions.slice(
        ingredientsMarkerIdx + 1,
      );
      const splitIdx = afterMarker.findIndex((s) =>
        /^(heat|preheat|cook|mix|combine|blend|stir|whisk|boil|bake|grill|sauté|roast|fry|place|arrange|serve|season|add|toss|drain|bring|set|pour|spread|layer|slice|chop|prepare|marinate|remove|transfer|let|allow|cover|simmer|reduce|fold|brush|drizzle|assemble|garnish|top|cut|dice|mince|julienne|shred|grate|peel|trim|rinse|pat|pound|flatten|stuff|wrap|roll|fill|line|grease|spray|dust|coat|dredge|bread|flour|dip|soak|squeeze|press|crush|smash|mash|puree|whip|beat|cream|knead|shape|form|scoop|spoon|ladle|sift)\b/i.test(
          s.trim(),
        ),
      );

      if (splitIdx > 0) {
        data.ingredients = afterMarker
          .slice(0, splitIdx)
          .filter((s) => s.trim().length > 0)
          .map((s) => parseIngredientString(s.trim()));
        data.instructions = afterMarker
          .slice(splitIdx)
          .filter((s) => s.trim().length > 0);
      }
    }
  }

  if (data.ingredients.length === 0) {
    log.warn(
      { title: data.title },
      "recipe generation produced no ingredients after post-processing",
    );
    throw new Error("Failed to generate valid recipe content");
  }

  return data;
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
  const prompt = `Professional food photography of "${safeTitle}" made with ${safeProduct}. Overhead 45-degree angle, natural window lighting, shallow depth of field. Plated on a neutral ceramic dish with fresh herb garnish. Clean minimalist background, photorealistic.`;

  // Try Runware first (much cheaper than DALL-E)
  if (isRunwareConfigured) {
    try {
      const buffer = await runwareGenerateImage({ prompt });
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

  // Fallback to DALL-E (no negative prompt support — embed exclusions in prompt)
  try {
    const dallePrompt = `${prompt} No text, no watermarks, no logos, no labels, no letters.`;
    const response = await dalleClient.images.generate(
      {
        model: "dall-e-3",
        prompt: dallePrompt,
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
 * Generate recipe content only. Image generation is kicked off separately
 * via generateAndPatchRecipeImage so the recipe is saved and returned to the
 * user without waiting for the image (which adds 5–30s).
 */
export async function generateFullRecipe(
  input: RecipeGenerationInput,
): Promise<GeneratedRecipe> {
  const content = await generateRecipeContent(input);
  return { ...content, imageUrl: null };
}

/**
 * Generate an image for a saved recipe and patch its imageUrl in the DB.
 * Intended to be called fire-and-forget after the recipe row is committed.
 */
export async function generateAndPatchRecipeImage(
  recipeId: number,
  recipeTitle: string,
  productName: string,
): Promise<void> {
  try {
    const imageUrl = await generateRecipeImage(recipeTitle, productName);
    if (imageUrl) {
      const { storage } = await import("../storage/index");
      await storage.updateCommunityRecipeImageUrl(recipeId, imageUrl);
    }
  } catch (error) {
    log.error(
      { err: toError(error), recipeId },
      "background image generation failed",
    );
  }
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
