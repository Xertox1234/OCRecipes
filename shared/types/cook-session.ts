import { z } from "zod";
import { foodCategorySchema } from "@shared/constants/preparation";

// ============================================================================
// SHARED TYPES
// ============================================================================

/** AI-generated recipe content returned by the recipe generation service. */
export interface RecipeContent {
  title: string;
  description: string;
  difficulty: "Easy" | "Medium" | "Hard";
  timeEstimate: string;
  instructions: string;
  dietTags: string[];
}

/** Signed calorie/macro difference (can be negative for reductions). */
export interface MacroDelta {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface SubstitutionSuggestion {
  originalIngredientId: string;
  substitute: string;
  reason: string;
  ratio: string;
  macroDelta: MacroDelta;
  confidence: number;
}

export interface SubstitutionResult {
  suggestions: SubstitutionSuggestion[];
  dietaryProfileSummary: string;
}

// ============================================================================
// SESSION INGREDIENT (shared between client display and server responses)
// ============================================================================

export interface CookingSessionIngredient {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  confidence: number;
  category: z.infer<typeof foodCategorySchema>;
  photoId: string;
  preparationMethod?: string;
  userEdited: boolean;
}

export interface CookingSessionPhoto {
  id: string;
  addedAt: number; // epoch ms
}

export interface CookingSessionResponse {
  id: string;
  ingredients: CookingSessionIngredient[];
  photos: CookingSessionPhoto[];
  createdAt: number; // epoch ms
}

// ============================================================================
// NUTRITION SUMMARY
// ============================================================================

export interface CookSessionNutritionItem {
  ingredientId: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
  servingSize: string;
  cookingMethodApplied?: string;
}

export interface CookSessionNutritionSummary {
  total: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
    sugar: number;
    sodium: number;
  };
  items: CookSessionNutritionItem[];
}

// ============================================================================
// REQUEST/RESPONSE SCHEMAS (Zod for runtime validation)
// ============================================================================

export const ingredientEditSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  quantity: z.number().positive().max(10000).optional(),
  unit: z.string().min(1).max(50).optional(),
  preparationMethod: z.string().max(50).optional(),
});

export type IngredientEdit = z.infer<typeof ingredientEditSchema>;

export const nutritionRequestSchema = z.object({
  cookingMethod: z.string().max(50).optional(),
});

export const logRequestSchema = z.object({
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  date: z.string().optional(),
});

export const substitutionRequestSchema = z.object({
  ingredientIds: z.array(z.string().uuid()).optional(),
});

export const substitutionSuggestionSchema = z.object({
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
});

export const ingredientDetectionSchema = z.object({
  name: z.string(),
  quantity: z.number().positive(),
  unit: z.string(),
  confidence: z.number().min(0).max(1),
  category: foodCategorySchema.optional().default("other"),
});

export const photoAnalysisResponseSchema = z.object({
  ingredients: z.array(ingredientDetectionSchema),
});
