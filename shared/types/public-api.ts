import { z } from "zod";
import { verificationLevelSchema } from "./verification";

/** Free tier response: unverified nutrition data */
export const freeProductResponseSchema = z.object({
  barcode: z.string(),
  productName: z.string().nullable(),
  brandName: z.string().nullable(),
  servingSize: z.string().nullable(),
  calories: z.number().nullable(),
  protein: z.number().nullable(),
  carbs: z.number().nullable(),
  fat: z.number().nullable(),
  source: z.string(),
  verified: z.literal(false),
});
export type FreeProductResponse = z.infer<typeof freeProductResponseSchema>;

/** Paid tier response: verified data with provenance metadata */
export const paidProductResponseSchema = z.object({
  barcode: z.string(),
  productName: z.string().nullable(),
  brandName: z.string().nullable(),
  servingSize: z.string().nullable(),
  calories: z.number().nullable(),
  protein: z.number().nullable(),
  carbs: z.number().nullable(),
  fat: z.number().nullable(),
  source: z.string(),
  verified: z.boolean(),
  verificationLevel: verificationLevelSchema.nullable(),
  verificationCount: z.number().nullable(),
  lastVerifiedAt: z.string().nullable(),
  frontLabel: z
    .object({
      brand: z.string().nullable(),
      productName: z.string().nullable(),
      netWeight: z.string().nullable(),
      claims: z.array(z.string()),
    })
    .nullable(),
});
export type PaidProductResponse = z.infer<typeof paidProductResponseSchema>;

/** Public API response shape for a single curated (canonical) recipe. */
export interface CuratedRecipeResponse {
  id: number;
  title: string;
  description: string | null;
  cuisineOrigin: string | null;
  difficulty: string | null;
  timeEstimate: string | null;
  servings: number | null;
  dietTags: string[];
  mealTypes: string[];
  caloriesPerServing: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  ingredients: { name: string; quantity: string; unit: string }[];
  instructions: string[];
  instructionDetails: (string | null)[];
  toolsRequired: { name: string; affiliateUrl?: string }[];
  chefTips: string[];
  canonicalImages: string[];
  videoUrl: string | null;
  canonicalizedAt: string | null;
}
