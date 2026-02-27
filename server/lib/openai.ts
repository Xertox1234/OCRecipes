import OpenAI from "openai";

const OPENAI_DEFAULT_TIMEOUT_MS = 45_000;

const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
if (!apiKey) {
  console.warn(
    "AI_INTEGRATIONS_OPENAI_API_KEY not set — AI features will fail",
  );
}

export const openai = new OpenAI({
  apiKey: apiKey ?? "",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  timeout: OPENAI_DEFAULT_TIMEOUT_MS,
});

// DALL-E client uses direct OpenAI API (custom endpoints may not support image generation)
export const dalleClient = new OpenAI({
  apiKey: apiKey ?? "",
  timeout: OPENAI_DEFAULT_TIMEOUT_MS,
});
