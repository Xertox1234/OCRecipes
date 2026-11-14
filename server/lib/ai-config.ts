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
