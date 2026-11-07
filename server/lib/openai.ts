import OpenAI from "openai";
import { logger } from "./logger";
import { OPENAI_DEFAULT_TIMEOUT_MS } from "./ai-config";

// Timeout constants live in ai-config.ts (constructs nothing); re-exported so
// existing importers and their vi.mock("…/lib/openai") factories keep applying.
export {
  OPENAI_TIMEOUT_FAST_MS,
  OPENAI_TIMEOUT_STREAM_MS,
  OPENAI_TIMEOUT_HEAVY_MS,
  OPENAI_TIMEOUT_LONG_MS,
  VERTEX_BACKUP_TIMEOUT_FAST_MS,
} from "./ai-config";

if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  logger.warn("AI_INTEGRATIONS_OPENAI_API_KEY not set — AI features will fail");
}

/** Whether OpenAI API is configured and AI features should work */
export const isAiConfigured = !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

let client: OpenAI | undefined;

/**
 * The OpenAI client, built on first use (env is read then, not at import).
 * Throws when AI is unconfigured — the SDK rejects an empty key, and a
 * placeholder key would only defer the failure to a confusing 401.
 */
export function getOpenAI(): OpenAI {
  if (client) return client;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OpenAI is not configured (AI_INTEGRATIONS_OPENAI_API_KEY)",
    );
  }
  client = new OpenAI({
    apiKey,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    timeout: OPENAI_DEFAULT_TIMEOUT_MS,
  });
  return client;
}
