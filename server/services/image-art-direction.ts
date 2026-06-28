// server/services/image-art-direction.ts
import crypto from "node:crypto";
import { z } from "zod";
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import {
  openai,
  MODEL_FAST,
  isAiConfigured,
  OPENAI_TIMEOUT_FAST_MS,
} from "../lib/openai";
import { createServiceLogger, toError } from "../lib/logger";

export type ImageVariant = "hero" | "plated" | "ingredients";

export interface RecipeImageContext {
  title: string;
  productName?: string;
  cuisine?: string | null;
  mealTypes?: string[] | null;
  ingredients?: string[];
}

export interface ArtDirection {
  angle: string;
  surface: string;
  background: string;
  lighting: string;
  palette: string;
  props: string;
  mood: string;
  season?: string;
}

interface CuisineStyle {
  palette: string[];
  surfaces: string[];
  props: string[];
  backgrounds: string[];
}

// Each entry holds SETS, not single values, so two recipes of the same cuisine
// don't collide — the per-recipe seed picks a different member.
const CUISINE_STYLES: Record<string, CuisineStyle> = {
  italian: {
    palette: [
      "warm reds and terracotta",
      "rustic earth tones",
      "olive and cream",
    ],
    surfaces: [
      "a warm rustic walnut board",
      "a weathered marble slab",
      "a linen-draped table",
    ],
    props: [
      "a linen napkin and olive oil cruet",
      "fresh basil and a parmesan wedge",
      "a glass of red wine, softly blurred",
    ],
    backgrounds: [
      "a soft blurred trattoria interior",
      "warm out-of-focus kitchen depth",
      "a sunlit stone wall, blurred",
    ],
  },
  mexican: {
    palette: [
      "vibrant reds, limes and warm yellows",
      "earthy chili tones",
      "bright festive colours",
    ],
    surfaces: [
      "a hand-painted terracotta tile",
      "a rough wooden table",
      "a woven textile runner",
    ],
    props: [
      "lime wedges and fresh cilantro",
      "a small bowl of salsa",
      "dried chilies, softly blurred",
    ],
    backgrounds: [
      "warm adobe-toned negative space",
      "a blurred rustic cantina",
      "bright airy depth",
    ],
  },
  japanese: {
    palette: [
      "cool greens and charcoal",
      "muted minimal neutrals",
      "indigo and stone",
    ],
    surfaces: [
      "honed black slate",
      "pale natural light wood",
      "a textured ceramic mat",
    ],
    props: [
      "chopsticks and a ceramic teacup",
      "a sprig of shiso",
      "a small dipping dish",
    ],
    backgrounds: [
      "clean minimal grey depth",
      "soft shoji-screen light, blurred",
      "moody dark negative space",
    ],
  },
  indian: {
    palette: [
      "warm saffron and turmeric tones",
      "deep spice reds",
      "earthy golds",
    ],
    surfaces: [
      "a hammered brass platter",
      "a dark carved wood table",
      "a vibrant textile",
    ],
    props: [
      "whole spices and fresh coriander",
      "a small brass bowl",
      "naan, softly blurred",
    ],
    backgrounds: [
      "warm dark spice-toned depth",
      "a blurred market scene",
      "moody golden negative space",
    ],
  },
  thai: {
    palette: [
      "lush greens and chili reds",
      "tropical brights",
      "lemongrass and lime",
    ],
    surfaces: ["a fresh banana leaf", "dark teak wood", "a woven bamboo mat"],
    props: [
      "lime, lemongrass and chili",
      "a sprig of thai basil",
      "a small bowl of jasmine rice",
    ],
    backgrounds: [
      "dark moody tropical depth",
      "blurred lush greenery",
      "warm dim negative space",
    ],
  },
  mediterranean: {
    palette: [
      "sun-bleached blues and whites",
      "olive and lemon tones",
      "warm sandstone",
    ],
    surfaces: [
      "whitewashed weathered wood",
      "a stone tabletop",
      "a ceramic mosaic tile",
    ],
    props: [
      "lemon halves and fresh herbs",
      "a drizzle of olive oil",
      "olives in a small dish",
    ],
    backgrounds: [
      "bright airy coastal depth",
      "a sunlit blurred terrace",
      "soft white negative space",
    ],
  },
  french: {
    palette: [
      "elegant creams and golds",
      "soft butter tones",
      "muted classic neutrals",
    ],
    surfaces: [
      "a polished marble counter",
      "a vintage copper surface",
      "white linen",
    ],
    props: [
      "a sprig of thyme and a butter knife",
      "a glass of white wine, blurred",
      "a folded linen napkin",
    ],
    backgrounds: [
      "soft bistro depth, blurred",
      "elegant muted negative space",
      "warm window light, blurred",
    ],
  },
  chinese: {
    palette: [
      "deep reds and golds",
      "warm soy-glazed tones",
      "rich earthy browns",
    ],
    surfaces: [
      "dark lacquered wood",
      "a bamboo steamer mat",
      "a textured stone slab",
    ],
    props: [
      "chopsticks and a tea bowl",
      "scallions and sesame",
      "a small dish of chili oil",
    ],
    backgrounds: [
      "warm dim restaurant depth",
      "moody dark negative space",
      "blurred bamboo screen",
    ],
  },
  korean: {
    palette: [
      "warm gochujang reds",
      "earthy fermented tones",
      "sesame and scallion greens",
    ],
    surfaces: [
      "a dark stone bowl setting",
      "brushed steel",
      "natural dark wood",
    ],
    props: [
      "banchan dishes, softly blurred",
      "sesame seeds and scallion",
      "metal chopsticks",
    ],
    backgrounds: [
      "moody warm depth",
      "clean dark negative space",
      "a blurred grill setting",
    ],
  },
  "middle eastern": {
    palette: [
      "warm spice and saffron tones",
      "deep jewel reds",
      "earthy golds and greens",
    ],
    surfaces: ["an ornate patterned tile", "a brass tray", "dark carved wood"],
    props: [
      "pomegranate seeds and mint",
      "a small bowl of tahini",
      "warm flatbread, blurred",
    ],
    backgrounds: [
      "warm dim mosaic depth",
      "moody golden negative space",
      "a blurred souk scene",
    ],
  },
  american: {
    palette: [
      "warm comforting tones",
      "bright fresh colours",
      "classic diner reds",
    ],
    surfaces: ["a rustic wooden board", "brushed metal", "a checked cloth"],
    props: [
      "a side of fries, softly blurred",
      "fresh herbs",
      "a cold drink, blurred",
    ],
    backgrounds: [
      "warm casual depth",
      "bright airy negative space",
      "a blurred diner interior",
    ],
  },
  default: {
    palette: [
      "warm natural tones",
      "fresh appetizing colours",
      "soft balanced neutrals",
    ],
    surfaces: [
      "a warm rustic wooden board",
      "a clean light marble slab",
      "a textured ceramic surface",
    ],
    props: [
      "fresh herbs and a linen napkin",
      "complementary garnish",
      "a simple side, softly blurred",
    ],
    backgrounds: [
      "soft blurred kitchen depth",
      "bright airy negative space",
      "warm out-of-focus background",
    ],
  },
};

