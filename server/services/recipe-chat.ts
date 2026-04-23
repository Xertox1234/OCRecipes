import { z } from "zod";
import type { ChatMessage, UserProfile } from "@shared/schema";
import {
  detectAllergens,
  type AllergenMatch,
} from "@shared/constants/allergens";
import {
  openai,
  OPENAI_TIMEOUT_HEAVY_MS,
  OPENAI_TIMEOUT_IMAGE_MS,
  MODEL_HEAVY,
} from "../lib/openai";
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import { buildDietaryContext } from "../lib/dietary-context";
import { generateRecipeImage } from "./recipe-generation";
import { createServiceLogger, toError } from "../lib/logger";

const log = createServiceLogger("recipe-chat");

// ============================================================================
// TYPES
// ============================================================================

/**
 * SSE events emitted by the recipe chat generator.
 * The client extends the existing { content, done } protocol by checking for
 * optional `recipe`, `imageUrl`, and `allergenWarning` fields.
 */
export type RecipeChatSSEEvent =
  | { content: string }
  | {
      content: "";
      recipe: RecipeChatRecipe;
      allergenWarning: string | null;
      messageId?: number;
    }
  | { content: ""; imageUrl: string; messageId?: number }
  | { content: ""; imageUnavailable: true }
  | { done: true };

