import { z } from "zod";
import {
  allergenIdSchema,
  allergySeveritySchema,
  type AllergenId,
  type AllergySeverity,
  type AllergenMatch,
} from "@shared/constants/allergens";
import type { SubstitutionSuggestion } from "./cook-session";

// ============================================================================
// SHARED TYPES
// ============================================================================

/** A substitution suggestion enriched with allergen context. */
export interface AllergenSubstitutionSuggestion extends SubstitutionSuggestion {
  /** Which allergen this substitution addresses. */
  allergenId: AllergenId;
  /** The user's declared severity for this allergen. */
  severity: AllergySeverity;
  /** The functional role the original ingredient serves (e.g. "binder", "fat"). */
  functionalRole?: string;
}

/** Full result from the allergen-check endpoint. */
export interface AllergenCheckResult {
  /** Ingredients that matched the user's declared allergens. */
  matches: AllergenMatch[];
  /** Safe substitution suggestions for the matched ingredients. */
  substitutions: AllergenSubstitutionSuggestion[];
}

// ============================================================================
// REQUEST / RESPONSE SCHEMAS (Zod for runtime validation)
// ============================================================================

export const allergenCheckRequestSchema = z.object({
  ingredients: z
    .array(z.string().min(1).max(200))
    .min(1, "At least one ingredient is required")
    .max(100, "Too many ingredients"),
});

export type AllergenCheckRequest = z.infer<typeof allergenCheckRequestSchema>;

export const allergenCheckMatchSchema = z.object({
  allergenId: allergenIdSchema,
  severity: allergySeveritySchema,
  ingredientName: z.string(),
  matchedKeyword: z.string(),
  isDerived: z.boolean(),
});

export const allergenSubstitutionSchema = z.object({
  originalIngredientId: z.string(),
  substitute: z.string(),
  reason: z.string(),
  ratio: z.string(),
  macroDelta: z.object({
    calories: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
  }),
  confidence: z.number().min(0).max(1),
  allergenId: allergenIdSchema,
  severity: allergySeveritySchema,
  functionalRole: z.string().optional(),
});

export const allergenCheckResultSchema = z.object({
  matches: z.array(allergenCheckMatchSchema),
  substitutions: z.array(allergenSubstitutionSchema),
});