const ANGLES: Record<ImageVariant, string[]> = {
  hero: [
    "an overhead flat-lay shot",
    "a 45-degree three-quarter angle",
    "a low hero angle",
  ],
  plated: [
    "an eye-level straight-on shot",
    "a 45-degree three-quarter close-up",
    "a macro close-up",
  ],
  ingredients: ["an overhead flat-lay", "a neat 45-degree flat-lay"],
};

const MEAL_LIGHTING: Record<string, string> = {
  breakfast: "bright morning window light",
  brunch: "bright late-morning light",
  lunch: "soft midday daylight",
  dinner: "warm golden-hour evening glow",
  dessert: "soft diffused light",
  snack: "soft diffused daylight",
};
const DEFAULT_LIGHTING = "soft diffused daylight";

const MOODS = [
  "cozy and rustic",
  "clean and editorial",
  "vibrant and fresh",
  "warm and inviting",
];

function pickIndex(seed: string, modulo: number): number {
  if (modulo <= 0) return 0;
  const digest = crypto.createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % modulo;
}

function pick<T>(arr: T[], seed: string, salt: string): T {
  return arr[pickIndex(`${seed}::${salt}`, arr.length)];
}

function normalizeCuisineKey(cuisine?: string | null): string {
  if (!cuisine) return "default";
  const key = cuisine.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CUISINE_STYLES, key)
    ? key
    : "default";
}

function lightingForMealTypes(mealTypes?: string[] | null): string {
  for (const mt of mealTypes ?? []) {
    const k = mt.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(MEAL_LIGHTING, k))
      return MEAL_LIGHTING[k];
  }
  return DEFAULT_LIGHTING;
}

export function selectDeterministicArtDirection(
  ctx: RecipeImageContext,
  variant: ImageVariant,
): ArtDirection {
  // Seed on title (stable, always present; recipeId is not in the context —
  // recipe-chat generates before a DB id exists, so title is the uniform seed).
  const seed = `${ctx.title}|${variant}`;
  const style = CUISINE_STYLES[normalizeCuisineKey(ctx.cuisine)];
  return {
    angle: pick(ANGLES[variant], seed, "angle"),
    surface: pick(style.surfaces, seed, "surface"),
    background: pick(style.backgrounds, seed, "background"),
    palette: pick(style.palette, seed, "palette"),
    props: pick(style.props, seed, "props"),
    lighting: lightingForMealTypes(ctx.mealTypes),
    mood: pick(MOODS, seed, "mood"),
  };
}

const HOUSE_STYLE_PREFIX = "Premium editorial food photography of";
const HOUSE_STYLE_SUFFIX =
  "Photorealistic, appetizing, natural food textures, intentional composition, professional color grading, shallow depth of field where appropriate.";