export interface RecipeChatRecipe {
  title: string;
  description: string;
  difficulty: "Easy" | "Medium" | "Hard";
  timeEstimate: string;
  servings: number;
  ingredients: { name: string; quantity: string; unit: string }[];
  instructions: string[];
  dietTags: string[];
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

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

const recipeResponseSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  timeEstimate: z.string().min(1).max(50),
  servings: z.number().int().min(1).max(20).default(2),
  ingredients: z.array(ingredientSchema).min(1),
  instructions: z
    .union([z.string(), z.array(instructionItemSchema)])
    .transform((v): string[] => {
      if (!Array.isArray(v)) {
        return v
          .split(/\n/)
          .map((s) => s.replace(/^\d+[\.\)\:\-]\s*/, "").trim())
          .filter((s) => s.length > 0);
      }
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

// Re-export shared schema for consumers that already import from this file
export {
  recipeChatMetadataSchema,
  type RecipeChatMetadata,
} from "@shared/schemas/recipe-chat";

// ============================================================================
// CONTEXT BUILDING
// ============================================================================

/**
 * Build the OpenAI message array from conversation history.
 * Pure function — unit testable.
 *
 * Strategy: include last `maxMessages` messages. For the most recent recipe
 * card, include full JSON. For older recipe cards, include only title+servings
 * summary to save tokens.
 */
export function buildRecipeContext(
  messages: ChatMessage[],
  maxMessages = 10,
): { role: "user" | "assistant" | "system"; content: string }[] {
  const recent = messages.slice(-maxMessages);
  let foundLatestRecipe = false;

  // Process in reverse to find the most recent recipe first
  const processed = [...recent].reverse().map((msg) => {
    const metadata = msg.metadata as Record<string, unknown> | null;
    const recipe = metadata?.recipe as RecipeChatRecipe | undefined;

    let content = msg.content;

    if (recipe && msg.role === "assistant") {
      if (!foundLatestRecipe) {
        // Most recent recipe — include full JSON for refinement context
        foundLatestRecipe = true;
        content = `${msg.content}\n\n[Recipe: ${JSON.stringify(recipe)}]`;
      } else {
        // Older recipe — summary only
        content = `${msg.content}\n\n[Previous recipe: "${recipe.title}", ${recipe.servings} servings]`;
      }
    }

    return {
      role: msg.role as "user" | "assistant",
      content,
    };
  });

  // Reverse back to chronological order
  return processed.reverse();
}

function buildSystemPrompt(
  userProfile: UserProfile | null | undefined,
  imageAnalysis?: string,
): string {
  const parts = [
    "You are RecipeChef, a creative and knowledgeable AI chef built into the OCRecipes nutrition tracking app.",
    "Help users create delicious, nutritionally balanced recipes based on their requests.",
    "Be conversational and enthusiastic about cooking. Keep preamble brief (1-2 sentences).",
    "",
    "When the user asks for a recipe (or refines one), respond with:",
    "1. A brief conversational intro (1-2 sentences)",
    "2. Then output a JSON recipe object on a NEW LINE, starting with ```json and ending with ```",
    "",
    "The JSON must match this exact schema:",
    "{",
    '  "title": "string",',
    '  "description": "string (1-2 sentences)",',
    '  "difficulty": "Easy | Medium | Hard",',
    '  "timeEstimate": "string (e.g. 30 min)",',
    '  "servings": number,',
    '  "ingredients": [{ "name": "string", "quantity": "string", "unit": "string" }],',
    '  "instructions": ["string"],',
    '  "dietTags": ["string"]',
    "}",
    "",
    "Guidelines:",
    "- Use common, easy-to-find grocery-store ingredients",
    "- List each ingredient with measured quantity and unit",
    "- Write 5-12 concise instruction steps",
    "- Include accurate prep + cook time in timeEstimate",
    "- Tag with applicable diet tags: vegetarian, vegan, gluten-free, dairy-free, low-carb, high-protein, quick, kid-friendly",
    "",
  ];

  // User dietary context
  const dietaryContext = buildDietaryContext(userProfile, {
    allergenDetail: "basic",
  });
  if (dietaryContext) {
    parts.push("USER DIETARY PROFILE:");
    parts.push(dietaryContext);
    parts.push(
      "ALLERGY SAFETY: NEVER include ingredients containing listed allergens. Double-check every ingredient. Allergies are safety-critical — treat them as absolute exclusions.",
    );
    parts.push("");
  }

  // Image analysis context
  if (imageAnalysis) {
    parts.push(
      "IMAGE ANALYSIS (ingredients detected from user's photo):",
      sanitizeUserInput(imageAnalysis),
      "",
    );
  }

  parts.push(SYSTEM_PROMPT_BOUNDARY);
  return parts.join("\n");
}

/**
 * Build a system prompt for the recipe remix flow.
 * Instructs the AI to MODIFY the original recipe rather than generate a new one.
 */
export function buildRemixSystemPrompt(
  originalRecipe: {
    title: string;
    ingredients: { name: string; quantity: string; unit: string }[];
    instructions: string[];
    dietTags: string[];
    description?: string | null;
    difficulty?: string | null;
    timeEstimate?: string | null;
    servings?: number | null;
  },
  userProfile: UserProfile | null | undefined,
): string {
  const parts = [
    "You are RecipeChef, a creative AI chef built into the OCRecipes app.",
    "The user wants to REMIX an existing recipe. Your job is to MODIFY the recipe based on their request.",
    "",
    "IMPORTANT RULES:",
    "- Preserve the original recipe's structure, style, and format",
    "- Only change what the user specifically requests",
    "- Keep the same number of instruction steps when possible",
    "- Adjust quantities proportionally when swapping ingredients",
    "- Update dietTags to reflect the changes (e.g., add 'dairy-free' if dairy was removed)",
    "- Give the remix a new title that reflects the changes (e.g., 'Dairy-Free Chicken Alfredo')",
    "",
    "ORIGINAL RECIPE TO MODIFY:",
    "```json",
    JSON.stringify(
      {
        title: sanitizeUserInput(originalRecipe.title),
        description: sanitizeUserInput(originalRecipe.description ?? ""),
        difficulty: originalRecipe.difficulty,
        timeEstimate: originalRecipe.timeEstimate,
        servings: originalRecipe.servings,
        ingredients: originalRecipe.ingredients.map((i) => ({
          name: sanitizeUserInput(i.name),
          quantity: i.quantity,
          unit: i.unit,
        })),
        instructions: originalRecipe.instructions.map(sanitizeUserInput),
        dietTags: originalRecipe.dietTags,
      },
      null,
      2,
    ),
    "```",
    "",
    "When the user describes changes, respond with:",
    "1. A brief conversational note about the changes (1-2 sentences)",
    "2. Then output the MODIFIED recipe as a JSON object on a NEW LINE, starting with ```json and ending with ```",
    "",
    "The JSON must match this exact schema:",
    "{",
    '  "title": "string",',
    '  "description": "string (1-2 sentences)",',
    '  "difficulty": "Easy | Medium | Hard",',
    '  "timeEstimate": "string (e.g. 30 min)",',
    '  "servings": number,',
    '  "ingredients": [{ "name": "string", "quantity": "string", "unit": "string" }],',
    '  "instructions": ["string"],',
    '  "dietTags": ["string"]',
    "}",
    "",
  ];

  // User dietary context
  const dietaryContext = buildDietaryContext(userProfile, {
    allergenDetail: "basic",
  });
  if (dietaryContext) {
    parts.push("USER DIETARY PROFILE:");
    parts.push(dietaryContext);
    parts.push(
      "ALLERGY SAFETY: NEVER include ingredients containing listed allergens. Double-check every ingredient. Allergies are safety-critical — treat them as absolute exclusions.",
    );
    parts.push("");
  }

  parts.push(SYSTEM_PROMPT_BOUNDARY);
  return parts.join("\n");
}

// ============================================================================
// ALLERGEN CHECK
// ============================================================================

/**
 * Run deterministic allergen detection on recipe ingredients against user allergies.
 * Uses the shared detectAllergens() with ALLERGEN_INGREDIENT_MAP for reliable matching.
 */
export function checkRecipeAllergens(
  ingredients: { name: string }[],
  userProfile: UserProfile | null | undefined,
): string | null {
  if (!userProfile?.allergies || !Array.isArray(userProfile.allergies)) {
    return null;
  }

  const allergies = userProfile.allergies as {
    name: string;
    severity: string;
  }[];
  if (allergies.length === 0) return null;

  const ingredientNames = ingredients.map((i) => i.name);
  const matches: AllergenMatch[] = detectAllergens(
    ingredientNames,
    allergies as Parameters<typeof detectAllergens>[1],
  );

  if (matches.length === 0) return null;

  const uniqueAllergens = [...new Set(matches.map((m) => m.allergenId))];
  return `Potential allergens detected: ${uniqueAllergens.join(", ")}. Please verify all ingredients before cooking.`;
}

// ============================================================================
// STREAMING GENERATOR
// ============================================================================

/**
 * Generate a recipe chat response as an async generator of SSE events.
 *
 * Flow:
 * 1. Stream conversational text from GPT-4o
 * 2. Extract and validate JSON recipe from the response
 * 3. Run deterministic allergen check
 * 4. Yield recipe card event
 * 5. Fire-and-forget image generation, yield image event when done
 */
export async function* generateRecipeChatResponse(
  conversationMessages: {
    role: "user" | "assistant" | "system";
    content: string;
  }[],
  userProfile: UserProfile | null | undefined,
  imageAnalysis?: string,
  options?: { systemPromptOverride?: string },
): AsyncGenerator<RecipeChatSSEEvent> {
  const systemPrompt =
    options?.systemPromptOverride ??
    buildSystemPrompt(userProfile, imageAnalysis);

  // Sanitize user messages
  const sanitizedMessages = conversationMessages.map((m) => ({
    role: m.role,
    content: m.role === "user" ? sanitizeUserInput(m.content) : m.content,
  }));

  let stream;
  try {
    stream = await openai.chat.completions.create(
      {
        model: MODEL_HEAVY,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          ...sanitizedMessages,
        ],
        max_completion_tokens: 2000,
        temperature: 0.7,
      },
      { timeout: OPENAI_TIMEOUT_HEAVY_MS },
    );
  } catch (error) {
    log.error({ err: toError(error) }, "recipe chat API error");
    yield {
      content:
        "Sorry, I'm having trouble generating a recipe right now. Please try again.",
    };
    yield { done: true };
    return;
  }

  let fullResponse = "";

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullResponse += delta;
        yield { content: delta };
      }
    }
  } catch (error) {
    log.error({ err: toError(error) }, "recipe chat streaming error");
    yield {
      content: "\n\nSorry, the response was interrupted. Please try again.",
    };
    yield { done: true };
    return;
  }

  // Extract JSON recipe from the response
  const recipe = extractRecipeFromResponse(fullResponse);

  if (recipe) {
    // Run deterministic allergen check
    const allergenWarning = checkRecipeAllergens(
      recipe.ingredients,
      userProfile,
    );

    yield {
      content: "",
      recipe,
      allergenWarning,
    };

    // Await image generation with timeout — yield image event (imageUrl or imageUnavailable) before done
    try {
      const imageUrl = await Promise.race([
        generateRecipeImage(
          recipe.title,
          recipe.ingredients.map((i) => i.name).join(", "),
        ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
      ]);
      if (imageUrl) {
        yield { content: "", imageUrl };
      } else {
        yield { content: "", imageUnavailable: true };
      }
    } catch (error) {
      log.warn({ err: toError(error) }, "recipe image generation failed");
      yield { content: "", imageUnavailable: true };
    }
  }

  yield { done: true };
}

