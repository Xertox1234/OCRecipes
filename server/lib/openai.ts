import OpenAI from "openai";
import { logger } from "./logger";

const OPENAI_DEFAULT_TIMEOUT_MS = 45_000;

export const OPENAI_TIMEOUT_FAST_MS = 15_000; // food-nlp: simple text parsing
export const OPENAI_TIMEOUT_STREAM_MS = 30_000; // nutrition-coach: streaming chat
export const OPENAI_TIMEOUT_HEAVY_MS = 60_000; // recipe/meal generation: large token budgets
export const OPENAI_TIMEOUT_IMAGE_MS = 120_000; // DALL-E: image generation

// Centralized model constants — change here to update all AI calls
export const MODEL_FAST = "gpt-4o-mini"; // lightweight tasks: parsing, classification, coaching
export const MODEL_HEAVY = "gpt-4o"; // vision, recipe generation, meal planning

const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
if (!apiKey) {
  logger.warn("AI_INTEGRATIONS_OPENAI_API_KEY not set — AI features will fail");
}

/** Whether OpenAI API is configured and AI features should work */
export const isAiConfigured = !!apiKey;

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
