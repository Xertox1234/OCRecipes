// server/lib/ai-models.ts
/**
 * One row per AI call site. `model` is the OpenRouter id (provider-prefixed);
 * `fallback` is the id for the existing OpenAI client (today's path). Moving
 * a feature to another model = edit its row (spec §3.1, owner approval +
 * paired eval report required — spec §5/§6).
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
  fallback: string;
  json: boolean;
  vision: boolean;
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
  "photo-analyze": { ...HEAVY, json: true, vision: true }, // analyzePhoto
  "photo-refine": { ...HEAVY, json: true, vision: false }, // refineAnalysis
  "photo-classify": { ...FAST, json: true, vision: true }, // classifyAndAnalyze
  // Other vision services
  "receipt-scan": { ...HEAVY, json: true, vision: true }, // receipt-analysis analyzeReceiptPhotos
  "menu-scan": { ...HEAVY, json: true, vision: true }, // menu-analysis analyzeMenuPhoto
  "front-label-scan": { ...HEAVY, json: true, vision: true }, // front-label-analysis analyzeFrontLabel
  "cooking-ingredient-photo": { ...HEAVY, json: true, vision: true }, // cooking-session analyzeIngredientPhoto
  // Recipes & meals
  "recipe-generate": { ...HEAVY, json: true, vision: false }, // recipe-generation generateRecipeContent
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
  // Images / covers
  "image-art-direction": { ...FAST, json: true, vision: false }, // image-art-direction resolveArtDirection
  "cookbook-cover-subject": { ...FAST, json: true, vision: false }, // cookbook-cover deriveCoverSubject
  // Scripts
  "script-seed-macros": { ...FAST, json: true, vision: false }, // server/scripts/seed-recipes estimateMacros
  "script-backfill-macros": { ...FAST, json: true, vision: false }, // server/scripts/backfill-community-nutrition estimateMacros
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