/**
 * Extract and validate a JSON recipe from the LLM response text.
 * Looks for JSON within ```json ... ``` fences or bare { ... } objects.
 */
function extractRecipeFromResponse(text: string): RecipeChatRecipe | null {
  // Try fenced JSON first
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fencedMatch) {
    return parseRecipeJson(fencedMatch[1]);
  }

  // Try bare JSON object
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return parseRecipeJson(text.slice(braceStart, braceEnd + 1));
  }

  return null;
}

function parseRecipeJson(jsonString: string): RecipeChatRecipe | null {
  try {
    const parsed = JSON.parse(jsonString.trim());
    const validated = recipeResponseSchema.safeParse(parsed);
    if (!validated.success) {
      log.warn(
        { zodErrors: validated.error.flatten() },
        "recipe chat JSON validation failed",
      );
      return null;
    }
    return validated.data;
  } catch (error) {
    log.warn({ err: toError(error) }, "recipe chat JSON parse error");
    return null;
  }
}

// ============================================================================
// IMAGE ANALYSIS
// ============================================================================

/**
 * Analyze an uploaded image for food ingredients using OpenAI Vision.
 * Returns a plain text ingredient list.
 */
export async function analyzeImageForRecipe(
  imageBase64: string,
  mimeType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
): Promise<string> {
  try {
    const response = await openai.chat.completions.create(
      {
        model: MODEL_HEAVY,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Identify all food ingredients visible in this image. List each ingredient on a new line. Only list ingredients you can clearly identify. If this is not a food image, say 'No food ingredients detected.'",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`,
                  detail: "low",
                },
              },
            ],
          },
        ],
        max_completion_tokens: 500,
        temperature: 0.3,
      },
      { timeout: OPENAI_TIMEOUT_IMAGE_MS },
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Vision API returned empty response");
    }

    return sanitizeUserInput(content);
  } catch (error) {
    log.error({ err: toError(error) }, "image analysis error");
    throw new Error("Failed to analyze image. Please try again.");
  }
}

// ============================================================================
// SUGGESTION CHIPS
// ============================================================================

export const RECIPE_SUGGESTION_CHIPS = [
  {
    label: "Quick & Easy",
    prompt: "Give me a quick and easy recipe I can make in under 20 minutes",
  },
  {
    label: "High Protein",
    prompt: "Create a high-protein meal for post-workout recovery",
  },
  { label: "Italian", prompt: "Make me an authentic Italian dinner" },
  { label: "Comfort Food", prompt: "I want something warm and comforting" },
  { label: "Kid-Friendly", prompt: "Create a healthy kid-friendly meal" },
  { label: "Low Carb", prompt: "Give me a delicious low-carb dinner option" },
  {
    label: "Budget Friendly",
    prompt: "Create a tasty meal using affordable ingredients",
  },
  { label: "Date Night", prompt: "Create an impressive dinner for two" },
];
