import { z } from "zod";

/**
 * Runtime schemas for the Spoonacular catalog search response, used by
 * `server/services/recipe-catalog.ts` to validate the raw Spoonacular payload.
 */
export const catalogSearchResultSchema = z.object({
  id: z.number(),
  title: z.string(),
  image: z.string().optional(),
  imageType: z.string().optional(),
  readyInMinutes: z.number().optional(),
});

export const catalogSearchResponseSchema = z.object({
  results: z.array(catalogSearchResultSchema),
  offset: z.number(),
  number: z.number(),
  totalResults: z.number(),
});

export type CatalogSearchResult = z.infer<typeof catalogSearchResultSchema>;

export type CatalogSearchResponse = z.infer<typeof catalogSearchResponseSchema>;

export interface CatalogSearchParams {
  query: string;
  cuisine?: string;
  diet?: string;
  type?: string;
  maxReadyTime?: number;
  offset?: number;
  number?: number;
}
