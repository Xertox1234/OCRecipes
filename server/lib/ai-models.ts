// server/lib/ai-models.ts
/**
 * One row per AI call site. `model` is the provider-prefixed id (OpenRouter's
 * form, which Vertex's OpenAI-compatible endpoint also uses). `fallback` is
 * the id for the existing OpenAI client (today's path). A row with
 * `primary: "vertex"` goes Vertex direct → OpenRouter and has NO `fallback`:
 * it never reaches OpenAI (spec 2026-10-19-vision-rows-vertex-direct §2).
 * Moving a feature to another model = edit its row (owner approval + paired
 * eval report required).
 *
 * `json` / `vision` describe the call (response_format json_object / an
 * image_url part) — scripts/ai-smoke.ts reproduces them per row.
 */
export interface AiAdapt {
  drop?: readonly string[];
  rename?: Readonly<Record<string, string>>;
  set?: Readonly<Record<string, unknown>>;
}

export interface AiFeatureConfig {
  model: string;
  /** OpenAI-direct model id. Absent exactly when `primary` is "vertex". */
  fallback?: string;
  json: boolean;
  vision: boolean;
  primary?: "vertex";
  adapt?: AiAdapt;
}

const FAST = { model: "openai/gpt-4o-mini", fallback: "gpt-4o-mini" } as const;
const HEAVY = { model: "openai/gpt-4o", fallback: "gpt-4o" } as const;
// GPT-6 Luna (owner ruling 2026-10-06, both coach chats): no temperature
// parameter; low reasoning effort keeps chat latency and cost down.
const LUNA = {
  model: "openai/gpt-6-luna",
  fallback: "gpt-4o-mini",
  adapt: { drop: ["temperature"], set: { reasoning_effort: "low" } },
} as const;

