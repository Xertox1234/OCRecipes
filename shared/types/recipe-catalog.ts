import { z } from "zod";

/**
 * Runtime schemas for the Spoonacular catalog search response. Shared between
 * the server (`server/services/recipe-catalog.ts`, which validates the raw
 * Spoonacular payload) and the client hook `useCatalogSearch`, which validates
 * the GET /api/meal-plan/catalog/search response at the network boundary.
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

/** Response of GET /api/meal-plan/catalog/config — reports whether this
 *  deployment has the online catalog configured (SPOONACULAR_API_KEY present).
 *  Capability probe only; does not affect the premium gate. */
export const catalogConfigResponseSchema = z.object({ enabled: z.boolean() });
export type CatalogConfigResponse = z.infer<typeof catalogConfigResponseSchema>;