export function subjectFor(
  ctx: RecipeImageContext,
  variant: ImageVariant,
): string {
  const title = sanitizeUserInput(ctx.title);
  if (variant === "ingredients") {
    return `the raw ingredients for "${title}", neatly arranged`;
  }
  const made = ctx.productName
    ? ` made with ${sanitizeUserInput(ctx.productName)}`
    : "";
  return `a beautifully plated serving of "${title}"${made}`;
}

export function composePrompt(subject: string, art: ArtDirection): string {
  const seasonClause = art.season ? `, ${art.season} seasonal feel` : "";
  return [
    `${HOUSE_STYLE_PREFIX} ${subject}.`,
    `Shot as ${art.angle} under ${art.lighting}.`,
    `Presented on ${art.surface} against ${art.background}.`,
    `Styled with ${art.props}; ${art.palette} colour palette; ${art.mood} mood${seasonClause}.`,
    HOUSE_STYLE_SUFFIX,
  ].join(" ");
}

// ─── LLM art-director pre-pass ───────────────────────────────────────────────

const log = createServiceLogger("image-art-direction");

const ArtDirectionLLMSchema = z.object({
  angle: z.string().min(1).max(60),
  surface: z.string().min(1).max(80),
  background: z.string().min(1).max(80),
  lighting: z.string().min(1).max(80),
  palette: z.string().min(1).max(80),
  props: z.string().min(1).max(100),
  mood: z.string().min(1).max(60),
  season: z.string().max(40).optional(),
});

function sanitizeField(s: string): string {
  return s
    .replace(/[\r\n"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isArtDirectorLLMEnabled(): boolean {
  return isAiConfigured && process.env.IMAGE_ART_DIRECTOR_LLM !== "off";
}

export async function resolveArtDirection(
  ctx: RecipeImageContext,
  variant: ImageVariant,
  opts?: { skipLLM?: boolean },
): Promise<ArtDirection> {
  const deterministic = selectDeterministicArtDirection(ctx, variant);
  if (opts?.skipLLM || !isArtDirectorLLMEnabled()) return deterministic;

  try {
    const safeTitle = sanitizeUserInput(ctx.title);
    const safeCuisine = ctx.cuisine
      ? sanitizeUserInput(ctx.cuisine)
      : "unspecified";
    const safeMeals =
      (ctx.mealTypes ?? []).map(sanitizeUserInput).join(", ") || "unspecified";
    const safeIngredients =
      (ctx.ingredients ?? []).slice(0, 12).map(sanitizeUserInput).join(", ") ||
      "unspecified";

    const systemPrompt =
      `You are a professional food-photography art director. Propose art direction that makes a dish look like a premium editorial food photo — NOT a generic plain-white-background stock image. Tailor angle, surface, background, lighting, palette, props, mood, and season to the dish, its cuisine, and when it is eaten.\n` +
      SYSTEM_PROMPT_BOUNDARY;

    const userPrompt =
      `Dish: "${safeTitle}"\n` +
      `Cuisine: ${safeCuisine}\n` +
      `Meal types: ${safeMeals}\n` +
      `Key ingredients: ${safeIngredients}\n` +
      `Shot type: ${variant}\n\n` +
      `Refine (do not ignore) this starting point: ${JSON.stringify(deterministic)}\n\n` +
      `Return a JSON object with short-phrase string fields: angle, surface, background, lighting, palette, props, mood, and optionally season. Describe only the scene. Do NOT mention text, captions, logos, or watermarks.`;

    const completion = await openai.chat.completions.create(
      {
        model: MODEL_FAST,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 300,
        response_format: { type: "json_object" },
      },
      { timeout: OPENAI_TIMEOUT_FAST_MS },
    );

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return deterministic;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return deterministic;
    }

    const validated = ArtDirectionLLMSchema.safeParse(parsed);
    if (!validated.success) {
      log.warn(
        { issues: validated.error.issues },
        "art-director LLM response failed validation; using deterministic",
      );
      return deterministic;
    }

    const d = validated.data;
    return {
      angle: sanitizeField(d.angle),
      surface: sanitizeField(d.surface),
      background: sanitizeField(d.background),
      lighting: sanitizeField(d.lighting),
      palette: sanitizeField(d.palette),
      props: sanitizeField(d.props),
      mood: sanitizeField(d.mood),
      season: d.season ? sanitizeField(d.season) : undefined,
    };
  } catch (err) {
    log.warn(
      { err: toError(err) },
      "art-director LLM call failed; using deterministic",
    );
    return deterministic;
  }
}

export async function buildImagePrompt(
  ctx: RecipeImageContext,
  variant: ImageVariant,
  opts?: { skipLLM?: boolean },
): Promise<string> {
  const art = await resolveArtDirection(ctx, variant, opts);
  return composePrompt(subjectFor(ctx, variant), art);
}
