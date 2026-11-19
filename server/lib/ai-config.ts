/**
 * AI timeout constants. Constructs nothing and reads no env, so importing it
 * is free (client construction lives in `openai.ts` / `ai-client.ts`).
 */
export const OPENAI_DEFAULT_TIMEOUT_MS = 45_000;

export const OPENAI_TIMEOUT_FAST_MS = 15_000; // food-nlp: simple text parsing
export const OPENAI_TIMEOUT_STREAM_MS = 30_000; // nutrition-coach: streaming chat
export const OPENAI_TIMEOUT_HEAVY_MS = 60_000; // recipe/meal generation: large token budgets
export const OPENAI_TIMEOUT_LONG_MS = 120_000; // recipe-chat photo analysis, canonical editorial content: long outputs
// The Vertex backup leg's timeout for every OPENAI_TIMEOUT_FAST_MS caller
// (aiChat applies it; owner 2026-11-03 after 15 s timeouts in the PR 3 gate).
export const VERTEX_BACKUP_TIMEOUT_FAST_MS = 30_000;

type Env = Record<string, string | undefined>;

/** The three variables Vertex AI direct needs (server/lib/vertex-client.ts). */
export const VERTEX_ENV_VARS = [
  "GOOGLE_VERTEX_PROJECT",
  "GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY",
] as const;

/** Which Vertex variables are missing or blank; all three means "not set up". */
export function missingVertexVars(env: Env = process.env): string[] {
  return VERTEX_ENV_VARS.filter((name) => !env[name]?.trim());
}

/**
 * True when aiChat has at least one route: an OpenRouter key, or the full
 * Vertex set. Every chat and vision call goes through aiChat; the retired
 * OpenAI-direct key now serves voice transcription only (reliability audit
 * 2026-11-19, M-rel-3).
 */
export function hasAiChatRoute(env: Env = process.env): boolean {
  return (
    Boolean(env.OPENROUTER_API_KEY?.trim()) ||
    missingVertexVars(env).length === 0
  );
}
