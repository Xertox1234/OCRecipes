/**
 * Canonical recipe enrichment pipeline.
 *
 * Generates 3 high-quality images (hero, plated, ingredients), normalizes
 * ingredients/instructions, and calls GPT-4o for editorial content (detailed
 * instruction notes, tools required, chef tips, cuisine origin).
 *
 * Called fire-and-forget by the promotion job; failures are caught and logged
 * by the caller.
 */

import { createServiceLogger, toError } from "../lib/logger";
import { storage } from "../storage";
import {
  generateImage,
  saveImageBuffer,
  isRunwareConfigured,
  RUNWARE_MODEL_HQ,
} from "../lib/runware";
import {
  openai,
  dalleClient,
  MODEL_HEAVY,
  OPENAI_TIMEOUT_IMAGE_MS,
} from "../lib/openai";
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";

const log = createServiceLogger("canonical-enrichment");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorialContent {
  instructionDetails: (string | null)[];
  toolsRequired: { name: string; affiliateUrl?: string }[];
  chefTips: string[];
  cuisineOrigin: string;
}

interface IngredientInput {
  name: string;
  quantity: string;
  unit: string;
}

export interface EditorialInput {
  title: string;
  ingredients: IngredientInput[];
  instructions: string[];
}

// ---------------------------------------------------------------------------
// Unit normalization
// ---------------------------------------------------------------------------

const UNIT_NORMALIZATION_MAP: Record<string, string> = {
  tbs: "tablespoons",
  tbsp: "tablespoons",
  tsp: "teaspoons",
  ts: "teaspoons",
  oz: "ounce",
  fl: "fluid ounce",
  lb: "pound",
  lbs: "pound",
  g: "gram",
  kg: "kilogram",
  ml: "milliliter",
  l: "liter",
  c: "cup",
  pt: "pint",
  qt: "quart",
  gal: "gallon",
  pkg: "package",
  pkt: "packet",
};

function normalizeUnit(unit: string): string {
  const lower = unit.toLowerCase().trim();
  return (
    UNIT_NORMALIZATION_MAP[lower] ??
    UNIT_NORMALIZATION_MAP[lower.replace(/s$/, "")] ??
    unit
  );
}

function normalizeIngredients(
  ingredients: IngredientInput[],
): IngredientInput[] {
  return ingredients.map((ing) => ({
    ...ing,
    unit: ing.unit ? normalizeUnit(ing.unit) : ing.unit,
  }));
}

// ---------------------------------------------------------------------------
// Instruction normalization
// ---------------------------------------------------------------------------

/** Sentence-case a string: uppercase first char, lowercase the rest. */
function sentenceCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Ensure the instruction ends with a period (or other terminal punctuation). */
function ensureTerminalPeriod(s: string): string {
  const trimmed = s.trimEnd();
  if (/[.!?]$/.test(trimmed)) return trimmed;
  return trimmed + ".";
}

function normalizeInstructions(instructions: string[]): string[] {
  return instructions.map((step) => ensureTerminalPeriod(sentenceCase(step)));
}

// ---------------------------------------------------------------------------
// Image generation — 3 shots per recipe
// ---------------------------------------------------------------------------

const IMAGE_SHOTS: { label: string; prompt: (title: string) => string }[] = [
  {
    label: "hero",
    prompt: (title) =>
      `Professional food photography of "${title}". Overhead 45-degree angle, natural window lighting, shallow depth of field. Plated beautifully on a neutral ceramic dish with fresh herb garnish. Clean minimalist background, photorealistic.`,
  },
  {
    label: "plated",
    prompt: (title) =>
      `Close-up food photography of a perfect serving of "${title}". Eye-level angle, warm soft lighting, rustic wooden table setting. Garnished with fresh herbs and a lemon wedge. Photorealistic, appetising.`,
  },
  {
    label: "ingredients",
    prompt: (title) =>
      `Flat lay of all raw ingredients required to make "${title}" arranged neatly on a white marble surface. Clear natural lighting, sharp focus, photorealistic food photography. No text or labels.`,
  },
];

async function generateSingleImage(
  title: string,
  shot: (typeof IMAGE_SHOTS)[number],
): Promise<string | null> {
  const safeTitle = sanitizeUserInput(title);
  const prompt = shot.prompt(safeTitle);

  // Try Runware HQ model first
  if (isRunwareConfigured) {
    try {
      const buffer = await generateImage({ prompt, model: RUNWARE_MODEL_HQ });
      if (buffer) {
        return await saveImageBuffer(buffer);
      }
      log.warn(
        { shot: shot.label },
        "Runware returned no image, falling back to DALL-E",
      );
    } catch (err) {
      log.warn(
        { err: toError(err), shot: shot.label },
        "Runware failed, falling back to DALL-E",
      );
    }
  }

  // DALL-E 3 fallback
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
      log.error({ shot: shot.label }, "DALL-E returned no image data");
      return null;
    }
    return await saveImageBuffer(Buffer.from(imageData, "base64"));
  } catch (err) {
    log.error(
      { err: toError(err), shot: shot.label },
      "DALL-E image generation error",
    );
    return null;
  }
}

/**
 * Generate all 3 canonical images (hero, plated, ingredients) sequentially
 * (one at a time) to avoid rate-limit bursts.
 * Individual failures are skipped gracefully — returns only successful URLs.
 */
