// server/lib/ai-models.ts
/**
 * One row per AI call site. `model` is the provider-prefixed id (OpenRouter's
 * form, which Vertex's OpenAI-compatible endpoint also uses). Each row has
 * exactly one backup kind, and none reaches OpenAI direct (gpt-4o/mini shut
 * down there 2027-01-14): `vertexBackup` goes OpenRouter → Vertex direct
 * (spec 2026-11-02-vertex-backup-route-design §3); a row with
 * `primary: "vertex"` goes Vertex direct → OpenRouter
 * (spec 2026-10-19-vision-rows-vertex-direct §2).
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

interface AiFeatureBase {
  model: string;
  json: boolean;
  vision: boolean;
  adapt?: AiAdapt;
}

/** Either Vertex-first, or OpenRouter-first with the Vertex backup. */
export type AiFeatureConfig = AiFeatureBase &
  (
    | { primary: "vertex"; vertexBackup?: never }
    | {
        primary?: never;
        /** Vertex AI direct as the backup when OpenRouter fails. */
        vertexBackup: { model: string; adapt?: AiAdapt };
      }
  );

// The Vertex-direct backup for every `vertexBackup` row (owner ruling
// 2026-11-02): Flash, not the row's own model — Vertex keeps "frontier" models'
// prompts up to 30 days on every request; Flash's only when abuse-flagged.
export const VERTEX_BACKUP = {
  model: "google/gemini-3.8-flash",
  adapt: { set: { reasoning_effort: "low" } },
} as const;

// Added to the row's token cap on the backup leg (owner 2026-11-03): Flash
// counts thinking inside the cap and cannot switch it off ("none"/"minimal"
// are rejected, thinking_budget 0 is ignored); one 200-cap call spent 189 on
// it in the PR 3 gate.
export const VERTEX_BACKUP_REASONING_HEADROOM = 1000;

// Every row backs up to Vertex direct (Flash), never OpenAI (owner 2026-11-03;
// spec 2026-11-02-vertex-backup-route-design).
const FAST = {
  model: "openai/gpt-4o-mini",
  vertexBackup: VERTEX_BACKUP,
} as const;
const HEAVY = { model: "openai/gpt-4o", vertexBackup: VERTEX_BACKUP } as const;
// GPT-6 Luna (owner ruling 2026-10-06, both coach chats): no temperature
// parameter; low reasoning effort keeps chat latency and cost down. Backup:
// Vertex direct (Flash) — spec 2026-11-02-vertex-backup-route-design.
const LUNA = {
  model: "openai/gpt-6-luna",
  vertexBackup: VERTEX_BACKUP,
  adapt: { drop: ["temperature"], set: { reasoning_effort: "low" } },
} as const;

