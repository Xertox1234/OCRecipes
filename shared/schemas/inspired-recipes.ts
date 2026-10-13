// shared/schemas/inspired-recipes.ts
// Inspired recipes (spec 2026-10-12): AI-written cards; nothing from Spoonacular.
import { z } from "zod";
import type { InspiredSuggestionRow } from "../schema";

export const INSPIRED_LISTING_SIZE = 8;
export const SUGGESTION_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Rolling-24h cap on idea cards per user, across Recipe Browser + Recipe
 * Finder. Cost guard: roughly 10 Browser listings.
 */
export const INSPIRED_DAILY_CARD_CAP = 80;
/**
 * A make started longer ago than this is treated as a crashed request: the
 * lock can be retaken, and the expiry purge may delete the card.
 */
export const MAKING_STALE_MS = 2 * 60 * 1000;

/** What the AI returns for one card. */
export const suggestionDraftSchema = z.object({
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().min(10).max(140),
  totalMinutes: z.number().int().min(5).max(240),
  tags: z.array(z.string().trim().min(1).max(24)).max(5),
});
export type SuggestionDraft = z.infer<typeof suggestionDraftSchema>;

/** What the client sees for one card. */
export const suggestionSchema = suggestionDraftSchema.extend({
  id: z.number().int().positive(),
  imageUrl: z.string().nullable(),
  madeRecipeId: z.number().int().positive().nullable(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export const createListingBodySchema = z.object({
  query: z.string().trim().min(1).max(200),
  cuisine: z.string().trim().min(1).max(50).optional(),
  diet: z.string().trim().min(1).max(50).optional(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  maxReadyTime: z.number().int().positive().max(1440).optional(),
});
export type CreateListingBody = z.infer<typeof createListingBodySchema>;

export const listingResponseSchema = z.object({
  suggestions: z.array(suggestionSchema),
});
export type ListingResponse = z.infer<typeof listingResponseSchema>;

export const makeResponseSchema = z.object({
  recipeId: z.number().int().positive(),
});
export type MakeResponse = z.infer<typeof makeResponseSchema>;

export function toSuggestion(row: InspiredSuggestionRow): Suggestion {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    totalMinutes: row.totalMinutes,
    tags: row.tags,
    imageUrl: row.imageUrl,
    madeRecipeId: row.madeRecipeId,
  };
}