export const AI_FEATURES = {
  // Coach
  "coach-chat": { ...LUNA, json: false, vision: false }, // nutrition-coach generateCoachResponse (stream)
  "coach-pro-chat": { ...LUNA, json: false, vision: false }, // nutrition-coach generateCoachProResponse (stream, tools)
  "coach-notebook-extract": { ...FAST, json: true, vision: false }, // notebook-extraction extractNotebookEntries
  // Recipe chat
  "recipe-chat": { ...HEAVY, json: false, vision: false }, // recipe-chat generateRecipeChatResponse (stream)
  "recipe-chat-image": { ...HEAVY, json: false, vision: true }, // recipe-chat analyzeImageForRecipe
  // Photo analysis (photo-analysis.ts)
  "photo-recipe": { ...HEAVY, json: true, vision: true }, // analyzeRecipePhoto
  "photo-recipe-text": { ...FAST, json: true, vision: false }, // structureRecipeFromText
  "photo-label": { ...HEAVY, json: true, vision: true }, // analyzeLabelPhoto
  // Gemini 3.8 Flash (owner-approved 2026-10-19, paired eval 7.76 vs gpt-4o
  // 6.90; todo P2-2026-10-18-camera-vision-features-to-gemini). Low reasoning
  // keeps the JSON reply inside its token cap. Direct-OpenAI fallback stays
  // gpt-4o until nearer its 2027-01-14 retirement.
  "photo-analyze": {
    model: "google/gemini-3.8-flash",
    fallback: "gpt-4o",
    json: true,
    vision: true,
    adapt: { set: { reasoning_effort: "low" } },
  }, // analyzePhoto
  "photo-refine": { ...HEAVY, json: true, vision: false }, // refineAnalysis
  "photo-classify": { ...FAST, json: true, vision: true }, // classifyAndAnalyze
  // Other vision services
  "receipt-scan": { ...HEAVY, json: true, vision: true }, // receipt-analysis analyzeReceiptPhotos
  "menu-scan": { ...HEAVY, json: true, vision: true }, // menu-analysis analyzeMenuPhoto
  "front-label-scan": { ...HEAVY, json: true, vision: true }, // front-label-analysis analyzeFrontLabel
  "cooking-ingredient-photo": { ...HEAVY, json: true, vision: true }, // cooking-session analyzeIngredientPhoto
  // Recipes & meals
  // Gemini 4 Argon (owner-approved 2026-10-17, paired eval +1.97 creativity vs
  // gpt-4o, 0/36 assertion failures; spec 2026-10-17-recipe-generate-argon-
  // background-completion §1). Direct-OpenAI fallback stays gpt-4o until nearer
  // its 2027-01-14 retirement. Gemini keeps `temperature` and OpenRouter
  // honours `max_completion_tokens` for it, so no adapt block.
  "recipe-generate": {
    model: "google/gemini-4-argon",
    fallback: "gpt-4o",
    json: true,
    vision: false,
  }, // recipe-generation generateRecipeContent
  "meal-suggestions": { ...HEAVY, json: true, vision: false }, // meal-suggestions generateMealSuggestions
  "pantry-meal-plan": { ...HEAVY, json: true, vision: false }, // pantry-meal-plan generateMealPlanFromPantry
  "ingredient-substitution": { ...HEAVY, json: true, vision: false }, // ingredient-substitution getAiSubstitutions
  "canonical-editorial": { ...HEAVY, json: false, vision: false }, // canonical-enrichment generateEditorialContent
  "suggestion-generate": { ...FAST, json: true, vision: false }, // suggestion-generation generateSuggestions
  "suggestion-instructions": { ...FAST, json: false, vision: false }, // suggestion-generation generateInstructions
  "food-nlp-parse": { ...FAST, json: true, vision: false }, // food-nlp parseNaturalLanguageFood
  // Recipe finder
  "finder-classify-turn": { ...FAST, json: true, vision: false }, // recipe-finder/classify-turn
  "finder-ask-clarifying": { ...FAST, json: true, vision: false }, // recipe-finder/ask-clarifying
  "finder-extract-query": { ...FAST, json: true, vision: false }, // recipe-finder/extract-query
  "finder-extract-offer": { ...FAST, json: true, vision: false }, // recipe-finder/extract-query extractOfferDetails
  "finder-dish-follow-ups": { ...FAST, json: true, vision: false }, // recipe-finder/ask-follow-ups
  // Inspired recipes
  "inspired-suggestions": { ...FAST, json: true, vision: false }, // inspired-recipes/suggest-listing
  // Images / covers
  "image-art-direction": { ...FAST, json: true, vision: false }, // image-art-direction resolveArtDirection
  "cookbook-cover-subject": { ...FAST, json: true, vision: false }, // cookbook-cover deriveCoverSubject
  // Scripts
  "script-seed-macros": { ...FAST, json: true, vision: false }, // server/scripts/seed-recipes estimateMacros
  "script-backfill-macros": { ...FAST, json: true, vision: false }, // server/scripts/backfill-community-nutrition estimateMacros
  "script-backfill-spice": { ...FAST, json: true, vision: false }, // server/scripts/backfill-recipe-spice-level askSpiceLevels
} as const satisfies Record<string, AiFeatureConfig>;

export type AiFeature = keyof typeof AI_FEATURES;

/**
 * The ONE OpenRouter host each provider's models may run on (sent as
 * `provider.only`). The privacy policy names these hosts, so a request must
 * never route elsewhere — e.g. OpenRouter also serves gpt-6-luna on Amazon
 * Bedrock. Adding a provider here requires a privacy-policy update first.
 */
export const PINNED_HOSTS: Readonly<Record<string, string>> = {
  openai: "azure",
  google: "google-vertex",
};

export function hostForModel(model: string): string | undefined {
  const slash = model.indexOf("/");
  if (slash < 1) return undefined;
  const provider = model.slice(0, slash);
  return Object.prototype.hasOwnProperty.call(PINNED_HOSTS, provider)
    ? PINNED_HOSTS[provider]
    : undefined;
}

export function isAiFeature(name: string): name is AiFeature {
  return Object.prototype.hasOwnProperty.call(AI_FEATURES, name);
}

/** Rewrites applied ONLY to the OpenRouter attempt (spec §3.3). */
export function adaptParams(
  params: Record<string, unknown>,
  adapt: AiAdapt | undefined,
  extraSet: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params };
  for (const key of adapt?.drop ?? []) delete out[key];
  for (const [from, to] of Object.entries(adapt?.rename ?? {})) {
    if (from in out) {
      if (!(to in out)) out[to] = out[from];
      delete out[from];
    }
  }
  return { ...out, ...adapt?.set, ...extraSet };
}