export const AI_FEATURES = {
  // Coach
  "coach-chat": { ...LUNA, json: false, vision: false }, // nutrition-coach generateCoachResponse (stream)
  "coach-pro-chat": { ...LUNA, json: false, vision: false }, // nutrition-coach generateCoachProResponse (stream, tools)
  "coach-notebook-extract": { ...FAST, json: true, vision: false }, // notebook-extraction extractNotebookEntries
  "coach-weekly-report": { ...FAST, json: true, vision: false }, // weekly-report writeWeeklyReport (one call per user-week)
  // Recipe chat
  // Gemini 3.8 Flash (owner-approved 2026-11-02, paired eval safety +0.96 vs
  // gpt-4o, p50 5.9 s to the card vs Argon's 11.7 s; todo
  // P2-2026-10-17-recipe-chat-row-model-eval-before-switch). Backup: Vertex
  // direct (Flash) — spec 2026-11-02-vertex-backup-route-design.
  "recipe-chat": {
    model: "google/gemini-3.8-flash",
    vertexBackup: VERTEX_BACKUP,
    json: false,
    vision: false,
    adapt: { set: { reasoning_effort: "low" } },
  }, // recipe-chat generateRecipeChatResponse (stream)
  "recipe-chat-image": { ...HEAVY, json: false, vision: true }, // recipe-chat analyzeImageForRecipe
  // Photo analysis (photo-analysis.ts)
  "photo-recipe": { ...HEAVY, json: true, vision: true }, // analyzeRecipePhoto
  "photo-recipe-text": { ...FAST, json: true, vision: false }, // structureRecipeFromText
  // Gemini 3.8 Flash (owner-approved 2026-11-05, paired eval with the
  // no-invented-zeros prompt 9.01 vs gpt-4o 8.93, faster and ~half the cost;
  // todo P2-2026-10-18-camera-vision-features-to-gemini). Backup: Vertex
  // direct (Flash) — spec 2026-11-02-vertex-backup-route-design.
  "photo-label": {
    model: "google/gemini-3.8-flash",
    vertexBackup: VERTEX_BACKUP,
    json: true,
    vision: true,
    adapt: { set: { reasoning_effort: "low" } },
  }, // analyzeLabelPhoto
  // Gemini 3.8 Flash (owner-approved 2026-10-19, paired eval 7.76 vs gpt-4o
  // 6.90; todo P2-2026-10-18-camera-vision-features-to-gemini). Low reasoning
  // keeps the JSON reply inside its token cap. Backup: Vertex direct (Flash) —
  // spec 2026-11-02-vertex-backup-route-design.
  "photo-analyze": {
    model: "google/gemini-3.8-flash",
    vertexBackup: VERTEX_BACKUP,
    json: true,
    vision: true,
    adapt: { set: { reasoning_effort: "low" } },
  }, // analyzePhoto
  "photo-refine": { ...HEAVY, json: true, vision: false }, // refineAnalysis
  // Gemini 3.8 Flash (owner-approved 2026-11-06, accuracy 10.0 = 10.0 at the 1000 cap classifyPhoto now sends; gpt-4o-mini retires 2027; todo
  // P2-2026-10-18-camera-vision-features-to-gemini). Backup: Vertex direct
  // (Flash) — spec 2026-11-02-vertex-backup-route-design.
  "photo-classify": {
    model: "google/gemini-3.8-flash",
    vertexBackup: VERTEX_BACKUP,
    json: true,
    vision: true,
    adapt: { set: { reasoning_effort: "low" } },
  }, // classifyPhoto (classifyAndAnalyze step 1)
  // Other vision services
  // Gemini 3.8 Flash (owner 2026-11-06: switch on the measured data, no
  // further re-measure). Eval: item decoding 8.76 vs gpt-4o 4.56, paired gate
  // passes, ~half the cost; its one failure (category "deli") is normalised by
  // receiptItemSchema. Largest reply 2443 of the 4096 cap. Todo
  // P2-2026-10-18-camera-vision-features-to-gemini. Backup: Vertex direct.
  "receipt-scan": {
    model: "google/gemini-3.8-flash",
    vertexBackup: VERTEX_BACKUP,
    json: true,
    vision: true,
    adapt: { set: { reasoning_effort: "low" } },
  }, // receipt-analysis analyzeReceiptPhotos
  "menu-scan": { ...HEAVY, json: true, vision: true }, // menu-analysis analyzeMenuPhoto
  // Gemini 3.8 Flash (owner-approved 2026-11-05, paired eval 8.92 vs gpt-4o
  // 7.83, claims fidelity +0.96; todo P2-2026-10-18-camera-vision-features-to-
  // gemini). Needs the 1300 reply cap in analyzeFrontLabel. Backup: Vertex
  // direct (Flash) — spec 2026-11-02-vertex-backup-route-design.
  "front-label-scan": {
    model: "google/gemini-3.8-flash",
    vertexBackup: VERTEX_BACKUP,
    json: true,
    vision: true,
    adapt: { set: { reasoning_effort: "low" } },
  }, // front-label-analysis analyzeFrontLabel
  // Gemini 3.8 Flash (owner-approved 2026-11-06, paired eval 8.12 vs gpt-4o 6.81, 0/15 failures vs 2/15, ~60% cheaper; todo
  // P2-2026-10-18-camera-vision-features-to-gemini). Backup: Vertex direct
  // (Flash) — spec 2026-11-02-vertex-backup-route-design.
  "cooking-ingredient-photo": {
    model: "google/gemini-3.8-flash",
    vertexBackup: VERTEX_BACKUP,
    json: true,
    vision: true,
    adapt: { set: { reasoning_effort: "low" } },
  }, // cooking-session analyzeIngredientPhoto
  // Recipes & meals
  // Gemini 4 Argon (owner-approved 2026-10-17, paired eval +1.97 creativity vs
  // gpt-4o, 0/36 assertion failures; spec 2026-10-17-recipe-generate-argon-
  // background-completion §1). Backup: Vertex direct (Flash, never Argon —
  // spec 2026-11-02-vertex-backup-route-design §1). Gemini keeps `temperature`
  // and OpenRouter honours `max_completion_tokens` for it, so no adapt block.
  "recipe-generate": {
    model: "google/gemini-4-argon",
    vertexBackup: VERTEX_BACKUP,
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