async function generateCanonicalImages(title: string): Promise<string[]> {
  const urls: string[] = [];
  for (const shot of IMAGE_SHOTS) {
    const url = await generateSingleImage(title, shot);
    if (url) urls.push(url);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// GPT-4o editorial content
// ---------------------------------------------------------------------------

const EDITORIAL_FALLBACK: EditorialContent = {
  instructionDetails: [],
  toolsRequired: [],
  chefTips: [],
  cuisineOrigin: "",
};

/**
 * Generate AI editorial content for a recipe: detailed instruction notes,
 * required tools, chef tips, and cuisine origin.
 *
 * Exported for testing.
 */
export async function generateEditorialContent(
  input: EditorialInput,
): Promise<EditorialContent> {
  const safeTitle = sanitizeUserInput(input.title);

  const ingredientList = input.ingredients
    .map(
      (i) =>
        `${i.quantity ? i.quantity + " " : ""}${i.unit ? i.unit + " " : ""}${i.name}`,
    )
    .join(", ");

  const instructionList = input.instructions
    .map((step, idx) => `${idx + 1}. ${step}`)
    .join("\n");

  const systemPrompt =
    `You are an expert culinary editor. Your role is to enrich recipe content with professional detail.\n` +
    SYSTEM_PROMPT_BOUNDARY;

  const userPrompt =
    `Recipe: "${safeTitle}"\n` +
    `Ingredients: ${ingredientList || "not specified"}\n\n` +
    `Instructions:\n${instructionList || "not specified"}\n\n` +
    `Return a JSON object with these fields:\n` +
    `- instructionDetails: string[] — one concise professional elaboration per instruction step (same length as steps array; null if no elaboration needed)\n` +
    `- toolsRequired: Array<{name: string, affiliateUrl: null}> — specific tools/equipment needed\n` +
    `- chefTips: string[] — 2-4 professional tips for best results\n` +
    `- cuisineOrigin: string — the cuisine style (e.g. "Italian", "Mexican", "Japanese")\n\n` +
    `Respond with valid JSON only, no markdown fences.`;

  try {
    const completion = await openai.chat.completions.create(
      {
        model: MODEL_HEAVY,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      },
      { timeout: OPENAI_TIMEOUT_IMAGE_MS },
    );

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      log.warn("GPT-4o returned no content for editorial generation");
      return EDITORIAL_FALLBACK;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      log.warn(
        { raw: raw.slice(0, 200) },
        "Failed to parse GPT-4o editorial JSON",
      );
      return EDITORIAL_FALLBACK;
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>).instructionDetails) ||
      !Array.isArray((parsed as Record<string, unknown>).toolsRequired) ||
      !Array.isArray((parsed as Record<string, unknown>).chefTips)
    ) {
      log.warn("GPT-4o editorial response has unexpected shape");
      return EDITORIAL_FALLBACK;
    }

    const data = parsed as {
      instructionDetails: (string | null)[];
      toolsRequired: { name: string; affiliateUrl: string | null }[];
      chefTips: string[];
      cuisineOrigin: string;
    };

    // Pad instructionDetails to match the number of instruction steps so
    // callers indexing by step position always get string | null, not undefined.
    const padded: (string | null)[] = Array.from(
      { length: input.instructions.length },
      (_, i) => data.instructionDetails[i] ?? null,
    );

    return {
      instructionDetails: padded,
      toolsRequired: data.toolsRequired.map((t) => ({
        name: t.name,
        affiliateUrl: t.affiliateUrl ?? undefined,
      })),
      chefTips: data.chefTips,
      cuisineOrigin: data.cuisineOrigin ?? "",
    };
  } catch (err) {
    log.error(
      { err: toError(err) },
      "GPT-4o editorial content generation failed",
    );
    return EDITORIAL_FALLBACK;
  }
}

// ---------------------------------------------------------------------------
// Main enrichment entry point
// ---------------------------------------------------------------------------

/**
 * Enrich a newly-promoted canonical recipe.
 * Called fire-and-forget by the promotion job; failures are caught and logged
 * by the caller.
 */
export async function enrichRecipe(recipeId: number): Promise<void> {
  log.info({ recipeId }, "Starting canonical enrichment");

  // 1. Fetch recipe
  const recipe = await storage.getRecipeById(recipeId);
  if (!recipe) {
    throw new Error(`Recipe ${recipeId} not found`);
  }

  // Idempotency guard — don't re-enrich already-enriched recipes
  if (recipe.canonicalEnrichedAt !== null) {
    log.info({ recipeId }, "recipe already enriched, skipping");
    return;
  }

  // 2. Generate 3 HQ images (hero, plated, ingredients)
  const canonicalImages = await generateCanonicalImages(recipe.title);
  log.info(
    { recipeId, imageCount: canonicalImages.length },
    "Canonical images generated",
  );

  // 3. Normalize ingredients and instructions
  const rawIngredients = recipe.ingredients ?? [];
  const normalizedIngredients = normalizeIngredients(rawIngredients);
  const normalizedInstructions = normalizeInstructions(
    recipe.instructions ?? [],
  );

  // 4. Generate editorial content via GPT-4o
  const editorial = await generateEditorialContent({
    title: recipe.title,
    ingredients: normalizedIngredients,
    instructions: normalizedInstructions,
  });

  // 5. Persist enrichment results
  await storage.markEnriched(recipeId, {
    canonicalImages,
    instructionDetails: editorial.instructionDetails,
    toolsRequired: editorial.toolsRequired,
    chefTips: editorial.chefTips,
    cuisineOrigin: editorial.cuisineOrigin,
  });

  log.info({ recipeId }, "Canonical enrichment complete");
}
